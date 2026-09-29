'

# UrbanFlow Simulation & Optimization Engine — Mathematical Guide & Algorithm Reference

## 1. Executive Summary

This document provides a formal mathematical and algorithmic reference for the **UrbanFlow Simulation & Optimization Engine**. It outlines the core traffic equilibrium formulations, link congestion functions (BPR), bottleneck detection methods, Braess Paradox mechanics, and the Network Design Optimization Algorithm (Edge Pruning & Capacity Allocation).

---

## 2. Mathematical Formulations

### 2.1 Graph & Traffic Network Model

A road network is modeled as a directed graph $G = (V, E)$:

- **Vertices ($V$)**: Intersections, centroids, origins, and destinations.
- **Edges ($E$)**: One-way road segments with attributes:
  - $l_e$: Length in meters ($m$).
  - $v_{free, e}$: Free-flow speed ($km/h$).
  - $t_{0, e} = \frac{l_e}{v_{free, e} / 3.6}$: Free-flow travel time (seconds).
  - $c_e$: Nominal road capacity (vehicles per hour, $vph$).
  - $v_e$: Assigned traffic volume ($vph$).
  - $\alpha, \beta$: Congestion calibration parameters (defaults: $\alpha = 0.15, \beta = 4.0$).

---

### 2.2 Link Performance Function (Bureau of Public Roads - BPR)

Travel time $t_e(v_e)$ increases non-linearly as traffic volume $v_e$ approaches or exceeds road capacity $c_e$:

$$
t_e(v_e) = t_{0, e} \cdot \left[ 1 + \alpha \cdot \left(\frac{v_e}{c_e}\right)^\beta \right]
$$

- **When $v_e \ll c_e$**: Travel time is approximately free-flow ($t_e \approx t_{0, e}$).
- **When $v_e \approx c_e$**: Travel time increases by factor $(1 + \alpha)$ (+15% for $\alpha=0.15$).
- **When $v_e > c_e$ (Oversaturated)**: Travel time escalates rapidly due to exponent $\beta=4.0$.

Effective vehicle travel speed on edge $e$ is given by:

$$
v_{speed, e} = 3.6 \cdot \frac{l_e}{t_e(v_e)} \quad (\text{km/h})
$$

---

### 2.3 User Equilibrium & Wardrop's First Principle

UrbanFlow models driver route choice under **Wardrop's First Principle of User Equilibrium (UE)**:

> *"No individual driver can unilaterally reduce their travel time by switching to an alternative route."*

Formally, for every Origin-Destination pair $(o, d) \in \mathcal{OD}$ with demand $D_{od}$ and path set $\mathcal{P}_{od}$:

$$
\forall p \in \mathcal{P}_{od}: \quad f_p > 0 \implies C_p(\mathbf{v}) = \pi_{od}
$$

$$
\forall p \in \mathcal{P}_{od}: \quad f_p = 0 \implies C_p(\mathbf{v}) \ge \pi_{od}
$$

Where:

- $f_p$: Traffic flow on path $p$.
- $C_p(\mathbf{v}) = \sum_{e \in p} t_e(v_e)$: Total travel cost on path $p$.
- $\pi_{od} = \min_{q \in \mathcal{P}_{od}} C_q(\mathbf{v})$: Minimum travel cost between $o$ and $d$.

This corresponds to the solution of the **Beckmann Convex Optimization Formulation**:

$$
\min_{\mathbf{v}} \sum_{e \in E} \int_{0}^{v_e} t_e(w) \, dw
$$

$$
\text{subject to:} \quad \sum_{p \in \mathcal{P}_{od}} f_p = D_{od} \quad \forall (o, d), \quad v_e = \sum_{p \in \mathcal{P}} f_p \delta_{ep}, \quad f_p \ge 0
$$

---

## 3. Simulation Algorithm: Method of Successive Averages (MSA)

To solve for User Equilibrium on large and synthetic graphs, UrbanFlow implements the **Method of Successive Averages (MSA)**:

```
Algorithm 1: MSA Traffic Assignment Engine
─────────────────────────────────────────────────────────────────────────────
Input : Graph G = (V, E), Demand Matrix D, Config {max_iter, tolerance, alpha, beta}
Output: Equilibrium link flows v_e, link travel times t_e, Path allocations

1: Initialize edge flows: v_e^(0) = 0 for all e in E
2: Set link weights to free-flow time: cost_e = t_0,e
3: For iteration k = 1 to max_iter do:
4:     // Step A: Update Link Travel Costs
5:     For each edge e in E do:
6:         cost_e = t_0,e * [ 1 + alpha * (v_e^(k-1) / c_e)^beta ]
7:   
8:     // Step B: Auxiliary All-or-Nothing (AON) Shortest Path Assignment
9:     Initialize auxiliary flows: y_e = 0 for all e in E
10:    For each OD pair (o, d) with demand D_od do:
11:        Find shortest path P_od in G using Dijkstra(weights = cost_e)
12:        For each edge e in P_od do:
13:            y_e = y_e + D_od
14:
15:    // Step C: Flow Averaging with Predefined Step Size
16:    lambda_k = 1.0 / (k + 1)
17:    For each edge e in E do:
18:        v_e^(k) = (1 - lambda_k) * v_e^(k-1) + lambda_k * y_e
19:
20:    // Step D: Convergence Check (Relative Gap)
21:    gap = sum_e |v_e^(k) - v_e^(k-1)| / max(1, sum_e v_e^(k))
22:    If gap < tolerance and k >= 4 then:
23:        Break (Equilibrium Reached)
24: End For
25: Compute final travel times t_e, V/C ratios, and bottleneck scores.
─────────────────────────────────────────────────────────────────────────────
```

---

## 4. Braess Paradox Mechanics & Proof

### 4.1 Theoretical Reproduction (4-Node Network)

Consider origin $A$ and destination $D$ with $D_{AD} = 4000$ vph:

- Link $A \to B$: $t_{AB}(v) = v / 100$
- Link $B \to D$: $t_{BD} = 45$ min (constant)
- Link $A \to C$: $t_{AC} = 45$ min (constant)
- Link $C \to D$: $t_{CD}(v) = v / 100$

#### Case 1: Baseline Network (No Shortcut)

- Traffic divides equally by symmetry: $v_1 = 2000$ on $A \to B \to D$ and $v_2 = 2000$ on $A \to C \to D$.
- Travel time on Path 1: $T_1 = 2000/100 + 45 = 65\text{ mins}$.
- Travel time on Path 2: $T_2 = 45 + 2000/100 = 65\text{ mins}$.
- **Network Average Travel Time = 65.0 minutes**.

#### Case 2: Adding Zero-Cost Shortcut $B \to C$ ($t_{BC} \approx 0$)

- A driver considering route $A \to B \to C \to D$:
  - If all other drivers take the old paths, travel time on $A \to B \to C \to D$ is $2000/100 + 0 + 2000/100 = 40\text{ mins} < 65\text{ mins}$.
  - Selfish routing incentives cause **all 4,000 drivers** to switch to path $A \to B \to C \to D$.
- At the new Nash equilibrium ($v_{AB} = 4000, v_{CD} = 4000$):
  - $T(A \to B \to C \to D) = 4000/100 + 0 + 4000/100 = 80.0\text{ mins}$.
- **Paradox Result**: Adding a shortcut road increased average travel time from 65 to 80 minutes (+23.1% degradation)!

---

## 5. Network Optimizer Engine (Edge Pruning & Capacity Allocation)

The UrbanFlow Optimizer solves the **Discrete Network Design Problem (DNDP)** through intelligent heuristic search:

```
                          Base Network Graph G = (V, E)
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
   [ 1. Bridge Safety Check ]                           [ 2. Bottleneck Scan ]
   Find cut-edges with Tarjan's                         Filter edges with
   (Exclude from removal)                               V/C ratio >= 0.85
            │                                                     │
            ▼                                                     ▼
   [ 3. Road Removal Testing ]                          [ 4. Road Widening Testing ]
   For each non-bridge edge e:                          For top bottleneck edges:
   Simulate G \ {e} under MSA                           Simulate G with e (lanes + 1)
   Calculate delta_time = T_base - T_after              Calculate delta_time = T_base - T_after
            │                                                     │
            └──────────────────────────┬──────────────────────────┘
                                       ▼
                     [ 5. Rank Interventions & Plan ]
                     - Highlight Braess Paradox Removals (delta_time > 0)
                     - Highlight Capacity Widenings
                     - Compute Net Flow & Throughput Increase
```

### 5.1 Safety Constraint: Graph Connectivity (Bridge Filtering)

Before testing edge removal, the engine computes all cut-edges (bridges) using Tarjan’s bridge-finding algorithm in $O(|V| + |E|)$ time:

- If removing edge $e$ increases the number of connected components in $G$, edge $e$ is **strictly preserved**.

---

## 6. How to Tweak & Tune Parameters in the Engine

All parameters can be modified via API or through the Frontend Tuning Panel:

| Parameter                          | Default  | Range           | Impact                                                                                                            |
| ---------------------------------- | -------- | --------------- | ----------------------------------------------------------------------------------------------------------------- |
| **$\alpha$ (Alpha)**       | `0.15` | `0.05 - 1.0`  | Controls baseline penalty coefficient in BPR function. Higher values increase congestion sensitivity.             |
| **$\beta$ (Beta)**         | `4.0`  | `1.0 - 6.0`   | Exponent curve steepness.$\beta=1$ produces linear congestion; $\beta=4$ produces sharp saturation drop-offs. |
| **Max Iterations**           | `40`   | `10 - 100`    | Number of MSA equilibration loops. 30-40 iterations is optimal for balance between speed and precision.           |
| **Tolerance ($\epsilon$)** | `1e-4` | `1e-2 - 1e-6` | Convergence threshold for relative flow variance between iterations.                                              |
| **Demand Factor**            | `100%` | `50% - 250%`  | Scales all OD matrix demands to simulate off-peak vs rush-hour congestion peaks.                                  |
