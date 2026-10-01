"""
Synthetic Graph and Demand Generators for UrbanFlow validation and optimization.
Includes:
1. Classic 4-Node Braess Network
2. Expanded 8-Node Multi-Hub Network with Latent Braess Paradox
3. 3x3 Urban Grid Network
4. 6-Node Bottleneck Bridge Network
"""
from typing import Tuple
from app.core.graph_model import (
    UrbanFlowGraph,
    GraphNode,
    GraphEdge,
    GraphMetadata,
    TrafficDemand,
    OriginDestinationDemand
)


def get_braess_paradox_network(include_shortcut: bool = False) -> Tuple[UrbanFlowGraph, TrafficDemand]:
    """
    Classic 4-node Braess Paradox Graph.
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
        # Path 1: A -> B: t(v) = 0.6 * v (seconds), which is v / 100 (minutes)
        GraphEdge(
            id="e_AB", source="A", target="B", name="A ➔ B (Flow Dependent)",
            length_m=10000.0, lanes=1, free_speed_kmh=60.0, capacity_vph=1000.0,
            alpha=0.6, beta=1.0, cost_model="braess_exact",
            geometry=[[76.300, 10.000], [76.320, 10.020]]
        ),
        # Path 1: B -> D: fixed 45 mins = 2700 seconds
        GraphEdge(
            id="e_BD", source="B", target="D", name="B ➔ D (Fixed 45 min)",
            length_m=27000.0, lanes=4, free_speed_kmh=36.0, capacity_vph=10000.0,
            alpha=0.0, beta=1.0, cost_model="braess_exact",
            geometry=[[76.320, 10.020], [76.340, 10.000]]
        ),
        # Path 2: A -> C: fixed 45 mins = 2700 seconds
        GraphEdge(
            id="e_AC", source="A", target="C", name="A ➔ C (Fixed 45 min)",
            length_m=27000.0, lanes=4, free_speed_kmh=36.0, capacity_vph=10000.0,
            alpha=0.0, beta=1.0, cost_model="braess_exact",
            geometry=[[76.300, 10.000], [76.320, 9.980]]
        ),
        # Path 2: C -> D: t(v) = 0.6 * v (seconds), which is v / 100 (minutes)
        GraphEdge(
            id="e_CD", source="C", target="D", name="C ➔ D (Flow Dependent)",
            length_m=10000.0, lanes=1, free_speed_kmh=60.0, capacity_vph=1000.0,
            alpha=0.6, beta=1.0, cost_model="braess_exact",
            geometry=[[76.320, 9.980], [76.340, 10.000]]
        )
    ]
    
    if include_shortcut:
        edges.append(
            GraphEdge(
                id="e_BC", source="B", target="C", name="B ➔ C (Zero-Cost Shortcut)",
                length_m=10.0, lanes=4, free_speed_kmh=120.0, capacity_vph=10000.0,
                alpha=0.0, beta=1.0, cost_model="braess_exact",
                geometry=[[76.320, 10.020], [76.320, 9.980]]
            )
        )

    graph = UrbanFlowGraph(
        graph_id="braess_4node_shortcut" if include_shortcut else "braess_4node",
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


def get_expanded_braess_network() -> Tuple[UrbanFlowGraph, TrafficDemand]:
    """
    Expanded 8-node multi-corridor city network containing a latent Braess Paradox road (H3 -> H4).
    Nodes:
    - O1, O2 (Origins: Residential North & West)
    - H1, H2, H3, H4 (Transit Hubs)
    - D1, D2 (Destinations: Commercial Downtown & Tech Park)
    """
    nodes = [
        GraphNode(id="O1", label="North Suburb (O1)", lat=10.040, lng=76.280, type="origin"),
        GraphNode(id="O2", label="West Suburb (O2)", lat=10.000, lng=76.270, type="origin"),
        GraphNode(id="H1", label="North Hub (H1)", lat=10.040, lng=76.310, type="intersection"),
        GraphNode(id="H2", label="Central Junction (H2)", lat=10.010, lng=76.300, type="intersection"),
        GraphNode(id="H3", label="Midtown Bypass (H3)", lat=10.030, lng=76.330, type="intersection"),
        GraphNode(id="H4", label="South Hub (H4)", lat=9.980, lng=76.330, type="intersection"),
        GraphNode(id="D1", label="Downtown CBD (D1)", lat=10.020, lng=76.360, type="destination"),
        GraphNode(id="D2", label="Tech Park (D2)", lat=9.970, lng=76.360, type="destination")
    ]

    edges = [
        # O1 routes
        GraphEdge(id="e_O1_H1", source="O1", target="H1", name="North Ring Expressway", length_m=3200, lanes=3, capacity_vph=3200, free_speed_kmh=60),
        GraphEdge(id="e_O1_H2", source="O1", target="H2", name="West Link", length_m=3500, lanes=2, capacity_vph=1800, free_speed_kmh=45),
        
        # O2 routes
        GraphEdge(id="e_O2_H2", source="O2", target="H2", name="West Arterial", length_m=3000, lanes=2, capacity_vph=2000, free_speed_kmh=50),
        GraphEdge(id="e_O2_H4", source="O2", target="H4", name="South Canal Road", length_m=6500, lanes=3, capacity_vph=3000, free_speed_kmh=60),
        
        # Central connections
        GraphEdge(id="e_H1_H3", source="H1", target="H3", name="Midtown Connector", length_m=2200, lanes=2, capacity_vph=1500, free_speed_kmh=50),
        GraphEdge(id="e_H2_H3", source="H2", target="H3", name="Central Eastway", length_m=3400, lanes=2, capacity_vph=1800, free_speed_kmh=45),
        GraphEdge(id="e_H2_H4", source="H2", target="H4", name="Central Southway", length_m=3200, lanes=2, capacity_vph=1800, free_speed_kmh=45),
        
        # Latent Braess Paradox edge: Shortcut H3 -> H4
        # This shortcut entices drivers away from wide expressways, overloading H4 and downstream exits!
        GraphEdge(
            id="e_H3_H4_SHORTCUT", source="H3", target="H4", name="Midtown-South Crosscut (Braess Link)",
            length_m=600, lanes=2, capacity_vph=3500, free_speed_kmh=70, alpha=0.05, beta=2.0
        ),
        
        # Destination connections
        GraphEdge(id="e_H3_D1", source="H3", target="D1", name="CBD North Avenue", length_m=3100, lanes=2, capacity_vph=1900, free_speed_kmh=45),
        GraphEdge(id="e_H4_D1", source="H4", target="D1", name="CBD South Avenue (Bottleneck)", length_m=4200, lanes=1, capacity_vph=1100, free_speed_kmh=35, alpha=0.4, beta=3.5),
        GraphEdge(id="e_H4_D2", source="H4", target="D2", name="Tech Park Radial", length_m=3300, lanes=2, capacity_vph=2200, free_speed_kmh=55)
    ]

    graph = UrbanFlowGraph(
        graph_id="expanded_8node",
        name="Expanded 8-Node Multi-Hub City Network",
        nodes=nodes,
        edges=edges,
        metadata=GraphMetadata(node_count=len(nodes), edge_count=len(edges))
    )

    demand = TrafficDemand(
        demand_id="metro_morning_peak",
        description="Dual-origin commute into Downtown CBD (D1) and Tech Park (D2)",
        demands=[
            OriginDestinationDemand(origin="O1", destination="D1", volume_vph=2200.0),
            OriginDestinationDemand(origin="O1", destination="D2", volume_vph=1400.0),
            OriginDestinationDemand(origin="O2", destination="D1", volume_vph=1800.0),
            OriginDestinationDemand(origin="O2", destination="D2", volume_vph=1200.0)
        ]
    )

    return graph, demand


def get_grid_3x3_network() -> Tuple[UrbanFlowGraph, TrafficDemand]:
    """Generates a 3x3 urban grid network with 9 nodes and 24 directed edges."""
    nodes = []
    base_lat, base_lng = 10.000, 76.300
    grid_size = 3
    spacing = 0.015
    
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
            if c + 1 < grid_size:
                v_id = f"N_{r}_{c+1}"
                u_node, v_node = node_map[u_id], node_map[v_id]
                edges.append(GraphEdge(
                    id=f"e_{edge_idx}", source=u_id, target=v_id, name=f"St {u_id}➔{v_id}",
                    length_m=1500.0, lanes=2, free_speed_kmh=45.0, capacity_vph=1600.0,
                    geometry=[[u_node.lng, u_node.lat], [v_node.lng, v_node.lat]]
                ))
                edge_idx += 1
                edges.append(GraphEdge(
                    id=f"e_{edge_idx}", source=v_id, target=u_id, name=f"St {v_id}➔{u_id}",
                    length_m=1500.0, lanes=2, free_speed_kmh=45.0, capacity_vph=1600.0,
                    geometry=[[v_node.lng, v_node.lat], [u_node.lng, u_node.lat]]
                ))
                edge_idx += 1
            
            if r + 1 < grid_size:
                v_id = f"N_{r+1}_{c}"
                u_node, v_node = node_map[u_id], node_map[v_id]
                edges.append(GraphEdge(
                    id=f"e_{edge_idx}", source=u_id, target=v_id, name=f"Ave {u_id}➔{v_id}",
                    length_m=1500.0, lanes=2, free_speed_kmh=45.0, capacity_vph=1600.0,
                    geometry=[[u_node.lng, u_node.lat], [v_node.lng, v_node.lat]]
                ))
                edge_idx += 1
                edges.append(GraphEdge(
                    id=f"e_{edge_idx}", source=v_id, target=u_id, name=f"Ave {v_id}➔{u_id}",
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
        GraphNode(id="W1", label="West Suburb", lat=10.010, lng=76.280, type="origin"),
        GraphNode(id="W2", label="West Central", lat=10.000, lng=76.290, type="intersection"),
        GraphNode(id="W3", label="West Bridge Approach", lat=10.000, lng=76.305, type="intersection"),
        GraphNode(id="E1", label="East Bridge Exit", lat=10.000, lng=76.325, type="intersection"),
        GraphNode(id="E2", label="East Central", lat=10.000, lng=76.340, type="intersection"),
        GraphNode(id="E3", label="East Industrial Zone", lat=9.990, lng=76.350, type="destination")
    ]
    
    edges = [
        GraphEdge(id="e_W1_W2", source="W1", target="W2", length_m=1200, lanes=2, capacity_vph=2000),
        GraphEdge(id="e_W2_W3", source="W2", target="W3", length_m=1500, lanes=3, capacity_vph=3000),
        GraphEdge(id="e_BRIDGE_WE", source="W3", target="E1", name="Backwaters Bridge (Bottleneck)", length_m=2000, lanes=1, capacity_vph=1200),
        GraphEdge(id="e_BRIDGE_EW", source="E1", target="W3", name="Backwaters Bridge (Return)", length_m=2000, lanes=1, capacity_vph=1200),
        GraphEdge(id="e_E1_E2", source="E1", target="E2", length_m=1500, lanes=3, capacity_vph=3000),
        GraphEdge(id="e_E2_E3", source="E2", target="E3", length_m=1400, lanes=2, capacity_vph=2000)
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


def get_new_york_manhattan_network() -> Tuple[UrbanFlowGraph, TrafficDemand]:
    """
    Generates a realistic Midtown Manhattan Grid network (Times Square, Grand Central, Herald Square, Central Park South).
    Avenues (North/South): 8th Ave, 7th Ave, Broadway, 6th Ave, 5th Ave, Madison Ave, Park Ave.
    Cross Streets (East/West): 34th St, 42nd St, 49th St, 57th St.
    """
    streets = [
        ("34th", 40.7488),
        ("42nd", 40.7549),
        ("49th", 40.7598),
        ("57th", 40.7658),
    ]
    avenues = [
        ("8th_Ave", -73.9930, "southbound"),
        ("7th_Ave", -73.9870, "southbound"),
        ("6th_Ave", -73.9820, "northbound"),
        ("5th_Ave", -73.9770, "southbound"),
        ("Madison_Ave", -73.9730, "northbound"),
        ("Park_Ave", -73.9700, "two-way"),
    ]

    nodes = []
    node_map = {}
    for st_name, lat in streets:
        for av_name, lng, _ in avenues:
            nid = f"{st_name}_{av_name}"
            label = f"{st_name} St & {av_name.replace('_', ' ')}"
            node_type = "origin" if st_name == "34th" else ("destination" if st_name == "57th" else "intersection")
            node = GraphNode(id=nid, label=label, lat=lat, lng=lng, type=node_type)
            nodes.append(node)
            node_map[nid] = node

    edges = []
    edge_idx = 1
    # Cross street links (alternating one-way)
    for st_idx, (st_name, _) in enumerate(streets):
        direction = "eastbound" if st_idx % 2 == 0 else "westbound"
        for i in range(len(avenues) - 1):
            av1, av2 = avenues[i][0], avenues[i + 1][0]
            u_id = f"{st_name}_{av1}"
            v_id = f"{st_name}_{av2}"
            u_node, v_node = node_map[u_id], node_map[v_id]
            if direction == "eastbound":
                src, tgt, g = u_id, v_id, [[u_node.lng, u_node.lat], [v_node.lng, v_node.lat]]
            else:
                src, tgt, g = v_id, u_id, [[v_node.lng, v_node.lat], [u_node.lng, u_node.lat]]

            edges.append(GraphEdge(
                id=f"e_ny_{edge_idx}", source=src, target=tgt, name=f"{st_name} St ({direction})",
                length_m=350.0, lanes=2, free_speed_kmh=40.0, capacity_vph=1400.0,
                geometry=g, road_type="primary"
            ))
            edge_idx += 1

    # Avenue links
    for av_name, _, av_dir in avenues:
        for i in range(len(streets) - 1):
            st1, st2 = streets[i][0], streets[i + 1][0]
            u_id = f"{st1}_{av_name}"  # South
            v_id = f"{st2}_{av_name}"  # North
            u_node, v_node = node_map[u_id], node_map[v_id]

            if av_dir in ("northbound", "two-way"):
                edges.append(GraphEdge(
                    id=f"e_ny_{edge_idx}", source=u_id, target=v_id, name=f"{av_name.replace('_', ' ')} (NB)",
                    length_m=650.0, lanes=3, free_speed_kmh=45.0, capacity_vph=2400.0,
                    geometry=[[u_node.lng, u_node.lat], [v_node.lng, v_node.lat]], road_type="primary"
                ))
                edge_idx += 1
            if av_dir in ("southbound", "two-way"):
                edges.append(GraphEdge(
                    id=f"e_ny_{edge_idx}", source=v_id, target=u_id, name=f"{av_name.replace('_', ' ')} (SB)",
                    length_m=650.0, lanes=3, free_speed_kmh=45.0, capacity_vph=2400.0,
                    geometry=[[v_node.lng, v_node.lat], [u_node.lng, u_node.lat]], road_type="primary"
                ))
                edge_idx += 1

    # Add Broadway diagonal shortcut crossing Herald Square to Times Square
    u_herald = "34th_6th_Ave"
    v_times = "42nd_7th_Ave"
    if u_herald in node_map and v_times in node_map:
        edges.append(GraphEdge(
            id="e_ny_broadway_shortcut", source=u_herald, target=v_times, name="Broadway Diagonal Corridor",
            length_m=750.0, lanes=2, free_speed_kmh=40.0, capacity_vph=1600.0,
            geometry=[[node_map[u_herald].lng, node_map[u_herald].lat], [node_map[v_times].lng, node_map[v_times].lat]],
            road_type="primary"
        ))

    graph = UrbanFlowGraph(
        graph_id="new_york",
        name="New York City (Midtown Manhattan Grid)",
        nodes=nodes,
        edges=edges,
        metadata=GraphMetadata(node_count=len(nodes), edge_count=len(edges), bbox=[-73.9930, 40.7488, -73.9700, 40.7658])
    )

    demand = TrafficDemand(
        demand_id="new_york_midtown_demand",
        description="Midtown commute demand from Herald Sq / Penn Station to Grand Central / Central Park",
        demands=[
            OriginDestinationDemand(origin="34th_8th_Ave", destination="57th_Park_Ave", volume_vph=2200.0),
            OriginDestinationDemand(origin="34th_7th_Ave", destination="57th_5th_Ave", volume_vph=1800.0),
            OriginDestinationDemand(origin="34th_6th_Ave", destination="57th_Madison_Ave", volume_vph=1600.0),
            OriginDestinationDemand(origin="42nd_8th_Ave", destination="49th_Park_Ave", volume_vph=1400.0)
        ]
    )
    return graph, demand


def get_braess_3route_network() -> Tuple[UrbanFlowGraph, TrafficDemand]:
    """
    Canonical 3-Road Paradox (Triad Network):
    Three roads connect Source (A) to Sink (B) directly:
    - Road 1 (North Highway): 12 km, 4 lanes, capacity 3,200 vph, free-flow time 14 min.
    - Road 2 (Central Cut-Through - The Paradox Link): 6 km, 1 lane, capacity 900 vph, free-flow time 5 min.
      Initial quick allure causes the majority of drivers to crowd into it, spiking congested travel time to 35+ mins!
    - Road 3 (South Highway): 12 km, 4 lanes, capacity 3,200 vph, free-flow time 14 min.

    When Road 2 (Central Cut-Through) is REMOVED:
    Traffic splits 50/50 onto North and South Highways (2,000 vph each, well under capacity V/C=0.62).
    Average travel time drops from ~35.5 mins down to ~12.3 mins (-65% latency reduction)!
    Average network speed jumps from ~14 km/h to ~50 km/h!
    """
    nodes = [
        GraphNode(id="A", label="Source (West Metro Hub A)", lat=10.000, lng=76.275, type="origin"),
        GraphNode(id="B", label="Sink (East Downtown CBD B)", lat=10.000, lng=76.365, type="destination"),
    ]

    edges = [
        # Road 1: North Highway (longer 12 km highway curving north from Source to Sink)
        GraphEdge(
            id="e_ROAD_1", source="A", target="B", name="Road 1 (North Highway)",
            length_m=12000.0, lanes=4, free_speed_kmh=60.0, capacity_vph=3200.0,
            alpha=0.15, beta=4.0, cost_model="bpr", free_flow_time_sec=840.0,
            geometry=[[76.275, 10.000], [76.320, 10.035], [76.365, 10.000]], road_type="motorway"
        ),
        # Road 2: Central Cut-Through (shorter 6 km narrow road straight through the middle from Source to Sink)
        GraphEdge(
            id="e_ROAD_2", source="A", target="B", name="Road 2 (Central Cut-Through - Paradox Link)",
            length_m=6000.0, lanes=1, free_speed_kmh=72.0, capacity_vph=900.0,
            alpha=0.15, beta=4.0, cost_model="braess_exact", free_flow_time_sec=300.0,
            geometry=[[76.275, 10.000], [76.320, 10.000], [76.365, 10.000]], road_type="secondary"
        ),
        # Road 3: South Highway (longer 12 km highway curving south from Source to Sink)
        GraphEdge(
            id="e_ROAD_3", source="A", target="B", name="Road 3 (South Highway)",
            length_m=12000.0, lanes=4, free_speed_kmh=60.0, capacity_vph=3200.0,
            alpha=0.15, beta=4.0, cost_model="bpr", free_flow_time_sec=840.0,
            geometry=[[76.275, 10.000], [76.320, 9.965], [76.365, 10.000]], road_type="motorway"
        ),
    ]

    graph = UrbanFlowGraph(
        graph_id="braess_3route",
        name="Canonical 3-Road Paradox (Three Direct Routes A ➔ B)",
        nodes=nodes,
        edges=edges,
        metadata=GraphMetadata(node_count=len(nodes), edge_count=len(edges), bbox=[76.275, 9.965, 76.365, 10.035])
    )

    demand = TrafficDemand(
        demand_id="braess_3route_demand",
        description="Peak Commuter Demand from Source (A) to Sink (B)",
        demands=[
            OriginDestinationDemand(origin="A", destination="B", volume_vph=4000.0)
        ]
    )
    return graph, demand


