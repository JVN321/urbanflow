import hashlib
import re
from typing import Any, Tuple

from app.core.graph_model import GraphEdge, GraphMetadata, GraphNode, OriginDestinationDemand, TrafficDemand, UrbanFlowGraph


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
    except ValueError:
        ids = [node.id for node in graph.nodes]
    valid = {node.id for node in graph.nodes}
    ids = [str(node_id) for node_id in ids if str(node_id) in valid]
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


def load_osm_bbox(min_lat: float, min_lng: float, max_lat: float, max_lng: float, label: str = "selected area") -> Tuple[UrbanFlowGraph, TrafficDemand]:
    import osmnx as ox
    if min_lat >= max_lat or min_lng >= max_lng:
        raise ValueError("Selected area bounds are invalid")
    if max_lat - min_lat > 0.25 or max_lng - min_lng > 0.25:
        raise ValueError("Selected area is too large; select an area no larger than 0.25 degrees")
    raw_graph = ox.graph_from_bbox(bbox=(min_lng, min_lat, max_lng, max_lat), network_type="drive", simplify=True)
    digest = hashlib.sha1(f"{min_lat:.5f},{min_lng:.5f},{max_lat:.5f},{max_lng:.5f}".encode()).hexdigest()[:12]
    return _convert(raw_graph, f"osm_area_{digest}", f"{label} | OpenStreetMap")


def load_osm_place(place: str, network_type: str = "drive") -> Tuple[UrbanFlowGraph, TrafficDemand]:
    import osmnx as ox
    boundary = ox.geocode_to_gdf(place)
    if boundary.empty:
        raise ValueError(f"No OpenStreetMap boundary found for '{place}'")
    polygon = boundary.geometry.union_all() if hasattr(boundary.geometry, "union_all") else boundary.geometry.unary_union
    return _convert(ox.graph_from_polygon(polygon, network_type=network_type, simplify=True), f"osm_{_slug(place)}", f"{place} | OpenStreetMap")
