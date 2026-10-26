# Graph Report - urbanflow  (2026-10-19)

## Corpus Check
- Large corpus: 50 files · ~1,517,157 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 368 nodes · 841 edges · 18 communities (14 shown, 4 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 76 edges (avg confidence: 0.93)
- Token cost: 15,420 input · 3,850 output

## Community Hubs (Navigation)
- Graph Registry & Metadata API
- Intervention & Network Optimizer
- React UI & MapLibre Deck.gl
- Traffic Assignment & MSA Solver
- Frontend NPM Dependencies
- Spatial Area Analysis API
- TypeScript Compiler Setup
- CLI Tools & Core Math Engine
- OpenStreetMap Ingestion & BBox
- Simulation SSE Stream Endpoints
- OSM & Random Selection Tests
- Tarjan Bridge Topology & Safety
- System Architecture & Specs
- Shell Environment Setup
- Vite Client Types
- Orchestration & Run Scripts
- Service Start Scripts
- Kochi Network Geographic Spec

## God Nodes (most connected - your core abstractions)
1. `UrbanFlowGraph` - 48 edges
2. `simulate_traffic_msa()` - 45 edges
3. `TrafficDemand` - 42 edges
4. `SimulationConfig` - 27 edges
5. `optimize_traffic_network()` - 17 edges
6. `_simulate_triad_paradox()` - 16 edges
7. `compilerOptions` - 16 edges
8. `GraphEdge` - 15 edges
9. `load_osm_bbox()` - 15 edges
10. `evaluate_intervention()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `One-Way Street Directionality Optimization` --references--> `apply_modifications()`  [INFERRED]
  README.md → backend/app/core/intervention.py
- `UrbanFlow Optimization Platform` --references--> `optimize_traffic_network()`  [INFERRED]
  README.md → backend/app/core/optimizer.py
- `Braess Paradox Validation Suite` --implements--> `run_braess_paradox_benchmark()`  [EXTRACTED]
  specs/01_BACKEND_SPEC.md → backend/app/api/routes_benchmarks.py
- `Rustworkx Multi-Origin Dijkstra Engine` --implements--> `_dijkstra_origins_batch()`  [EXTRACTED]
  architecture/README.md → backend/app/core/assignment.py
- `Mathematical Proof of Braess Paradox` --implements--> `_simulate_triad_paradox()`  [EXTRACTED]
  specs/04_SIMULATION_AND_OPTIMIZER_ENGINE_GUIDE.md → backend/app/core/assignment.py

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Wardrop User Equilibrium & MSA Traffic Assignment Pipeline** — specs_04_simulation_and_optimizer_engine_guide_wardropequilibrium, specs_01_backend_spec_msaalgorithm, specs_01_backend_spec_bprfunction, backend_app_core_assignment_simulate_traffic_msa, architecture_readme_rustworkxdijkstra [EXTRACTED 1.00]
- **Braess Paradox Identification & Network Optimization** — specs_04_simulation_and_optimizer_engine_guide_braessmathematicalproof, specs_04_simulation_and_optimizer_engine_guide_bridgefiltering, specs_04_simulation_and_optimizer_engine_guide_corridorcandidates, backend_app_core_optimizer_optimize_traffic_network, backend_app_core_bottleneck_analyze_graph_bridges [EXTRACTED 1.00]
- **UrbanFlow Fullstack Simulation and Visualization Contract** — specs_00_system_architecture_systemoverview, specs_00_system_architecture_urbanflowgraph, specs_00_system_architecture_simulationresult, specs_02_frontend_spec_deckglvisualization, frontend_src_services_api_runsimulation [EXTRACTED 1.00]

## Communities (18 total, 4 thin omitted)

### Community 0 - "Graph Registry & Metadata API"
Cohesion: 0.10
Nodes (29): get_graph_by_id(), get_graph_default_demand(), list_available_graphs(), GraphEdge, GraphMetadata, GraphNode, OriginDestinationDemand, TrafficDemand (+21 more)

### Community 1 - "Intervention & Network Optimizer"
Cohesion: 0.09
Nodes (28): evaluate_proposed_intervention(), _build_candidate_jobs(), _eval_candidate(), get_recommendations(), OptimizationRequestPayload, stream_optimization(), event_generator(), run_optimizer_pipeline() (+20 more)

### Community 2 - "React UI & MapLibre Deck.gl"
Cohesion: 0.08
Nodes (41): App(), edgeColor(), edgePath(), getEdgeBearingAndDirection(), getEdgeMidpoint(), allowedRoadTypes(), analyzeArea(), AreaAnalysisResult (+33 more)

### Community 3 - "Traffic Assignment & MSA Solver"
Cohesion: 0.08
Nodes (22): Rustworkx Multi-Origin Dijkstra Engine, _build_empty_result(), build_networkx_graph(), _dijkstra_origins_batch(), simulate_traffic_msa(), _simulate_triad_paradox(), calculate_congested_speed(), calculate_link_travel_time() (+14 more)

### Community 4 - "Frontend NPM Dependencies"
Cohesion: 0.07
Nodes (28): dependencies, leaflet, lucide-react, react, react-dom, devDependencies, @types/leaflet, @types/react (+20 more)

### Community 5 - "Spatial Area Analysis API"
Cohesion: 0.12
Nodes (9): analyze_area(), AreaAnalysisRequest, get_analysis_graph(), _register_area(), run_braess_paradox_benchmark(), favicon(), health_check(), root() (+1 more)

### Community 6 - "TypeScript Compiler Setup"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+9 more)

### Community 7 - "CLI Tools & Core Math Engine"
Cohesion: 0.18
Nodes (3): extract_kochi_network(), haversine_m(), main()

### Community 8 - "OpenStreetMap Ingestion & BBox"
Cohesion: 0.20
Nodes (8): fetch_osm_bbox_api(), fetch_random_selection(), import_osm_place(), list_curated_locations(), OSMFetchRequest, OSMImportRequest, OSMRandomRequest, _register_graph_and_demand()

### Community 9 - "Simulation SSE Stream Endpoints"
Cohesion: 0.17
Nodes (7): run_simulation(), SimulationRequestPayload, stream_simulation(), event_generator(), on_progress(), run_engine(), _allowed_road_types()

### Community 10 - "OSM & Random Selection Tests"
Cohesion: 0.12
Nodes (6): test_area_analysis_newly_selected_data(), test_curated_locations_endpoint(), test_osm_fetch_endpoint_custom_bbox(), test_random_osm_selection_endpoint(), test_random_osm_selection_specific_city(), test_root_and_health_endpoints()

### Community 11 - "Tarjan Bridge Topology & Safety"
Cohesion: 0.24
Nodes (5): Tarjan DFS Bridge-Finding Algorithm, analyze_graph_bridges(), compute_edge_betweenness(), Bottleneck and Bridge Cut-Edge Analyzer, Bridge Filtering Safety Constraint

### Community 12 - "System Architecture & Specs"
Cohesion: 0.50
Nodes (4): UrbanFlow Frontend App Shell, Frontend PNPM Workspace, UrbanFlow System Architecture, Deck.gl Vector Map Visualization

### Community 13 - "Shell Environment Setup"
Cohesion: 0.50
Nodes (3): PATH, setup_env.sh script, VIRTUAL_ENV

## Knowledge Gaps
- **26 isolated node(s):** `@types/leaflet`, `@types/react`, `@types/react-dom`, `typescript`, `VIRTUAL_ENV` (+21 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 174 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `UrbanFlowGraph` connect `Graph Registry & Metadata API` to `Intervention & Network Optimizer`, `Traffic Assignment & MSA Solver`, `Spatial Area Analysis API`, `CLI Tools & Core Math Engine`, `OpenStreetMap Ingestion & BBox`, `Simulation SSE Stream Endpoints`, `Tarjan Bridge Topology & Safety`?**
  _High betweenness centrality (0.093) - this node is a cross-community bridge._
- **Are the 22 inferred relationships involving `UrbanFlowGraph` (e.g. with `analyze_area()` and `_register_area()`) actually correct?**
  _`UrbanFlowGraph` has 22 INFERRED edges - model-reasoned connections that need verification._
- **What connects `@types/leaflet`, `@types/react`, `@types/react-dom` to the rest of the system?**
  _26 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Graph Registry & Metadata API` be split into smaller, more focused modules?**
  _Cohesion score 0.09696969696969697 - nodes in this community are weakly interconnected._
- **Why does `simulate_traffic_msa()` connect `Traffic Assignment & MSA Solver` to `Graph Registry & Metadata API`, `Intervention & Network Optimizer`, `Spatial Area Analysis API`, `CLI Tools & Core Math Engine`, `OpenStreetMap Ingestion & BBox`, `Simulation SSE Stream Endpoints`, `Tarjan Bridge Topology & Safety`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `simulate_traffic_msa()` (e.g. with `run_optimizer_pipeline()` and `run_engine()`) actually correct?**
  _`simulate_traffic_msa()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Should `Intervention & Network Optimizer` be split into smaller, more focused modules?**
  _Cohesion score 0.08665269042627533 - nodes in this community are weakly interconnected._