export interface GraphNode {
  id: string;
  label?: string;
  lat: number;
  lng: number;
  type?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  name?: string;
  length_m: number;
  lanes: number;
  free_speed_kmh: number;
  capacity_vph: number;
  alpha?: number;
  beta?: number;
  geometry?: number[][];
  road_type?: string;
  oneway?: boolean;
}

export interface UrbanFlowGraph {
  graph_id: string;
  name: string;
  crs?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface EdgeSimulationMetric {
  edge_id: string;
  volume_vph: number;
  capacity_vph: number;
  vc_ratio: number;
  free_flow_time_sec: number;
  congested_time_sec: number;
  avg_speed_kmh: number;
  congestion_level: 'free_flow' | 'moderate' | 'congested' | 'severe';
  is_bottleneck: boolean;
}

export interface BottleneckInfo {
  edge_id: string;
  edge_name?: string;
  vc_ratio: number;
  volume_vph: number;
  capacity_vph: number;
  severity_score: number;
  is_cut_edge?: boolean;
  cause: string;
  recommendation: string;
}

export interface PathFlowInfo {
  path_nodes: string[];
  path_edges: string[];
  assigned_volume_vph: number;
  travel_time_mins: number;
  is_equilibrium_path?: boolean;
}

export interface SimulationConfig {
  algorithm: 'msa' | 'aon';
  max_iterations: number;
  convergence_tolerance: number;
  default_alpha: number;
  default_beta: number;
  cost_model: 'bpr' | 'linear' | 'braess_exact';
}

export interface SimulationSummaryMetrics {
  total_vehicles: number;
  total_travel_time_hours: number;
  avg_travel_time_mins: number;
  avg_network_speed_kmh: number;
  severely_congested_edges_count: number;
  network_efficiency_index: number;
  iterations_run?: number;
  converged?: boolean;
}

export interface SimulationResult {
  run_id: string;
  graph_id: string;
  summary_metrics: SimulationSummaryMetrics;
  edge_metrics: Record<string, EdgeSimulationMetric>;
  bottlenecks: BottleneckInfo[];
  path_flows?: PathFlowInfo[];
}

export interface InterventionAction {
  action: 'WIDEN' | 'CLOSE' | 'OPEN' | 'ADD' | 'SPEED_LIMIT';
  edge_id?: string;
  new_lanes?: number;
  new_capacity_vph?: number;
  new_speed_kmh?: number;
  new_edge?: GraphEdge;
  rationale?: string;
}

export interface InterventionPayload {
  base_graph_id: string;
  demand_multiplier?: number;
  modifications: InterventionAction[];
  config?: SimulationConfig;
}

export interface MetricsDelta {
  total_travel_time_change_pct: number;
  avg_travel_time_change_pct: number;
  congested_edges_change: number;
  throughput_increase_pct?: number;
  is_braess_paradox: boolean;
  summary_text: string;
}

export interface InterventionReport {
  report_id: string;
  base_graph_id: string;
  modifications: InterventionAction[];
  baseline: SimulationResult;
  intervention: SimulationResult;
  delta: MetricsDelta;
}

export interface OptimizerRecommendation {
  rank: number;
  type: 'REMOVE_ROAD' | 'WIDEN_ROAD';
  edge_id: string;
  edge_name: string;
  action: InterventionAction;
  avg_travel_time_before_mins: number;
  avg_travel_time_after_mins: number;
  travel_time_reduction_pct: number;
  throughput_gain_pct: number;
  is_braess_fix: boolean;
  explanation: string;
}

export interface OptimizationResult {
  graph_id: string;
  baseline_avg_travel_time_mins: number;
  total_candidates_evaluated: number;
  recommendations: OptimizerRecommendation[];
  optimal_combined_actions: InterventionAction[];
  projected_overall_improvement_pct: number;
  summary: string;
}
