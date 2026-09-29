from typing import List, Dict, Optional, Literal, Tuple, Any
from pydantic import BaseModel, Field


class GraphNode(BaseModel):
    id: str
    label: Optional[str] = None
    lat: float
    lng: float
    type: Optional[str] = "intersection"


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    name: Optional[str] = None
    length_m: float
    lanes: int = 1
    free_speed_kmh: float = 50.0
    capacity_vph: float = 1800.0
    alpha: float = 0.15
    beta: float = 4.0
    geometry: Optional[List[List[float]]] = None  # [[lng, lat], [lng, lat], ...]
    road_type: Optional[str] = "primary"
    oneway: bool = True

    @property
    def free_flow_time_sec(self) -> float:
        # t0 = length (m) / (speed (km/h) / 3.6)
        speed_mps = (self.free_speed_kmh * 1000.0) / 3600.0
        return self.length_m / max(speed_mps, 0.1)


class GraphMetadata(BaseModel):
    node_count: int = 0
    edge_count: int = 0
    bbox: Optional[List[float]] = None  # [min_lng, min_lat, max_lng, max_lat]


class UrbanFlowGraph(BaseModel):
    graph_id: str
    name: str
    crs: str = "EPSG:4326"
    metadata: Optional[GraphMetadata] = None
    nodes: List[GraphNode]
    edges: List[GraphEdge]


class OriginDestinationDemand(BaseModel):
    origin: str
    destination: str
    volume_vph: float


class TrafficDemand(BaseModel):
    demand_id: str
    description: Optional[str] = None
    demands: List[OriginDestinationDemand]


class EdgeSimulationMetric(BaseModel):
    edge_id: str
    volume_vph: float
    capacity_vph: float
    vc_ratio: float
    free_flow_time_sec: float
    congested_time_sec: float
    avg_speed_kmh: float
    congestion_level: Literal["free_flow", "moderate", "congested", "severe"]
    is_bottleneck: bool = False


class BottleneckInfo(BaseModel):
    edge_id: str
    edge_name: Optional[str] = None
    vc_ratio: float
    volume_vph: float
    capacity_vph: float
    severity_score: float
    is_cut_edge: bool = False
    cause: str
    recommendation: str


class SimulationSummaryMetrics(BaseModel):
    total_vehicles: float
    total_travel_time_hours: float
    avg_travel_time_mins: float
    avg_network_speed_kmh: float
    severely_congested_edges_count: int
    network_efficiency_index: float


class SimulationResult(BaseModel):
    run_id: str
    graph_id: str
    summary_metrics: SimulationSummaryMetrics
    edge_metrics: Dict[str, EdgeSimulationMetric]
    bottlenecks: List[BottleneckInfo]


class InterventionAction(BaseModel):
    action: Literal["WIDEN", "CLOSE", "ADD", "SPEED_LIMIT"]
    edge_id: Optional[str] = None
    new_lanes: Optional[int] = None
    new_capacity_vph: Optional[float] = None
    new_speed_kmh: Optional[float] = None
    new_edge: Optional[GraphEdge] = None


class InterventionPayload(BaseModel):
    base_graph_id: str
    demand: Optional[TrafficDemand] = None
    demand_multiplier: float = 1.0
    modifications: List[InterventionAction]


class MetricsDelta(BaseModel):
    total_travel_time_change_pct: float
    avg_travel_time_change_pct: float
    congested_edges_change: int
    is_braess_paradox: bool
    summary_text: str


class InterventionReport(BaseModel):
    report_id: str
    base_graph_id: str
    modifications: List[InterventionAction]
    baseline: SimulationResult
    intervention: SimulationResult
    delta: MetricsDelta
