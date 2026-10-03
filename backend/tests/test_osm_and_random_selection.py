"""
Tests for OpenStreetMap Map Fetching, Random Area Selection, and Area Analysis APIs
"""
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_root_and_health_endpoints():
    """Verify root GET / returns 200 (not 404) and health check is online."""
    res_root = client.get("/")
    assert res_root.status_code == 200
    data = res_root.json()
    assert data["status"] == "online"
    assert "service" in data

    res_fav = client.get("/favicon.ico")
    assert res_fav.status_code == 204

    res_health = client.get("/api/health")
    assert res_health.status_code == 200
    assert res_health.json()["status"] == "healthy"


def test_curated_locations_endpoint():
    """Verify curated locations list is populated."""
    res = client.get("/api/osm/locations")
    assert res.status_code == 200
    locations = res.json()
    assert isinstance(locations, list)
    assert len(locations) >= 10
    assert any("Tokyo" in loc["city"] for loc in locations)
    assert any("London" in loc["city"] for loc in locations)
    assert any("Paris" in loc["city"] for loc in locations)


def test_random_osm_selection_endpoint():
    """Verify /api/osm/random retrieves a valid road network and simulation result."""
    res = client.get("/api/osm/random")
    assert res.status_code == 200
    data = res.json()
    assert "city" in data
    assert "country" in data
    assert "bbox" in data
    assert "graph" in data
    assert "result" in data

    graph = data["graph"]
    assert len(graph["nodes"]) >= 4
    assert len(graph["edges"]) >= 3
    assert graph["graph_id"].startswith("osm_area_")

    result = data["result"]
    assert result["summary_metrics"]["avg_travel_time_mins"] >= 0.0


def test_random_osm_selection_specific_city():
    """Verify /api/osm/random with a specified city name."""
    res = client.get("/api/osm/random?city=Paris")
    assert res.status_code == 200
    data = res.json()
    assert "Paris" in data["city"]
    assert data["country"] == "France"
    assert len(data["graph"]["nodes"]) >= 4
    assert len(data["graph"]["edges"]) >= 3


def test_osm_fetch_endpoint_custom_bbox():
    """Verify /api/osm/fetch with a custom bounding box."""
    # Central Kochi Marine Drive coordinates
    payload = {
        "min_lat": 9.9750,
        "min_lng": 76.2750,
        "max_lat": 9.9860,
        "max_lng": 76.2880,
        "label": "Kochi Test Area",
        "road_density": 1.0,
        "demand_multiplier": 1.0,
        "simulate": True
    }
    res = client.post("/api/osm/fetch", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert "graph" in data
    assert "result" in data
    assert len(data["graph"]["nodes"]) >= 4
    assert len(data["graph"]["edges"]) >= 3


def test_area_analysis_newly_selected_data():
    """Verify /api/analysis/area works with newly selected coordinate boxes."""
    payload = {
        "graph_id": "kochi_central",
        "min_lat": 9.9780,
        "min_lng": 76.2760,
        "max_lat": 9.9850,
        "max_lng": 76.2870,
        "demand_multiplier": 1.0,
        "road_density": 1.0,
        "fetch_osm": True
    }
    res = client.post("/api/analysis/area", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert "graph" in data
    assert "result" in data
    assert len(data["graph"]["nodes"]) >= 4
    assert len(data["graph"]["edges"]) >= 3
