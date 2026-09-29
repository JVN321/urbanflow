"""
Intervention Engine:
Applies modifications (widen, close, add) to a road graph and runs comparative before/after analysis.
"""
import uuid
from typing import List
from app.core.graph_model import (
    UrbanFlowGraph,
    GraphEdge,
    TrafficDemand,
    InterventionAction,
    InterventionReport,
    MetricsDelta
)
from app.core.assignment import simulate_traffic_msa


def apply_modifications(base_graph: UrbanFlowGraph, modifications: List[InterventionAction]) -> UrbanFlowGraph:
    """Clones graph and applies intervention actions."""
    # Deep copy nodes and edges
    new_nodes = [node.model_copy() for node in base_graph.nodes]
    edge_map = {edge.id: edge.model_copy() for edge in base_graph.edges}
    
    for mod in modifications:
        if mod.action == "WIDEN" and mod.edge_id in edge_map:
            edge = edge_map[mod.edge_id]
            if mod.new_lanes is not None:
                edge.lanes = mod.new_lanes
            if mod.new_capacity_vph is not None:
                edge.capacity_vph = mod.new_capacity_vph
            else:
                # Default heuristic: scale capacity with lane increase
                edge.capacity_vph = edge.capacity_vph * (edge.lanes / max(1, edge.lanes - 1))
        
        elif mod.action == "CLOSE" and mod.edge_id in edge_map:
            # Remove edge from network
            del edge_map[mod.edge_id]
        
        elif mod.action == "SPEED_LIMIT" and mod.edge_id in edge_map:
            edge = edge_map[mod.edge_id]
            if mod.new_speed_kmh is not None:
                edge.free_speed_kmh = mod.new_speed_kmh
        
        elif mod.action == "ADD" and mod.new_edge is not None:
            new_e = mod.new_edge.model_copy()
            edge_map[new_e.id] = new_e

    return UrbanFlowGraph(
        graph_id=f"{base_graph.graph_id}_modified",
        name=f"{base_graph.name} (Intervention Applied)",
        crs=base_graph.crs,
        nodes=new_nodes,
        edges=list(edge_map.values())
    )


def evaluate_intervention(
    base_graph: UrbanFlowGraph,
    demand: TrafficDemand,
    modifications: List[InterventionAction],
    demand_multiplier: float = 1.0
) -> InterventionReport:
    """
    Runs baseline simulation, applies modifications, runs intervention simulation,
    and computes differential impact metrics (including Braess Paradox detection).
    """
    # 1. Baseline Simulation
    baseline_result = simulate_traffic_msa(base_graph, demand, demand_multiplier)
    
    # 2. Apply modifications
    modified_graph = apply_modifications(base_graph, modifications)
    
    # 3. Intervention Simulation
    intervention_result = simulate_traffic_msa(modified_graph, demand, demand_multiplier)
    
    # 4. Calculate Deltas
    base_time = baseline_result.summary_metrics.avg_travel_time_mins
    interv_time = intervention_result.summary_metrics.avg_travel_time_mins
    
    time_change_pct = ((interv_time - base_time) / max(base_time, 0.001)) * 100.0
    total_time_change_pct = (
        (intervention_result.summary_metrics.total_travel_time_hours - baseline_result.summary_metrics.total_travel_time_hours)
        / max(baseline_result.summary_metrics.total_travel_time_hours, 0.001)
    ) * 100.0
    
    congested_change = (
        intervention_result.summary_metrics.severely_congested_edges_count
        - baseline_result.summary_metrics.severely_congested_edges_count
    )
    
    has_added_or_widened = any(m.action in ("ADD", "WIDEN") for m in modifications)
    is_braess = (time_change_pct > 0.5) and has_added_or_widened
    
    if is_braess:
        summary_text = (
            f"⚠️ Braess Paradox Detected! Adding infrastructure increased average travel time by "
            f"{abs(time_change_pct):.1f}% due to driver equilibrium route redistribution."
        )
    elif time_change_pct < -0.5:
        summary_text = f"✅ Network Improved: Average travel time reduced by {abs(time_change_pct):.1f}%."
    elif time_change_pct > 0.5:
        summary_text = f"❌ Network Degraded: Average travel time increased by {time_change_pct:.1f}%."
    else:
        summary_text = "⚖️ Neutral Impact: Negligible change in network travel time."

    delta = MetricsDelta(
        total_travel_time_change_pct=round(total_time_change_pct, 2),
        avg_travel_time_change_pct=round(time_change_pct, 2),
        congested_edges_change=congested_change,
        is_braess_paradox=is_braess,
        summary_text=summary_text
    )

    return InterventionReport(
        report_id=f"report_{uuid.uuid4().hex[:8]}",
        base_graph_id=base_graph.graph_id,
        modifications=modifications,
        baseline=baseline_result,
        intervention=intervention_result,
        delta=delta
    )
