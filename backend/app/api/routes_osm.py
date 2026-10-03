import random
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.api.routes_graphs import _DEMANDS, _GRAPHS
from app.api.routes_analysis import _AREA_GRAPHS, _AREA_DEMANDS
from app.core.assignment import simulate_traffic_msa
from app.core.graph_model import SimulationConfig, UrbanFlowGraph, TrafficDemand, SimulationResult
from app.core.osm_loader import load_osm_place, load_osm_bbox

router = APIRouter(prefix="/api/osm", tags=["OpenStreetMap"])

RANDOM_LOCATIONS: List[Dict[str, Any]] = [
    {
        "city": "Tokyo (Shibuya)",
        "country": "Japan",
        "min_lat": 35.6550, "min_lng": 139.6960, "max_lat": 35.6640, "max_lng": 139.7070,
        "description": "High-density multi-tiered street grid around Shibuya Crossing"
    },
    {
        "city": "London (Westminster)",
        "country": "United Kingdom",
        "min_lat": 51.5000, "min_lng": -0.1340, "max_lat": 51.5090, "max_lng": -0.1200,
        "description": "Historic Thames-side street network and Westminster artery"
    },
    {
        "city": "Paris (Champs-Élysées)",
        "country": "France",
        "min_lat": 48.8680, "min_lng": 2.3020, "max_lat": 48.8770, "max_lng": 2.3160,
        "description": "Haussmannian radial avenues and arterial roundabout network"
    },
    {
        "city": "New York (Lower Manhattan)",
        "country": "United States",
        "min_lat": 40.7100, "min_lng": -74.0130, "max_lat": 40.7190, "max_lng": -74.0000,
        "description": "High-density canyon grid of the Financial District and Broadway"
    },
    {
        "city": "San Francisco (Financial District)",
        "country": "United States",
        "min_lat": 37.7880, "min_lng": -122.4050, "max_lat": 37.7970, "max_lng": -122.3940,
        "description": "Market Street transit corridor and orthogonal bay street grid"
    },
    {
        "city": "Singapore (Marina Bay)",
        "country": "Singapore",
        "min_lat": 1.2800, "min_lng": 103.8500, "max_lat": 1.2890, "max_lng": 103.8620,
        "description": "Modern planned highway and waterfront boulevard system"
    },
    {
        "city": "Berlin (Mitte)",
        "country": "Germany",
        "min_lat": 52.5160, "min_lng": 13.3900, "max_lat": 52.5250, "max_lng": 13.4060,
        "description": "Unter den Linden central boulevard and Spree river crossings"
    },
    {
        "city": "Mumbai (Bandra Kurla Complex)",
        "country": "India",
        "min_lat": 19.0600, "min_lng": 72.8600, "max_lat": 19.0690, "max_lng": 72.8730,
        "description": "Commercial arterial loop and high-volume commuter connectors"
    },
    {
        "city": "Amsterdam (Centrum)",
        "country": "Netherlands",
        "min_lat": 52.3660, "min_lng": 4.8860, "max_lat": 52.3750, "max_lng": 4.9000,
        "description": "Concentric canal rings and multi-modal urban connectors"
    },
    {
        "city": "Sydney (CBD Core)",
        "country": "Australia",
        "min_lat": -33.8720, "min_lng": 151.2030, "max_lat": -33.8630, "max_lng": 151.2150,
        "description": "George Street corridor and harbour bridge approaches"
    },
    {
        "city": "Kochi (Marine Drive)",
        "country": "India",
        "min_lat": 9.9750, "min_lng": 76.2750, "max_lat": 9.9860, "max_lng": 76.2880,
        "description": "Coastal arterial link connecting Broadway and Shanmugham Road"
    }
]


def _register_graph_and_demand(graph: UrbanFlowGraph, demand: TrafficDemand):
    """Registers graph in both global and area registries for simulation and optimization."""
    _GRAPHS[graph.graph_id] = graph
    _DEMANDS[graph.graph_id] = demand
    _AREA_GRAPHS[graph.graph_id] = graph
    _AREA_DEMANDS[graph.graph_id] = demand


class OSMImportRequest(BaseModel):
    place: str = Field(min_length=2, max_length=200)
    network_type: str = Field(default="drive", pattern="^(drive|walk|bike|all)$")
    demand_multiplier: float = Field(default=1.0, ge=0.1, le=20.0)
    config: Optional[SimulationConfig] = None


class OSMFetchRequest(BaseModel):
    min_lat: float
    min_lng: float
    max_lat: float
    max_lng: float
    label: Optional[str] = "selected area"
    road_density: float = Field(default=1.0, ge=0.0, le=1.0)
    demand_multiplier: float = Field(default=1.0, ge=0.1, le=20.0)
    simulate: bool = True
    config: Optional[SimulationConfig] = None


class OSMRandomRequest(BaseModel):
    city: Optional[str] = None
    demand_multiplier: float = Field(default=1.0, ge=0.1, le=20.0)
    road_density: float = Field(default=1.0, ge=0.0, le=1.0)
    simulate: bool = True
    config: Optional[SimulationConfig] = None


@router.get("/locations")
def list_curated_locations():
    """Returns the list of curated worldwide metropolitan areas available for instant selection."""
    return RANDOM_LOCATIONS


@router.post("/import")
def import_osm_place(payload: OSMImportRequest):
    try:
        graph, demand = load_osm_place(payload.place, payload.network_type)
        _register_graph_and_demand(graph, demand)
        result = simulate_traffic_msa(graph, demand, payload.demand_multiplier, payload.config)
        return {"graph": graph, "demand": demand, "result": result, "area_id": graph.graph_id}
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenStreetMap import failed: {exc}") from exc


@router.post("/fetch")
def fetch_osm_bbox_api(payload: OSMFetchRequest):
    """
    Fetches real-world OpenStreetMap road network for any custom bounding box,
    runs User Equilibrium traffic simulation, and registers it for live interaction.
    """
    try:
        graph, demand = load_osm_bbox(
            payload.min_lat, payload.min_lng, payload.max_lat, payload.max_lng,
            label=payload.label or "selected area",
            road_density=payload.road_density
        )
        _register_graph_and_demand(graph, demand)
        result = None
        if payload.simulate:
            result = simulate_traffic_msa(graph, demand, payload.demand_multiplier, payload.config)
        return {
            "area_id": graph.graph_id,
            "graph": graph,
            "demand": demand,
            "result": result,
            "source": "openstreetmap"
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Map extraction failed: {exc}") from exc


@router.get("/random")
@router.post("/random")
def fetch_random_selection(
    city: Optional[str] = Query(default=None),
    demand_multiplier: float = Query(default=1.0),
    road_density: float = Query(default=1.0),
    simulate: bool = Query(default=True)
):
    """
    Picks a random world city area (or specified city), extracts its live road network,
    computes traffic equilibrium, and returns full graph topology and simulation metrics.
    """
    # Select city location
    loc = None
    if city:
        for item in RANDOM_LOCATIONS:
            if city.lower() in item["city"].lower() or city.lower() in item["country"].lower():
                loc = item
                break
    if not loc:
        loc = random.choice(RANDOM_LOCATIONS)

    try:
        graph, demand = load_osm_bbox(
            loc["min_lat"], loc["min_lng"], loc["max_lat"], loc["max_lng"],
            label=f"{loc['city']}, {loc['country']}",
            road_density=road_density
        )
        _register_graph_and_demand(graph, demand)
        result = None
        if simulate:
            result = simulate_traffic_msa(graph, demand, demand_multiplier, None)

        return {
            "city": loc["city"],
            "country": loc["country"],
            "description": loc["description"],
            "bbox": {
                "min_lat": loc["min_lat"],
                "min_lng": loc["min_lng"],
                "max_lat": loc["max_lat"],
                "max_lng": loc["max_lng"]
            },
            "area_id": graph.graph_id,
            "graph": graph,
            "demand": demand,
            "result": result
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Random area extraction failed: {exc}") from exc