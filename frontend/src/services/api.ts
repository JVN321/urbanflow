import { UrbanFlowGraph, SimulationResult, InterventionPayload, InterventionReport } from '../types';

const API_BASE_URL = 'http://localhost:8000/api';

// Pre-packaged mock data for Person A to build complete UI offline
export const MOCK_BRAESS_BASELINE_GRAPH: UrbanFlowGraph = {
  graph_id: 'braess_4node',
  name: 'Braess Paradox Network (Baseline)',
  nodes: [
    { id: 'A', label: 'Origin (A)', lat: 10.000, lng: 76.300, type: 'origin' },
    { id: 'B', label: 'Upper Hub (B)', lat: 10.020, lng: 76.320, type: 'intersection' },
    { id: 'C', label: 'Lower Hub (C)', lat: 9.980, lng: 76.320, type: 'intersection' },
    { id: 'D', label: 'Destination (D)', lat: 10.000, lng: 76.340, type: 'destination' }
  ],
  edges: [
    { id: 'e_AB', source: 'A', target: 'B', name: 'A ➔ B (Flow Sensitive)', length_m: 5000, lanes: 1, free_speed_kmh: 60, capacity_vph: 1000, geometry: [[76.300, 10.000], [76.320, 10.020]] },
    { id: 'e_BD', source: 'B', target: 'D', name: 'B ➔ D (Fixed High Time)', length_m: 15000, lanes: 4, free_speed_kmh: 20, capacity_vph: 10000, geometry: [[76.320, 10.020], [76.340, 10.000]] },
    { id: 'e_AC', source: 'A', target: 'C', name: 'A ➔ C (Fixed High Time)', length_m: 15000, lanes: 4, free_speed_kmh: 20, capacity_vph: 10000, geometry: [[76.300, 10.000], [76.320, 9.980]] },
    { id: 'e_CD', source: 'C', target: 'D', name: 'C ➔ D (Flow Sensitive)', length_m: 5000, lanes: 1, free_speed_kmh: 60, capacity_vph: 1000, geometry: [[76.320, 9.980], [76.340, 10.000]] }
  ]
};

export const MOCK_SIMULATION_RESULT: SimulationResult = {
  run_id: 'mock_run_01',
  graph_id: 'braess_4node',
  summary_metrics: {
    total_vehicles: 4000,
    total_travel_time_hours: 4333.3,
    avg_travel_time_mins: 65.0,
    avg_network_speed_kmh: 32.5,
    severely_congested_edges_count: 0,
    network_efficiency_index: 1.0
  },
  edge_metrics: {
    e_AB: { edge_id: 'e_AB', volume_vph: 2000, capacity_vph: 1000, vc_ratio: 0.85, free_flow_time_sec: 300, congested_time_sec: 1200, avg_speed_kmh: 35, congestion_level: 'moderate', is_bottleneck: false },
    e_BD: { edge_id: 'e_BD', volume_vph: 2000, capacity_vph: 10000, vc_ratio: 0.20, free_flow_time_sec: 2700, congested_time_sec: 2700, avg_speed_kmh: 20, congestion_level: 'free_flow', is_bottleneck: false },
    e_AC: { edge_id: 'e_AC', volume_vph: 2000, capacity_vph: 10000, vc_ratio: 0.20, free_flow_time_sec: 2700, congested_time_sec: 2700, avg_speed_kmh: 20, congestion_level: 'free_flow', is_bottleneck: false },
    e_CD: { edge_id: 'e_CD', volume_vph: 2000, capacity_vph: 1000, vc_ratio: 0.85, free_flow_time_sec: 300, congested_time_sec: 1200, avg_speed_kmh: 35, congestion_level: 'moderate', is_bottleneck: false }
  },
  bottlenecks: []
};

export const fetchGraph = async (graphId: string): Promise<UrbanFlowGraph> => {
  try {
    const res = await fetch(`${API_BASE_URL}/graphs/${graphId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`[UrbanFlow] Live backend unreachable for graph '${graphId}'. Falling back to mock data.`);
    return MOCK_BRAESS_BASELINE_GRAPH;
  }
};

export const runSimulation = async (graphId: string, demandMultiplier: number = 1.0): Promise<SimulationResult> => {
  try {
    const res = await fetch(`${API_BASE_URL}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph_id: graphId, demand_multiplier: demandMultiplier })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[UrbanFlow] Live simulation endpoint unreachable. Returning mock simulation.');
    return MOCK_SIMULATION_RESULT;
  }
};

export const evaluateIntervention = async (payload: InterventionPayload): Promise<InterventionReport> => {
  try {
    const res = await fetch(`${API_BASE_URL}/interventions/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[UrbanFlow] Live intervention endpoint unreachable. Generating client-side mock diff.');
    // Simulated Braess Paradox response if user added a road
    const isAddingRoad = payload.modifications.some(m => m.action === 'ADD');
    const avgTimeAfter = isAddingRoad ? 80.0 : 54.0;
    const timeDeltaPct = isAddingRoad ? 23.08 : -16.92;

    return {
      report_id: 'mock_report_01',
      base_graph_id: payload.base_graph_id,
      modifications: payload.modifications,
      baseline: MOCK_SIMULATION_RESULT,
      intervention: {
        ...MOCK_SIMULATION_RESULT,
        summary_metrics: {
          ...MOCK_SIMULATION_RESULT.summary_metrics,
          avg_travel_time_mins: avgTimeAfter,
          total_travel_time_hours: (avgTimeAfter * 4000) / 60
        }
      },
      delta: {
        total_travel_time_change_pct: timeDeltaPct,
        avg_travel_time_change_pct: timeDeltaPct,
        congested_edges_change: isAddingRoad ? 2 : -1,
        is_braess_paradox: isAddingRoad,
        summary_text: isAddingRoad
          ? '⚠️ Braess Paradox Verified! Adding shortcut road increased average travel time by +23.1% due to equilibrium shift.'
          : '✅ Network Improved: Travel time reduced.'
      }
    };
  }
};
