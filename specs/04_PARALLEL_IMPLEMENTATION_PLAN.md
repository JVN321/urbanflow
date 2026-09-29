# Parallel Implementation Plan & 2-Person Work Matrix

## 1. Team Role Allocation

| Role | Developer | Core Domains | Working Directories |
|---|---|---|---|
| **Frontend & Map Specialist** | **Person A** | React+Vite UI, MapLibre/Leaflet rendering, Intervention Designer, Kochi OSMnx extraction pipeline, Synthetic visualizer | `frontend/`, `scripts/`, `data/raw/`, `data/processed/` |
| **Backend & Algorithms Specialist** | **Person B** | Python Graph Engine, BPR Traffic Assignment (MSA), Bottleneck detection, Intervention evaluator, FastAPI endpoints | `backend/`, `data/synthetic/` |

---

## 2. Phase-by-Phase Parallel Execution Roadmap

```
Week  │ Person A (Frontend & Map)                 │ Person B (Backend & Algorithms)
──────┼───────────────────────────────────────────┼────────────────────────────────────────────
W1    │ • Setup React+Vite app                    │ • Setup FastAPI & pyproject.toml
      │ • Setup Leaflet & SVG Canvas container    │ • Implement NetworkX Graph & Pydantic models
      │ • Create synthetic graph JSON fixtures    │ • Implement BPR function & Dijkstra AON
──────┼───────────────────────────────────────────┼────────────────────────────────────────────
W2    │ • Build Interactive Map & Road hover HUD  │ • Implement Method of Successive Averages (MSA)
      │ • Build Braess 4-node Visualizer          │ • Implement Braess Paradox verification math
      │ • Add Mock API service layer              │ • Write unit tests for convergence & BPR
──────┼───────────────────────────────────────────┼────────────────────────────────────────────
W3    │ • Build Intervention Panel (Widen/Close)  │ • Implement Intervention Evaluator (Delta engine)
      │ • Build "Add New Road" drawing tool       │ • Implement Bottleneck & Cut-Edge bridge detector
      │ • Integrate Live FastAPI Client           │ • Expose `/api/simulate` & `/api/interventions`
──────┼───────────────────────────────────────────┼────────────────────────────────────────────
W4    │ • Run OSMnx Kochi extraction script       │ • Optimize MSA engine for 100+ node graph
      │ • Generate `kochi_graph.json` & GeoJSON   │ • Ingest Kochi graph & OD demand matrix
      │ • Render dark-mode Kochi road network     │ • Validate Kochi baseline simulation metrics
──────┼───────────────────────────────────────────┼────────────────────────────────────────────
W5    │ • Build Before vs After Split/Diff HUD    │ • Run candidate intervention experiments
      │ • Polish UI design system & animations   │ • Generate quantitative benchmark tables
      │ • Prepare live demo scenario walkthrough  │ • Finalize API documentation & tests
```

---

## 3. Detailed Weekly Milestone Checklist

### Week 1 — Foundations, Contracts & Scaffolding
- [ ] **Person A**:
  - Initialize Vite React TypeScript project in `frontend/`.
  - Configure Leaflet map container and dark tiles (CartoDB Dark).
  - Add synthetic JSON fixtures (`braess_network.json`, `grid_3x3_network.json`) to `frontend/src/services/fixtures/`.
- [ ] **Person B**:
  - Setup Python virtual environment and dependencies (`fastapi`, `networkx`, `numpy`, `scipy`, `pydantic`).
  - Create `backend/app/core/graph_model.py` and `backend/app/core/bpr.py`.
  - Implement basic All-or-Nothing (AON) assignment on synthetic 4-node network.
- 🤝 **Sync Checkpoint 1**: Validate that Person A's mock JSON matches Person B's Pydantic response format.

---

### Week 2 — Core Simulation & Interactive Visualization
- [ ] **Person A**:
  - Build color-coded road polyline renderer (Green $\rightarrow$ Yellow $\rightarrow$ Red based on $V/C$).
  - Build Braess Paradox demonstration screen: display the 4-node network, toggle shortcut B-C, and observe path travel time updates.
  - Implement metrics overview HUD (Total travel time, average vehicle speed).
- [ ] **Person B**:
  - Implement Method of Successive Averages (MSA) for User Equilibrium (`backend/app/core/assignment.py`).
  - Build `GET /api/benchmarks/braess` endpoint proving the paradox numerically.
  - Create synthetic network generators in `backend/app/data/synthetic_graphs.py`.
- 🤝 **Sync Checkpoint 2**: Test running Person B's backend locally and verify Person A's frontend fetches and renders the live Braess benchmark result.

---

### Week 3 — Intervention Studio & Delta Evaluator
- [ ] **Person A**:
  - Build Intervention Toolbar:
    - Click road to open editor modal (Change lane count, capacity, free speed).
    - "Close Road" toggle button.
    - "Add Road" interactive connector (click Node 1 $\rightarrow$ click Node 2).
  - Stage modifications in React state and send payload to `/api/interventions/evaluate`.
- [ ] **Person B**:
  - Implement `backend/app/core/intervention.py` (Differential simulation engine).
  - Implement `backend/app/core/bottleneck.py` (Identifies top congested segments & cut-edges).
  - Expose `/api/interventions/evaluate` returning before/after summary and edge deltas.
- 🤝 **Sync Checkpoint 3**: Perform an interactive road widening in the frontend and confirm the backend returns updated travel times and delta metrics.

---

### Week 4 — Real-World Kochi Data Integration
- [ ] **Person A**:
  - Write and execute `scripts/extract_kochi_network.py` using OSMnx.
  - Apply IRC 106 capacity heuristics and extract nodes/edges for central Kochi (Edappally, Vyttila, MG Road).
  - Save `data/processed/kochi_graph.json` and `data/processed/kochi_network.geojson`.
- [ ] **Person B**:
  - Write `backend/app/data/kochi_loader.py` to parse the processed Kochi graph.
  - Formulate realistic OD demand matrix for Kochi morning peak rush.
  - Benchmark simulation runtime and tune MSA convergence tolerance for 100+ nodes.
- 🤝 **Sync Checkpoint 4**: Render full Kochi geographic road network in the frontend and run baseline traffic simulation on real road geometry.

---

### Week 5 — Comparative Analytics, Scenarios & Final Polish
- [ ] **Person A**:
  - Implement side-by-side or split slider before/after comparison view.
  - Add interactive bottleneck ranking list and Braess Paradox alert banner.
  - Polish visual design (dark mode glow effects, micro-interactions, responsive drawer layouts).
- [ ] **Person B**:
  - Run the 4 key PBL test scenarios:
    1. Braess Paradox verification.
    2. Grid network load balancing.
    3. Synthetic bridge bottleneck failure & widening.
    4. Kochi real-world intervention (e.g. widening Banerji Road or adding a bypass link).
  - Write test suites in `backend/tests/` with 90%+ coverage.
- 🤝 **Final Demo Dry Run**: Both developers present full end-to-end demo covering synthetic validation $\rightarrow$ Kochi real network $\rightarrow$ intervention evaluation.

---

## 4. Conflict Avoidance & Git Guidelines
1. **Never edit each other's directories without prior notice**:
   - Person A owns `frontend/` and `scripts/`.
   - Person B owns `backend/`.
2. **Schema changes must be updated in `specs/` first**:
   - If a new field is needed in the API response, update `specs/00_SYSTEM_ARCHITECTURE.md` first and notify the other developer.
3. **Keep `data/` clean**:
   - Do not commit huge raw `.osm` XML files; only commit clean, compact JSON/GeoJSON outputs in `data/processed/` and `data/synthetic/`.
