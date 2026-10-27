import matplotlib.pyplot as plt
import matplotlib.patches as patches

# Clean typography
plt.rcParams['font.sans-serif'] = 'DejaVu Sans'
plt.rcParams['font.family'] = 'sans-serif'
plt.rcParams['figure.autolayout'] = False

# -----------------------------------------------------------------------------
# 1. HIGH-LEVEL ARCHITECTURE (SIMPLE UML / MERMAID STYLE BLOCK DIAGRAM)
# -----------------------------------------------------------------------------
def generate_high_level_architecture():
    # Width x Height: 10.5 x 5.8 inches, tight bounds, no top title banner
    fig, ax = plt.subplots(figsize=(10.5, 5.6), dpi=300)
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 72)
    ax.axis('off')
    fig.patch.set_facecolor('#ffffff')

    # Styling: Clean Mermaid / UML style
    # Neutral slate / soft steel blue palette
    box_border = '#334155'
    header_fill = '#f1f5f9'
    header_border = '#64748b'
    body_fill = '#ffffff'
    text_dark = '#0f172a'
    text_muted = '#334155'

    stages = [
        {
            "num": "1",
            "title": "Geospatial Data Ingestion",
            "items": [
                "• OpenStreetMap (OSM) via OSMnx",
                "• Junction node clustering (< 15m)",
                "• Anti-parallel directed edge expansion",
                "• IRC:106 highway capacity imputation"
            ],
            "x": 3, "y": 48, "w": 44, "h": 22
        },
        {
            "num": "2",
            "title": "Traffic Demand Generation",
            "items": [
                "• 14 Origin-Destination arterial corridors",
                "• 100% Baseline Demand (27,300 vph)",
                "• 200% Congestion Surge (54,600 vph)",
                "• Initial all-or-nothing trip assignment"
            ],
            "x": 53, "y": 48, "w": 44, "h": 22
        },
        {
            "num": "3",
            "title": "Equilibrium Assignment Engine",
            "items": [
                r"• BPR Delay: $t_e = t_e^0 [1 + 0.15(x_e/C_e)^4]$",
                r"• Min-Heap Dijkstra: $O(|E| + |V|\log|V|)$",
                r"• MSA Flow Update: $x^{(k+1)} = (1 - \frac{1}{k+1})x^{(k)} + \frac{1}{k+1}y$",
                r"• Wardropian user equilibrium ($\leq 30$ iters)"
            ],
            "x": 3, "y": 24, "w": 44, "h": 22
        },
        {
            "num": "4",
            "title": "Congestion & Bottleneck Analysis",
            "items": [
                r"• Volume-to-Capacity ($V/C \geq 0.95$) evaluation",
                "• Queue spillback & delay identification",
                "• Detection of Braess Paradox shortcuts",
                "• Pinch-point ranking (MG Rd, Banerji Rd)"
            ],
            "x": 53, "y": 24, "w": 44, "h": 22
        },
        {
            "num": "5",
            "title": "Combinatorial Network Optimizer",
            "items": [
                "• One-way street conversion evaluator",
                "• Arterial road lane widening (+1 lane)",
                "• Sub-second re-simulation (< 250 ms)",
                "• Multi-intervention synergistic ranking"
            ],
            "x": 3, "y": 0, "w": 44, "h": 22
        },
        {
            "num": "6",
            "title": "GIS Visualization & Policy Output",
            "items": [
                "• Interactive React 18 + MapLibre Web GIS",
                "• Real-time link congestion color styling",
                "• Before / after scenario comparison metrics",
                "• Municipal infrastructure action reports"
            ],
            "x": 53, "y": 0, "w": 44, "h": 22
        }
    ]

    for s in stages:
        # Outer Box
        rect = patches.FancyBboxPatch((s["x"], s["y"]), s["w"], s["h"],
                                     boxstyle="round,pad=0.5,rounding_size=1.0",
                                     facecolor=body_fill, edgecolor=box_border, linewidth=1.2)
        ax.add_patch(rect)

        # Header Box
        header_rect = patches.FancyBboxPatch((s["x"], s["y"] + s["h"] - 5.0), s["w"], 5.0,
                                             boxstyle="round,pad=0.5,rounding_size=0.8",
                                             facecolor=header_fill, edgecolor=header_border, linewidth=1.0)
        ax.add_patch(header_rect)

        # Header Text
        ax.text(s["x"] + s["w"]/2, s["y"] + s["h"] - 2.5, f"Stage {s['num']}: {s['title']}",
                ha='center', va='center', fontsize=9.2, fontweight='bold', color=text_dark)

        # Items
        for idx, item in enumerate(s["items"]):
            ax.text(s["x"] + 2.0, s["y"] + s["h"] - 8.2 - (idx * 3.8), item,
                    ha='left', va='center', fontsize=8.0, color=text_muted)

    # Clean connecting arrows (UML / Mermaid sequence)
    arrow_props = dict(arrowstyle="-|>", color="#1e293b", lw=1.5, mutation_scale=12)

    # 1 -> 2
    ax.annotate("", xy=(53, 59), xytext=(47, 59), arrowprops=arrow_props)
    # 1 -> 3
    ax.annotate("", xy=(25, 46), xytext=(25, 48), arrowprops=arrow_props)
    # 2 -> 4
    ax.annotate("", xy=(75, 46), xytext=(75, 48), arrowprops=arrow_props)
    # 3 -> 4
    ax.annotate("", xy=(53, 35), xytext=(47, 35), arrowprops=arrow_props)
    # 4 -> 5
    ax.annotate("", xy=(47, 11), xytext=(53, 24),
                arrowprops=dict(arrowstyle="-|>", color="#1e293b", lw=1.5, mutation_scale=12,
                                connectionstyle="angle,angleA=0,angleB=90,rad=3"))
    # 5 -> 6
    ax.annotate("", xy=(53, 11), xytext=(47, 11), arrowprops=arrow_props)

    plt.tight_layout()
    plt.savefig('report/figures/high_level_system_architecture.pdf', bbox_inches='tight')
    plt.savefig('report/figures/high_level_system_architecture.png', bbox_inches='tight')
    plt.close()
    print("Generated clean simple high_level_system_architecture.pdf and png")

# -----------------------------------------------------------------------------
# 2. TECHNICAL / IMPLEMENTATION ARCHITECTURE (SIMPLE UML COMPONENT DIAGRAM)
# -----------------------------------------------------------------------------
def generate_technical_architecture():
    # Width x Height: 10.5 x 5.8 inches, tight bounds, no top title banner
    fig, ax = plt.subplots(figsize=(10.5, 5.8), dpi=300)
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 72)
    ax.axis('off')
    fig.patch.set_facecolor('#ffffff')

    tiers = [
        {
            "name": "Frontend Presentation Layer (Web GIS Dashboard)",
            "y": 55, "h": 16.5,
            "components": [
                ("React 18 & TypeScript", "UI Component Hierarchy\nType-safe state model", 4, 21),
                ("MapLibre GL JS", "WebGL GPU Map Rendering\nVector tile zoom & pan", 28, 21),
                ("Zustand State Store", "Reactive scenario state\nDemand multiplier toggle", 52, 21),
                ("Deck.gl / HTML5 Canvas", "Link congestion coloring\nDynamic flow heatmaps", 76, 20)
            ]
        },
        {
            "name": "API Gateway & Communication Layer (FastAPI)",
            "y": 37, "h": 16.5,
            "components": [
                ("FastAPI Framework", "Asynchronous Python 3.11\nUvicorn ASGI HTTP Server", 4, 21),
                ("Pydantic Schemas", "Request parameter validation\nResponse serialization", 28, 21),
                ("REST Endpoints", "/api/simulate, /api/optimize\n/api/bottlenecks, /api/network", 52, 21),
                ("CORS & Serialization", "Fast JSON serialization\nBinary GeoJSON payloads", 76, 20)
            ]
        },
        {
            "name": "Core Simulation & Optimization Engine",
            "y": 19, "h": 16.5,
            "components": [
                ("Vectorized BPR Evaluator", "NumPy array computation\nt_e = t_e^0[1 + 0.15(x_e/C_e)^4]", 4, 21),
                ("Rustworkx Shortest Path", "Rust-accelerated min-heap\nDijkstra all-pairs routing", 28, 21),
                ("MSA Convergence Loop", "Successive flow averaging\nx^(k+1) = (1 - 1/k)x + 1/k y", 52, 21),
                ("Combinatorial Optimizer", "DNDP heuristic evaluator\nOne-way & lane widening tests", 76, 20)
            ]
        },
        {
            "name": "Geospatial Data & Storage Layer",
            "y": 1, "h": 16.5,
            "components": [
                ("OpenStreetMap (OSM)", "Raw drivable road network\nvia Overpass API query", 4, 21),
                ("OSMnx Graph Ingestion", "Topological graph parsing\nNode merging (< 15m)", 28, 21),
                ("GraphML / GeoJSON Cache", "Precomputed Kochi graph\n490 vertices, 1,200 edges", 52, 21),
                ("IRC:106 Standards Lookup", "Highway capacity rules\n900 to 1,800 vph/lane", 76, 20)
            ]
        }
    ]

    for t in tiers:
        # Tier boundary container (UML Package / Frame)
        rect = patches.FancyBboxPatch((2, t["y"]), 96, t["h"],
                                     boxstyle="round,pad=0.4,rounding_size=0.8",
                                     facecolor="#f8fafc", edgecolor="#475569", linewidth=1.2)
        ax.add_patch(rect)

        # Tier Name Banner (Top-left tab)
        ax.text(3.8, t["y"] + t["h"] - 2.2, t["name"],
                ha='left', va='center', fontsize=8.8, fontweight='bold', color='#1e293b')

        # Sub-components (Simple clean UML boxes)
        for title, desc, cx, cw in t["components"]:
            c_rect = patches.FancyBboxPatch((cx, t["y"] + 1.8), cw, t["h"] - 5.0,
                                           boxstyle="round,pad=0.3,rounding_size=0.6",
                                           facecolor='#ffffff', edgecolor='#94a3b8', linewidth=1.0)
            ax.add_patch(c_rect)
            ax.text(cx + cw/2, t["y"] + t["h"] - 4.5, title,
                    ha='center', va='center', fontsize=7.8, fontweight='bold', color='#0f172a')
            ax.text(cx + cw/2, t["y"] + 4.8, desc,
                    ha='center', va='center', fontsize=6.8, color='#475569', multialignment='center')

    # Bidirectional inter-tier arrows (UML communication flow)
    arrow_props = dict(arrowstyle="<|-|>", color="#1e293b", lw=1.3, mutation_scale=10)

    # Tier 1 <-> Tier 2
    ax.annotate("", xy=(22, 55), xytext=(22, 53.5), arrowprops=arrow_props)
    ax.annotate("", xy=(78, 55), xytext=(78, 53.5), arrowprops=arrow_props)
    ax.text(23, 54.2, "HTTP / JSON", ha='left', va='center', fontsize=7.0, color='#1e293b')
    ax.text(79, 54.2, "GeoJSON / Metrics", ha='left', va='center', fontsize=7.0, color='#1e293b')

    # Tier 2 <-> Tier 3
    ax.annotate("", xy=(36, 37), xytext=(36, 35.5), arrowprops=arrow_props)
    ax.annotate("", xy=(64, 37), xytext=(64, 35.5), arrowprops=arrow_props)
    ax.text(37, 36.2, "Invoke Sim", ha='left', va='center', fontsize=7.0, color='#1e293b')
    ax.text(65, 36.2, "Equilibrium Flows", ha='left', va='center', fontsize=7.0, color='#1e293b')

    # Tier 3 <-> Tier 4
    ax.annotate("", xy=(50, 19), xytext=(50, 17.5), arrowprops=arrow_props)
    ax.text(51, 18.2, "Load Network GraphML & IRC Specs", ha='left', va='center', fontsize=7.0, color='#1e293b')

    plt.tight_layout()
    plt.savefig('report/figures/implementation_technical_architecture.pdf', bbox_inches='tight')
    plt.savefig('report/figures/implementation_technical_architecture.png', bbox_inches='tight')
    plt.close()
    print("Generated clean simple implementation_technical_architecture.pdf and png")

if __name__ == '__main__':
    generate_high_level_architecture()
    generate_technical_architecture()
