from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any
from backend.app.core.graph_model import UrbanFlowGraph, TrafficDemand
from backend.app.data.synthetic_graphs import (
    get_braess_paradox_network,
    get_grid_3x3_network,
    get_bottleneck_bridge_network
)

router = APIRouter(prefix="/api/graphs", tags=["Graphs"])

# Preloaded registry
_GRAPHS: Dict[str, UrbanFlowGraph] = {}
_DEMANDS: Dict[str, TrafficDemand] = {}

# Initialize registry
b_graph, b_demand = get_braess_paradox_network(include_shortcut=False)
_GRAPHS["braess_4node"] = b_graph
_DEMANDS["braess_4node"] = b_demand

b_sc_graph, _ = get_braess_paradox_network(include_shortcut=True)
_GRAPHS["braess_4node_shortcut"] = b_sc_graph

g_graph, g_demand = get_grid_3x3_network()
_GRAPHS["grid_3x3"] = g_graph
_DEMANDS["grid_3x3"] = g_demand

br_graph, br_demand = get_bottleneck_bridge_network()
_GRAPHS["bottleneck_bridge"] = br_graph
_DEMANDS["bottleneck_bridge"] = br_demand


@router.get("", response_model=List[Dict[str, Any]])
def list_available_graphs():
    """Returns a list of all registered networks with basic metadata."""
    results = []
    for gid, g in _GRAPHS.items():
        results.append({
            "graph_id": g.graph_id,
            "name": g.name,
            "node_count": len(g.nodes),
            "edge_count": len(g.edges),
            "has_demand": gid in _DEMANDS
        })
    return results


@router.get("/{graph_id}", response_model=UrbanFlowGraph)
def get_graph_by_id(graph_id: str):
    """Fetches full graph topology, nodes, and edges."""
    if graph_id not in _GRAPHS:
        raise HTTPException(status_code=404, detail=f"Graph '{graph_id}' not found.")
    return _GRAPHS[graph_id]


@router.get("/{graph_id}/demand", response_model=TrafficDemand)
def get_graph_default_demand(graph_id: str):
    """Fetches default origin-destination demand matrix for graph."""
    if graph_id not in _DEMANDS:
        # Fallback to empty demand
        return TrafficDemand(demand_id="empty_demand", demands=[])
    return _DEMANDS[graph_id]
