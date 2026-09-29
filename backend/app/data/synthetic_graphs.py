"""
Synthetic Graph and Demand Generators for UrbanFlow validation.
"""
from typing import Tuple
from backend.app.core.graph_model import (
    UrbanFlowGraph,
    GraphNode,
    GraphEdge,
    GraphMetadata,
    TrafficDemand,
    OriginDestinationDemand
)


def get_braess_paradox_network(include_shortcut: bool = False) -> Tuple[UrbanFlowGraph, TrafficDemand]:
    """
    Creates the classic 4-node Braess Paradox graph.
    Nodes: A (Origin), B, C, D (Destination).
    Demand: 4000 vph from A to D.
    """
    nodes = [
        GraphNode(id="A", label="Origin (A)", lat=10.000, lng=76.300, type="origin"),
        GraphNode(id="B", label="Upper Hub (B)", lat=10.020, lng=76.320, type="intersection"),
        GraphNode(id="C", label="Lower Hub (C)", lat=9.980, lng=76.320, type="intersection"),
        GraphNode(id="D", label="Destination (D)", lat=10.000, lng=76.340, type="destination")
    ]
    
    edges = [
        # Path 1: A -> B (congestion sensitive: travel time proportional to flow)
        GraphEdge(
            id="e_AB", source="A", target="B", name="A to B (Flow Sensitive)",
            length_m=5000.0, lanes=1, free_speed_kmh=60.0, capacity_vph=1000.0,
            alpha=0.5, beta=1.0, geometry=[[76.300, 10.000], [76.320, 10.020]]
        ),
        # Path 1: B -> D (constant high travel time)
        GraphEdge(
            id="e_BD", source="B", target="D", name="B to D (Fixed High Time)",
            length_m=15000.0, lanes=4, free_speed_kmh=20.0, capacity_vph=10000.0,
            alpha=0.01, beta=1.0, geometry=[[76.320, 10.020], [76.340, 10.000]]
        ),
        # Path 2: A -> C (constant high travel time)
        GraphEdge(
            id="e_AC", source="A", target="C", name="A to C (Fixed High Time)",
            length_m=15000.0, lanes=4, free_speed_kmh=20.0, capacity_vph=10000.0,
            alpha=0.01, beta=1.0, geometry=[[76.300, 10.000], [76.320, 9.980]]
        ),
        # Path 2: C -> D (congestion sensitive)
        GraphEdge(
            id="e_CD", source="C", target="D", name="C to D (Flow Sensitive)",
            length_m=5000.0, lanes=1, free_speed_kmh=60.0, capacity_vph=1000.0,
            alpha=0.5, beta=1.0, geometry=[[76.320, 9.980], [76.340, 10.000]]
        )
    ]
    
    if include_shortcut:
        edges.append(
            GraphEdge(
                id="e_BC", source="B", target="C", name="B to C (Zero Cost Shortcut)",
                length_m=100.0, lanes=4, free_speed_kmh=100.0, capacity_vph=10000.0,
                alpha=0.001, beta=1.0, geometry=[[76.320, 10.020], [76.320, 9.980]]
            )
        )

    graph = UrbanFlowGraph(
        graph_id="braess_4node_shortcut" if include_shortcut else "braess_4node_baseline",
        name=f"Braess Paradox Network ({'With Shortcut' if include_shortcut else 'Baseline'})",
        nodes=nodes,
        edges=edges,
        metadata=GraphMetadata(node_count=len(nodes), edge_count=len(edges), bbox=[76.300, 9.980, 76.340, 10.020])
    )
    
    demand = TrafficDemand(
        demand_id="braess_demand_4000",
        description="4000 vph from Origin A to Destination D",
        demands=[OriginDestinationDemand(origin="A", destination="D", volume_vph=4000.0)]
    )
    
    return graph, demand


def get_grid_3x3_network() -> Tuple[UrbanFlowGraph, TrafficDemand]:
    """Generates a 3x3 urban grid network with 9 nodes and 24 directed edges."""
    nodes = []
    base_lat, base_lng = 10.000, 76.300
    grid_size = 3
    spacing = 0.015  # approx 1.5 km
    
    for r in range(grid_size):
        for c in range(grid_size):
            nid = f"N_{r}_{c}"
            nodes.append(GraphNode(
                id=nid,
                label=f"Grid ({r},{c})",
                lat=base_lat + r * spacing,
                lng=base_lng + c * spacing
            ))
    
    node_map = {n.id: n for n in nodes}
    edges = []
    edge_idx = 1
    
    for r in range(grid_size):
        for c in range(grid_size):
            u_id = f"N_{r}_{c}"
            # Horizontal right
            if c + 1 < grid_size:
                v_id = f"N_{r}_{c+1}"
                u_node, v_node = node_map[u_id], node_map[v_id]
                edges.append(GraphEdge(
                    id=f"e_{edge_idx}", source=u_id, target=v_id, name=f"St {u_id}->{v_id}",
                    length_m=1500.0, lanes=2, free_speed_kmh=45.0, capacity_vph=1600.0,
                    geometry=[[u_node.lng, u_node.lat], [v_node.lng, v_node.lat]]
                ))
                edge_idx += 1
                # Reverse
                edges.append(GraphEdge(
                    id=f"e_{edge_idx}", source=v_id, target=u_id, name=f"St {v_id}->{u_id}",
                    length_m=1500.0, lanes=2, free_speed_kmh=45.0, capacity_vph=1600.0,
                    geometry=[[v_node.lng, v_node.lat], [u_node.lng, u_node.lat]]
                ))
                edge_idx += 1
            
            # Vertical up
            if r + 1 < grid_size:
                v_id = f"N_{r+1}_{c}"
                u_node, v_node = node_map[u_id], node_map[v_id]
                edges.append(GraphEdge(
                    id=f"e_{edge_idx}", source=u_id, target=v_id, name=f"Ave {u_id}->{v_id}",
                    length_m=1500.0, lanes=2, free_speed_kmh=45.0, capacity_vph=1600.0,
                    geometry=[[u_node.lng, u_node.lat], [v_node.lng, v_node.lat]]
                ))
                edge_idx += 1
                # Reverse
                edges.append(GraphEdge(
                    id=f"e_{edge_idx}", source=v_id, target=u_id, name=f"Ave {v_id}->{u_id}",
                    length_m=1500.0, lanes=2, free_speed_kmh=45.0, capacity_vph=1600.0,
                    geometry=[[v_node.lng, v_node.lat], [u_node.lng, u_node.lat]]
                ))
                edge_idx += 1

    graph = UrbanFlowGraph(
        graph_id="grid_3x3",
        name="3x3 Urban Grid Network",
        nodes=nodes,
        edges=edges,
        metadata=GraphMetadata(node_count=len(nodes), edge_count=len(edges))
    )
    
    demand = TrafficDemand(
        demand_id="grid_diagonal_demand",
        description="Cross-town demand from N_0_0 to N_2_2 and N_0_2 to N_2_0",
        demands=[
            OriginDestinationDemand(origin="N_0_0", destination="N_2_2", volume_vph=2400.0),
            OriginDestinationDemand(origin="N_0_2", destination="N_2_0", volume_vph=1800.0),
            OriginDestinationDemand(origin="N_1_0", destination="N_1_2", volume_vph=1200.0)
        ]
    )
    return graph, demand


def get_bottleneck_bridge_network() -> Tuple[UrbanFlowGraph, TrafficDemand]:
    """Generates two city hubs connected solely by a single critical bridge."""
    nodes = [
        # West Hub
        GraphNode(id="W1", label="West Suburb", lat=10.010, lng=76.280),
        GraphNode(id="W2", label="West Central", lat=10.000, lng=76.290),
        GraphNode(id="W3", label="West Bridge Approach", lat=10.000, lng=76.305),
        # East Hub
        GraphNode(id="E1", label="East Bridge Exit", lat=10.000, lng=76.325),
        GraphNode(id="E2", label="East Central", lat=10.000, lng=76.340),
        GraphNode(id="E3", label="East Industrial Zone", lat=9.990, lng=76.350)
    ]
    
    edges = [
        # West cluster
        GraphEdge(id="e_W1_W2", source="W1", target="W2", length_m=1200, lanes=2, capacity_vph=2000, geometry=[[76.280, 10.010], [76.290, 10.000]]),
        GraphEdge(id="e_W2_W3", source="W2", target="W3", length_m=1500, lanes=3, capacity_vph=3000, geometry=[[76.290, 10.000], [76.305, 10.000]]),
        # Critical Bridge (Single bottleneck edge joining East and West)
        GraphEdge(id="e_BRIDGE_WE", source="W3", target="E1", name="Backwaters Bridge (Bottleneck)", length_m=2000, lanes=1, capacity_vph=1200, geometry=[[76.305, 10.000], [76.325, 10.000]]),
        GraphEdge(id="e_BRIDGE_EW", source="E1", target="W3", name="Backwaters Bridge (Return)", length_m=2000, lanes=1, capacity_vph=1200, geometry=[[76.325, 10.000], [76.305, 10.000]]),
        # East cluster
        GraphEdge(id="e_E1_E2", source="E1", target="E2", length_m=1500, lanes=3, capacity_vph=3000, geometry=[[76.325, 10.000], [76.340, 10.000]]),
        GraphEdge(id="e_E2_E3", source="E2", target="E3", length_m=1400, lanes=2, capacity_vph=2000, geometry=[[76.340, 10.000], [76.350, 9.990]])
    ]
    
    graph = UrbanFlowGraph(
        graph_id="bottleneck_bridge",
        name="Two-Hub Bottleneck Bridge Network",
        nodes=nodes,
        edges=edges,
        metadata=GraphMetadata(node_count=len(nodes), edge_count=len(edges))
    )
    
    demand = TrafficDemand(
        demand_id="bridge_commute_demand",
        description="Peak cross-channel commute demand",
        demands=[
            OriginDestinationDemand(origin="W1", destination="E3", volume_vph=1800.0),
            OriginDestinationDemand(origin="W2", destination="E2", volume_vph=800.0)
        ]
    )
    return graph, demand
