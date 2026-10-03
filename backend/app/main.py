"""
UrbanFlow Engine - Main FastAPI Application
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes_graphs import router as graphs_router
from app.api.routes_simulation import router as sim_router
from app.api.routes_interventions import router as interv_router
from app.api.routes_benchmarks import router as bench_router
from app.api.routes_optimizer import router as opt_router
from app.api.routes_analysis import router as analysis_router
from app.api.routes_osm import router as osm_router

app = FastAPI(
    title="UrbanFlow - Traffic Graph Optimization Engine",
    description="Graph-based traffic assignment, bottleneck detection, and Braess Paradox intervention simulation API.",
    version="1.0.0"
)

# Enable CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routes
app.include_router(graphs_router)
app.include_router(sim_router)
app.include_router(interv_router)
app.include_router(bench_router)
app.include_router(opt_router)
app.include_router(analysis_router)
app.include_router(osm_router)


@app.get("/", tags=["Health"])
def root():
    return {
        "status": "online",
        "service": "UrbanFlow Traffic Simulation & Optimization Engine",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/api/health"
    }


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    from fastapi.responses import Response
    return Response(status_code=204)


@app.get("/api/health", tags=["Health"])
def health_check():
    return {
        "status": "healthy",
        "service": "UrbanFlow Simulation Engine",
        "version": "1.0.0"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
