"""
Bureau of Public Roads (BPR) Link Congestion Function and Speed calculations.
"""

def calculate_bpr_travel_time(
    free_flow_time_sec: float,
    volume_vph: float,
    capacity_vph: float,
    alpha: float = 0.15,
    beta: float = 4.0
) -> float:
    """
    Computes travel time under congestion using the standard BPR formula:
    t = t_0 * [1 + alpha * (v / c)^beta]
    """
    if capacity_vph <= 0:
        return free_flow_time_sec * 10.0
    
    vc_ratio = max(0.0, volume_vph / capacity_vph)
    travel_time = free_flow_time_sec * (1.0 + alpha * (vc_ratio ** beta))
    return travel_time


def calculate_congested_speed(
    length_m: float,
    travel_time_sec: float
) -> float:
    """
    Computes effective vehicle speed in km/h from length and travel time.
    """
    if travel_time_sec <= 0:
        return 0.0
    speed_mps = length_m / travel_time_sec
    return speed_mps * 3.6


def classify_congestion_level(vc_ratio: float) -> str:
    """
    Maps Volume-to-Capacity ratio to qualitative traffic status.
    """
    if vc_ratio < 0.75:
        return "free_flow"
    elif vc_ratio < 0.95:
        return "moderate"
    elif vc_ratio <= 1.10:
        return "congested"
    else:
        return "severe"
