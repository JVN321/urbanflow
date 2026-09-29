#!/usr/bin/env python3
"""
UrbanFlow Kochi Network Extraction Script
Extracts drivable road network for Kochi, Kerala using OSMnx,
assigns IRC 106 capacities, and outputs standard UrbanFlowGraph JSON and GeoJSON.
Also generates a realistic morning peak Origin-Destination demand matrix.
"""
import os
import sys
import json
import math
import argparse
from typing import Dict, Any, List, Tuple

# Ensure workspace root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# Ensure UTF-8 stdout on Windows console
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Computes great-circle distance in meters between two lat/lon points."""
    R = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2.0) ** 2
    return 2.0 * R * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))


def extract_kochi_network(
    output_graph_path: str = "data/processed/kochi_graph.json",
    output_geojson_path: str = "data/processed/kochi_network.geojson",
    output_demand_path: str = "data/processed/kochi_od_matrix.json",
    tolerance: float = 15.0,
    arterial_only: bool = False
):
    print("=== UrbanFlow Kochi Road Network Extractor ===")
    try:
        import osmnx as ox
        import geopandas as gpd
        import networkx as nx
    except ImportError as e:
        print(f"ERROR: Required geospatial libraries not found ({e}). Install with: pip install osmnx geopandas networkx")
        return False

    ox.settings.use_cache = True
    ox.settings.log_console = True

    # Kochi Bounding Box (Edappally to Kundannoor / MG Road to Vyttila)
    # Specified in specs/03_MAP_DATA_PIPELINE_SPEC.md: [9.9200, 76.2600] to [10.0400, 76.3600]
    north, south, east, west = 10.0400, 9.9200, 76.3600, 76.2600
    print(f"1. Fetching OSM drivable road network for Kochi bounding box: [{south}, {west}] to [{north}, {east}]...")

    custom_filter = None
    if arterial_only:
        custom_filter = '["highway"~"motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link"]'
        print("   Filtering mode: Arterial corridors only (motorway, trunk, primary, secondary, tertiary)")

    # Support OSMnx 2.x bbox=(west, south, east, north) and fallback for OSMnx 1.x
    try:
        G = ox.graph_from_bbox(
            bbox=(west, south, east, north),
            network_type="drive",
            simplify=True,
            custom_filter=custom_filter
        )
    except TypeError:
        # OSMnx 1.x signature
        G = ox.graph_from_bbox(
            north=north, south=south, east=east, west=west,
            network_type="drive",
            simplify=True,
            custom_filter=custom_filter
        )
    print(f"   Raw graph fetched: {len(G.nodes)} nodes, {len(G.edges)} edges.")

    print(f"2. Consolidating close intersections (tolerance={tolerance}m)...")
    G_proj = ox.project_graph(G)
    G_clean = ox.consolidate_intersections(G_proj, tolerance=tolerance, rebuild_graph=True)
    G_final = ox.project_graph(G_clean, to_crs="EPSG:4326")
    print(f"   Consolidated graph: {len(G_final.nodes)} nodes, {len(G_final.edges)} edges.")

    print("3. Extracting largest strongly connected component (guarantees reachability)...")
    try:
        G_conn = ox.truncate.largest_component(G_final, strongly=True)
    except Exception:
        sccs = list(nx.strongly_connected_components(G_final))
        if sccs:
            largest_scc = max(sccs, key=len)
            G_conn = G_final.subgraph(largest_scc).copy()
        else:
            G_conn = G_final
    print(f"   Connected component: {len(G_conn.nodes)} nodes, {len(G_conn.edges)} edges.")

    print("4. Identifying key Kochi landmark junctions...")
    # Known key intersections in Kochi
    landmarks = {
        "Edappally Bypass Junction": (10.0261, 76.3125),
        "Palarivattom Junction": (10.0050, 76.3075),
        "Vyttila Mobility Hub": (9.9678, 76.3195),
        "MG Road / Padma Junction": (9.9815, 76.2828),
        "Menaka / Marine Drive": (9.9800, 76.2760),
        "High Court Junction": (9.9860, 76.2755),
        "Kundannoor Junction": (9.9405, 76.3180),
        "Kaloor Junction": (9.9985, 76.2925),
        "Kadavanthra Junction": (9.9670, 76.2995),
        "Thevara Junction": (9.9360, 76.2970),
        "Ravipuram Junction": (9.9620, 76.2870),
        "Kalamassery Toll Junction": (10.0400, 76.3260)
    }

    landmark_node_ids: Dict[str, str] = {}
    for name, (lm_lat, lm_lng) in landmarks.items():
        best_node = None
        best_dist = float("inf")
        for nid, data in G_conn.nodes(data=True):
            n_lat = data.get("y", 0.0)
            n_lng = data.get("x", 0.0)
            dist = haversine_m(lm_lat, lm_lng, n_lat, n_lng)
            if dist < best_dist:
                best_dist = dist
                best_node = nid
        if best_node is not None and best_dist < 1500.0:
            landmark_node_ids[name] = str(best_node)
            print(f"   Mapped '{name}' -> Node {best_node} (offset {best_dist:.1f}m)")

    print("5. Applying IRC 106 capacity heuristics and building schemas...")
    # IRC 106 Standards: (lanes per dir, free_speed_kmh, capacity_vph_per_dir)
    capacity_map = {
        "motorway": (3, 70.0, 2700.0),
        "motorway_link": (2, 50.0, 1600.0),
        "trunk": (3, 70.0, 2700.0),
        "trunk_link": (2, 50.0, 1500.0),
        "primary": (2, 50.0, 1800.0),
        "primary_link": (1, 40.0, 1200.0),
        "secondary": (2, 40.0, 1400.0),
        "secondary_link": (1, 35.0, 1000.0),
        "tertiary": (1, 30.0, 900.0),
        "tertiary_link": (1, 25.0, 700.0),
        "residential": (1, 25.0, 600.0),
        "unclassified": (1, 25.0, 600.0),
        "living_street": (1, 20.0, 400.0),
        "service": (1, 20.0, 300.0)
    }

    # Invert landmark mapping for node labelling
    node_to_landmark = {nid: name for name, nid in landmark_node_ids.items()}

    nodes_data = []
    for nid, data in G_conn.nodes(data=True):
        lat = round(float(data.get("y", 0.0)), 6)
        lng = round(float(data.get("x", 0.0)), 6)
        str_nid = str(nid)
        label = node_to_landmark.get(str_nid, f"Junction {str_nid}")
        
        nodes_data.append({
            "id": str_nid,
            "label": label,
            "lat": lat,
            "lng": lng,
            "type": "intersection"
        })

    edges_data = []
    geojson_features = []
    edge_id_counter = 1

    for u, v, k, data in G_conn.edges(keys=True, data=True):
        hw_type = data.get("highway", "tertiary")
        if isinstance(hw_type, list):
            hw_type = hw_type[0]

        default_lanes, default_speed, default_cap = capacity_map.get(hw_type, (1, 30.0, 900.0))
        lanes = default_lanes
        speed = default_speed
        cap = default_cap

        # Respect OSM lanes tag if present
        raw_lanes = data.get("lanes")
        if raw_lanes:
            if isinstance(raw_lanes, list):
                raw_lanes = raw_lanes[0]
            try:
                parsed_lanes = int(str(raw_lanes).split(";")[0])
                if 1 <= parsed_lanes <= 6:
                    lanes = parsed_lanes
                    cap = round(default_cap * (lanes / max(default_lanes, 1)), 1)
            except (ValueError, TypeError):
                pass

        # Respect OSM maxspeed tag if present
        raw_speed = data.get("maxspeed")
        if raw_speed:
            if isinstance(raw_speed, list):
                raw_speed = raw_speed[0]
            try:
                parsed_speed = float(str(raw_speed).split(";")[0].split()[0])
                if 15.0 <= parsed_speed <= 100.0:
                    speed = parsed_speed
            except (ValueError, TypeError):
                pass

        # Edge length
        length_m = data.get("length", 200.0)
        if isinstance(length_m, list):
            length_m = length_m[0]
        try:
            length_m = round(float(length_m), 1)
        except (ValueError, TypeError):
            length_m = 200.0

        # Edge Name
        name = data.get("name")
        if isinstance(name, list):
            name = name[0]
        if not name:
            ref = data.get("ref")
            if isinstance(ref, list):
                ref = ref[0]
            if ref:
                name = str(ref)
            else:
                name = f"Road {edge_id_counter}"

        # Geometry coordinates (EPSG:4326 [lng, lat])
        u_node = G_conn.nodes[u]
        v_node = G_conn.nodes[v]
        if "geometry" in data and hasattr(data["geometry"], "coords"):
            geom_coords = [[round(float(pt[0]), 6), round(float(pt[1]), 6)] for pt in data["geometry"].coords]
        else:
            geom_coords = [
                [round(float(u_node.get("x", 0.0)), 6), round(float(u_node.get("y", 0.0)), 6)],
                [round(float(v_node.get("x", 0.0)), 6), round(float(v_node.get("y", 0.0)), 6)]
            ]

        oneway = data.get("oneway", False)
        if isinstance(oneway, list):
            oneway = oneway[0]
        if isinstance(oneway, str):
            oneway = oneway.lower() in ("true", "yes", "1")
        else:
            oneway = bool(oneway)

        edge_id = f"kochi_e_{edge_id_counter}"
        edges_data.append({
            "id": edge_id,
            "source": str(u),
            "target": str(v),
            "name": name,
            "length_m": length_m,
            "lanes": lanes,
            "free_speed_kmh": speed,
            "capacity_vph": cap,
            "alpha": 0.15,
            "beta": 4.0,
            "geometry": geom_coords,
            "road_type": str(hw_type),
            "oneway": oneway
        })

        geojson_features.append({
            "type": "Feature",
            "properties": {
                "id": edge_id,
                "source": str(u),
                "target": str(v),
                "name": name,
                "highway": str(hw_type),
                "lanes": lanes,
                "capacity": cap,
                "speed_kmh": speed,
                "length_m": length_m
            },
            "geometry": {
                "type": "LineString",
                "coordinates": geom_coords
            }
        })
        edge_id_counter += 1

    graph_payload = {
        "graph_id": "kochi_central_osm",
        "name": "Kochi Central Road Network (OpenStreetMap)",
        "crs": "EPSG:4326",
        "metadata": {
            "node_count": len(nodes_data),
            "edge_count": len(edges_data),
            "bbox": [west, south, east, north]
        },
        "nodes": nodes_data,
        "edges": edges_data
    }

    geojson_payload = {
        "type": "FeatureCollection",
        "features": geojson_features
    }

    # 6. Generate Realistic Kochi Morning Rush OD Matrix
    print("6. Formulating realistic morning peak Origin-Destination demand matrix...")
    od_pairs = []
    # Major morning traffic corridors in Kochi:
    # Suburbs / NH Bypass -> Central Business District (MG Road, Marine Drive, High Court)
    key_routes = [
        ("Edappally Bypass Junction", "MG Road / Padma Junction", 2200.0),
        ("Edappally Bypass Junction", "Menaka / Marine Drive", 1800.0),
        ("Edappally Bypass Junction", "Palarivattom Junction", 2400.0),
        ("Palarivattom Junction", "Kaloor Junction", 2100.0),
        ("Kaloor Junction", "MG Road / Padma Junction", 1900.0),
        ("Vyttila Mobility Hub", "MG Road / Padma Junction", 2500.0),
        ("Vyttila Mobility Hub", "Kadavanthra Junction", 2300.0),
        ("Kadavanthra Junction", "Ravipuram Junction", 1700.0),
        ("Kundannoor Junction", "Vyttila Mobility Hub", 2600.0),
        ("Kundannoor Junction", "Thevara Junction", 1500.0),
        ("Thevara Junction", "Ravipuram Junction", 1400.0),
        ("Ravipuram Junction", "MG Road / Padma Junction", 1800.0),
        ("MG Road / Padma Junction", "High Court Junction", 1600.0),
        ("Palarivattom Junction", "High Court Junction", 1500.0)
    ]

    for orig_name, dest_name, volume in key_routes:
        if orig_name in landmark_node_ids and dest_name in landmark_node_ids:
            u_id = landmark_node_ids[orig_name]
            v_id = landmark_node_ids[dest_name]
            if u_id != v_id:
                od_pairs.append({
                    "origin": u_id,
                    "destination": v_id,
                    "volume_vph": volume
                })

    demand_payload = {
        "demand_id": "kochi_morning_peak",
        "description": "Kochi Urban Corridor Morning Rush Hour (08:30 - 09:30 IST)",
        "demands": od_pairs
    }

    # Save to disk
    os.makedirs(os.path.dirname(output_graph_path), exist_ok=True)
    with open(output_graph_path, "w", encoding="utf-8") as f:
        json.dump(graph_payload, f, indent=2)
    print(f"[OK] Saved UrbanFlowGraph ({len(nodes_data)} nodes, {len(edges_data)} edges) to: {output_graph_path}")

    os.makedirs(os.path.dirname(output_geojson_path), exist_ok=True)
    with open(output_geojson_path, "w", encoding="utf-8") as f:
        json.dump(geojson_payload, f, indent=2)
    print(f"[OK] Saved GeoJSON to: {output_geojson_path}")

    os.makedirs(os.path.dirname(output_demand_path), exist_ok=True)
    with open(output_demand_path, "w", encoding="utf-8") as f:
        json.dump(demand_payload, f, indent=2)
    print(f"[OK] Saved Kochi OD Demand Matrix ({len(od_pairs)} OD pairs) to: {output_demand_path}")

    # Validate against Pydantic models
    print("7. Validating generated data against UrbanFlow Pydantic schemas...")
    try:
        from backend.app.core.graph_model import UrbanFlowGraph, TrafficDemand
        valid_graph = UrbanFlowGraph.model_validate(graph_payload)
        valid_demand = TrafficDemand.model_validate(demand_payload)
        print(f"[OK] Pydantic validation successful! Graph ID: '{valid_graph.graph_id}', Demand ID: '{valid_demand.demand_id}'.")
    except Exception as e:
        print(f"[WARN] Pydantic validation warning: {e}")

    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract Kochi Road Network from OpenStreetMap via OSMnx")
    parser.add_argument("--out-graph", default="data/processed/kochi_graph.json", help="Path to output UrbanFlowGraph JSON")
    parser.add_argument("--out-geojson", default="data/processed/kochi_network.geojson", help="Path to output GeoJSON")
    parser.add_argument("--out-demand", default="data/processed/kochi_od_matrix.json", help="Path to output OD Matrix JSON")
    parser.add_argument("--tolerance", type=float, default=15.0, help="Intersection consolidation buffer tolerance (meters)")
    parser.add_argument("--arterial-only", action="store_true", help="Extract only arterial corridors")
    args = parser.parse_args()

    success = extract_kochi_network(
        output_graph_path=args.out_graph,
        output_geojson_path=args.out_geojson,
        output_demand_path=args.out_demand,
        tolerance=args.tolerance,
        arterial_only=args.arterial_only
    )
    if not success:
        sys.exit(1)
