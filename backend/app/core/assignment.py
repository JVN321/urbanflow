"""
Traffic Assignment Algorithms:
1. All-or-Nothing (AON) Dijkstra Assignment
2. Method of Successive Averages (MSA) for Wardrop User Equilibrium
Includes path flow decomposition and convergence tracking.
"""
import uuid
import networkx as nx
from typing import Any, Callable, Dict, List, Optional
from app.core.graph_model import (
    UrbanFlowGraph,
    TrafficDemand,
    SimulationResult,
    SimulationSummaryMetrics,
    EdgeSimulationMetric,
    BottleneckInfo,
    PathFlowInfo,
    SimulationConfig
)
from app.core.bpr import calculate_link_travel_time, calculate_congested_speed, classify_congestion_level


def build_networkx_graph(graph: UrbanFlowGraph, config: Optional[SimulationConfig] = None) -> nx.DiGraph:
    """Converts UrbanFlowGraph schema into a NetworkX DiGraph."""
    G = nx.DiGraph()
    for node in graph.nodes:
        G.add_node(node.id, lat=node.lat, lng=node.lng, label=node.label, type=node.type)
    
    for edge in graph.edges:
        alpha = edge.alpha if edge.alpha is not None else (config.default_alpha if config else 0.15)
        beta = edge.beta if edge.beta is not None else (config.default_beta if config else 4.0)
        cost_model = edge.cost_model if edge.cost_model is not None else (config.cost_model if config else "bpr")

        G.add_edge(
            edge.source,
            edge.target,
            edge_id=edge.id,
            name=edge.name,
            length_m=edge.length_m,
            lanes=edge.lanes,
            free_speed_kmh=edge.free_speed_kmh,
            capacity_vph=edge.capacity_vph,
            alpha=alpha,
            beta=beta,
            cost_model=cost_model,
            t0=edge.free_flow_time_sec,
            cost=edge.free_flow_time_sec,
            volume=0.0
        )
    return G


def simulate_traffic_msa(
    graph: UrbanFlowGraph,
    demand: TrafficDemand,
    demand_multiplier: float = 1.0,
    config: Optional[SimulationConfig] = None,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None
) -> SimulationResult:
    """
    Executes User Equilibrium traffic assignment using the Method of Successive Averages (MSA).
    Tracks edge flows, path flow distributions, and convergence.
    """
    if config is None:
        config = SimulationConfig()

    G = build_networkx_graph(graph, config)
    edge_dict = {edge.id: edge for edge in graph.edges}
    
    edge_flows: Dict[str, float] = {edge.id: 0.0 for edge in graph.edges}
    path_history: Dict[str, Dict[str, Any]] = {}

    if not demand.demands or len(graph.edges) == 0:
        return _build_empty_result(graph)

    converged = False
    iterations_run = 0

    # Iterative MSA Algorithm
    for k in range(1, config.max_iterations + 1):
        iterations_run = k
        
        # 1. Update link costs based on current flows
        for u, v, data in G.edges(data=True):
            eid = data["edge_id"]
            current_v = edge_flows[eid]
            t = calculate_link_travel_time(
                free_flow_time_sec=data["t0"],
                volume_vph=current_v,
                capacity_vph=data["capacity_vph"],
                alpha=data["alpha"],
                beta=data["beta"],
                cost_model=data.get("cost_model", "bpr"),
                length_m=data["length_m"],
                free_speed_kmh=data["free_speed_kmh"]
            )
            data["cost"] = t

        # 2. Auxiliary All-or-Nothing (AON) Assignment
        aux_flows: Dict[str, float] = {edge.id: 0.0 for edge in graph.edges}

        for od in demand.demands:
            od_vol = od.volume_vph * demand_multiplier
            if od_vol <= 0:
                continue
            try:
                path = nx.shortest_path(G, source=od.origin, target=od.destination, weight="cost")
                path_str = " ➔ ".join(path)
                
                # Calculate path travel time
                path_edge_ids = []
                path_time_sec = 0.0
                for i in range(len(path) - 1):
                    u, v = path[i], path[i + 1]
                    eid = G[u][v]["edge_id"]
                    path_edge_ids.append(eid)
                    aux_flows[eid] += od_vol
                    path_time_sec += G[u][v]["cost"]

                # Accumulate path flow info
                if path_str not in path_history:
                    path_history[path_str] = {
                        "nodes": path,
                        "edges": path_edge_ids,
                        "volume": 0.0,
                        "time_mins": round(path_time_sec / 60.0, 2)
                    }
                path_history[path_str]["time_mins"] = round(path_time_sec / 60.0, 2)
            except (nx.NetworkXNoPath, nx.NodeNotFound):
                continue

        # 3. Method of Successive Averages Step Size: lambda_k = 1 / (k + 1)
        step_size = 1.0 / float(k + 1) if config.algorithm == "msa" else 1.0

        # 4. Check Convergence: Relative Gap
        max_flow_diff = 0.0
        total_flow = sum(edge_flows.values())

        for eid in edge_flows:
            old_flow = edge_flows[eid]
            new_flow = (1.0 - step_size) * old_flow + step_size * aux_flows[eid]
            max_flow_diff += abs(new_flow - old_flow)
            edge_flows[eid] = new_flow

        if progress_callback:
            progress_callback({
                "iteration": k,
                "max_iterations": config.max_iterations,
                "converged": False,
                "edge_volumes": {eid: round(volume, 1) for eid, volume in edge_flows.items()}
            })

        if total_flow > 0 and (max_flow_diff / max(total_flow, 1.0)) < config.convergence_tolerance and k >= 4:
            converged = True
            if progress_callback:
                progress_callback({
                    "iteration": k,
                    "max_iterations": config.max_iterations,
                    "converged": True,
                    "edge_volumes": {eid: round(volume, 1) for eid, volume in edge_flows.items()}
                })
            break

    # Build final metrics and results
    edge_metrics: Dict[str, EdgeSimulationMetric] = {}
    bottlenecks: List[BottleneckInfo] = []
    total_travel_time_sec = 0.0
    severely_congested_count = 0

    for edge in graph.edges:
        vol = edge_flows.get(edge.id, 0.0)
        t0 = edge.free_flow_time_sec
        congested_t = calculate_link_travel_time(
            free_flow_time_sec=t0,
            volume_vph=vol,
            capacity_vph=edge.capacity_vph,
            alpha=edge.alpha,
            beta=edge.beta,
            cost_model=edge.cost_model,
            length_m=edge.length_m,
            free_speed_kmh=edge.free_speed_kmh
        )
        vc = vol / max(edge.capacity_vph, 1.0)
        speed = calculate_congested_speed(edge.length_m, congested_t)
        level = classify_congestion_level(vc)
        is_bottleneck = vc >= 0.95

        if is_bottleneck:
            severely_congested_count += 1
            bottlenecks.append(BottleneckInfo(
                edge_id=edge.id,
                edge_name=edge.name or f"Edge {edge.source}➔{edge.target}",
                vc_ratio=round(vc, 3),
                volume_vph=round(vol, 1),
                capacity_vph=edge.capacity_vph,
                severity_score=round(min(vc, 2.0) / 2.0, 3),
                cause="Capacity exceeded during peak demand" if vc > 1.0 else "Approaching saturation",
                recommendation="Widen road segment or prune adverse shortcuts"
            ))

        edge_metrics[edge.id] = EdgeSimulationMetric(
            edge_id=edge.id,
            volume_vph=round(vol, 1),
            capacity_vph=edge.capacity_vph,
            vc_ratio=round(vc, 3),
            free_flow_time_sec=round(t0, 1),
            congested_time_sec=round(congested_t, 1),
            avg_speed_kmh=round(speed, 1),
            congestion_level=level,
            is_bottleneck=is_bottleneck
        )

        total_travel_time_sec += vol * congested_t

    # Path flows reconstruction
    path_flows_list: List[PathFlowInfo] = []
    for p_key, p_data in path_history.items():
        # Estimate path flow from constituent edge minimum flow
        constituent_flows = [edge_flows.get(e, 0.0) for e in p_data["edges"]]
        est_vol = min(constituent_flows) if constituent_flows else 0.0
        if est_vol > 1.0:
            path_flows_list.append(PathFlowInfo(
                path_nodes=p_data["nodes"],
                path_edges=p_data["edges"],
                assigned_volume_vph=round(est_vol, 1),
                travel_time_mins=p_data["time_mins"]
            ))

    total_vehicles = sum(d.volume_vph * demand_multiplier for d in demand.demands)
    total_hours = total_travel_time_sec / 3600.0
    avg_travel_mins = (total_travel_time_sec / max(total_vehicles, 1.0)) / 60.0
    avg_speed = sum(m.avg_speed_kmh for m in edge_metrics.values()) / max(len(edge_metrics), 1)

    summary = SimulationSummaryMetrics(
        total_vehicles=round(total_vehicles, 1),
        total_travel_time_hours=round(total_hours, 2),
        avg_travel_time_mins=round(avg_travel_mins, 2),
        avg_network_speed_kmh=round(avg_speed, 1),
        severely_congested_edges_count=severely_congested_count,
        network_efficiency_index=round(max(0.0, 1.0 - (severely_congested_count / max(len(graph.edges), 1))), 3),
        iterations_run=iterations_run,
        converged=converged
    )

    return SimulationResult(
        run_id=f"sim_{uuid.uuid4().hex[:8]}",
        graph_id=graph.graph_id,
        summary_metrics=summary,
        edge_metrics=edge_metrics,
        bottlenecks=sorted(bottlenecks, key=lambda b: b.vc_ratio, reverse=True),
        path_flows=path_flows_list
    )


def _build_empty_result(graph: UrbanFlowGraph) -> SimulationResult:
    edge_metrics = {}
    for edge in graph.edges:
        t0 = edge.free_flow_time_sec
        edge_metrics[edge.id] = EdgeSimulationMetric(
            edge_id=edge.id,
            volume_vph=0.0,
            capacity_vph=edge.capacity_vph,
            vc_ratio=0.0,
            free_flow_time_sec=round(t0, 1),
            congested_time_sec=round(t0, 1),
            avg_speed_kmh=round(edge.free_speed_kmh, 1),
            congestion_level="free_flow",
            is_bottleneck=False
        )
    return SimulationResult(
        run_id="empty_run",
        graph_id=graph.graph_id,
        summary_metrics=SimulationSummaryMetrics(
            total_vehicles=0,
            total_travel_time_hours=0,
            avg_travel_time_mins=0,
            avg_network_speed_kmh=50.0,
            severely_congested_edges_count=0,
            network_efficiency_index=1.0,
            iterations_run=0,
            converged=True
        ),
        edge_metrics=edge_metrics,
        bottlenecks=[],
        path_flows=[]
    )
