# Backend & Graph Engine Specification (Person B Focus)

## 1. Overview & Technology Stack
The backend is a high-performance Python-based traffic graph modeling and simulation engine. It exposes REST API endpoints using **FastAPI** and uses **NetworkX** and **NumPy/SciPy** for algorithmic graph operations and iterative traffic assignment.

### Stack:
- **Language**: Python 3.10+
- **Framework**: FastAPI + Uvicorn
- **Graph & Math**: NetworkX, NumPy, SciPy, Pydantic v2
- **Testing**: Pytest

---

## 2. Core Mathematical & Algorithmic Modules

### 2.1 Graph Representation
- The road network is represented internally as a `networkx.DiGraph`.
- Vertices ($V$) represent intersections, junctions, or OD centroids.
- Directed Edges ($E$) represent one-way road segments (bidirectional streets are represented as two opposite directed edges).
- Edge properties:
  - $l_e$: Length in meters.
  - $v_{free}$: Free-flow speed in km/h.
  - $t_0 = \frac{l_e}{v_{free} / 3.6}$: Free-flow travel time (seconds).
  - $c_e$: Capacity (vehicles per hour, vph).
  - $v_e$: Assigned traffic volume (vph).
  - $\alpha, \beta$: BPR coefficients (default: $\alpha = 0.15, \beta = 4.0$).

### 2.2 Traffic Assignment & Congestion Model (BPR Function)
Travel time on an edge under congestion is calculated using the **Bureau of Public Roads (BPR)** function:
$$t_e(v_e) = t_0 \cdot \left[ 1 + \alpha \left(\frac{v_e}{c_e}\right)^\beta \right]$$

### 2.3 Traffic Equilibrium Algorithms

#### Algorithm 1: All-or-Nothing (AON) Assignment (Baseline)
1. Set edge weights $w_e = t_0$ (free-flow travel time).
2. For each OD pair $(o, d)$ with demand $D_{od}$, find the shortest path using Dijkstra's algorithm.
3. Assign all demand $D_{od}$ to edges on the shortest path:
   $$v_e = \sum_{od} D_{od} \cdot \mathbf{1}_{\{e \in p_{od}\}}$$
4. Compute congested travel time $t_e(v_e)$.

#### Algorithm 2: Method of Successive Averages (MSA) for User Equilibrium (Wardrop's First Principle)
Drivers choose the path with the minimum perceived travel time. At equilibrium, no driver can unilaterally switch to an alternate path and reduce travel time.

1. **Initialization**: Set iteration $k=1$. Run AON on free-flow times to get initial flow vector $\mathbf{v}^{(1)}$.
2. **Update Cost**: Compute $t_e^{(k)} = t_e(v_e^{(k)})$ for all $e \in E$.
3. **Direction Finding**: Using $t_e^{(k)}$ as edge weights, perform AON assignment to get auxiliary flow vector $\mathbf{y}^{(k)}$.
4. **Step Size & Flow Update**:
   $$\lambda_k = \frac{1}{k+1}$$
   $$\mathbf{v}^{(k+1)} = (1 - \lambda_k) \mathbf{v}^{(k)} + \lambda_k \mathbf{y}^{(k)}$$
5. **Convergence Criterion**: Check Relative Gap $\epsilon$:
   $$\epsilon = \frac{\sum_e |v_e^{(k+1)} - v_e^{(k)}|}{\sum_e v_e^{(k)}} < 10^{-3} \quad \text{or} \quad k \ge k_{max} \ (\text{default: } 50)$$

---

## 3. Braess Paradox Synthetic Validation Suite

The backend must include a built-in automated test and demonstration module for the classic **Braess Paradox**:

### Network Topology:
```
         [Node A] (Origin)
          /    \
  (Road 1)     (Road 2)
  t = v/100     t = 45
       /          \
   [Node B]      [Node C]
       \          /
  (Road 3)     (Road 4)
   t = 45       t = v/100
         \    /
         [Node D] (Destination)
```
- **Total Demand**: 4,000 vehicles/hour from A to D.
- **Without Shortcut (Baseline)**:
  - Equilibrium routes split 2000 vehicles along A-B-D and 2000 along A-C-D.
  - Travel time per vehicle = $2000/100 + 45 = 65\text{ mins}$.
- **With Shortcut Road (B $\rightarrow$ C, travel time $t \approx 0$)**:
  - All 4000 drivers choose path A-B-C-D.
  - Travel time becomes: $4000/100 + 0 + 4000/100 = 80\text{ mins}$.
  - **Paradox result**: Adding the road increases average travel time from 65 to 80 minutes (+23%).

The endpoint `GET /api/benchmarks/braess` must run this test and output the exact mathematical and simulated proof.

---

## 4. Bottleneck & Graph Topology Analyzer

1. **Volume-to-Capacity Ratio ($V/C$)**:
   - $V/C < 0.75$: Free flow / Good (Green)
   - $0.75 \le V/C < 0.95$: Moderate / Approaching capacity (Yellow)
   - $0.95 \le V/C \le 1.10$: Congested (Orange)
   - $V/C > 1.10$: Severe Bottleneck / Oversaturated (Red)
2. **Edge Betweenness Centrality**:
   Identifies critical backbone roads carrying high shortest path traffic.
3. **Cut-Edge (Bridge) Detection**:
   Uses Tarjan's bridge-finding algorithm to identify vulnerable roads whose closure will partition the graph.
4. **Max-Flow / Min-Cut**:
   Calculates theoretical maximum network capacity between key origin and destination clusters.

---

## 5. Intervention Engine

The intervention engine executes differential analysis:
```python
def evaluate_intervention(base_graph: UrbanFlowGraph, demand: TrafficDemand, modifications: list[InterventionAction]) -> InterventionReport:
    # 1. Run baseline simulation on base_graph
    baseline_result = simulate_traffic(base_graph, demand)
    
    # 2. Clone graph and apply modifications (WIDEN, CLOSE, ADD)
    modified_graph = apply_modifications(base_graph.copy(), modifications)
    
    # 3. Run intervention simulation on modified_graph
    intervention_result = simulate_traffic(modified_graph, demand)
    
    # 4. Compute delta metrics
    delta = compute_metrics_diff(baseline_result, intervention_result)
    
    return InterventionReport(
        baseline=baseline_result,
        intervention=intervention_result,
        delta=delta,
        is_braess_paradox=(delta.avg_travel_time_pct_change > 0 and has_added_roads(modifications))
    )
```

---

## 6. FastAPI REST Endpoints Spec

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Healthcheck and engine status |
| `GET` | `/api/graphs` | List available graphs (`braess_4node`, `grid_3x3`, `bottleneck_bridge`, `kochi_central`) |
| `GET` | `/api/graphs/{graph_id}` | Retrieve full graph topology (nodes, edges, metadata) |
| `POST` | `/api/graphs/custom` | Upload or register a custom graph |
| `POST` | `/api/simulate` | Run traffic assignment simulation on a graph with demand |
| `POST` | `/api/interventions/evaluate` | Run before-and-after comparison with specific road interventions |
| `GET` | `/api/bottlenecks/{graph_id}` | Retrieve bottleneck and critical bridge analysis for a graph |
| `GET` | `/api/benchmarks/braess` | Execute pre-configured Braess Paradox verification test |

---

## 7. Directory Structure for Backend
```
backend/
├── app/
│   ├── api/
│   │   ├── __init__.py
│   │   ├── routes_graphs.py
│   │   ├── routes_simulation.py
│   │   ├── routes_interventions.py
│   │   ├── routes_benchmarks.py
│   │   └── mock_routes.py        # Mock routes for fast frontend unblocking
│   ├── core/
│   │   ├── __init__.py
│   │   ├── graph_model.py        # Pydantic & NetworkX data structures
│   │   ├── bpr.py                # BPR congestion equation functions
│   │   ├── assignment.py         # MSA & AON traffic assignment algorithms
│   │   ├── bottleneck.py         # V/C and cut-edge analysis
│   │   └── intervention.py       # Graph cloning, patching, and diff engine
│   ├── data/
│   │   ├── synthetic_graphs.py   # Code generators for Braess, Grid, Bridge
│   │   └── kochi_loader.py       # Loader for processed Kochi GeoJSON/JSON
│   └── main.py                   # FastAPI app entrypoint with CORS
├── tests/
│   ├── test_bpr.py
│   ├── test_assignment.py
│   ├── test_braess.py
│   └── test_api.py
├── pyproject.toml
└── requirements.txt
```
