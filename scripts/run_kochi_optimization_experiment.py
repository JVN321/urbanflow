#!/usr/bin/env bash
"""
UrbanFlow Kochi Optimization Experiment Runner
Executes MSA simulation on the extracted Kochi, Kerala road network and identifies
optimal road removals (Braess Paradox shortcuts) and capacity widenings.
"""
import os
import sys
import json
import time

# Add backend to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../backend")))

from app.core.graph_model import UrbanFlowGraph, TrafficDemand, SimulationConfig
from app.core.assignment import simulate_traffic_msa
from app.core.optimizer import optimize_traffic_network


def main():
    print("=================================================================")
    print("  🏙️  URBANFLOW: KOCHI REAL-WORLD TRAFFIC OPTIMIZATION ENGINE    ")
    print("=================================================================\n")

    graph_file = "data/processed/kochi_arterial_graph.json"
    demand_file = "data/processed/kochi_arterial_od_matrix.json"

    if not os.path.exists(graph_file) or not os.path.exists(demand_file):
        print(f"❌ Error: Could not find {graph_file} or {demand_file}.")
        return

    print(f"1. Loading Kochi Arterial Road Network...")
    with open(graph_file, "r") as f:
        graph_data = json.load(f)
        graph = UrbanFlowGraph(**graph_data)
    
    with open(demand_file, "r") as f:
        demand_data = json.load(f)
        demand = TrafficDemand(**demand_data)

    print(f"   ✓ Network: '{graph.name}'")
    print(f"   ✓ Graph Size: {len(graph.nodes)} junctions (nodes), {len(graph.edges)} road segments (edges)")
    total_trips = sum(d.volume_vph for d in demand.demands)
    print(f"   ✓ OD Demand Matrix: {len(demand.demands)} origin-destination corridors ({total_trips:,.0f} peak vehicles/hr)\n")

    # 2. Run Baseline Simulation
    print("2. Running Baseline Traffic Simulation (Method of Successive Averages)...")
    config = SimulationConfig(
        algorithm="msa",
        max_iterations=30,
        convergence_tolerance=1e-3,
        default_alpha=0.15,
        default_beta=4.0
    )
    
    start_t = time.time()
    baseline_sim = simulate_traffic_msa(graph, demand, demand_multiplier=1.0, config=config)
    sim_time = time.time() - start_t

    bm = baseline_sim.summary_metrics
    print(f"   ✓ Simulation completed in {sim_time:.2f}s ({bm.iterations_run} iterations)")
    print(f"   -------------------------------------------------------")
    print(f"   • Baseline Average Travel Time : {bm.avg_travel_time_mins:.2f} mins")
    print(f"   • Total Network Delay Hours    : {bm.total_travel_time_hours:,.1f} vehicle-hours")
    print(f"   • Average Network Speed        : {bm.avg_network_speed_kmh:.1f} km/h")
    print(f"   • Severely Congested Roads     : {bm.severely_congested_edges_count} segments (V/C >= 0.95)")
    print(f"   -------------------------------------------------------\n")

    # Top bottlenecks before optimization
    print("3. Top 5 Congested Bottlenecks in Baseline Network:")
    for i, b in enumerate(baseline_sim.bottlenecks[:5], 1):
        print(f"   {i}. [{b.edge_id}] {b.edge_name} | V/C Ratio: {b.vc_ratio:.2f} | Volume: {b.volume_vph:,.0f} / {b.capacity_vph:,.0f} vph")
    print("")

    # 4. Run Network Optimizer Engine
    print("4. Running Network Optimizer (Braess Shortcut Pruning & Bottleneck Widening)...")
    opt_start = time.time()
    opt_result = optimize_traffic_network(graph, demand, demand_multiplier=1.0, config=config)
    opt_time = time.time() - opt_start

    print(f"   ✓ Evaluated {opt_result.total_candidates_evaluated} candidate interventions in {opt_time:.2f}s")
    print(f"   ✓ Discovered {len(opt_result.recommendations)} high-impact interventions.\n")

    print("=================================================================")
    print("  🏆 OPTIMIZER RECOMMENDATIONS FOR KOCHI ROAD NETWORK            ")
    print("=================================================================")
    
    removals = [r for r in opt_result.recommendations if r.type == "REMOVE_ROAD"]
    widenings = [r for r in opt_result.recommendations if r.type == "WIDEN_ROAD"]

    if removals:
        print("\n🚫 OPTIMAL ROADS TO REMOVE / BLOCK (BRAESS PARADOX RESOLUTION):")
        print("   Closing these roads forces traffic onto higher-capacity arterials, reducing citywide travel time:")
        for r in removals:
            print(f"   • Rank {r.rank} [{r.edge_id}] {r.edge_name}")
            print(f"     ➔ Avg Latency Before: {r.avg_travel_time_before_mins:.2f}m ➔ After: {r.avg_travel_time_after_mins:.2f}m")
            print(f"     ➔ Network Time Savings: -{r.travel_time_reduction_pct:.2f}% | Throughput Boost: +{r.throughput_gain_pct:.2f}%")
            print(f"     ➔ Insight: {r.explanation}\n")
    else:
        print("\nℹ️ No pure Braess removal shortcuts found in current corridor topology.")

    if widenings:
        print("\n➕ OPTIMAL ROADS TO WIDEN / EXPAND CAPACITY:")
        for r in widenings:
            print(f"   • Rank {r.rank} [{r.edge_id}] {r.edge_name}")
            print(f"     ➔ Avg Latency Before: {r.avg_travel_time_before_mins:.2f}m ➔ After: {r.avg_travel_time_after_mins:.2f}m")
            print(f"     ➔ Network Time Savings: -{r.travel_time_reduction_pct:.2f}% | Throughput Boost: +{r.throughput_gain_pct:.2f}%")
            print(f"     ➔ Insight: {r.explanation}\n")

    # Output JSON summary
    report_output_path = "data/processed/kochi_optimization_report.json"
    with open(report_output_path, "w") as f:
        json.dump(opt_result.model_dump(), f, indent=2)
    print(f"✅ Saved full optimization report to: {report_output_path}")


if __name__ == "__main__":
    main()
