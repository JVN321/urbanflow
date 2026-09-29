# UrbanFlow System Architecture & Collaboration Specification

## 1. System Overview
**UrbanFlow** is an Urban Traffic Graph Optimization & Simulation Engine designed to model urban road networks as directed weighted graphs, simulate traffic flow and congestion using equilibrium assignment (BPR function), detect bottlenecks, and evaluate infrastructure interventions (road widening, closure, and additions) to analyze phenomena like the **Braess Paradox**.

The system is split into two decoupled sub-systems:
1. **Python Simulation & Optimization Engine (Backend)**: Fast mathematical graph computation, traffic assignment, bottleneck detection, and intervention benchmarking.
2. **React + Vite Interactive Map & Analytics Dashboard (Frontend)**: Real-time map rendering, interactive network editing (interventions), congestion heatmap visualization, and comparative metric dashboards.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React + Vite)                         │
│  ┌──────────────────────┐  ┌───────────────────────┐  ┌──────────────────┐  │
│  │ Interactive Map View │  │ Intervention Designer │  │ Before/After HUD │  │
│  │ (MapLibre / Leaflet) │  │ (Add/Widen/Close Rd)  │  │ & Graph Metrics  │  │
│  └──────────┬───────────┘  └───────────┬───────────┘  └─────────┬────────┘  │
└─────────────┼──────────────────────────┼────────────────────────┼───────────┘
              │                          │                        │
       REST / JSON API            REST / JSON API          REST / JSON API
              │                          │                        │
┌─────────────┼──────────────────────────┼────────────────────────┼───────────┘
│             ▼                          ▼                        ▼           │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                     FastAPI Gateway & Route Handlers                  │  │
│  └───────────────────────────────────┬───────────────────────────────────┘  │
│                                      │                                      │
│  ┌───────────────────────────────────▼───────────────────────────────────┐  │
│  │                    Core Traffic Simulation Engine                     │  │
│  │  - Graph Representation (NetworkX / Custom DiGraph)                   │  │
│  │  - User Equilibrium / MSA Traffic Assignment (BPR Function)           │  │
│  │  - Bottleneck & Cut-Edge Analysis (Max-Flow, Betweenness)             │  │
│  │  - Intervention Engine (Delta Graph Evaluator)                        │  │
│  └───────────────────────────────────┬───────────────────────────────────┘  │
│                                      │                                      │
│  ┌───────────────────────────────────▼───────────────────────────────────┐  │
│  │                     Data & Network Providers                          │  │
│  │  - Synthetic Networks (Braess Paradox 4-node, Grid, Bottlenecks)      │  │
│  │  - Kochi OSMnx Extracted Graph & OD Demand Matrices                   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                              BACKEND (Python)                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Standardized Graph & Simulation Data Schemas

To ensure Person A (Frontend + Map) and Person B (Backend) can work 100% independently without blocking each other, all data exchange adheres strictly to the following JSON schemas.

### 2.1 Graph Definition Schema (`UrbanFlowGraph`)
Used to serialize synthetic or real (Kochi) road networks.

```json
{
  "graph_id": "kochi_central_v1",
  "name": "Kochi Central Road Network",
  "crs": "EPSG:4326",
  "metadata": {
    "node_count": 142,
    "edge_count": 318,
    "bbox": [76.267, 9.931, 76.350, 10.015]
  },
  "nodes": [
    {
      "id": "node_101",
      "label": "Edappally Junction",
      "lat": 10.0261,
      "lng": 76.3125,
      "type": "intersection"
    }
  ],
  "edges": [
    {
      "id": "edge_501",
      "source": "node_101",
      "target": "node_102",
      "name": "Banerji Road",
      "length_m": 850.0,
      "lanes": 2,
      "free_speed_kmh": 50.0,
      "capacity_vph": 1800.0,
      "geometry": [
        [76.3125, 10.0261],
        [76.3080, 10.0210]
      ],
      "road_type": "primary",
      "oneway": true
    }
  ]
}
```

### 2.2 Traffic Demand Matrix Schema (`TrafficDemand`)
Defines the Origin-Destination (OD) volume matrix.

```json
{
  "demand_id": "kochi_morning_peak",
  "description": "Morning Peak Hour Demand (08:30 - 09:30)",
  "demands": [
    {
      "origin": "node_101",
      "destination": "node_140",
      "volume_vph": 1200
    }
  ]
}
```

### 2.3 Simulation Result Schema (`SimulationResult`)
The output returned by the simulation engine for both baseline and intervention runs.

```json
{
  "run_id": "sim_run_20260929_001",
  "graph_id": "kochi_central_v1",
  "summary_metrics": {
    "total_vehicles": 15400,
    "total_travel_time_hours": 3820.5,
    "avg_travel_time_mins": 14.88,
    "avg_network_speed_kmh": 26.4,
    "severely_congested_edges_count": 12,
    "network_efficiency_index": 0.74
  },
  "edge_metrics": {
    "edge_501": {
      "volume_vph": 1650.0,
      "capacity_vph": 1800.0,
      "vc_ratio": 0.916,
      "free_flow_time_sec": 61.2,
      "congested_time_sec": 114.8,
      "avg_speed_kmh": 26.6,
      "congestion_level": "heavy",
      "is_bottleneck": true
    }
  },
  "bottlenecks": [
    {
      "edge_id": "edge_501",
      "severity_score": 0.92,
      "cause": "capacity_exceeded",
      "recommendation": "widen_or_reroute"
    }
  ]
}
```

### 2.4 Intervention Request & Comparison Schema (`InterventionPayload`)
Sent by the frontend to test a road modification.

```json
{
  "base_graph_id": "kochi_central_v1",
  "demand_id": "kochi_morning_peak",
  "modifications": [
    {
      "action": "WIDEN",
      "edge_id": "edge_501",
      "new_lanes": 3,
      "new_capacity_vph": 2700.0
    },
    {
      "action": "CLOSE",
      "edge_id": "edge_508"
    },
    {
      "action": "ADD",
      "new_edge": {
        "id": "edge_new_99",
        "source": "node_101",
        "target": "node_115",
        "length_m": 600.0,
        "lanes": 2,
        "free_speed_kmh": 40.0,
        "capacity_vph": 1600.0,
        "geometry": [[76.3125, 10.0261], [76.3200, 10.0300]]
      }
    }
  ]
}
```

---

## 3. Parallel Git Workflow for 2 Developers

To prevent merge conflicts and enable simultaneous development:

### 3.1 Repository Structure Isolation
- **Person A Working Root**: `frontend/` and `data/raw/` + `data/processed/`
- **Person B Working Root**: `backend/` and `data/synthetic/`
- **Shared Agreement**: `specs/` (immutable contracts once approved).

### 3.2 Branching Model
- `main`: Production/Demo branch. Only working, tested integration code is merged here.
- `feat/person-a-frontend-map`: Frontend React/Vite app, Map UI, visualization widgets, OSMnx data extraction scripts.
- `feat/person-b-backend-engine`: Python FastAPI, traffic assignment simulator, BPR models, intervention evaluator.
- `contract/mock-api`: Contains shared mock fixtures in `specs/fixtures/` and a mock API server so Person A never waits for Person B.

### 3.3 Mock-First Development Rule
1. Before Person B writes the full simulation algorithms, a lightweight mock endpoint returning static fixture JSONs is provided in `backend/app/api/mock_routes.py`.
2. Person A uses this mock API immediately to build and test the full React/Map experience.
3. Person B replaces the mock engine with the real algorithmic implementation in parallel.
4. When both are ready, Person A toggles the frontend API URL to the live backend endpoints.
