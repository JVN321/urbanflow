"""
UrbanFlow Network Optimization Engine:
1. Detects and eliminates Braess Paradox links (Road Removal Optimization).
2. Identifies high-yield Bottleneck Widenings (Capacity Expansion).
3. Evaluates network topology to prevent graph disconnection (Bridge constraints).
4. Ranks candidate actions by travel time reduction and throughput gain.
"""
import networkx as nx
from typing import List, Dict, Tuple
from app.core.graph_model import (
    UrbanFlowGraph,
    TrafficDemand,
    InterventionAction,
    OptimizerRecommendation,
    OptimizationResult,
    SimulationConfig
)
from app.core.assignment import simulate_traffic_msa, build_networkx_graph
from app.core.intervention import apply_modifications


def optimize_traffic_network(
    base_graph: UrbanFlowGraph,
    demand: TrafficDemand,
    demand_multiplier: float = 1.0,
    config: SimulationConfig = None
) -> OptimizationResult:
    """
    Scans the road network to discover:
    1. Harmful edges (Braess Paradox roads) whose removal lowers average travel time.
    2. Severe bottleneck edges whose widening yields maximum delay reduction.
    """
    if config is None:
        config = SimulationConfig()

    # 1. Run Baseline Simulation
    baseline = simulate_traffic_msa(base_graph, demand, demand_multiplier, config)
    base_avg_time = baseline.summary_metrics.avg_travel_time_mins
    base_total_time = baseline.summary_metrics.total_travel_time_hours

    # 2. Identify Bridges (Cut-edges) that cannot be safely removed
    G_undir = nx.Graph()
    for e in base_graph.edges:
        G_undir.add_edge(e.source, e.target)
    bridges = set(nx.bridges(G_undir))

    recommendations: List[OptimizerRecommendation] = []
    candidates_count = 0

    # 3. Test Road Removal on active, non-bridge edges carrying traffic (Braess Paradox Detector)
    # Only test roads carrying flow (removing zero-flow streets has 0 impact)
    active_edges = [
        e for e in base_graph.edges
        if baseline.edge_metrics.get(e.id) and baseline.edge_metrics[e.id].volume_vph >= 50.0
    ]

    for edge in active_edges:
        is_bridge = (edge.source, edge.target) in bridges or (edge.target, edge.source) in bridges
        if is_bridge:
            continue

        candidates_count += 1
        remove_action = InterventionAction(
            action="CLOSE",
            edge_id=edge.id,
            rationale=f"Evaluate closure of {edge.name or edge.id}"
        )

        mod_graph = apply_modifications(base_graph, [remove_action])
        sim_after = simulate_traffic_msa(mod_graph, demand, demand_multiplier, config)
        after_avg_time = sim_after.summary_metrics.avg_travel_time_mins

        # Check if removal IMPROVES the network (Braess Paradox link)
        time_diff_pct = ((base_avg_time - after_avg_time) / max(base_avg_time, 0.001)) * 100.0

        if time_diff_pct > 0.5:  # At least 0.5% improvement when closed
            throughput_gain = (
                (sim_after.summary_metrics.avg_network_speed_kmh - baseline.summary_metrics.avg_network_speed_kmh)
                / max(baseline.summary_metrics.avg_network_speed_kmh, 0.1)
            ) * 100.0

            recommendations.append(OptimizerRecommendation(
                rank=1,  # will sort later
                type="REMOVE_ROAD",
                edge_id=edge.id,
                edge_name=edge.name or f"Edge {edge.source}➔{edge.target}",
                action=remove_action,
                avg_travel_time_before_mins=round(base_avg_time, 2),
                avg_travel_time_after_mins=round(after_avg_time, 2),
                travel_time_reduction_pct=round(time_diff_pct, 2),
                throughput_gain_pct=round(max(0.0, throughput_gain), 2),
                is_braess_fix=True,
                explanation=(
                    f"Braess Paradox link identified: Closing this road eliminates an inefficient shortcut, "
                    f"rerouting traffic to higher-capacity arterials and reducing average travel time by {time_diff_pct:.1f}%."
                )
            ))

    # 4. Test Road Widening on Top Bottlenecks
    top_bottlenecks = [b for b in baseline.bottlenecks if b.vc_ratio >= 0.85][:3]
    for b in top_bottlenecks:
        edge = next((e for e in base_graph.edges if e.id == b.edge_id), None)
        if not edge:
            continue

        candidates_count += 1
        widen_action = InterventionAction(
            action="WIDEN",
            edge_id=edge.id,
            new_lanes=edge.lanes + 1,
            new_capacity_vph=edge.capacity_vph * 1.5,
            rationale=f"Widen bottleneck edge {edge.name or edge.id} (+1 lane)"
        )

        mod_graph = apply_modifications(base_graph, [widen_action])
        sim_after = simulate_traffic_msa(mod_graph, demand, demand_multiplier, config)
        after_avg_time = sim_after.summary_metrics.avg_travel_time_mins
        time_diff_pct = ((base_avg_time - after_avg_time) / max(base_avg_time, 0.001)) * 100.0

        if time_diff_pct > 0.5:
            throughput_gain = (
                (sim_after.summary_metrics.avg_network_speed_kmh - baseline.summary_metrics.avg_network_speed_kmh)
                / max(baseline.summary_metrics.avg_network_speed_kmh, 0.1)
            ) * 100.0

            recommendations.append(OptimizerRecommendation(
                rank=1,
                type="WIDEN_ROAD",
                edge_id=edge.id,
                edge_name=edge.name or f"Edge {edge.source}➔{edge.target}",
                action=widen_action,
                avg_travel_time_before_mins=round(base_avg_time, 2),
                avg_travel_time_after_mins=round(after_avg_time, 2),
                travel_time_reduction_pct=round(time_diff_pct, 2),
                throughput_gain_pct=round(max(0.0, throughput_gain), 2),
                is_braess_fix=False,
                explanation=(
                    f"Critical bottleneck mitigation: Adding 1 lane increases road capacity to "
                    f"{edge.capacity_vph * 1.5:.0f} vph, decreasing congestion delay by {time_diff_pct:.1f}%."
                )
            ))

    # Sort recommendations by travel time reduction percentage (descending)
    recommendations.sort(key=lambda r: r.travel_time_reduction_pct, reverse=True)
    for idx, rec in enumerate(recommendations, start=1):
        rec.rank = idx

    # Combined optimal interventions
    optimal_actions = [r.action for r in recommendations[:2]]
    overall_improvement = sum(r.travel_time_reduction_pct for r in recommendations[:2])

    summary_text = (
        f"Evaluated {candidates_count} candidate modifications. Found {len(recommendations)} high-impact interventions. "
        f"Top recommendation: {recommendations[0].type} on {recommendations[0].edge_name} (reduces latency by {recommendations[0].travel_time_reduction_pct}%)."
        if recommendations else "The current network is already in a near-optimal configuration."
    )

    return OptimizationResult(
        graph_id=base_graph.graph_id,
        baseline_avg_travel_time_mins=round(base_avg_time, 2),
        total_candidates_evaluated=candidates_count,
        recommendations=recommendations,
        optimal_combined_actions=optimal_actions,
        projected_overall_improvement_pct=round(overall_improvement, 2),
        summary=summary_text
    )
