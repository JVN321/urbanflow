# Traffic Network Optimization PBL — Project Phases

## Project Overview

UrbanFlow

**Urban Traffic Graph Optimization Engine**

### Core Objective

Build a graph-based urban traffic simulation and intervention engine that can:

1. Model a road network as a weighted graph.
2. Simulate traffic flow and congestion.
3. Identify bottlenecks and critical roads.
4. Evaluate infrastructure interventions such as:
   - Road widening
   - Road removal / closure
   - New road addition
5. Validate the approach on synthetic networks.
6. Apply the same engine to real-world road and traffic data from Kochi.
7. Compare the simulated network before and after interventions using measurable metrics.

The project follows the progression:

**Graph Algorithms → Simulation Engine → Optimization → Real-World Data → Kochi Simulation → Intervention Analysis**

---

# Phase 1 — Problem Definition & Graph Modelling

## Goal

Establish the mathematical and computational representation of an urban road network.

## Tasks

- Define the traffic optimization problem.
- Research graph representations for road networks.
- Represent:
  - Junctions as vertices.
  - Road segments as edges.
- Define edge attributes:
  - Road length
  - Number of lanes
  - Capacity
  - Free-flow speed
  - Travel time
  - Traffic volume
- Decide whether the graph should be directed.
- Define the initial traffic-demand model.
- Study the required graph algorithms from the syllabus.

## Algorithms / Concepts

- Graph representation
- Weighted graphs
- Directed graphs
- Paths and connectivity
- Vertex degree
- Shortest-path algorithms
- Network flow
- Max-flow / Min-cut
- Graph connectivity

## Deliverables

- Problem statement
- System architecture
- Graph data model
- Initial mathematical model
- Literature / algorithm study
- Small manually-created test graph

---

# Phase 2 — Synthetic Traffic Simulation Engine

## Goal

Build the first working simulation using artificial road networks.

## Tasks

- Create a graph-based road network simulator.
- Generate small synthetic road networks.
- Assign road capacities and travel times.
- Create origin-destination traffic demands.
- Route traffic through the network.
- Calculate road utilization.
- Model congestion-dependent travel time.
- Run repeated traffic assignment until the network reaches a stable state or predefined iteration limit.

## Initial Traffic Model

For each road:

- Capacity
- Traffic volume
- Free-flow travel time
- Congested travel time

A congestion function can be used to make travel time increase as traffic approaches road capacity.

## Deliverables

- Working simulation engine
- Synthetic road-network generator
- Traffic-demand generator
- Route assignment system
- Congestion model
- Baseline simulation results

---

# Phase 3 — Traffic Optimization & Intervention Engine

## Goal

Extend the simulator so that it can test changes to the road network and measure their effects.

## Intervention Types

### 1. Road Widening

Increase the capacity of an existing road.

Example:

`2 lanes → 3 lanes`

The simulator should measure how the increased capacity changes:

- Traffic distribution
- Travel time
- Congestion
- Network throughput

### 2. Road Removal / Closure

Temporarily remove a road from the graph and rerun the simulation.

The engine should determine whether traffic:

- Successfully reroutes
- Causes new bottlenecks
- Increases travel time
- Disconnects important parts of the network

### 3. New Road

Add a new edge between suitable junctions and evaluate the resulting network.

## Optimization Workflow

```text
Baseline Network
       ↓
Run Simulation
       ↓
Calculate Metrics
       ↓
Generate Candidate Intervention
       ↓
Modify Network
       ↓
Run Simulation Again
       ↓
Calculate New Metrics
       ↓
Compare With Baseline
       ↓
Restore Network
       ↓
Test Next Intervention
```

## Metrics

At minimum:

- Average travel time
- Total travel time
- Road utilization
- Congestion level
- Network throughput
- Number of severely congested roads
- Connectivity

## Deliverables

- Intervention engine
- Road modification functions
- Automated before/after comparison
- Bottleneck detection
- Optimization experiments on synthetic networks

---

# Phase 4 — Kochi Real-World Data Integration

## Goal

Replace the synthetic road network with a real-world representation of Kochi.

## Data Required

### Road Network

- Junctions
- Road segments
- Road geometry
- Road length
- Number of lanes where available
- Road direction
- Road connectivity

### Traffic Data

Where available:

- Traffic volume
- Peak-hour traffic
- Average speed
- Travel time
- Junction traffic
- Time-dependent traffic patterns

### Additional Information

Where available:

- Road classifications
- Existing bottlenecks
- Major intersections
- Bridges / restricted crossings
- One-way roads
- Important origin-destination areas

## Data Processing

Convert the real-world data into the same graph format used by the synthetic simulator.

```text
Real Kochi Data
      ↓
Data Cleaning
      ↓
Road Network Extraction
      ↓
Graph Construction
      ↓
Attribute Assignment
      ↓
Kochi Traffic Graph
```

## Important Principle

The simulation engine should remain independent of Kochi.

Only the **input dataset** changes.

This allows the same engine to work with:

- Synthetic networks
- Kochi
- Other cities in future work

## Deliverables

- Kochi road-network dataset
- Clean graph representation
- Data preprocessing pipeline
- Kochi graph visualization
- Mapping between real roads and graph edges

---

# Phase 5 — Kochi Simulation & Intervention Analysis

## Goal

Run the validated simulation engine on the Kochi road network and evaluate candidate interventions.

## Process

```text
Kochi Road Graph
       ↓
Baseline Traffic Simulation
       ↓
Identify Bottlenecks
       ↓
Generate Candidate Interventions
       ↓
Widen / Remove / Add Road
       ↓
Run Simulation
       ↓
Compare With Baseline
       ↓
Analyze Results
```

## Analysis

For each candidate intervention, record:

| Intervention  | Avg. Travel Time | Congestion | Throughput | Bottlenecks | Connectivity |
| ------------- | ---------------: | ---------: | ---------: | ----------: | -----------: |
| Baseline      |               — |         — |         — |          — |           — |
| Widen Road A  |               — |         — |         — |          — |           — |
| Widen Road B  |               — |         — |         — |          — |           — |
| Remove Road C |               — |         — |         — |          — |           — |
| Add Road D    |               — |         — |         — |          — |           — |

The values will be obtained from the actual simulation.

## Final Output

Produce:

- Kochi baseline traffic simulation
- Congestion visualization
- Bottleneck identification
- Candidate road interventions
- Before/after comparison
- Quantitative results
- Limitations and assumptions

The project should report **simulated effects of candidate interventions**, rather than presenting the model as a definitive real-world infrastructure decision system.

---

# 5-Week Implementation Timeline

| Week             | Phase   | Main Work                                                     | Expected Output              |
| ---------------- | ------- | ------------------------------------------------------------- | ---------------------------- |
| **Week 1** | Phase 1 | Learn algorithms, define graph model, design architecture     | Graph model + project design |
| **Week 2** | Phase 2 | Build synthetic network and traffic simulator                 | Working simulation engine    |
| **Week 3** | Phase 3 | Implement intervention testing and optimization               | Optimization engine          |
| **Week 4** | Phase 4 | Collect and process Kochi road/traffic data                   | Kochi graph                  |
| **Week 5** | Phase 5 | Run Kochi simulations, analyze interventions, prepare results | Final results + presentation |

---

# Proposed System Architecture

```text
                 ┌───────────────────────┐
                 │      Input Data       │
                 └───────────┬───────────┘
                             │
                ┌────────────┴────────────┐
                │                         │
                ▼                         ▼
        Synthetic Network          Kochi Dataset
                │                         │
                └────────────┬────────────┘
                             ▼
                  ┌─────────────────────┐
                  │   Graph Builder     │
                  └──────────┬──────────┘
                             ▼
                  ┌─────────────────────┐
                  │ Traffic Simulator   │
                  └──────────┬──────────┘
                             ▼
                  ┌─────────────────────┐
                  │ Bottleneck Detector │
                  └──────────┬──────────┘
                             ▼
                  ┌─────────────────────┐
                  │ Intervention Engine │
                  └──────────┬──────────┘
                             ▼
                  ┌─────────────────────┐
                  │ Evaluation Engine   │
                  └──────────┬──────────┘
                             ▼
                  ┌─────────────────────┐
                  │ Results & Visuals   │
                  └─────────────────────┘
```

---

# Core Algorithms to Investigate

## Path Finding

- Dijkstra's algorithm
- Alternative shortest-path methods if required

## Network Flow

- Ford-Fulkerson
- Max-Flow / Min-Cut
- Connectivity analysis

## Graph Analysis

- Degree / weighted degree
- Critical edges
- Connectivity
- Cut edges / bottlenecks

## Optimization

Initially use exhaustive evaluation of candidate interventions.

Later, if time permits, investigate more efficient optimization strategies for larger networks.

---

# Validation Strategy

The project should not jump directly to Kochi.

Validation should happen in stages:

### Test 1 — Tiny Graph

Manually calculate the expected shortest path and traffic distribution.

### Test 2 — Synthetic Network

Generate larger networks and verify that the simulator behaves logically.

### Test 3 — Controlled Bottleneck

Create a network where one road has intentionally low capacity.

Expected behaviour:

- Traffic accumulates around the bottleneck.
- Alternative routes become more attractive.
- Increasing its capacity should reduce congestion.

### Test 4 — Road Removal

Remove a critical edge.

Expected behaviour:

- Traffic reroutes if alternative paths exist.
- Travel time increases if alternatives are worse.
- Network connectivity changes if the edge is a bridge.

### Test 5 — Kochi

Run the same engine without changing the core algorithms.

---

# Project Success Criteria

The project should be considered successful if it can:

- Represent an urban road network as a graph.
- Simulate traffic demand on that graph.
- Model congestion and road capacity.
- Detect important bottlenecks.
- Modify the network programmatically.
- Compare baseline and modified networks.
- Produce measurable improvements or degradations.
- Successfully process a real-world Kochi road network.
- Generate interpretable visualizations and results.

---

# Expected Final Demonstration

The final demonstration should follow this sequence:

```text
1. Create / load a road network
              ↓
2. Generate traffic demand
              ↓
3. Run baseline simulation
              ↓
4. Visualize congestion
              ↓
5. Detect bottlenecks
              ↓
6. Select a candidate intervention
              ↓
7. Modify the road network
              ↓
8. Run simulation again
              ↓
9. Compare before vs after
              ↓
10. Repeat using real Kochi data
```

---

# Relation to the Advanced Graph Algorithm Course

The project directly uses graph concepts covered in the syllabus, including:

- Graphs and applications
- Paths and connectivity
- Weighted graph concepts
- Network flow
- Max-Flow / Min-Cut
- Connectivity analysis
- Graph-based optimization

The syllabus also lists **applications of advanced graph theory in routing and related real-world problems** as suggested project areas. The PBL structure includes project identification, analysis, data collection, simulation/laboratory work, testing, prototyping, and presentations, which align with the planned development process.

---

# Final Project Statement

> **Develop a graph-based urban traffic simulation and optimization engine, validate it using synthetic road networks, and apply it to real-world Kochi traffic and road-network data to evaluate candidate infrastructure interventions such as road widening, road removal, and road addition.**
