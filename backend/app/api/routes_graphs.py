from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any
from app.core.graph_model import UrbanFlowGraph, TrafficDemand
from app.data.synthetic_graphs import (
    get_braess_paradox_network,
    get_expanded_braess_network,
    get_grid_3x3_network,
    get_bottleneck_bridge_network,
    get_new_york_manhattan_network
)

router = APIRouter(prefix="/api/graphs", tags=["Graphs"])

# Preloaded registry
_GRAPHS: Dict[str, UrbanFlowGraph] = {}
_DEMANDS: Dict[str, TrafficDemand] = {}

# Initialize registry
b_graph, b_demand = get_braess_paradox_network(include_shortcut=True)
_GRAPHS["braess_4node"] = b_graph
_DEMANDS["braess_4node"] = b_demand

b_sc_graph, _ = get_braess_paradox_network(include_shortcut=True)
_GRAPHS["braess_4node_shortcut"] = b_sc_graph

exp_graph, exp_demand = get_expanded_braess_network()
_GRAPHS["expanded_8node"] = exp_graph
_DEMANDS["expanded_8node"] = exp_demand

g_graph, g_demand = get_grid_3x3_network()
_GRAPHS["grid_3x3"] = g_graph
_DEMANDS["grid_3x3"] = g_demand

ny_graph, ny_demand = get_new_york_manhattan_network()
_GRAPHS["new_york"] = ny_graph
_DEMANDS["new_york"] = ny_demand

import os
import json

br_graph, br_demand = get_bottleneck_bridge_network()
_GRAPHS["bottleneck_bridge"] = br_graph
_DEMANDS["bottleneck_bridge"] = br_demand

# Load real Kochi dataset if present in data/processed/
kochi_graph_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../data/processed/kochi_arterial_graph.json"))
kochi_od_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../data/processed/kochi_arterial_od_matrix.json"))

if os.path.exists(kochi_graph_path):
    try:
        with open(kochi_graph_path, "r") as f:
            k_data = json.load(f)
            k_graph = UrbanFlowGraph(**k_data)
            # Keep the public registry aliases stable. The dataset's internal
            # graph_id must not leak into follow-up simulation requests.
            _GRAPHS["kochi_central"] = k_graph.model_copy(update={"graph_id": "kochi_central"})
            _GRAPHS["kochi_arterial"] = k_graph.model_copy(update={"graph_id": "kochi_arterial"})
        if os.path.exists(kochi_od_path):
            with open(kochi_od_path, "r") as f:
                k_od_data = json.load(f)
                k_demand = TrafficDemand(**k_od_data)
                _DEMANDS["kochi_central"] = k_demand
                _DEMANDS["kochi_arterial"] = k_demand
    except Exception as e:
        print(f"Notice: Could not load Kochi graph dataset: {e}")


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
