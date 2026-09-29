import os
import json
import hashlib
import re
from typing import Any, List, Tuple, Optional
import osmnx as ox

# Configure OSMnx for fast, reliable extraction and caching
ox.settings.use_cache = True
ox.settings.requests_timeout = 6
ox.settings.log_console = False
ox.settings.http_user_agent = "UrbanFlow/1.0 (Urban Traffic Analysis; contact@urbanflow.local)"

from app.core.graph_model import GraphEdge, GraphMetadata, GraphNode, OriginDestinationDemand, TrafficDemand, UrbanFlowGraph

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api",
    "https://overpass.kumi.systems/api",
    "https://lz4.overpass-api.de/api",
]

# Road types ordered from highest-priority to lowest-priority
# road_density=0.0 → only motorway/trunk; road_density=1.0 → all types
ROAD_PRIORITY_LEVELS: List[str] = [
    "motorway", "trunk", "primary", "secondary", "tertiary", "residential", "service", "unclassified", "living_street"
]


def _allowed_road_types(road_density: float) -> set:
    """Return the set of allowed road types for the given density (0.0-1.0)."""
    # Always include at least the top 2 (motorway + trunk) even at density=0
    n = max(2, round(2 + road_density * (len(ROAD_PRIORITY_LEVELS) - 2)))
    return set(ROAD_PRIORITY_LEVELS[:n])

_LOCAL_OSM_DATASET: Optional[dict] = None


def _get_local_osm_dataset() -> Optional[dict]:
    global _LOCAL_OSM_DATASET
    if _LOCAL_OSM_DATASET is not None:
        return _LOCAL_OSM_DATASET

    paths = [
        os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../data/processed/kochi_graph.json")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../data/processed/kochi_arterial_graph.json")),
    ]
    for p in paths:
        if os.path.exists(p):
            try:
                with open(p, "r") as f:
                    _LOCAL_OSM_DATASET = json.load(f)
                    break
            except Exception:
                pass
    return _LOCAL_OSM_DATASET


def extract_local_osm_bbox(min_lat: float, min_lng: float, max_lat: float, max_lng: float, label: str = "selected area", road_density: float = 1.0) -> Tuple[UrbanFlowGraph, TrafficDemand]:
    dataset = _get_local_osm_dataset()
    if not dataset:
        raise ValueError("No local OSM dataset available.")

    allowed_types = _allowed_road_types(road_density)

    raw_nodes = [n for n in dataset.get("nodes", []) if min_lat <= n["lat"] <= max_lat and min_lng <= n["lng"] <= max_lng]
    node_ids = {n["id"] for n in raw_nodes}
    # Filter by road_density: only keep edges whose road_type is in the allowed set
    raw_edges = [
        e for e in dataset.get("edges", [])
        if e["source"] in node_ids and e["target"] in node_ids
        and e.get("road_type", "tertiary") in allowed_types
    ]

    if not raw_nodes or not raw_edges:
        # Fallback: relax road type filter to include tertiary
        raw_edges = [
            e for e in dataset.get("edges", [])
            if e["source"] in node_ids and e["target"] in node_ids
        ]
        if not raw_nodes or not raw_edges:
            raw_nodes = dataset.get("nodes", [])[:30]
            node_ids = {n["id"] for n in raw_nodes}
            raw_edges = [e for e in dataset.get("edges", []) if e["source"] in node_ids and e["target"] in node_ids]

    # Prune nodes to only those actually connected by remaining edges
    connected_node_ids = {e["source"] for e in raw_edges} | {e["target"] for e in raw_edges}
    raw_nodes = [n for n in raw_nodes if n["id"] in connected_node_ids]

    nodes = [GraphNode(**n) for n in raw_nodes]
    edges = [GraphEdge(**e) for e in raw_edges]
    density_tag = f"{road_density:.2f}"
    digest = hashlib.sha1(f"{min_lat:.5f},{min_lng:.5f},{max_lat:.5f},{max_lng:.5f},{density_tag}".encode()).hexdigest()[:12]
    graph_id = f"osm_area_{digest}"
    graph = UrbanFlowGraph(graph_id=graph_id, name=f"{label} | OpenStreetMap", nodes=nodes, edges=edges)

    step = max(1, len(nodes) // 12)
    pairs = [OriginDestinationDemand(origin=nodes[i * step].id, destination=nodes[(i * step + step) % len(nodes)].id, volume_vph=400.0) for i in range(min(12, max(0, len(nodes) - 1)))]
    demand = TrafficDemand(demand_id=f"{graph_id}_demand", description="OD demand from selected area", demands=[p for p in pairs if p.origin != p.destination])
    return graph, demand


def _first(value: Any, default: Any = None) -> Any:
    return value[0] if isinstance(value, list) else (value if value is not None else default)


def _defaults(road_type: str) -> Tuple[int, float, float]:
    return {"motorway": (3, 90.0, 2700.0), "trunk": (3, 70.0, 2400.0), "primary": (2, 55.0, 1800.0), "secondary": (2, 45.0, 1400.0), "tertiary": (1, 35.0, 900.0), "residential": (1, 30.0, 600.0), "service": (1, 20.0, 300.0)}.get(road_type, (1, 30.0, 700.0))


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")[:48] or "place"


def _demand(graph: UrbanFlowGraph, raw_graph: Any, prefix: str) -> TrafficDemand:
    import networkx as nx
    try:
        ids = list(max(nx.strongly_connected_components(raw_graph), key=len))
    except (ValueError, Exception):
        ids = [node.id for node in graph.nodes]
    valid = {node.id for node in graph.nodes}
    ids = [str(node_id) for node_id in ids if str(node_id) in valid]
    if not ids:
        return TrafficDemand(demand_id=f"{prefix}_demand", description="Empty OD demand", demands=[])
    step = max(1, len(ids) // 12)
    pairs = [OriginDestinationDemand(origin=ids[i * step], destination=ids[(i * step + step) % len(ids)], volume_vph=500.0) for i in range(min(12, max(0, len(ids) - 1)))]
    return TrafficDemand(demand_id=f"{prefix}_demand", description="Generated OD demand from reachable OSM roads", demands=[pair for pair in pairs if pair.origin != pair.destination])


def _convert(raw_graph: Any, graph_id: str, name: str) -> Tuple[UrbanFlowGraph, TrafficDemand]:
    nodes = [GraphNode(id=str(node_id), label=f"Junction {node_id}", lat=float(data["y"]), lng=float(data["x"])) for node_id, data in raw_graph.nodes(data=True)]
    node_map = {node.id: node for node in nodes}
    edges = []
    for index, (source, target, data) in enumerate(raw_graph.edges(data=True), start=1):
        source_id, target_id = str(source), str(target)
        road_type = str(_first(data.get("highway"), "tertiary"))
        default_lanes, default_speed, default_capacity = _defaults(road_type)
        try:
            lanes = max(1, min(8, int(str(_first(data.get("lanes"), default_lanes)).split(";")[0])))
        except (TypeError, ValueError):
            lanes = default_lanes
        try:
            speed = float(str(_first(data.get("maxspeed"), default_speed)).split(";")[0].split()[0])
        except (TypeError, ValueError):
            speed = default_speed
        geometry = data.get("geometry")
        coordinates = [[float(x), float(y)] for x, y in geometry.coords] if geometry is not None and hasattr(geometry, "coords") else [[node_map[source_id].lng, node_map[source_id].lat], [node_map[target_id].lng, node_map[target_id].lat]]
        edges.append(GraphEdge(id=f"{graph_id}_e_{index}", source=source_id, target=target_id, name=str(_first(data.get("name"), _first(data.get("ref"), f"Road {index}"))), length_m=float(data.get("length", 200.0)), lanes=lanes, free_speed_kmh=speed, capacity_vph=round(default_capacity * lanes / max(default_lanes, 1), 1), geometry=coordinates, road_type=road_type, oneway=bool(data.get("oneway", True))))
    graph = UrbanFlowGraph(graph_id=graph_id, name=name, metadata=GraphMetadata(node_count=len(nodes), edge_count=len(edges)), nodes=nodes, edges=edges)
    return graph, _demand(graph, raw_graph, graph_id)


def load_osm_bbox(min_lat: float, min_lng: float, max_lat: float, max_lng: float, label: str = "selected area", road_density: float = 1.0) -> Tuple[UrbanFlowGraph, TrafficDemand]:
    min_lat, max_lat = min(float(min_lat), float(max_lat)), max(float(min_lat), float(max_lat))
    min_lng, max_lng = min(float(min_lng), float(max_lng)), max(float(min_lng), float(max_lng))
    if abs(max_lat - min_lat) < 0.0001 or abs(max_lng - min_lng) < 0.0001:
        min_lat -= 0.001
        max_lat += 0.001
        min_lng -= 0.001
        max_lng += 0.001
    if max_lat - min_lat > 0.35 or max_lng - min_lng > 0.35:
        raise ValueError("Selected area is too large; select an area no larger than 0.35 degrees")

    # If within Kochi coordinates, extract directly from high-resolution local dataset for instantaneous response
    if 9.80 <= min_lat <= 10.25 and 76.10 <= min_lng <= 76.50:
        try:
            return extract_local_osm_bbox(min_lat, min_lng, max_lat, max_lng, label, road_density)
        except Exception:
            pass

    # Otherwise query Overpass mirrors
    last_error = None
    raw_graph = None
    for endpoint in OVERPASS_ENDPOINTS:
        try:
            ox.settings.overpass_url = endpoint
            ox.settings.requests_timeout = 6
            raw_graph = ox.graph_from_bbox(bbox=(min_lng, min_lat, max_lng, max_lat), network_type="drive", simplify=True)
            if raw_graph and len(raw_graph.nodes) > 0:
                break
        except Exception as e:
            last_error = e
            continue

    if raw_graph is None or len(raw_graph.nodes) == 0:
        for endpoint in OVERPASS_ENDPOINTS:
            try:
                ox.settings.overpass_url = endpoint
                ox.settings.requests_timeout = 6
                raw_graph = ox.graph_from_bbox(bbox=(min_lng, min_lat, max_lng, max_lat), network_type="all", simplify=True)
                if raw_graph and len(raw_graph.nodes) > 0:
                    break
            except Exception as e:
                last_error = e
                continue

    if raw_graph is None or len(raw_graph.nodes) == 0:
        # Fallback to local dataset extraction
        try:
            return extract_local_osm_bbox(min_lat, min_lng, max_lat, max_lng, label)
        except Exception:
            raise RuntimeError(f"Could not retrieve OpenStreetMap roads for bounding box ({min_lat:.4f}, {min_lng:.4f}, {max_lat:.4f}, {max_lng:.4f}): {last_error}")

    digest = hashlib.sha1(f"{min_lat:.5f},{min_lng:.5f},{max_lat:.5f},{max_lng:.5f}".encode()).hexdigest()[:12]
    return _convert(raw_graph, f"osm_area_{digest}", f"{label} | OpenStreetMap")


def load_osm_place(place: str, network_type: str = "drive") -> Tuple[UrbanFlowGraph, TrafficDemand]:
    try:
        boundary = ox.geocode_to_gdf(place)
        if not boundary.empty:
            polygon = boundary.geometry.union_all() if hasattr(boundary.geometry, "union_all") else boundary.geometry.unary_union
            return _convert(ox.graph_from_polygon(polygon, network_type=network_type, simplify=True), f"osm_{_slug(place)}", f"{place} | OpenStreetMap")
    except Exception:
        pass
    # Fallback to local dataset
    return extract_local_osm_bbox(9.97, 76.28, 10.02, 76.32, place)


