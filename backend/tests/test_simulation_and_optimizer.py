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
