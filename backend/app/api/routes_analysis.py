from typing import Dict, List
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from app.api.routes_graphs import _GRAPHS, _DEMANDS
from app.core.assignment import simulate_traffic_msa
from app.core.graph_model import SimulationConfig, TrafficDemand, UrbanFlowGraph
from app.core.osm_loader import load_osm_bbox

router = APIRouter(prefix="/api/analysis", tags=["Analysis"])
_AREA_GRAPHS: Dict[str, UrbanFlowGraph] = {}
_AREA_DEMANDS: Dict[str, TrafficDemand] = {}
_OSM_AREA_CACHE: Dict[str, tuple[UrbanFlowGraph, TrafficDemand]] = {}


class AreaAnalysisRequest(BaseModel):
    graph_id: str
    min_lat: float
    min_lng: float
    max_lat: float
    max_lng: float
    demand_multiplier: float = Field(default=1.0, ge=0.1, le=5.0)
    config: SimulationConfig | None = None
    fetch_osm: bool = True


def get_analysis_graph(graph_id: str):
    graph_id = {"kochi_central_osm": "kochi_central", "kochi_arterial_osm": "kochi_arterial"}.get(graph_id, graph_id)
    return _AREA_GRAPHS.get(graph_id) or _GRAPHS.get(graph_id), _AREA_DEMANDS.get(graph_id) or _DEMANDS.get(graph_id)


@router.post("/area")
def analyze_area(payload: AreaAnalysisRequest):
    if payload.fetch_osm:
        cache_key = f"{payload.min_lat:.5f},{payload.min_lng:.5f},{payload.max_lat:.5f},{payload.max_lng:.5f}"
        try:
            cached = cache_key in _OSM_AREA_CACHE
            graph, demand = _OSM_AREA_CACHE.get(cache_key) or load_osm_bbox(payload.min_lat, payload.min_lng, payload.max_lat, payload.max_lng)
            _OSM_AREA_CACHE[cache_key] = (graph, demand)
            _AREA_GRAPHS[graph.graph_id] = graph
            _AREA_DEMANDS[graph.graph_id] = demand
            result = simulate_traffic_msa(graph, demand, payload.demand_multiplier, payload.config)
            return {"area_id": graph.graph_id, "graph": graph, "result": result, "source": "openstreetmap", "cached": cached}
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"OSM area download failed: {exc}") from exc

    graph, demand = get_analysis_graph(payload.graph_id)
    if not graph:
        raise HTTPException(status_code=404, detail=f"Graph '{payload.graph_id}' not found.")

    def inside(node):
        return payload.min_lat <= node.lat <= payload.max_lat and payload.min_lng <= node.lng <= payload.max_lng

    node_ids = {node.id for node in graph.nodes if inside(node)}
    edges = [edge for edge in graph.edges if edge.source in node_ids and edge.target in node_ids]
    area_id = f"{payload.graph_id}_area_{len(_AREA_GRAPHS) + 1}"
    area_graph = UrbanFlowGraph(graph_id=area_id, name=f"{graph.name} | selected area", crs=graph.crs, nodes=[node for node in graph.nodes if node.id in node_ids], edges=edges)
    area_demands = TrafficDemand(demand_id=f"{area_id}_demand", description="OD demand restricted to selected area", demands=[od for od in (demand.demands if demand else []) if od.origin in node_ids and od.destination in node_ids])
    _AREA_GRAPHS[area_id] = area_graph
    _AREA_DEMANDS[area_id] = area_demands
    result = simulate_traffic_msa(area_graph, area_demands, payload.demand_multiplier, payload.config)
    return {"area_id": area_id, "graph": area_graph, "result": result}