from fastapi import APIRouter, HTTPException
from app.core.graph_model import InterventionPayload, InterventionReport
from app.core.intervention import evaluate_intervention
from app.api.routes_graphs import _GRAPHS, _DEMANDS
from app.api.routes_analysis import _AREA_GRAPHS, _AREA_DEMANDS

router = APIRouter(prefix="/api/interventions", tags=["Interventions"])


@router.post("/evaluate", response_model=InterventionReport)
def evaluate_proposed_intervention(payload: InterventionPayload):
    """
    Simulates baseline vs modified graph (widen, close, add roads) and returns delta comparison.
    """
    if payload.base_graph_id not in _GRAPHS and payload.base_graph_id not in _AREA_GRAPHS:
        raise HTTPException(status_code=404, detail=f"Base graph '{payload.base_graph_id}' not found.")
    
    base_graph = _AREA_GRAPHS.get(payload.base_graph_id) or _GRAPHS[payload.base_graph_id]
    demand = payload.demand or _AREA_DEMANDS.get(payload.base_graph_id) or _DEMANDS.get(payload.base_graph_id)
    
    if not demand:
        raise HTTPException(status_code=400, detail="No OD demand matrix found for this graph.")

    report = evaluate_intervention(
        base_graph=base_graph,
        demand=demand,
        modifications=payload.modifications,
        demand_multiplier=payload.demand_multiplier,
        config=payload.config
    )
    return report
