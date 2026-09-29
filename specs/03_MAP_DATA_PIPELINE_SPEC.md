# Map & Geographic Data Pipeline Specification (Person A Focus)

## 1. Overview
This specification defines the pipeline for extracting, cleaning, and transforming the real-world road network of **Kochi, Kerala** into the graph format required by the UrbanFlow simulation engine, as well as generating standardized synthetic benchmark networks.

---

## 2. Kochi Road Network Scope & Geographic Area

### 2.1 Geographic Bounding Box
- **City**: Kochi (Cochin), Kerala, India
- **Key Intersections & Corridors**:
  - Edappally Bypass Junction (NH 66 / NH 544 intersection)
  - Palarivattom Junction
  - Vyttila Mobility Hub Junction (Busiest intersection in Kerala)
  - MG Road (Mahatma Gandhi Road - Central Business District)
  - Banerji Road & High Court / Menaka Junction
  - Kundannoor Junction
  - SA Road (South Railway Station to Vyttila)
- **Bounding Box Coordinates (EPSG:4326)**:
  - South Latitude: `9.9200`
  - North Latitude: `10.0400`
  - West Longitude: `76.2600`
  - East Longitude: `76.3600`

```
   [10.0400, 76.2600] ────────────────────── [10.0400, 76.3600]
           │                                          │
           │        (Edappally / Palarivattom)        │
           │                                          │
           │        (MG Road / Marine Drive)          │
           │                                          │
           │        (Vyttila Hub / Kundannoor)        │
           │                                          │
   [9.9200, 76.2600]  ────────────────────── [9.9200, 76.3600]
```

---

## 3. Data Extraction & Preprocessing Pipeline

### 3.1 Extraction using OSMnx / Overpass API
A standalone Python script `scripts/extract_kochi_network.py` will extract the road graph from OpenStreetMap:

```python
import osmnx as ox

# Configure OSMnx
ox.settings.use_cache = True
ox.settings.log_console = True

# Download drivable road network
place_query = "Kochi, Kerala, India"
# Alternatively use bounding box
G = ox.graph_from_bbox(
    north=10.0400, south=9.9200, east=76.3600, west=76.2600,
    network_type="drive",
    simplify=True
)

# Consolidate close intersections (eliminate micro-junctions within 15 meters)
G_proj = ox.project_graph(G)
G_clean = ox.consolidate_intersections(G_proj, tolerance=15, rebuild_graph=True)
G_final = ox.project_graph(G_clean, to_crs="EPSG:4326")
```

### 3.2 Imputing Missing Attributes (Indian Urban Road Standards - IRC 106)
OpenStreetMap often lacks explicit lane counts or capacities. The pipeline will apply deterministic rules based on road classification (`highway` tag):

| Highway Tag | Inferred Lanes (per dir) | Free-Flow Speed ($v_{free}$) | Capacity ($c_e$ vph/dir) |
|---|---|---|---|
| `trunk` / `motorway` | 3 | 70 km/h | 2,700 vph |
| `primary` | 2 | 50 km/h | 1,800 vph |
| `secondary` | 2 | 40 km/h | 1,400 vph |
| `tertiary` | 1 | 30 km/h | 900 vph |
| `residential` / `unclassified` | 1 | 25 km/h | 600 vph |

### 3.3 Graph Serialization Output
The pipeline produces:
1. `data/processed/kochi_graph.json`: Fully compliant with `UrbanFlowGraph` schema.
2. `data/processed/kochi_network.geojson`: GeoJSON FeatureCollection of LineStrings for instant rendering in MapLibre/Leaflet.
3. `data/processed/kochi_od_matrix.json`: Estimated Origin-Destination matrix reflecting morning rush hour (Suburbs $\rightarrow$ Central Kochi).

---

## 4. Synthetic Network Specifications

To support Phase 2 and 3 validation, three synthetic network files are maintained in `data/synthetic/`:

### 4.1 Braess Paradox Benchmark (`data/synthetic/braess_network.json`)
- **Nodes**:
  - `A` (Origin: [0, 0])
  - `B` (Upper junction: [5, 3])
  - `C` (Lower junction: [5, -3])
  - `D` (Destination: [10, 0])
- **Edges**:
  - `e_AB`: Length = 5km, $v_{free}=60$, Capacity = 1000 vph, travel cost $t(v) = v/100$
  - `e_BD`: Fixed travel cost $t(v) = 45$ mins
  - `e_AC`: Fixed travel cost $t(v) = 45$ mins
  - `e_CD`: Length = 5km, travel cost $t(v) = v/100$
  - `e_BC` (Optional Shortcut Edge): Length = 0.5km, $t \approx 0$.
- **Demand**: 4000 vph from Node A to Node D.

### 4.2 3x3 Grid Network (`data/synthetic/grid_3x3_network.json`)
- 9 nodes arranged in a $3 \times 3$ Cartesian coordinate grid.
- 24 directed edges representing two-way grid streets.
- Demonstrates distributed routing, alternate bypass paths, and localized gridlock.

### 4.3 Bottleneck Bridge Network (`data/synthetic/bottleneck_bridge_network.json`)
- Two 4-node clusters ("West Bank" and "East Bank") joined solely by a single 2-lane bridge edge.
- Demonstrates $V/C > 1.30$ bottleneck formation and evaluates intervention of adding a second bridge or widening the existing one.
