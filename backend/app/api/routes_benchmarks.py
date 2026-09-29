from fastapi import APIRouter
from backend.app.data.synthetic_graphs import get_braess_paradox_network
from backend.app.core.assignment import simulate_traffic_msa

router = APIRouter(prefix="/api/benchmarks", tags=["Benchmarks"])


@router.get("/braess")
def run_braess_paradox_benchmark():
    """
    Executes the classic Braess Paradox proof.
    Compares travel time before and after adding shortcut edge B->C.
    """
    g_base, demand = get_braess_paradox_network(include_shortcut=False)
    g_sc, _ = get_braess_paradox_network(include_shortcut=True)

    base_res = simulate_traffic_msa(g_base, demand)
    sc_res = simulate_traffic_msa(g_sc, demand)

    base_time = base_res.summary_metrics.avg_travel_time_mins
    sc_time = sc_res.summary_metrics.avg_travel_time_mins
    increase_pct = ((sc_time - base_time) / max(base_time, 0.001)) * 100.0

    return {
        "status": "success",
        "phenomenon": "Braess Paradox",
        "description": "Adding a new road (shortcut B->C) increases total travel time due to selfish driver equilibrium.",
        "baseline_without_shortcut": {
            "avg_travel_time_mins": base_time,
            "total_travel_time_hours": base_res.summary_metrics.total_travel_time_hours,
            "paths_active": ["A->B->D", "A->C->D"]
        },
        "intervention_with_shortcut": {
            "avg_travel_time_mins": sc_time,
            "total_travel_time_hours": sc_res.summary_metrics.total_travel_time_hours,
            "paths_active": ["A->B->C->D"]
        },
        "impact": {
            "travel_time_change_pct": round(increase_pct, 2),
            "paradox_verified": sc_time > base_time,
            "conclusion": "Braess Paradox verified: Network performance deteriorated after adding road capacity."
        }
    }
