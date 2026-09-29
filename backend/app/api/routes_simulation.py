from fastapi import APIRouter, HTTPException, Body
from typing import Optional
from app.core.graph_model import (
    UrbanFlowGraph,
    TrafficDemand,
    SimulationResult
)
from app.core.assignment import simulate_traffic_msa
from app.api.routes_graphs import _GRAPHS, _DEMANDS

router = APIRouter(prefix="/api/simulate", tags=["Simulation"])


@router.post("", response_model=SimulationResult)
def run_simulation(
    graph_id: Optional[str] = None,
    graph: Optional[UrbanFlowGraph] = None,
    demand: Optional[TrafficDemand] = None,
    demand_multiplier: float = 1.0,
    iterations: int = 40
):
    """
    Executes User Equilibrium traffic assignment using MSA.
    Can accept either a registered `graph_id` or an ad-hoc `graph` payload.
    """
    target_graph = graph
    if target_graph is None and graph_id:
        if graph_id not in _GRAPHS:
            raise HTTPException(status_code=404, detail=f"Graph '{graph_id}' not found.")
        target_graph = _GRAPHS[graph_id]

    if target_graph is None:
        raise HTTPException(status_code=400, detail="Must provide either 'graph_id' or 'graph' object.")

    target_demand = demand
    if target_demand is None and graph_id and graph_id in _DEMANDS:
        target_demand = _DEMANDS[graph_id]
    
    if target_demand is None:
        target_demand = TrafficDemand(demand_id="empty_demand", demands=[])

    result = simulate_traffic_msa(
        graph=target_graph,
        demand=target_demand,
        demand_multiplier=demand_multiplier,
        max_iterations=iterations
    )
    return result
