# Abstract — Urban Traffic Graph Optimization Engine

## Abstract

Urban traffic congestion is a complex network optimization problem in which changes to one road can affect traffic throughout an entire road network. This project proposes a graph-based **Urban Traffic Graph Optimization Engine** for modelling, simulating, and evaluating traffic networks. The road network is represented as a weighted graph in which junctions are vertices and road segments are edges with attributes such as travel time, capacity, and traffic volume.

The project will first develop a simulation engine using synthetic road networks. This controlled environment will be used to implement and validate graph algorithms for shortest paths, connectivity, network flow, bottleneck detection, and traffic assignment. The system will then be extended with an intervention engine capable of testing changes such as road widening, road removal or closure, and addition of new roads. Each intervention will be evaluated by comparing measurable network properties such as travel time, congestion, throughput, and connectivity before and after the modification.

A central concept investigated in the project is the **Braess Paradox**, a counterintuitive phenomenon in traffic networks where adding a new road can increase overall travel time because individual route choices change the distribution of traffic. This demonstrates why improving a single road does not necessarily improve the performance of the entire network. The project therefore focuses on **network-level optimization rather than optimizing individual roads in isolation**. Road additions, widenings, and removals can all be treated as candidate interventions and evaluated through simulation.

After validation on synthetic networks, the same engine will be applied to real-world road-network and traffic data from **Kochi, Kerala**. The Kochi data will be converted into the same graph representation used by the simulator, allowing the algorithms to identify bottlenecks and evaluate candidate infrastructure interventions. The final system will provide quantitative before-and-after comparisons and visualizations of the simulated traffic network.

The project combines advanced graph algorithms, simulation, data analysis, and real-world transportation data to demonstrate how graph-theoretic methods can be used to study urban traffic networks and evaluate infrastructure changes. The resulting system is intended as a simulation and decision-support prototype; its results represent modelled effects and would require additional traffic engineering, safety, economic, land-use, and regulatory analysis before being used for real infrastructure decisions.

---

# Core Concept — Braess Paradox

## What is the Braess Paradox?

The **Braess Paradox** is a phenomenon in traffic networks where **adding a new road can make the overall traffic situation worse**.

At first this seems impossible:

> More roads → more capacity → less congestion

But that assumption ignores how drivers choose routes.

Drivers generally select routes based on their own perceived travel cost. When a new road creates a seemingly attractive shortcut, many drivers may switch to it. The resulting redistribution of traffic can cause congestion on roads that were previously less congested.

As a result:

```text
Original network
       ↓
Drivers choose routes
       ↓
Traffic reaches equilibrium
       ↓
Add a new road
       ↓
Drivers change routes
       ↓
Traffic distribution changes
       ↓
Congestion can increase
       ↓
Overall travel time can become worse
```

## Why It Matters to Our Project

This is directly relevant to the project's main question:

> **Should changing a road necessarily improve the traffic network?**

The answer is not always yes.

Our engine therefore should not assume:

- Wider road = better traffic
- New road = better traffic
- Removing a road = worse traffic

Instead, every intervention should be treated as a **hypothesis that must be tested through simulation**.

### Example

Suppose the network initially has:

```text
A ───── B ───── D
 \             //
  \           //
   C ─────────
```

Drivers distribute themselves between the available routes.

Now suppose we add a new shortcut:

```text
A ───── B ───── D
 \      │      //
  \     │     //
   C ────┴────
```

The shortcut may appear to be beneficial because it provides a faster local connection.

However, if many drivers select it, the roads feeding into and leaving the shortcut can become congested. The resulting equilibrium can have a **higher total travel time** than the original network.

The important point is that the effect emerges from the **interaction between individual route choices and the network structure**.

---

# How We Use Braess Paradox in the Project

Braess Paradox should be used as a **core motivation and validation concept**, rather than claiming that every Kochi intervention will exhibit it.

## Step 1 — Reproduce a Known Paradox

Build a small synthetic network specifically designed to demonstrate Braess Paradox.

The simulation should show:

1. Traffic distribution before the new road.
2. Addition of the new road.
3. Route redistribution.
4. New traffic equilibrium.
5. Comparison of total/average travel time.

This gives us a controlled experiment demonstrating that the simulator can reproduce a known graph/traffic phenomenon.

## Step 2 — Generalize the Idea

After validating the paradox, the engine should test arbitrary interventions:

```text
             Candidate intervention
                      ↓
          ┌───────────┴───────────┐
          ↓                       ↓
     Add / widen              Remove / close
          ↓                       ↓
          └───────────┬───────────┘
                      ↓
                Run simulation
                      ↓
                Measure metrics
                      ↓
                Compare baseline
```

This allows us to discover whether a particular intervention:

- Improves the network
- Has little effect
- Creates new bottlenecks
- Increases overall congestion
- Changes network connectivity

## Step 3 — Apply the Same Principle to Kochi

Once the simulator is validated, the Kochi network becomes another graph input.

For each candidate road modification:

```text
Kochi baseline
      ↓
Simulate
      ↓
Modify network
      ↓
Simulate again
      ↓
Compare
```

The important principle is:

> **We do not assume that adding infrastructure improves the network. We measure the network-level effect.**

---

# Main Research Question

A suitable central research question for the project is:

> **How can advanced graph algorithms and traffic simulation be used to evaluate the network-level effects of road-network interventions in an urban environment?**

A more Braess-focused version is:

> **Can a graph-based traffic simulation engine identify cases where changes to individual roads produce unexpected effects on overall network performance?**

---

# Key Hypothesis

The project can investigate the hypothesis that:

> **The effect of a road intervention depends on the structure and traffic distribution of the entire network, and therefore cannot always be predicted from the local properties of the modified road alone.**

Braess Paradox provides a well-known theoretical example supporting the motivation for investigating this hypothesis.

---

# Project Flow

```text
Advanced Graph Algorithms
          ↓
   Graph Representation
          ↓
 Synthetic Traffic Network
          ↓
   Traffic Simulator
          ↓
  Braess Paradox Test
          ↓
 Intervention Engine
          ↓
 Validation Experiments
          ↓
    Kochi Road Data
          ↓
  Kochi Graph Network
          ↓
 Baseline Simulation
          ↓
 Intervention Analysis
          ↓
 Before / After Results
```

## Keywords

**Graph Theory, Traffic Simulation, Urban Traffic Optimization, Braess Paradox, Network Flow, Shortest Path, Graph Connectivity, Bottleneck Detection, Traffic Assignment, Kochi, Road Network Optimization**
