import asyncio
import json
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from typing import Optional
from pydantic import BaseModel, Field
from app.core.graph_model import (
    UrbanFlowGraph,
    TrafficDemand,
    SimulationResult,
    SimulationConfig
)
from app.core.assignment import simulate_traffic_msa
from app.api.routes_graphs import _GRAPHS, _DEMANDS

router = APIRouter(prefix="/api/simulate", tags=["Simulation"])


class SimulationRequestPayload(BaseModel):
    graph_id: Optional[str] = None
    graph: Optional[UrbanFlowGraph] = None
    demand: Optional[TrafficDemand] = None
    demand_multiplier: float = Field(default=1.0, ge=0.1, le=5.0)
    iterations: Optional[int] = Field(default=30)
    config: Optional[SimulationConfig] = None


@router.post("", response_model=SimulationResult)
def run_simulation(
    payload: Optional[SimulationRequestPayload] = None,
    graph_id: Optional[str] = Query(default=None),
    demand_multiplier: Optional[float] = Query(default=None)
):
    """
    Executes User Equilibrium traffic assignment using MSA.
    Accepts JSON body or query parameters.
    """
    target_graph_id = (payload.graph_id if payload else None) or graph_id
    target_multiplier = (payload.demand_multiplier if payload and payload.demand_multiplier is not None else None) or (demand_multiplier if demand_multiplier is not None else 1.0)
    target_graph = payload.graph if payload else None
    
    if target_graph is None and target_graph_id:
        if target_graph_id not in _GRAPHS:
            raise HTTPException(status_code=404, detail=f"Graph '{target_graph_id}' not found.")
        target_graph = _GRAPHS[target_graph_id]

    if target_graph is None:
        raise HTTPException(status_code=400, detail="Must provide either 'graph_id' or 'graph' object.")

    target_demand = payload.demand if payload else None
    if target_demand is None and target_graph_id and target_graph_id in _DEMANDS:
        target_demand = _DEMANDS[target_graph_id]
    
    if target_demand is None:
        target_demand = TrafficDemand(demand_id="empty_demand", demands=[])

    sim_config = (payload.config if (payload and payload.config) else None) or SimulationConfig()
    if payload and payload.iterations:
        sim_config.max_iterations = payload.iterations

    result = simulate_traffic_msa(
        graph=target_graph,
        demand=target_demand,
        demand_multiplier=target_multiplier,
        config=sim_config
    )
    return result


@router.get("/stream")
async def stream_simulation(
    graph_id: str,
    demand_multiplier: float = Query(default=1.0, ge=0.1, le=5.0),
    iterations: int = Query(default=30, ge=1, le=500),
    alpha: float = Query(default=0.15, ge=0.0),
    beta: float = Query(default=4.0, ge=0.1),
    convergence_tolerance: float = Query(default=0.001, gt=0.0),
    algorithm: str = Query(default="msa"),
    cost_model: str = Query(default="bpr")
):
    """Stream MSA iterations, then emit the canonical final simulation result."""
    if graph_id not in _GRAPHS:
        raise HTTPException(status_code=404, detail=f"Graph '{graph_id}' not found.")

    graph = _GRAPHS[graph_id]
    demand = _DEMANDS.get(graph_id) or TrafficDemand(demand_id="empty_demand", demands=[])
    config = SimulationConfig(max_iterations=iterations, default_alpha=alpha, default_beta=beta, convergence_tolerance=convergence_tolerance, algorithm=algorithm, cost_model=cost_model)
    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def on_progress(event):
        loop.call_soon_threadsafe(queue.put_nowait, {"type": "progress", **event})

    async def run_engine():
        result = await asyncio.to_thread(
            simulate_traffic_msa,
            graph,
            demand,
            demand_multiplier,
            config,
            on_progress,
        )
        # Let callbacks scheduled from the worker thread reach the queue first.
        await asyncio.sleep(0)
        await queue.put({"type": "complete", "result": result.model_dump()})

    async def event_generator():
        task = asyncio.create_task(run_engine())
        yield f"data: {json.dumps({'type': 'status', 'message': 'Running MSA traffic assignment'})}\n\n"
        try:
            while True:
                event = await queue.get()
                yield f"data: {json.dumps(event)}\n\n"
                if event["type"] == "complete":
                    break
            await task
        except asyncio.CancelledError:
            task.cancel()
            raise

    return StreamingResponse(event_generator(), media_type="text/event-stream")
