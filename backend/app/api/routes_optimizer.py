from fastapi import APIRouter, HTTPException
from app.core.graph_model import (
    UrbanFlowGraph,
    TrafficDemand,
    OptimizationResult,
    SimulationConfig
)
from app.core.optimizer import optimize_traffic_network
from app.api.routes_graphs import _GRAPHS, _DEMANDS

router = APIRouter(prefix="/api/optimizer", tags=["Optimizer"])


@router.post("/recommend", response_model=OptimizationResult)
def get_optimization_recommendations(
    graph_id: str,
    demand_multiplier: float = 1.0,
    config: SimulationConfig = None
):
    """
    Analyzes the network to identify harmful Braess Paradox shortcuts to remove
    and critical bottlenecks to widen, ranking recommendations by travel time reduction.
    """
    if graph_id not in _GRAPHS:
        raise HTTPException(status_code=404, detail=f"Graph '{graph_id}' not found.")
    
    graph = _GRAPHS[graph_id]
    demand = _DEMANDS.get(graph_id)
    if not demand:
        raise HTTPException(status_code=400, detail="No OD demand matrix found for this graph.")

    result = optimize_traffic_network(
        base_graph=graph,
        demand=demand,
        demand_multiplier=demand_multiplier,
        config=config
    )
    return result
