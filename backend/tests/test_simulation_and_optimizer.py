"""
Unit Tests for UrbanFlow Simulation and Optimizer Engine
"""
from app.data.synthetic_graphs import (
    get_braess_paradox_network,
    get_expanded_braess_network,
    get_bottleneck_bridge_network
)
from app.core.assignment import simulate_traffic_msa
from app.core.optimizer import optimize_traffic_network
from app.core.bpr import calculate_link_travel_time


def test_bpr_travel_time():
    t0 = 60.0  # 60 seconds
    # Zero flow -> t0
    assert calculate_link_travel_time(t0, 0, 1000) == 60.0
    # At capacity (v = c, alpha=0.15) -> 60 * 1.15 = 69.0
    assert abs(calculate_link_travel_time(t0, 1000, 1000, alpha=0.15, beta=4.0) - 69.0) < 0.01


def test_braess_paradox_simulation():
    # 1. Baseline network (without shortcut)
    g_base, demand = get_braess_paradox_network(include_shortcut=False)
    res_base = simulate_traffic_msa(g_base, demand)

    # 2. Network with shortcut B -> C
    g_sc, _ = get_braess_paradox_network(include_shortcut=True)
    res_sc = simulate_traffic_msa(g_sc, demand)

    # Braess Paradox validation: Average travel time MUST increase when shortcut is added
    assert res_sc.summary_metrics.avg_travel_time_mins > res_base.summary_metrics.avg_travel_time_mins
    print(f"Base Travel Time: {res_base.summary_metrics.avg_travel_time_mins} min")
    print(f"Shortcut Travel Time: {res_sc.summary_metrics.avg_travel_time_mins} min")


def test_network_optimizer_braess_detection():
    # Test on the 8-node network with latent Braess paradox link
    g_exp, demand = get_expanded_braess_network()
    opt_result = optimize_traffic_network(g_exp, demand)

    assert len(opt_result.recommendations) > 0
    # Top recommendation should identify the shortcut edge or severe bottleneck
    top_rec = opt_result.recommendations[0]
    assert top_rec.travel_time_reduction_pct > 0.0
    print(f"Top Recommendation: {top_rec.type} on {top_rec.edge_name} (Saves {top_rec.travel_time_reduction_pct}%)")


def test_api_optimizer_recommendation():
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    response = client.post("/api/optimizer/recommend?graph_id=expanded_8node&demand_multiplier=1.0", json={})
    assert response.status_code == 200
    data = response.json()
    assert "recommendations" in data
    assert len(data["recommendations"]) > 0
    assert data["recommendations"][0]["travel_time_reduction_pct"] > 0


def test_braess_3route_paradox_detection():
    from app.data.synthetic_graphs import get_braess_3route_network
    g, demand = get_braess_3route_network()
    opt_result = optimize_traffic_network(g, demand)

    assert len(opt_result.recommendations) > 0
    top = opt_result.recommendations[0]
    assert top.type == "REMOVE_ROAD"
    assert top.edge_id == "e_ROAD_2"
    assert top.travel_time_reduction_pct > 50.0
    assert top.is_braess_fix is True


def test_simulation_stream_with_density_and_eta():
    import json
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    response = client.get("/api/simulate/stream?graph_id=braess_3route&demand_multiplier=1.0&road_density=0.5")
    assert response.status_code == 200
    events = [line for line in response.text.split("\n") if line.startswith("data: ")]
    assert len(events) > 0
    # Parse last progress or complete event
    parsed = [json.loads(line[len("data: "):]) for line in events]
    progress_events = [e for e in parsed if e.get("type") == "progress"]
    complete_events = [e for e in parsed if e.get("type") == "complete"]
    assert len(progress_events) > 0 or len(complete_events) > 0
    if progress_events:
        assert "eta_sec" in progress_events[-1]
        assert "elapsed_sec" in progress_events[-1]


def test_optimizer_stream_with_eta():
    import json
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    response = client.get("/api/optimizer/stream-optimize?graph_id=braess_3route&demand_multiplier=1.0")
    assert response.status_code == 200
    events = [line for line in response.text.split("\n") if line.startswith("data: ")]
    assert len(events) > 0
    parsed = [json.loads(line[len("data: "):]) for line in events]
    progress_events = [e for e in parsed if e.get("type") == "progress"]
    assert len(progress_events) > 0
    assert "eta_sec" in progress_events[0]
    assert "elapsed_sec" in progress_events[0]


