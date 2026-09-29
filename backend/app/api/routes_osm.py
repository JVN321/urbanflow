from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.api.routes_graphs import _DEMANDS, _GRAPHS
from app.core.assignment import simulate_traffic_msa
from app.core.graph_model import SimulationConfig
from app.core.osm_loader import load_osm_place

router = APIRouter(prefix="/api/osm", tags=["OpenStreetMap"])


class OSMImportRequest(BaseModel):
    place: str = Field(min_length=2, max_length=200)
    network_type: str = Field(default="drive", pattern="^(drive|walk|bike|all)$")
    demand_multiplier: float = Field(default=1.0, ge=0.1, le=5.0)
    config: SimulationConfig | None = None


@router.post("/import")
def import_osm_place(payload: OSMImportRequest):
    try:
        graph, demand = load_osm_place(payload.place, payload.network_type)
        _GRAPHS[graph.graph_id] = graph
        _DEMANDS[graph.graph_id] = demand
        result = simulate_traffic_msa(graph, demand, payload.demand_multiplier, payload.config)
        return {"graph": graph, "demand": demand, "result": result}
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenStreetMap import failed: {exc}") from exc