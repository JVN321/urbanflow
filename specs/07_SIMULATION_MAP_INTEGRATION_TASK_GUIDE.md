# UrbanFlow Simulation and Map Integration Task Guide

## Goal

Make the dashboard a backend-driven traffic operations view: the selected graph and
OD demand come from FastAPI, simulation progress is visible while the MSA engine
runs, edge flow data is rendered on the map, and map navigation has one owner.

## Current findings

- `frontend/src/App.tsx` renders a hand-built SVG graph and a separate Leaflet map.
  Both receive pointer and wheel events, so panning and zooming conflict.
- `frontend/src/services/api.ts` catches every network or HTTP error and returns
  mock results. This hides backend failures and produces empty edge metrics.
- Simulation requests send only `iterations`; alpha, beta, algorithm, and cost model
  are not sent as the backend `config` object.
- Intervention requests include config in TypeScript, but the backend route drops it
  before calling the intervention engine.
- `run.sh` has invalid `2>/devdev` redirections and relies on a fixed frontend port
  without checking whether it is available.

## Implementation tasks

1. **API contract and engine progress**
   - Add a server-sent-event simulation endpoint backed by the existing MSA/BPR
     implementation.
   - Emit iteration number, convergence state, and current edge volumes, followed by
     the canonical `SimulationResult`.
   - Pass the full `SimulationConfig` through simulation and intervention routes.
   - Preserve real HTTP errors in the client; use an explicit error state instead of
     fabricated traffic data.

2. **Single map renderer**
   - Use Leaflet as the only renderer for synthetic and Kochi graphs.
   - Build road layers from backend edge geometry where present, otherwise derive
     endpoints from backend node coordinates.
   - Fit the map to the loaded graph bounds and let Leaflet own wheel zoom, drag,
     touch gestures, and zoom controls.
   - Rebuild only the vector layers when graph or simulation data changes; do not
     recreate the map instance.

3. **Flow and interaction behavior**
   - Color links from the returned V/C ratio and show volume/travel-time popups.
   - Animate flow markers from backend edge volume and speed data.
   - Select a link by clicking its Leaflet layer and apply interventions through the
     existing backend optimizer/intervention endpoints.
   - Show live iteration progress and disable conflicting actions while a run is in
     progress.

4. **Runtime and validation**
   - Fix the combined Linux launcher cleanup and readiness checks.
   - Keep API and Vite URLs configurable with `VITE_API_BASE_URL` and
     `VITE_MAP_TILE_URL`.
   - Validate backend tests, frontend type/build checks, API health, graph loading,
     streamed simulation completion, and map interaction in a browser.

## Acceptance checks

- Selecting `kochi_central` loads nodes, geometries, and OD-backed edge metrics from
  FastAPI with no mock fallback.
- Clicking Simulate visibly advances iterations and ends with populated edge flow
  metrics from the backend.
- Leaflet drag, wheel zoom, buttons, fit-to-network, and link clicks do not interfere
  with one another.
- Optimizer recommendations and applied interventions change the rendered link
  metrics using the existing backend algorithms.
- `./run.sh` starts both services and Ctrl+C stops both without shell errors.