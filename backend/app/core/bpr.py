"""
Bureau of Public Roads (BPR) Link Congestion Function and Cost calculations.
Supports both standard BPR polynomial model and linear flow cost models.
"""
from typing import Literal


def calculate_link_travel_time(
    free_flow_time_sec: float,
    volume_vph: float,
    capacity_vph: float,
    alpha: float = 0.15,
    beta: float = 4.0,
    cost_model: Literal["bpr", "linear", "braess_exact"] = "bpr",
    length_m: float = 1000.0,
    free_speed_kmh: float = 50.0
) -> float:
    """
    Computes travel time (seconds) on a link based on traffic volume and configured cost model.

    Models:
    1. BPR (Default): t(v) = t_0 * [1 + alpha * (v / c)^beta]
    2. Linear: t(v) = t_0 + alpha * (v / max(1, c)) * t_0
    3. Braess Exact: For synthetic classic paradox links where t(v) = v/100 or t(v) = 45 mins.
    """
    if cost_model == "braess_exact":
        # Handled at edge attribute level
        return free_flow_time_sec + (alpha * volume_vph)

    if capacity_vph <= 0:
        return free_flow_time_sec * 10.0

    vc_ratio = max(0.0, volume_vph / capacity_vph)

    if cost_model == "linear":
        return free_flow_time_sec * (1.0 + alpha * vc_ratio)
    
    # Standard BPR: t = t_0 * [1 + alpha * (v/c)^beta]
    return free_flow_time_sec * (1.0 + alpha * (vc_ratio ** beta))


def calculate_congested_speed(length_m: float, travel_time_sec: float) -> float:
    """Computes vehicle speed in km/h from length (m) and travel time (s)."""
    if travel_time_sec <= 0:
        return 0.0
    speed_mps = length_m / travel_time_sec
    return speed_mps * 3.6


def classify_congestion_level(vc_ratio: float) -> str:
    """Categorizes link status based on Volume-to-Capacity ratio."""
    if vc_ratio < 0.75:
        return "free_flow"
    elif vc_ratio < 0.95:
        return "moderate"
    elif vc_ratio <= 1.10:
        return "congested"
    else:
        return "severe"
