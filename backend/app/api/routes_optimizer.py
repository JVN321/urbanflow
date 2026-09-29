import os
import json
import asyncio
from concurrent.futures import ThreadPoolExecutor, as_completed
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

router = APIRouter(prefix="/api/optimizer", tags=["Optimizer"])

# Optimized worker pool: 4 lightweight shared-memory threads (avoids spiking RAM and CPU)
_OPTIMIZER_WORKERS = max(1, min(4, os.cpu_count() or 2))


def _eval_candidate(
    base_graph: UrbanFlowGraph,
    demand: TrafficDemand,
    demand_multiplier: float,
    config: SimulationConfig,
    job_type: str,
    edge_id: str,
    extra: dict,
    base_avg_time: float,
    baseline_speed: float
) -> Optional[OptimizerRecommendation]:
    """Lightweight in-memory candidate evaluation."""
    edge = next((e for e in base_graph.edges if e.id == edge_id), None)
    if not edge:
        return None

    is_removal = job_type == "REMOVE_ROAD"
    if is_removal:
        action = InterventionAction(action="CLOSE", edge_id=edge.id)
    else:
        new_lanes = extra.get("new_lanes", edge.lanes + 1)
        new_cap = extra.get("new_capacity", edge.capacity_vph * 1.5)
        action = InterventionAction(action="WIDEN", edge_id=edge.id, new_lanes=new_lanes, new_capacity_vph=new_cap)

    mod_graph = apply_modifications(base_graph, [action])
    result = simulate_traffic_msa(mod_graph, demand, demand_multiplier, config)
    after = result.summary_metrics.avg_travel_time_mins
    gain = ((base_avg_time - after) / max(base_avg_time, 0.001)) * 100.0

    if gain <= 0.5:
        return None

    speed_after = result.summary_metrics.avg_network_speed_kmh
    throughput = ((speed_after - baseline_speed) / max(baseline_speed, 0.1)) * 100.0

    return OptimizerRecommendation(
        rank=0,
        type=job_type,
        edge_id=edge.id,
        edge_name=edge.name or f"Edge {edge.source}➔{edge.target}",
        action=action,
        avg_travel_time_before_mins=round(base_avg_time, 2),
        avg_travel_time_after_mins=round(after, 2),
        travel_time_reduction_pct=round(gain, 2),
        throughput_gain_pct=round(max(0.0, throughput), 2),
        is_braess_fix=is_removal,
        explanation=(
            f"Braess Paradox link: Closing reduces travel time by {gain:.1f}%." if is_removal
            else f"Bottleneck relief: +1 lane reduces travel time by {gain:.1f}%."
        )
    )


def _build_candidate_jobs(base_graph: UrbanFlowGraph, baseline, G_undir: nx.Graph):
    """Returns list of (type, edge_id, extra_kwargs) for candidates to evaluate."""
    bridges = set(nx.bridges(G_undir))
    active_edges = [
        e for e in base_graph.edges
        if baseline.edge_metrics.get(e.id) and baseline.edge_metrics[e.id].volume_vph >= 50.0
    ]
    top_bottlenecks = [b for b in baseline.bottlenecks if b.vc_ratio >= 0.85][:5]

    jobs = []
    for edge in active_edges:
        is_bridge = (edge.source, edge.target) in bridges or (edge.target, edge.source) in bridges
        if not is_bridge:
            jobs.append(("REMOVE_ROAD", edge.id, {}))

    for b in top_bottlenecks:
        edge = next((e for e in base_graph.edges if e.id == b.edge_id), None)
        if edge:
            jobs.append(("WIDEN_ROAD", edge.id, {"new_lanes": edge.lanes + 1, "new_capacity": edge.capacity_vph * 1.5}))
    return jobs


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

    target_multiplier = (payload.demand_multiplier if payload and payload.demand_multiplier is not None else None) or (demand_multiplier if demand_multiplier is not None else 1.0)
    target_config = (payload.config if payload else None) or SimulationConfig(algorithm="msa", max_iterations=15, convergence_tolerance=2e-3)

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
                baseline_speed
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

    recommendations.sort(key=lambda r: r.travel_time_reduction_pct, reverse=True)
    for idx, rec in enumerate(recommendations, start=1):
        rec.rank = idx

    overall_gain = sum(r.travel_time_reduction_pct for r in recommendations[:3])
    return OptimizationResult(
        graph_id=base_graph.graph_id,
        baseline_avg_travel_time_mins=round(base_avg_time, 2),
        total_candidates_evaluated=total_candidates,
        recommendations=recommendations,
        optimal_combined_actions=[r.action for r in recommendations[:3]],
        projected_overall_improvement_pct=round(overall_gain, 2),
        summary=f"Discovered {len(recommendations)} high-impact interventions. Top intervention achieves -{recommendations[0].travel_time_reduction_pct if recommendations else 0}% latency reduction."
    )


@router.get("/stream-optimize")
async def stream_optimization(
    graph_id: str,
    demand_multiplier: float = 1.0,
    max_iterations: int = 15
):
    """
    SSE streaming endpoint for real-time optimization evaluation with minimal CPU/RAM footprint.
    """
    if graph_id not in _GRAPHS and graph_id not in _AREA_GRAPHS:
        raise HTTPException(status_code=404, detail=f"Graph '{graph_id}' not found.")

    base_graph = _AREA_GRAPHS.get(graph_id) or _GRAPHS[graph_id]
    demand = _AREA_DEMANDS.get(graph_id) or _DEMANDS.get(graph_id)
    if not demand:
        raise HTTPException(status_code=400, detail="No OD demand matrix found.")

    config = SimulationConfig(algorithm="msa", max_iterations=max_iterations, convergence_tolerance=2e-3)

    async def event_generator():
        yield f"data: {json.dumps({'type': 'status', 'message': 'Running baseline equilibrium simulation...'})}\n\n"
        await asyncio.sleep(0.01)

        baseline = simulate_traffic_msa(base_graph, demand, demand_multiplier, config)
        base_avg_time = baseline.summary_metrics.avg_travel_time_mins
        baseline_speed = baseline.summary_metrics.avg_network_speed_kmh

        yield f"data: {json.dumps({'type': 'baseline', 'avg_travel_time_mins': base_avg_time, 'bottlenecks_count': len(baseline.bottlenecks)})}\n\n"
        await asyncio.sleep(0.01)

        G_undir = nx.Graph()
        for e in base_graph.edges:
            G_undir.add_edge(e.source, e.target)

        candidate_jobs = _build_candidate_jobs(base_graph, baseline, G_undir)
        total_candidates = len(candidate_jobs)

        yield f"data: {json.dumps({'type': 'init', 'total_candidates': total_candidates, 'baseline_time': base_avg_time})}\n\n"
        await asyncio.sleep(0.01)

        recommendations = []
        eval_idx = 0

        # Run candidate evaluations in parallel using lightweight shared-memory thread pool
        with ThreadPoolExecutor(max_workers=_OPTIMIZER_WORKERS) as executor:
            futures = {
                executor.submit(
                    _eval_candidate,
                    base_graph,
                    demand,
                    demand_multiplier,
                    config,
                    job_type,
                    edge_id,
                    extra,
                    base_avg_time,
                    baseline_speed
                ): (job_type, edge_id)
                for job_type, edge_id, extra in candidate_jobs
            }

            for fut in as_completed(futures):
                eval_idx += 1
                job_type, edge_id = futures[fut]
                edge = next((e for e in base_graph.edges if e.id == edge_id), None)
                edge_name = edge.name or edge_id if edge else edge_id

                try:
                    rec = fut.result()
                    if rec:
                        recommendations.append(rec)
                        yield f"data: {json.dumps({'type': 'discovery', 'recommendation': rec.model_dump()})}\n\n"
                        await asyncio.sleep(0.005)
                except Exception:
                    pass

                yield f"data: {json.dumps({'type': 'progress', 'current': eval_idx, 'total': total_candidates, 'candidate': edge_id, 'name': edge_name, 'action_type': job_type})}\n\n"
                await asyncio.sleep(0.005)

        recommendations.sort(key=lambda r: r.travel_time_reduction_pct, reverse=True)
        for idx, rec in enumerate(recommendations, start=1):
            rec.rank = idx

        overall_gain = sum(r.travel_time_reduction_pct for r in recommendations[:3])
        final_result = OptimizationResult(
            graph_id=base_graph.graph_id,
            baseline_avg_travel_time_mins=round(base_avg_time, 2),
            total_candidates_evaluated=total_candidates,
            recommendations=recommendations,
            optimal_combined_actions=[r.action for r in recommendations[:3]],
            projected_overall_improvement_pct=round(overall_gain, 2),
            summary=f"Discovered {len(recommendations)} high-impact interventions. Top intervention achieves -{recommendations[0].travel_time_reduction_pct if recommendations else 0}% latency reduction."
        )

        yield f"data: {json.dumps({'type': 'complete', 'result': final_result.model_dump()})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
