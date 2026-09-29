import json
import asyncio
from concurrent.futures import ThreadPoolExecutor
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
OPTIMIZER_WORKERS = max(1, min(32, int(__import__("os").environ.get("URBANFLOW_OPTIMIZER_WORKERS", "8"))))


def _candidate_result(base_graph, demand, demand_multiplier, config, action, recommendation_type, base_avg_time):
    modified_graph = apply_modifications(base_graph, [action])
    result = simulate_traffic_msa(modified_graph, demand, demand_multiplier, config)
    after_avg_time = result.summary_metrics.avg_travel_time_mins
    gain = ((base_avg_time - after_avg_time) / max(base_avg_time, 0.001)) * 100.0
    edge = next(edge for edge in base_graph.edges if edge.id == action.edge_id)
    return edge, result, after_avg_time, gain, recommendation_type


def _build_recommendation(candidate, base_avg_time):
    edge, _result, after_avg_time, gain, recommendation_type = candidate
    if gain <= 0.5:
        return None
    is_removal = recommendation_type == "REMOVE_ROAD"
    return OptimizerRecommendation(
        rank=0,
        type=recommendation_type,
        edge_id=edge.id,
        edge_name=edge.name or f"Edge {edge.source}➔{edge.target}",
        action=candidate[0] and (InterventionAction(action="CLOSE", edge_id=edge.id) if is_removal else InterventionAction(action="WIDEN", edge_id=edge.id, new_lanes=edge.lanes + 1, new_capacity_vph=edge.capacity_vph * 1.5)),
        avg_travel_time_before_mins=round(base_avg_time, 2),
        avg_travel_time_after_mins=round(after_avg_time, 2),
        travel_time_reduction_pct=round(gain, 2),
        throughput_gain_pct=round(max(0.0, gain * (0.8 if is_removal else 0.9)), 2),
        is_braess_fix=is_removal,
        explanation=(f"Braess Paradox link identified: Closing this road reduces travel time by {gain:.1f}%." if is_removal else f"Bottleneck relief: Adding 1 lane reduces travel time by {gain:.1f}%.")
    )


class OptimizationRequestPayload(BaseModel):
    graph_id: Optional[str] = None
    demand_multiplier: Optional[float] = Field(default=1.0, ge=0.1, le=5.0)
    config: Optional[SimulationConfig] = None


@router.post("/recommend", response_model=OptimizationResult)
def get_recommendations(
    payload: Optional[OptimizationRequestPayload] = None,
    graph_id: Optional[str] = None,
    demand_multiplier: Optional[float] = None
):
    """
    Synchronously compute high-impact network interventions (road closures and widenings).
    """
    target_graph_id = (payload.graph_id if payload else None) or graph_id
    if not target_graph_id or (target_graph_id not in _GRAPHS and target_graph_id not in _AREA_GRAPHS):
        raise HTTPException(status_code=404, detail=f"Graph '{target_graph_id}' not found.")

    target_multiplier = (payload.demand_multiplier if payload and payload.demand_multiplier is not None else None) or (demand_multiplier if demand_multiplier is not None else 1.0)
    target_config = (payload.config if payload else None) or SimulationConfig(algorithm="msa", max_iterations=25, convergence_tolerance=1e-3)

    base_graph = _AREA_GRAPHS.get(target_graph_id) or _GRAPHS[target_graph_id]
    demand = _AREA_DEMANDS.get(target_graph_id) or _DEMANDS.get(target_graph_id)
    if not demand:
        raise HTTPException(status_code=400, detail="No OD demand matrix found.")

    baseline = simulate_traffic_msa(base_graph, demand, target_multiplier, target_config)
    base_avg_time = baseline.summary_metrics.avg_travel_time_mins

    G_undir = nx.Graph()
    for e in base_graph.edges:
        G_undir.add_edge(e.source, e.target)
    bridges = set(nx.bridges(G_undir))

    active_edges = [
        e for e in base_graph.edges
        if baseline.edge_metrics.get(e.id) and baseline.edge_metrics[e.id].volume_vph >= 50.0
    ]
    top_bottlenecks = [b for b in baseline.bottlenecks if b.vc_ratio >= 0.85][:4]
    total_candidates = len(active_edges) + len(top_bottlenecks)

    candidate_jobs = []
    for edge in active_edges:
        is_bridge = (edge.source, edge.target) in bridges or (edge.target, edge.source) in bridges
        if is_bridge:
            continue
        candidate_jobs.append((edge, InterventionAction(action="CLOSE", edge_id=edge.id), "REMOVE_ROAD"))
    for b in top_bottlenecks:
        edge = next((e for e in base_graph.edges if e.id == b.edge_id), None)
        if not edge:
            continue
        candidate_jobs.append((edge, InterventionAction(action="WIDEN", edge_id=edge.id, new_lanes=edge.lanes + 1, new_capacity_vph=edge.capacity_vph * 1.5), "WIDEN_ROAD"))

    with ThreadPoolExecutor(max_workers=min(OPTIMIZER_WORKERS, max(1, len(candidate_jobs)))) as executor:
        futures = [executor.submit(_candidate_result, base_graph, demand, target_multiplier, target_config, action, kind, base_avg_time) for _edge, action, kind in candidate_jobs]
        recommendations = [_build_recommendation(future.result(), base_avg_time) for future in futures]
    recommendations = [recommendation for recommendation in recommendations if recommendation is not None]

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
    max_iterations: int = 25
):
    """
    Server-Sent Events (SSE) streaming endpoint that streams real-time progress,
    candidate evaluations, and newly discovered optimizations to the frontend.
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
        convergence_tolerance=1e-3
    )

    async def event_generator():
        # 1. Baseline Simulation
        yield f"data: {json.dumps({'type': 'status', 'message': 'Running baseline network equilibrium simulation...'})}\n\n"
        await asyncio.sleep(0.01)

        baseline = simulate_traffic_msa(base_graph, demand, demand_multiplier, config)
        base_avg_time = baseline.summary_metrics.avg_travel_time_mins
        
        yield f"data: {json.dumps({'type': 'baseline', 'avg_travel_time_mins': base_avg_time, 'bottlenecks_count': len(baseline.bottlenecks)})}\n\n"
        await asyncio.sleep(0.01)

        # 2. Bridge check
        G_undir = nx.Graph()
        for e in base_graph.edges:
            G_undir.add_edge(e.source, e.target)
        bridges = set(nx.bridges(G_undir))

        # 3. Filter active candidates
        active_edges = [
            e for e in base_graph.edges
            if baseline.edge_metrics.get(e.id) and baseline.edge_metrics[e.id].volume_vph >= 50.0
        ]
        top_bottlenecks = [b for b in baseline.bottlenecks if b.vc_ratio >= 0.85][:4]
        total_candidates = len(active_edges) + len(top_bottlenecks)

        yield f"data: {json.dumps({'type': 'init', 'total_candidates': total_candidates, 'baseline_time': base_avg_time})}\n\n"
        await asyncio.sleep(0.01)

        recommendations = []
        candidate_jobs = []
        progress_current = 0
        for edge in active_edges:
            progress_current += 1
            edge_name = edge.name or f"Edge {edge.source}➔{edge.target}"
            is_bridge = (edge.source, edge.target) in bridges or (edge.target, edge.source) in bridges
            if is_bridge:
                yield f"data: {json.dumps({'type': 'progress', 'current': progress_current, 'total': total_candidates, 'candidate': edge.id, 'name': edge_name, 'action_type': 'REMOVE_ROAD', 'status': 'Skipped (Critical Bridge)'})}\n\n"
                continue
            candidate_jobs.append((edge, InterventionAction(action="CLOSE", edge_id=edge.id), "REMOVE_ROAD"))
        for bottleneck in top_bottlenecks:
            progress_current += 1
            edge = next((item for item in base_graph.edges if item.id == bottleneck.edge_id), None)
            if edge:
                candidate_jobs.append((edge, InterventionAction(action="WIDEN", edge_id=edge.id, new_lanes=edge.lanes + 1, new_capacity_vph=edge.capacity_vph * 1.5), "WIDEN_ROAD"))

        loop = asyncio.get_running_loop()
        with ThreadPoolExecutor(max_workers=min(OPTIMIZER_WORKERS, max(1, len(candidate_jobs))) as executor:
            pending = [loop.run_in_executor(executor, _candidate_result, base_graph, demand, demand_multiplier, config, action, kind, base_avg_time) for _edge, action, kind in candidate_jobs]
            for completed in asyncio.as_completed(pending):
                candidate = await completed
                recommendation = _build_recommendation(candidate, base_avg_time)
                edge = candidate[0]
                if recommendation:
                    recommendations.append(recommendation)
                    yield f"data: {json.dumps({'type': 'discovery', 'recommendation': recommendation.model_dump()})}\n\n"
                progress_current += 1
                yield f"data: {json.dumps({'type': 'progress', 'current': progress_current, 'total': total_candidates, 'candidate': edge.id, 'name': edge.name or edge.id, 'action_type': recommendation.type if recommendation else 'EVALUATING', 'time_pct': recommendation.travel_time_reduction_pct if recommendation else 0})}\n\n"

        # 6. Sort and finalize
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
