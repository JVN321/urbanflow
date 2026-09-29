# Frontend & Simulation Visualization Specification (Person A Focus)

## 1. Overview & Technology Stack
The frontend is a modern, responsive single-page web application built with **React**, **TypeScript**, and **Vite**. It provides an interactive map and graph canvas, allowing users to visualize traffic congestion heatmaps, design infrastructure interventions (widen/close/add roads), run simulations, and analyze before-and-after performance metrics in real-time.

### Stack:
- **Core**: React 18+ (TypeScript), Vite
- **Styling**: Modern CSS / CSS Modules with a custom dark-mode design system (Glassmorphism, vibrant HSL color accents, glowing congestion overlays).
- **Map & Canvas Rendering**: Leaflet with `react-leaflet` (or MapLibre GL) for real-world Kochi maps, plus SVG/Canvas hybrid renderer for synthetic coordinate graphs.
- **Icons & Visuals**: Lucide-react icons, Chart.js / Recharts for metrics & convergence graphs.
- **State Management**: Zustand / lightweight React Context.
- **HTTP Client**: Axios or Fetch with typed schema interfaces.

---

## 2. Design System & Aesthetics Guidelines

### 2.1 Theme & Palette
- **Background**: Deep Navy / Carbon Dark (`#0a0e17`, `#111827`, `#1e293b`)
- **Card Surface**: Glassmorphic translucent dark with border glow (`rgba(30, 41, 59, 0.7)`, `backdrop-filter: blur(12px)`)
- **Text**: Crisp white (`#f8fafc`) and subtle slate (`#94a3b8`)
- **Congestion Heatmap Palette**:
  - Free Flow ($V/C < 0.75$): Emerald Green (`#10b981`, glowing `#34d399`)
  - Moderate ($0.75 \le V/C < 0.95$): Amber Gold (`#f59e0b`)
  - Congested ($0.95 \le V/C \le 1.10$): Orange Coral (`#f97316`)
  - Severe Bottleneck ($V/C > 1.10$): Crimson Red with pulsing glow (`#ef4444`, shadow `#dc2626`)
  - Intervened Roads (Added / Modified): Cyan Blue (`#06b6d4`, `#38bdf8`)

---

## 3. Core UI Layout & Key Views

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  [ UrbanFlow Engine ]   Scenario: [ Kochi Central ▼ ]   Demand: [ Morning Peak ▼ ] [▶ Run] │
├──────────────────────────┬──────────────────────────────────────────┬──────────────────┤
│ 🛠️ Intervention Studio   │ 🗺️ Interactive Traffic Map Canvas         │ 📊 Analytics HUD │
│                          │                                          │                  │
│ • Selected: Road 501     │  (Congestion heatmaps, animated flow,    │ Baseline vs Interv│
│   [Banerji Road]         │   node pins, bridge indicators)          │                  │
│                          │                                          │ Avg Travel Time: │
│ [ ➕ Widen (+1 Lane) ]   │                                          │ 14.8m ➔ 12.1m    │
│ [ 🚫 Close Road      ]   │                                          │ (-18.2% 🟢)      │
│ [ ✏️ Draw New Road   ]   │                                          │                  │
│                          │                                          │ Bottlenecks:     │
│ Active Modifications:    │                                          │ 12 ➔ 4 (-66%)    │
│ 1. Widen Road 501 (3 ln) │                                          │                  │
│ 2. Closed Road 508       │                                          │ 🚨 Braess Alert: │
│                          │                                          │ No paradox detected│
├──────────────────────────┴──────────────────────────────────────────┴──────────────────┤
│ 🎚️ Traffic Volume Multiplier: [───●──────────] 100% (15,400 vehicles/hr)               │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Views & Modes
1. **Synthetic Benchmark View (Braess Paradox Demo)**:
   - Fixed 4-node graph layout with interactive toggle: "Activate Shortcut Road (B-C)".
   - Real-time display showing individual path travel times and total network cost climbing from 65 min to 80 min.
2. **Kochi Geographic Map View**:
   - Leaflet tile layer (CartoDB Dark Matter / OpenStreetMap Dark).
   - Dynamic GeoJSON edge polylines with variable line weight and color matching $V/C$ ratio.
   - Click node/edge to view instant telemetry (speed, capacity, flow).
3. **Intervention Sandbox Mode**:
   - Click any road to open modification popup (Widen / Close / Speed limit).
   - "Add Road" mode: Click origin node, then destination node, specify lane count.
   - Visual badges on modified roads.
4. **Before vs After Diff Mode**:
   - Side-by-side or split-slider view comparing Baseline vs Intervention congestion levels.
   - Delta cards showing green/red indicators for improvements vs degradation.

---

## 4. Frontend Component Hierarchy

```
frontend/
├── src/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Navbar.tsx             # Scenario selector, Run CTA, status badge
│   │   │   └── MainLayout.tsx         # Responsive 3-pane grid container
│   │   ├── map/
│   │   │   ├── TrafficMap.tsx         # Leaflet map container & tile engine
│   │   │   ├── EdgePolyline.tsx       # Color-coded road segment with hover tooltips
│   │   │   ├── NodeMarker.tsx         # Intersection marker with label
│   │   │   ├── SyntheticCanvas.tsx    # 2D Canvas/SVG renderer for Braess & Grid graphs
│   │   │   └── RoadDrawingTool.tsx    # Interactive line tool to connect nodes
│   │   ├── intervention/
│   │   │   ├── InterventionPanel.tsx  # Active modification list and controls
│   │   │   ├── RoadEditorModal.tsx    # Modal to change lanes/capacity
│   │   │   └── InterventionSummary.tsx# Action pills (e.g., "Widen Edge #501")
│   │   ├── analytics/
│   │   │   ├── MetricsHUD.tsx         # Top-level metric cards (Travel time, V/C)
│   │   │   ├── BottleneckList.tsx     # Ranked critical road table
│   │   │   ├── BraessIndicator.tsx    # Warning banner when intervention worsens travel time
│   │   │   └── TravelTimeChart.tsx    # Bar/Line chart comparing baseline vs intervention
│   │   └── common/
│   │       ├── Button.tsx
│   │       ├── Slider.tsx
│   │       └── Card.tsx
│   ├── hooks/
│   │   ├── useSimulation.ts           # Trigger simulation, manage loading & run results
│   │   ├── useGraphData.ts            # Fetch graph topologies and OD demands
│   │   └── useInterventions.ts        # Manage staged modifications (add/widen/close)
│   ├── services/
│   │   ├── api.ts                     # Axios client targeting backend / mock endpoints
│   │   └── mockData.ts                # Built-in fallback fixtures for offline/mock dev
│   ├── types/
│   │   └── index.ts                   # TypeScript definitions mirroring backend schemas
│   ├── App.tsx
│   ├── index.css                      # Core design system tokens & glassmorphic classes
│   └── main.tsx
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 5. Offline / Mock Mode for Independent Development

Person A can develop the entire UI with full interactivity before Person B completes the backend. 
In `src/services/api.ts`, a configuration toggle (`USE_MOCK_DATA = true`) allows the frontend to serve instant mock simulation responses for:
- Braess 4-node network
- 3x3 Grid synthetic network
- Kochi sample road network
