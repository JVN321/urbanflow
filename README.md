# UrbanFlow — Urban Traffic Graph Optimization Engine

UrbanFlow is a graph-based traffic simulation and intervention engine designed to model road networks, simulate equilibrium traffic flow using BPR congestion functions, detect bottlenecks, and evaluate candidate infrastructure modifications (widening, closures, additions) to discover phenomena like the **Braess Paradox**.

---

## 👥 Parallel Development Setup (2-Person Split)

The codebase is split into decoupled sub-systems with clear contracts in `specs/`:

| Developer | Role & Domain | Working Directory | Key Spec Sheet |
|---|---|---|---|
| **Person A** | **Frontend & Map Specialist** (React, MapLibre/Leaflet, OSMnx extraction) | [`frontend/`](file:///devdrive/github/projects/urbanflow/frontend/) & [`scripts/`](file:///devdrive/github/projects/urbanflow/scripts/) | [`specs/02_FRONTEND_SPEC.md`](file:///devdrive/github/projects/urbanflow/specs/02_FRONTEND_SPEC.md) & [`specs/03_MAP_DATA_PIPELINE_SPEC.md`](file:///devdrive/github/projects/urbanflow/specs/03_MAP_DATA_PIPELINE_SPEC.md) |
| **Person B** | **Backend & Engine Specialist** (Python, NetworkX, BPR traffic assignment, FastAPI) | [`backend/`](file:///devdrive/github/projects/urbanflow/backend/) | [`specs/01_BACKEND_SPEC.md`](file:///devdrive/github/projects/urbanflow/specs/01_BACKEND_SPEC.md) |

---

## 📁 Project Directory Structure

```
urbanflow/
├── specs/                                # Immutable API & Architecture contracts
│   ├── 00_SYSTEM_ARCHITECTURE.md         # Data schemas & Git workflow
│   ├── 01_BACKEND_SPEC.md                # Python BPR & MSA Engine specs
│   ├── 02_FRONTEND_SPEC.md               # React Vite & UI specs
│   ├── 03_MAP_DATA_PIPELINE_SPEC.md      # Kochi OSM extraction & IRC 106 specs
│   └── 04_PARALLEL_IMPLEMENTATION_PLAN.md# 5-Week Milestone roadmap
│
├── backend/                              # [Person B Workspace]
│   ├── app/
│   │   ├── api/                          # FastAPI route endpoints
│   │   ├── core/                         # BPR, MSA Assignment, Bottlenecks, Interventions
│   │   ├── data/                         # Synthetic generators & data loaders
│   │   └── main.py                       # App entrypoint
│   ├── tests/                            # Unit tests
│   └── requirements.txt
│
├── frontend/                             # [Person A Workspace]
│   ├── src/
│   │   ├── components/                   # Map, HUD, and Intervention widgets
│   │   ├── services/                     # API client with offline mock fallbacks
│   │   ├── types/                        # TypeScript schemas matching backend
│   │   ├── App.tsx                       # Interactive Dashboard
│   │   └── index.css                     # Glassmorphic Dark Design System
│   ├── package.json
│   └── vite.config.ts
│
├── scripts/                              # Map & Data extraction utilities
│   └── extract_kochi_network.py          # OSMnx Kochi road network extractor
│
└── data/                                 # Shared datasets
    ├── raw/                              # Raw OSM XML / GeoJSON data
    ├── processed/                        # Cleaned Kochi graph JSONs
    └── synthetic/                        # Synthetic benchmark networks
```

---

## 🚀 Quickstart Guide

### 1. Automated Environment Setup (One-Click)
Run the setup script from the root of the repo:
```bash
./setup_env.sh
```
*(On Windows: run `setup_env.bat`)*

This will create `backend/venv`, install all Python dependencies, and initialize `frontend/` npm packages.

---

### 2. Running the Backend (Person B)
```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --port 8000
```
Interactive Swagger API docs will be live at: `http://localhost:8000/docs`

### Importing a New Place from OpenStreetMap

The backend can fetch a new drivable place directly from OpenStreetMap through
OSMnx, register it in memory, generate an initial OD demand set, and run the
simulation before returning the data:

```bash
curl -X POST http://localhost:8000/api/osm/import \
    -H 'Content-Type: application/json' \
    -d '{"place":"Bengaluru, India","network_type":"drive","demand_multiplier":1.0}'
```

The response contains `graph`, `demand`, and `result`. The returned `graph.graph_id`
can then be used with `/api/simulate`, `/api/optimizer/recommend`,
`/api/optimizer/stream-optimize`, and `/api/interventions/evaluate`.

---

### 3. Running the Frontend (Person A)
```bash
cd frontend
npm run dev
```
Interactive simulation dashboard will be live at: `http://localhost:3000`

*(Note: The frontend includes built-in offline mock fallbacks so Person A can develop and test immediately without waiting for the backend).*

---

### 4. Extracting Kochi OSM Road Network (Person A)
```bash
cd backend && source venv/bin/activate && cd ..
python3 scripts/extract_kochi_network.py --out-graph data/processed/kochi_graph.json --out-geojson data/processed/kochi_network.geojson
```
