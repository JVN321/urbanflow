#!/usr/bin/env python3
"""
UrbanFlow Kochi Network Extraction Script
Extracts drivable road network for Kochi, Kerala using OSMnx,
assigns IRC 106 capacities, and outputs standard UrbanFlowGraph JSON and GeoJSON.
"""
import os
import json
import argparse


def extract_kochi_network(output_graph_path: str, output_geojson_path: str):
    print("=== UrbanFlow Kochi Road Network Extractor ===")
    try:
        import osmnx as ox
        import geopandas as gpd
    except ImportError:
        print("ERROR: osmnx and geopandas are required. Install with: pip install osmnx geopandas")
        return

    # Kochi Bounding Box (Edappally to Kundannoor / MG Road to Vyttila)
    north, south, east, west = 10.0400, 9.9200, 76.3600, 76.2600
    print(f"1. Fetching OSM drivable road network for bounding box: [{south}, {west}] to [{north}, {east}]...")
    
    G = ox.graph_from_bbox(
        north=north, south=south, east=east, west=west,
        network_type="drive",
        simplify=True
    )
    print(f"   Raw graph fetched: {len(G.nodes)} nodes, {len(G.edges)} edges.")

    print("2. Consolidating close intersections (tolerance=15m)...")
    G_proj = ox.project_graph(G)
    G_clean = ox.consolidate_intersections(G_proj, tolerance=15, rebuild_graph=True)
    G_final = ox.project_graph(G_clean, to_crs="EPSG:4326")

    print("3. Building UrbanFlowGraph JSON schema and assigning IRC 106 capacities...")
    nodes_data = []
    edges_data = []
    geojson_features = []

    for nid, data in G_final.nodes(data=True):
        lat = data.get("y", 0.0)
        lng = data.get("x", 0.0)
        nodes_data.append({
            "id": str(nid),
            "label": f"Junction {nid}",
            "lat": lat,
            "lng": lng,
            "type": "intersection"
        })

    # Capacity lookup map based on highway tag
    capacity_map = {
        "trunk": (3, 70.0, 2700.0),
        "motorway": (3, 70.0, 2700.0),
        "primary": (2, 50.0, 1800.0),
        "secondary": (2, 40.0, 1400.0),
        "tertiary": (1, 30.0, 900.0),
        "residential": (1, 25.0, 600.0),
        "unclassified": (1, 25.0, 600.0)
    }

    edge_id_counter = 1
    for u, v, k, data in G_final.edges(keys=True, data=True):
        hw_type = data.get("highway", "tertiary")
        if isinstance(hw_type, list):
            hw_type = hw_type[0]
        
        lanes, speed, cap = capacity_map.get(hw_type, (1, 30.0, 900.0))
        length_m = data.get("length", 500.0)
        name = data.get("name", f"Road {edge_id_counter}")
        if isinstance(name, list):
            name = name[0]

        # Geometry
        u_node = G_final.nodes[u]
        v_node = G_final.nodes[v]
        geom_coords = [[u_node.get("x"), u_node.get("y")], [v_node.get("x"), v_node.get("y")]]
        
        edge_id = f"kochi_e_{edge_id_counter}"
        edges_data.append({
            "id": edge_id,
            "source": str(u),
            "target": str(v),
            "name": name,
            "length_m": round(float(length_m), 1),
            "lanes": lanes,
            "free_speed_kmh": speed,
            "capacity_vph": cap,
            "geometry": geom_coords,
            "road_type": hw_type,
            "oneway": data.get("oneway", False)
        })

        geojson_features.append({
            "type": "Feature",
            "properties": {
                "id": edge_id,
                "name": name,
                "highway": hw_type,
                "lanes": lanes,
                "capacity": cap
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

    os.makedirs(os.path.dirname(output_graph_path), exist_ok=True)
    with open(output_graph_path, "w") as f:
        json.dump(graph_payload, f, indent=2)
    print(f"✅ Saved UrbanFlowGraph to: {output_graph_path}")

    with open(output_geojson_path, "w") as f:
        json.dump(geojson_payload, f, indent=2)
    print(f"✅ Saved GeoJSON to: {output_geojson_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract Kochi Road Network from OSM")
    parser.add_argument("--out-graph", default="data/processed/kochi_graph.json")
    parser.add_argument("--out-geojson", default="data/processed/kochi_network.geojson")
    args = parser.parse_args()
    extract_kochi_network(args.out_graph, args.out_geojson)
