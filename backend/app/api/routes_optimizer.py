import os
import json
import asyncio
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from app.core.graph_model import (
    UrbanFlowGraph,
    TrafficDemand,
    OptimizationResult,
    SimulationConfig,
    InterventionAction,
    OptimizerRecommendation
)
from app.core.assignment import simulate_traffic_msa
from app.core.intervention import apply_modifications
from app.api.routes_graphs import _GRAPHS, _DEMANDS
from app.api.routes_analysis import _AREA_GRAPHS, _AREA_DEMANDS
import networkx as nx

from pydantic import BaseModel, Field
from typing import Optional

from app.core.optimizer import select_corridor_candidates

router = APIRouter(prefix="/api/optimizer", tags=["Optimizer"])

# Multi-core thread pool utilizing all available CPU cores (e.g. 24 cores)
# Rustworkx releases the Python GIL during Dijkstra pathfinding, enabling full multi-core performance
# without spawning persistent Python child processes.
_OPTIMIZER_WORKERS = max(2, min(32, os.cpu_count() or 4))


def _eval_candidate(
    base_graph: UrbanFlowGraph,
    demand: TrafficDemand,
    demand_multiplier: float,
    config: SimulationConfig,
    job_type: str,
    edge_id: str,
    extra: dict,
    base_avg_time: float,
    baseline_speed: float,
    baseline_edge_metrics: Optional[dict] = None
) -> Optional[OptimizerRecommendation]:
    """Lightweight multi-threaded candidate evaluation with coupled widening."""
    edge = next((e for e in base_graph.edges if e.id == edge_id), None)
    if not edge:
        return None

    is_oneway = job_type in ("MAKE_ONE_WAY", "REMOVE_ROAD")
    if is_oneway:
        action = InterventionAction(
            action="ONE_WAY",
            edge_id=edge.id,
            rationale=f"Convert corridor {edge.name or edge.id} into a designated one-way street"
        )
    else:
        new_lanes = extra.get("new_lanes", edge.lanes + 1)
        new_cap = extra.get("new_capacity", edge.capacity_vph * 1.5)
        action = InterventionAction(action="WIDEN", edge_id=edge.id, new_lanes=new_lanes, new_capacity_vph=new_cap)

    # Fast convergence config matching simulation precision
    eval_config = SimulationConfig(
        algorithm="msa",
        max_iterations=max(config.max_iterations, 25),
        convergence_tolerance=config.convergence_tolerance or 1e-3,
        default_alpha=config.default_alpha,
        default_beta=config.default_beta
    )
    mod_graph = apply_modifications(base_graph, [action])
    result = simulate_traffic_msa(mod_graph, demand, demand_multiplier, eval_config)
    after = result.summary_metrics.avg_travel_time_mins
    gain = ((base_avg_time - after) / max(base_avg_time, 0.001)) * 100.0

    if gain <= 0.2:
        return None

    speed_after = result.summary_metrics.avg_network_speed_kmh
    throughput = ((speed_after - baseline_speed) / max(baseline_speed, 0.1)) * 100.0

    beneficiary_names = []
    # Identify beneficiary parallel corridors that absorb traffic from one-way conversions
    if is_oneway and baseline_edge_metrics:
        receiving = []
        for eid, m in result.edge_metrics.items():
            prev_vol = baseline_edge_metrics.get(eid).volume_vph if baseline_edge_metrics.get(eid) else 0.0
            dvol = m.volume_vph - prev_vol
            if dvol > 30.0 and eid != edge.id:
                receiving.append((eid, dvol, m.vc_ratio))
        receiving.sort(key=lambda x: x[1], reverse=True)
        for r_item in receiving[:2]:
            top_rec_edge = next((e for e in base_graph.edges if e.id == r_item[0]), None)
            if top_rec_edge and (top_rec_edge.name or top_rec_edge.id):
                beneficiary_names.append(top_rec_edge.name or top_rec_edge.id)

    # Custom explanatory rationale
    ben_text = f" (diverts to {', '.join(beneficiary_names)})" if beneficiary_names else ""
    if is_oneway:
        explanation = (
            f"Change: 1-way conversion (+40% fwd capacity) | "
            f"Effect: Resolves Braess bottleneck{ben_text}, cutting travel time by -{gain:.1f}%."
        )
    else:
        explanation = (
            f"Change: Add +1 lane ({extra.get('new_capacity', edge.capacity_vph * 1.5):.0f} vph) | "
            f"Effect: Bottleneck relief, cutting travel time by -{gain:.1f}%."
        )

    return OptimizerRecommendation(
        rank=0,
        type="MAKE_ONE_WAY" if is_oneway else "WIDEN_ROAD",
        edge_id=edge.id,
        edge_name=edge.name or f"Edge {edge.source}➔{edge.target}",
        action=action,
        avg_travel_time_before_mins=round(base_avg_time, 2),
        avg_travel_time_after_mins=round(after, 2),
        travel_time_reduction_pct=round(gain, 2),
        throughput_gain_pct=round(max(0.0, throughput), 2),
        is_braess_fix=is_oneway,
        explanation=explanation
    )


def _build_candidate_jobs(base_graph: UrbanFlowGraph, baseline, G_undir: nx.Graph, max_candidates: int = 20):
    """
    Corridor Alternative Analysis candidate builder:
    Identifies high-priority Braess shortcuts with viable alternative corridors,
    plus top bottleneck corridors for capacity expansion.
    Strictly deduplicates edges so no road is tested for both CLOSE and WIDEN.
    """
    max_rem = max(3, int(max_candidates * 0.7))
    max_wid = max(2, int(max_candidates * 0.3))
    tasks = select_corridor_candidates(base_graph, baseline, max_removals=max_rem, max_widenings=max_wid)
    candidates = []
    seen_edges = set()
    for action, job_type, meta in tasks:
        if action.edge_id not in seen_edges:
            seen_edges.add(action.edge_id)
            candidates.append((job_type, action.edge_id, meta))
    return candidates[:max_candidates]


class OptimizationRequestPayload(BaseModel):
    graph_id: Optional[str] = None
    demand_multiplier: Optional[float] = Field(default=1.0, ge=0.1, le=20.0)
    config: Optional[SimulationConfig] = None


@router.post("/recommend", response_model=OptimizationResult)
def get_recommendations(
    payload: Optional[OptimizationRequestPayload] = None,
    graph_id: Optional[str] = None,
    demand_multiplier: Optional[float] = None
):
    target_graph_id = (payload.graph_id if payload else None) or graph_id
    if not target_graph_id or (target_graph_id not in _GRAPHS and target_graph_id not in _AREA_GRAPHS):
        raise HTTPException(status_code=404, detail=f"Graph '{target_graph_id}' not found.")

    target_multiplier = demand_multiplier if demand_multiplier is not None else (payload.demand_multiplier if payload and payload.demand_multiplier is not None else 1.0)
    target_config = (payload.config if payload and payload.config else None) or SimulationConfig(algorithm="msa", max_iterations=30, convergence_tolerance=1e-3)

    base_graph = _AREA_GRAPHS.get(target_graph_id) or _GRAPHS[target_graph_id]
    demand = _AREA_DEMANDS.get(target_graph_id) or _DEMANDS.get(target_graph_id)
    if not demand:
        raise HTTPException(status_code=400, detail="No OD demand matrix found.")

    baseline = simulate_traffic_msa(base_graph, demand, target_multiplier, target_config)
    base_avg_time = baseline.summary_metrics.avg_travel_time_mins
    baseline_speed = baseline.summary_metrics.avg_network_speed_kmh

    G_undir = nx.Graph()
    for e in base_graph.edges:
        G_undir.add_edge(e.source, e.target)

    candidate_jobs = _build_candidate_jobs(base_graph, baseline, G_undir)
    total_candidates = len(candidate_jobs)

    recommendations = []
    with ThreadPoolExecutor(max_workers=_OPTIMIZER_WORKERS) as executor:
        futures = [
            executor.submit(
                _eval_candidate,
                base_graph,
                demand,
                target_multiplier,
                target_config,
                job_type,
                edge_id,
                extra,
                base_avg_time,
                baseline_speed,
                baseline.edge_metrics
            )
            for job_type, edge_id, extra in candidate_jobs
        ]
        for fut in as_completed(futures):
            try:
                rec = fut.result()
                if rec:
                    recommendations.append(rec)
            except Exception:
                pass

    # Deduplicate recommendations by edge_id (keep highest reduction pct)
    rec_by_edge = {}
    for r in recommendations:
        if r.edge_id not in rec_by_edge or r.travel_time_reduction_pct > rec_by_edge[r.edge_id].travel_time_reduction_pct:
            rec_by_edge[r.edge_id] = r
    recommendations = list(rec_by_edge.values())

    recommendations.sort(key=lambda r: r.travel_time_reduction_pct, reverse=True)
    for idx, rec in enumerate(recommendations, start=1):
        rec.rank = idx

    optimal_actions = []
    best_oneway = next((r.action for r in recommendations if r.type in ("MAKE_ONE_WAY", "REMOVE_ROAD")), None)
    if best_oneway:
        optimal_actions.append(best_oneway)
    for r in recommendations:
        if r.type == "WIDEN_ROAD":
            if not any(a.edge_id == r.action.edge_id for a in optimal_actions):
                optimal_actions.append(r.action)
        if len(optimal_actions) >= 3:
            break

    overall_gain = 0.0
    if optimal_actions:
        try:
            res_comb = simulate_traffic_msa(apply_modifications(base_graph, optimal_actions), demand, target_multiplier, target_config)
            comb_t = res_comb.summary_metrics.avg_travel_time_mins
            comb_g = ((base_avg_time - comb_t) / max(base_avg_time, 0.001)) * 100.0
            if comb_g > 0:
                overall_gain = comb_g
            else:
                optimal_actions = [recommendations[0].action]
                overall_gain = recommendations[0].travel_time_reduction_pct
        except Exception:
            optimal_actions = [recommendations[0].action] if recommendations else []
            overall_gain = recommendations[0].travel_time_reduction_pct if recommendations else 0.0

    return OptimizationResult(
        graph_id=base_graph.graph_id,
        baseline_avg_travel_time_mins=round(base_avg_time, 2),
        total_candidates_evaluated=total_candidates,
        recommendations=recommendations,
        optimal_combined_actions=optimal_actions,
        projected_overall_improvement_pct=round(overall_gain, 2),
        summary=f"Discovered {len(recommendations)} high-impact interventions. Top intervention achieves -{recommendations[0].travel_time_reduction_pct if recommendations else 0}% latency reduction."
    )


@router.get("/stream-optimize")
async def stream_optimization(
    graph_id: str,
    demand_multiplier: float = 1.0,
    max_iterations: int = 30,
    max_candidates: int = 20,
    min_savings_pct: float = 0.5,
    convergence_tolerance: float = 1e-3,
    alpha: float = 0.15,
    beta: float = 4.0
):
    """
    SSE streaming endpoint for real-time optimization evaluation utilizing all CPU cores.
    Uses multi-threaded worker execution with instant cleanup upon completion or cancellation.
    Zero lingering Python processes.
    """
    if graph_id not in _GRAPHS and graph_id not in _AREA_GRAPHS:
        raise HTTPException(status_code=404, detail=f"Graph '{graph_id}' not found.")

    base_graph = _AREA_GRAPHS.get(graph_id) or _GRAPHS[graph_id]
    demand = _AREA_DEMANDS.get(graph_id) or _DEMANDS.get(graph_id)
    if not demand:
        raise HTTPException(status_code=400, detail="No OD demand matrix found.")

    config = SimulationConfig(
        algorithm="msa",
        max_iterations=max_iterations,
        convergence_tolerance=convergence_tolerance,
        default_alpha=alpha,
        default_beta=beta
    )

    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()

    async def run_optimizer_pipeline():
        pool = ThreadPoolExecutor(max_workers=_OPTIMIZER_WORKERS)
        try:
            await queue.put({"type": "status", "message": "Running baseline equilibrium simulation across CPU cores..."})

            baseline = await loop.run_in_executor(
                pool,
                simulate_traffic_msa,
                base_graph,
                demand,
                demand_multiplier,
                config
            )
            base_avg_time = baseline.summary_metrics.avg_travel_time_mins
            baseline_speed = baseline.summary_metrics.avg_network_speed_kmh

            await queue.put({
                "type": "baseline",
                "avg_travel_time_mins": base_avg_time,
                "bottlenecks_count": len(baseline.bottlenecks)
            })

            G_undir = nx.Graph()
            for e in base_graph.edges:
                G_undir.add_edge(e.source, e.target)

            candidate_jobs = _build_candidate_jobs(base_graph, baseline, G_undir, max_candidates=max_candidates)
            total_candidates = len(candidate_jobs)

            await queue.put({
                "type": "init",
                "total": total_candidates,
                "total_candidates": total_candidates,
                "current": 0,
                "baseline_time": base_avg_time
            })

            import time
            recommendations = []
            eval_idx = 0
            opt_start_time = time.time()
            edge_map = {e.id: e for e in base_graph.edges}

            async def eval_job(job_type, edge_id, extra):
                nonlocal eval_idx
                rec = None
                try:
                    rec = await loop.run_in_executor(
                        pool,
                        _eval_candidate,
                        base_graph,
                        demand,
                        demand_multiplier,
                        config,
                        job_type,
                        edge_id,
                        extra,
                        base_avg_time,
                        baseline_speed,
                        baseline.edge_metrics
                    )
                except Exception:
                    pass

                eval_idx += 1
                edge = edge_map.get(edge_id)
                edge_name = edge.name or edge_id if edge else edge_id
                elapsed = time.time() - opt_start_time
                pct = round((eval_idx / max(total_candidates, 1)) * 100, 1)
                rem_cands = max(0, total_candidates - eval_idx)
                eta_sec = round((elapsed / max(eval_idx, 1)) * rem_cands, 1) if eval_idx > 0 else 0.0

                if rec and rec.travel_time_reduction_pct >= min_savings_pct:
                    recommendations.append(rec)
                    await queue.put({"type": "discovery", "recommendation": rec.model_dump()})

                await queue.put({
                    "type": "progress",
                    "current": eval_idx,
                    "total": total_candidates,
                    "percent": pct,
                    "candidate": edge_id,
                    "name": edge_name,
                    "action_type": job_type,
                    "eta_sec": eta_sec,
                    "elapsed_sec": round(elapsed, 1)
                })

            # Evaluate candidates concurrently across all CPU worker threads
            await asyncio.gather(*(eval_job(j, e, x) for j, e, x in candidate_jobs))

            # Deduplicate recommendations by edge_id so each edge appears at most once
            rec_by_edge = {}
            for r in recommendations:
                if r.edge_id not in rec_by_edge or r.travel_time_reduction_pct > rec_by_edge[r.edge_id].travel_time_reduction_pct:
                    rec_by_edge[r.edge_id] = r
            recommendations = list(rec_by_edge.values())

            recommendations.sort(key=lambda r: r.travel_time_reduction_pct, reverse=True)
            for idx, rec in enumerate(recommendations, start=1):
                rec.rank = idx

            optimal_actions = []
            best_oneway = next((r.action for r in recommendations if r.type in ("MAKE_ONE_WAY", "REMOVE_ROAD")), None)
            if best_oneway:
                optimal_actions.append(best_oneway)
            for r in recommendations:
                if r.type == "WIDEN_ROAD":
                    if not any(a.edge_id == r.action.edge_id for a in optimal_actions):
                        optimal_actions.append(r.action)
                if len(optimal_actions) >= 3:
                    break

            overall_gain = 0.0
            if optimal_actions:
                try:
                    res_comb = await loop.run_in_executor(
                        pool,
                        simulate_traffic_msa,
                        apply_modifications(base_graph, optimal_actions),
                        demand,
                        demand_multiplier,
                        config
                    )
                    comb_t = res_comb.summary_metrics.avg_travel_time_mins
                    comb_g = ((base_avg_time - comb_t) / max(base_avg_time, 0.001)) * 100.0
                    if comb_g > 0:
                        overall_gain = comb_g
                    else:
                        optimal_actions = [recommendations[0].action]
                        overall_gain = recommendations[0].travel_time_reduction_pct
                except Exception:
                    optimal_actions = [recommendations[0].action] if recommendations else []
                    overall_gain = recommendations[0].travel_time_reduction_pct if recommendations else 0.0

            final_result = OptimizationResult(
                graph_id=base_graph.graph_id,
                baseline_avg_travel_time_mins=round(base_avg_time, 2),
                total_candidates_evaluated=total_candidates,
                recommendations=recommendations,
                optimal_combined_actions=optimal_actions,
                projected_overall_improvement_pct=round(overall_gain, 2),
                summary=f"Discovered {len(recommendations)} high-impact interventions. Top intervention achieves -{recommendations[0].travel_time_reduction_pct if recommendations else 0}% latency reduction."
            )

            await queue.put({"type": "complete", "result": final_result.model_dump()})
        except Exception as err:
            await queue.put({"type": "error", "message": str(err)})
        finally:
            pool.shutdown(wait=False, cancel_futures=True)

    async def event_generator():
        task = asyncio.create_task(run_optimizer_pipeline())
        try:
            while True:
                event = await queue.get()
                yield f"data: {json.dumps(event)}\n\n"
                if event.get("type") in ("complete", "error"):
                    break
            await task
        except asyncio.CancelledError:
            task.cancel()
            raise

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )
