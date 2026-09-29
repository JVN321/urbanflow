import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  Layers,
  Play,
  RotateCcw,
  Sliders,
  Zap,
  Plus,
  Ban,
  LocateFixed,
  Map as MapIcon,
  Route,
  CircleDot
} from 'lucide-react';
import {
  evaluateIntervention,
  fetchGraph,
  analyzeArea,
  startOptimizationStream,
  SimulationProgressEvent,
  startSimulationStream
} from './services/api';
import {
  GraphEdge,
  InterventionAction,
  InterventionReport,
  OptimizationResult,
  SimulationConfig,
  SimulationResult,
  UrbanFlowGraph
} from './types';
import 'leaflet/dist/leaflet.css';

const TILE_URL = import.meta.env.VITE_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

function edgeColor(vc: number, closed = false, widened = false) {
  if (closed) return '#94a3b8';
  if (widened) return '#2563eb';
  if (vc >= 0.95) return '#dc2626';
  if (vc >= 0.75) return '#d97706';
  return '#059669';
}

function edgePath(graph: UrbanFlowGraph, edge: GraphEdge): L.LatLngExpression[] {
  if (edge.geometry?.length) return edge.geometry.map(([lng, lat]) => [lat, lng]);
  const source = graph.nodes.find((node) => node.id === edge.source);
  const target = graph.nodes.find((node) => node.id === edge.target);
  return source && target ? [[source.lat, source.lng], [target.lat, target.lng]] : [];
}

export default function App() {
  const [selectedScenario, setSelectedScenario] = useState<string>('kochi_central');
  const [graph, setGraph] = useState<UrbanFlowGraph | null>(null);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [baselineSimulation, setBaselineSimulation] = useState<SimulationResult | null>(null);
  const [progress, setProgress] = useState<SimulationProgressEvent | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [interventions, setInterventions] = useState<InterventionAction[]>([]);
  const [report, setReport] = useState<InterventionReport | null>(null);
  const [optimization, setOptimization] = useState<OptimizationResult | null>(null);
  const [discoveredRecommendations, setDiscoveredRecommendations] = useState<OptimizationResult['recommendations']>([]);
  const [optimizationProgress, setOptimizationProgress] = useState({ current: 0, total: 0 });

  // Map & Visual States
  const [showNames, setShowNames] = useState(true);
  const [showNodes, setShowNodes] = useState(true);
  const [showBasemap, setShowBasemap] = useState(true);
  const [showFlow, setShowFlow] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [areaMode, setAreaMode] = useState(false);
  const [areaId, setAreaId] = useState<string | null>(null);
  const [demandMultiplier, setDemandMultiplier] = useState(1.0);
  const [roadDensity, setRoadDensity] = useState(1.0);
  const [config, setConfig] = useState<SimulationConfig>({
    algorithm: 'msa',
    max_iterations: 30,
    convergence_tolerance: 0.001,
    default_alpha: 0.15,
    default_beta: 4.0,
    cost_model: 'bpr'
  });
  const [loading, setLoading] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queryStatus, setQueryStatus] = useState<{ type: 'loading' | 'success'; message: string } | null>(null);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const layerGroup = useRef<L.LayerGroup | null>(null);
  const flowLayerGroup = useRef<L.LayerGroup | null>(null);
  const tileLayer = useRef<L.TileLayer | null>(null);
  const stopStream = useRef<(() => void) | null>(null);
  const stopOptimizer = useRef<(() => void) | null>(null);
  const areaRect = useRef<L.Rectangle | null>(null);
  const lastGraphId = useRef<string | null>(null);

  const isSynthetic = ['braess_4node', 'expanded_8node', 'grid_3x3', 'bottleneck_bridge'].includes(selectedScenario);

  const runLiveSimulation = (graphId: string, nextConfig = config) => {
    stopStream.current?.();
    setLoading(true);
    setProgress(null);
    setError(null);
    stopStream.current = startSimulationStream(
      graphId,
      demandMultiplier,
      nextConfig,
      (event) => setProgress(event),
      (result) => {
        setSimulation(result);
        setBaselineSimulation((prev) => prev ?? result);
        setLoading(false);
        setProgress(null);
      },
      (streamError) => {
        setError(streamError.message);
        setLoading(false);
      }
    );
  };

  const handleScenarioChange = (scenarioId: string) => {
    if (scenarioId === 'custom_square') {
      setAreaMode(true);
      setShowBasemap(true);
      return;
    }
    setAreaMode(false);
    setSelectedScenario(scenarioId);
    if (scenarioId.startsWith('braess') || scenarioId === 'grid_3x3' || scenarioId === 'bottleneck_bridge') {
      setShowBasemap(false);
    } else {
      setShowBasemap(true);
    }
  };

  useEffect(() => {
    let active = true;
    setGraph(null);
    setSimulation(null);
    setBaselineSimulation(null);
    setInterventions([]);
    setReport(null);
    setOptimization(null);
    setDiscoveredRecommendations([]);
    setAreaId(null);

    fetchGraph(selectedScenario)
      .then((data) => {
        if (!active) return;
        setGraph(data);
        runLiveSimulation(data.graph_id);
      })
      .catch((loadError: Error) => active && setError(loadError.message));

    return () => {
      active = false;
      stopStream.current?.();
    };
  }, [selectedScenario]);

  // Leaflet Map Initialization with Native Smooth Dragging & Zooming
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const map = L.map(mapRef.current, {
      zoomControl: true,
      preferCanvas: true,
      attributionControl: true,
      dragging: true,
      scrollWheelZoom: true,
      touchZoom: true,
      doubleClickZoom: true
    }).setView([9.9816, 76.2999], 13);

    mapInstance.current = map;
    layerGroup.current = L.layerGroup().addTo(map);
    flowLayerGroup.current = L.layerGroup().addTo(map);

    requestAnimationFrame(() => map.invalidateSize());

    return () => {
      map.off();
      map.remove();
      mapInstance.current = null;
      layerGroup.current = null;
    };
  }, []);

  // Custom Bounding Box Area Selection (Only active when areaMode is toggled on)
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    if (areaMode) {
      map.dragging.disable();
      map.scrollWheelZoom.disable();
    } else {
      map.dragging.enable();
      map.scrollWheelZoom.enable();
    }

    const onMouseDown = (event: L.LeafletMouseEvent) => {
      if (!areaMode) return;
      event.originalEvent.preventDefault();
      event.originalEvent.stopPropagation();
      const start = event.latlng;

      const move = (moveEvent: L.LeafletMouseEvent) => {
        areaRect.current?.remove();
        areaRect.current = L.rectangle(L.latLngBounds(start, moveEvent.latlng), {
          color: '#0f172a',
          weight: 2,
          fillOpacity: 0.12,
          dashArray: '4,4'
        }).addTo(map);
      };

      const end = async (endEvent: L.LeafletMouseEvent) => {
        map.off('mousemove', move);
        map.off('mouseup', end);
        const bounds = L.latLngBounds(start, endEvent.latlng);
        if (bounds.getNorthEast().equals(bounds.getSouthWest())) return;

        try {
          setLoading(true);
          setError(null);
          setQueryStatus({
            type: 'loading',
            message: `Extracting road network for bounds [${bounds.getSouth().toFixed(3)}, ${bounds.getWest().toFixed(3)} ➔ ${bounds.getNorth().toFixed(3)}, ${bounds.getEast().toFixed(3)}]...`
          });

          const analyzed = await analyzeArea({
            graph_id: graph?.graph_id || selectedScenario,
            min_lat: bounds.getSouth(),
            min_lng: bounds.getWest(),
            max_lat: bounds.getNorth(),
            max_lng: bounds.getEast(),
            demand_multiplier: demandMultiplier,
            road_density: roadDensity,
            config,
            fetch_osm: true
          });

          setAreaId(analyzed.area_id);
          setGraph(analyzed.graph);
          setSimulation(analyzed.result);
          setBaselineSimulation(analyzed.result);
          setAreaMode(false);
          map.dragging.enable();
          map.scrollWheelZoom.enable();

          setQueryStatus({
            type: 'success',
            message: `Extracted ${analyzed.graph.edges.length} road links & ${analyzed.graph.nodes.length} intersections (${analyzed.result.summary_metrics.avg_travel_time_mins} min avg trip).`
          });
          setTimeout(() => setQueryStatus(null), 4500);

          const newBounds = L.latLngBounds(analyzed.graph.nodes.map((n) => [n.lat, n.lng]));
          if (newBounds.isValid()) {
            map.fitBounds(newBounds.pad(0.08), { maxZoom: 16 });
          }
        } catch (analysisError) {
          setError((analysisError as Error).message);
          setQueryStatus(null);
          setAreaMode(false);
          map.dragging.enable();
          map.scrollWheelZoom.enable();
        } finally {
          setLoading(false);
        }
      };

      map.on('mousemove', move);
      map.on('mouseup', end);
    };

    map.on('mousedown', onMouseDown);
    return () => {
      map.off('mousedown', onMouseDown);
      map.dragging.enable();
      map.scrollWheelZoom.enable();
    };
  }, [areaMode, selectedScenario, demandMultiplier, roadDensity, config, graph?.graph_id]);

  // Basemap Toggle
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    if (showBasemap) {
      if (!tileLayer.current) {
        tileLayer.current = L.tileLayer(TILE_URL, {
          maxZoom: 19,
          attribution: import.meta.env.VITE_MAP_ATTRIBUTION || '&copy; OpenStreetMap contributors'
        }).addTo(map);
      }
    } else {
      tileLayer.current?.remove();
      tileLayer.current = null;
    }
  }, [showBasemap]);

  // Render Vector Network, Directional Flows, and On-Graph Badges
  useEffect(() => {
    const map = mapInstance.current;
    const layers = layerGroup.current;
    if (!map || !layers || !graph) return;

    layers.clearLayers();
    const bounds = L.latLngBounds([]);

    graph.nodes.forEach((node) => bounds.extend([node.lat, node.lng]));

    const recommendations = optimization?.recommendations || discoveredRecommendations;
    const recMap = new Map(recommendations.map((r) => [r.edge_id, r]));

    graph.edges.forEach((edge) => {
      const points = edgePath(graph, edge);
      if (points.length < 2) return;
      points.forEach((point) => bounds.extend(point));

      const metric = simulation?.edge_metrics[edge.id];
      const baseMetric = baselineSimulation?.edge_metrics[edge.id];
      const volume = metric?.volume_vph ?? progress?.edge_volumes[edge.id] ?? 0;
      const edgeActions = interventions.filter((action) => action.edge_id === edge.id);
      const closed = edgeActions.length > 0 && edgeActions[edgeActions.length - 1].action === 'CLOSE';
      const widened = interventions.some((action) => action.action === 'WIDEN' && action.edge_id === edge.id);
      const vc = metric?.vc_ratio ?? volume / Math.max(edge.capacity_vph, 1);
      const recommendation = recMap.get(edge.id);

      const currentTimeMins = metric ? metric.congested_time_sec / 60 : 0;
      const baseTimeMins = baseMetric ? baseMetric.congested_time_sec / 60 : currentTimeMins;
      const timeSavedMins = baseTimeMins - currentTimeMins;

      // Highlighted stroke style
      let strokeColor = edgeColor(vc, closed, widened);
      let strokeWidth = Math.max(3.5, Math.min(8.5, (edge.lanes || 1) * 1.8 + 1));
      let strokeDashArray: string | undefined = undefined;
      let strokeOpacity = 0.88;

      if (closed) {
        strokeColor = '#dc2626';
        strokeWidth = 6;
        strokeDashArray = '6 6';
        strokeOpacity = 0.85;
      } else if (widened) {
        strokeColor = '#2563eb';
        strokeWidth = 9;
        strokeOpacity = 0.95;
      }

      if (selectedEdgeId === edge.id) {
        strokeWidth = 9;
        strokeColor = closed ? '#dc2626' : (widened ? '#2563eb' : '#0f172a');
      }

      const line = L.polyline(points, {
        color: strokeColor,
        weight: strokeWidth,
        opacity: strokeOpacity,
        dashArray: strokeDashArray
      });

      // Tooltip with detailed traffic flow and time saved
      let tooltipContent = `<strong>${edge.name || edge.id}</strong><br>${edge.source} ➔ ${edge.target}<br>Flow: ${Math.round(volume).toLocaleString()} vph | Capacity: ${edge.capacity_vph.toLocaleString()} vph<br>Time: ${currentTimeMins.toFixed(1)} min (V/C: ${vc.toFixed(2)})`;
      if (closed) {
        tooltipContent += `<br><span style="color: #dc2626; font-weight: bold;">🚫 ROAD BLOCKED / CLOSED</span>`;
      } else if (widened) {
        tooltipContent += `<br><span style="color: #2563eb; font-weight: bold;">➕ ROAD EXPANDED (+1 LANE)</span>`;
      }
      if (Math.abs(timeSavedMins) > 0.05) {
        tooltipContent += `<br><span style="color: ${timeSavedMins > 0 ? '#059669' : '#dc2626'}; font-weight: bold;">${timeSavedMins > 0 ? `⚡ Time Saved: -${timeSavedMins.toFixed(1)} min` : `⚠️ Delay: +${Math.abs(timeSavedMins).toFixed(1)} min`}</span>`;
      }
      if (recommendation) {
        tooltipContent += `<br><strong style="color: ${recommendation.type === 'REMOVE_ROAD' ? '#dc2626' : '#059669'};">⚡ Optimizer: ${recommendation.type === 'REMOVE_ROAD' ? '🚫 BLOCK ROAD' : '➕ WIDEN ROAD'} (-${recommendation.travel_time_reduction_pct}% latency)</strong>`;
      }

      if (showNames) {
        line.bindTooltip(tooltipContent, { sticky: true });
      }

      line.on('click', () => setSelectedEdgeId(edge.id));
      line.addTo(layers);

      // Optimizer On-Graph Badge or Active Intervention Badge
      if (points.length >= 2) {
        const midIdx = Math.floor(points.length / 2);
        const pA = L.latLng(points[Math.max(0, midIdx - 1)]);
        const pB = L.latLng(points[Math.min(points.length - 1, midIdx)]);
        const midLatLng = L.latLng((pA.lat + pB.lat) / 2, (pA.lng + pB.lng) / 2);

        let badgeHtml: string | null = null;
        if (closed) {
          badgeHtml = `<div class="on-graph-badge badge-remove" style="background:#dc2626; border-color:#fff;">🚫 CLOSED</div>`;
        } else if (widened) {
          badgeHtml = `<div class="on-graph-badge badge-widen" style="background:#2563eb; border-color:#fff;">➕ WIDENED</div>`;
        } else if (recommendation) {
          badgeHtml = recommendation.type === 'REMOVE_ROAD'
            ? `<div class="on-graph-badge badge-remove">🚫 BLOCK -${recommendation.travel_time_reduction_pct}%</div>`
            : `<div class="on-graph-badge badge-widen">➕ WIDEN -${recommendation.travel_time_reduction_pct}%</div>`;
        }

        if (badgeHtml) {
          const badgeIcon = L.divIcon({
            className: 'on-graph-badge-container',
            html: badgeHtml,
            iconSize: [88, 22],
            iconAnchor: [44, 11]
          });

          const badgeMarker = L.marker(midLatLng, { icon: badgeIcon, interactive: true });
          if (recommendation && !closed && !widened) {
            badgeMarker.on('click', (e) => {
              L.DomEvent.stopPropagation(e);
              applyActions([...interventions, recommendation.action]);
            });
          }
          badgeMarker.addTo(layers);
        }
      }
    });

    // Pruned Node Display: only render essential key junctions and selected road endpoints
    if (showNodes) {
      const selectedNodeIds = new Set<string>();
      if (selectedEdge) {
        selectedNodeIds.add(selectedEdge.source);
        selectedNodeIds.add(selectedEdge.target);
      }

      graph.nodes.forEach((node) => {
        const isOrigin = node.type === 'origin' || node.id.startsWith('O') || node.id === 'A';
        const isDest = node.type === 'destination' || node.id.startsWith('D') || node.id === 'D';
        const isSelectedEndpoint = selectedNodeIds.has(node.id);

        // On large networks (Kochi, New York), only render Origin/Destination nodes and selected endpoints
        if (graph.nodes.length > 25 && !isOrigin && !isDest && !isSelectedEndpoint) {
          return;
        }

        const marker = L.circleMarker([node.lat, node.lng], {
          radius: isSelectedEndpoint ? 8 : (isOrigin || isDest ? 6 : 4),
          color: isSelectedEndpoint ? '#2563eb' : '#0f172a',
          weight: isSelectedEndpoint ? 2.5 : 1.5,
          fillColor: isOrigin ? '#2563eb' : (isDest ? '#059669' : (isSelectedEndpoint ? '#38bdf8' : '#ffffff')),
          fillOpacity: 1
        });
        if (showNames) marker.bindTooltip(node.label || node.id);
        marker.addTo(layers);
      });
    }

    if (bounds.isValid() && (lastGraphId.current !== graph.graph_id || map.getZoom() < 3)) {
      lastGraphId.current = graph.graph_id;
      map.fitBounds(bounds.pad(0.08), { maxZoom: graph.nodes.length > 60 ? 15 : 14 });
    }
  }, [graph, simulation, baselineSimulation, progress, selectedEdgeId, interventions, optimization, discoveredRecommendations, showNames, showNodes]);

  // Real-Time Animated Flow Particle Simulation
  useEffect(() => {
    const layers = flowLayerGroup.current;
    if (!layers || !graph || !showFlow) return;

    layers.clearLayers();
    let frame = 0;
    const particles: Array<{ marker: L.CircleMarker; points: L.LatLngExpression[]; offset: number }> = [];

    graph.edges.forEach((edge, edgeIndex) => {
      const metric = simulation?.edge_metrics[edge.id];
      const volume = metric?.volume_vph ?? progress?.edge_volumes[edge.id] ?? 0;
      const points = edgePath(graph, edge);
      if (volume <= 0 || points.length < 2) return;

      const marker = L.circleMarker(points[0], {
        radius: 3,
        color: '#0f172a',
        weight: 1,
        fillColor: edgeColor(metric?.vc_ratio ?? 0),
        fillOpacity: 1
      }).addTo(layers);

      particles.push({ marker, points, offset: (edgeIndex * 0.17) % 1 });
    });

    const animate = () => {
      frame = window.requestAnimationFrame(animate);
      const now = (Date.now() % 4500) / 4500;
      particles.forEach(({ marker, points, offset }) => {
        const position = (now + offset) % 1;
        const segment = Math.min(points.length - 2, Math.floor(position * (points.length - 1)));
        const local = position * (points.length - 1) - segment;
        const a = L.latLng(points[segment]);
        const b = L.latLng(points[segment + 1]);
        marker.setLatLng([a.lat + (b.lat - a.lat) * local, a.lng + (b.lng - a.lng) * local]);
      });
    };

    animate();
    return () => {
      window.cancelAnimationFrame(frame);
      layers.clearLayers();
    };
  }, [graph, simulation, progress, showFlow]);

  const selectedEdge = graph?.edges.find((edge) => edge.id === selectedEdgeId);
  const selectedMetric = selectedEdgeId ? simulation?.edge_metrics[selectedEdgeId] : undefined;

  const applyActions = async (actions: InterventionAction[]) => {
    if (!graph) return;
    setLoading(true);
    setError(null);
    try {
      const nextReport = await evaluateIntervention({
        base_graph_id: graph.graph_id,
        demand_multiplier: demandMultiplier,
        modifications: actions,
        config
      });
      setInterventions(actions);
      setReport(nextReport);
      setSimulation(nextReport.intervention);
    } catch (actionError) {
      setError((actionError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleOptimizer = () => {
    const targetGraphId = areaId || selectedScenario;
    stopOptimizer.current?.();
    setOptimizing(true);
    setError(null);
    setOptimization(null);
    setDiscoveredRecommendations([]);
    setOptimizationProgress({ current: 0, total: 0 });

    stopOptimizer.current = startOptimizationStream(
      targetGraphId,
      demandMultiplier,
      config,
      (event) => setOptimizationProgress({ current: event.current, total: event.total }),
      (recommendation) => setDiscoveredRecommendations((current) => [...current, recommendation]),
      (result) => {
        setOptimization(result);
        setOptimizing(false);
      },
      (optimizerError: Error) => {
        setError(optimizerError.message);
        setOptimizing(false);
      }
    );
  };

  const applyAllRecommendations = () => {
    const recommendations = optimization?.recommendations || discoveredRecommendations;
    if (recommendations.length > 0) {
      applyActions(recommendations.map((rec) => rec.action));
    }
  };

  const clearAreaSelection = () => {
    areaRect.current?.remove();
    areaRect.current = null;
    setAreaId(null);
    setAreaMode(false);
    fetchGraph(selectedScenario).then((data) => {
      setGraph(data);
      runLiveSimulation(data.graph_id);
    });
  };

  const widen = () => selectedEdge && applyActions([...interventions, { action: 'WIDEN', edge_id: selectedEdge.id, new_lanes: selectedEdge.lanes + 1, new_capacity_vph: selectedEdge.capacity_vph * 1.5 }]);
  const isSelectedClosed = selectedEdge ? interventions.filter((action) => action.edge_id === selectedEdge.id).slice(-1)[0]?.action === 'CLOSE' : false;
  const close = () => selectedEdge && applyActions(isSelectedClosed ? [...interventions, { action: 'OPEN', edge_id: selectedEdge.id }] : [...interventions, { action: 'CLOSE', edge_id: selectedEdge.id }]);
  const reset = () => {
    setInterventions([]);
    setReport(null);
    if (graph) runLiveSimulation(graph.graph_id);
  };
  const fitNetwork = () => {
    if (!graph || !mapInstance.current) return;
    const bounds = L.latLngBounds(graph.nodes.map((node) => [node.lat, node.lng] as L.LatLngExpression));
    mapInstance.current.fitBounds(bounds.pad(0.08), { maxZoom: 15 });
  };

  return (
    <div className="app-shell">
      {/* Top Navigation Bar */}
      <header className="app-header">
        <div className="brand-container">
          <Layers size={18} />
          <strong className="brand-title">URBANFLOW</strong>
          <span className="brand-badge">TRANSPORT OPTIMIZATION ENGINE</span>
        </div>

        <div className="header-actions">
          {/* Mode & Place Dropdown */}
          <select
            className="select-input scenario-select"
            value={areaMode ? 'custom_square' : selectedScenario}
            onChange={(event) => handleScenarioChange(event.target.value)}
          >
            <optgroup label="📍 Live Map Mode">
              <option value="kochi_central">Kochi, Kerala (Arterial Network)</option>
              <option value="new_york">New York City (Midtown Manhattan Grid)</option>
              <option value="custom_square">🔲 Draw Custom Square Area</option>
            </optgroup>
            <optgroup label="⚙️ Synthetic Networks">
              <option value="braess_4node">Classic Braess Paradox (4 Nodes)</option>
              <option value="expanded_8node">Expanded Multi-Hub (8 Nodes, Latent Braess)</option>
              <option value="grid_3x3">3x3 Urban Grid Network (9 Nodes)</option>
              <option value="bottleneck_bridge">Bottleneck Bridge Hub (6 Nodes)</option>
            </optgroup>
          </select>

          <button className="btn" onClick={handleOptimizer} disabled={optimizing || loading}>
            <Zap size={14} />
            {optimizing
              ? `Optimizing ${optimizationProgress.total ? `${Math.round((optimizationProgress.current / optimizationProgress.total) * 100)}%` : '...'}`
              : 'Run Optimizer'}
          </button>

          <button className="btn btn-primary" onClick={() => graph && runLiveSimulation(graph.graph_id)} disabled={loading || !graph}>
            <Play size={14} />
            {loading ? `Simulating${progress ? ` ${progress.iteration}/${progress.max_iterations}` : '...'}` : 'Simulate'}
          </button>
        </div>
      </header>

      <div className="app-layout">
        {/* Left Sidebar Pane */}
        <aside className="sidebar-pane">
          {/* Section 1: Demand & Simulation Parameters */}
          <section className="panel">
            <div className="panel-header">
              <span><Sliders size={14} /> Simulation Parameters</span>
              <span className="muted">{config.algorithm.toUpperCase()} / BPR</span>
            </div>
            <div className="panel-body">
              <label>
                Traffic Demand: <strong>{(demandMultiplier * 100).toFixed(0)}%</strong>
              </label>
              <input
                type="range"
                min="0.1"
                max="3.0"
                step="0.1"
                value={demandMultiplier}
                onChange={(event) => setDemandMultiplier(Number(event.target.value))}
              />

              {!isSynthetic && (
                <>
                  <label style={{ marginTop: '10px' }}>
                    Road Density Filter: <strong>{roadDensity < 0.3 ? 'Motorways Only' : roadDensity < 0.6 ? 'Primary Arterials' : roadDensity < 0.85 ? 'Tertiary Included' : 'All Roads'} ({Math.round(roadDensity * 100)}%)</strong>
                  </label>
                  <input
                    type="range"
                    min="0.0"
                    max="1.0"
                    step="0.05"
                    value={roadDensity}
                    onChange={(event) => setRoadDensity(Number(event.target.value))}
                  />
                </>
              )}

              {report && (
                <div className="comparison-box">
                  <div>
                    <span>Baseline Travel Time</span>
                    <b>{report.baseline.summary_metrics.avg_travel_time_mins} min</b>
                  </div>
                  <div>
                    <span>After Intervention</span>
                    <b>{report.intervention.summary_metrics.avg_travel_time_mins} min</b>
                  </div>
                  <strong className={report.delta.avg_travel_time_change_pct <= 0 ? 'good' : 'bad'}>
                    {report.delta.avg_travel_time_change_pct <= 0 ? '' : '+'}
                    {report.delta.avg_travel_time_change_pct.toFixed(1)}% vs baseline
                  </strong>
                </div>
              )}

              <details open={showAdvanced} onToggle={(event) => setShowAdvanced((event.currentTarget as HTMLDetailsElement).open)}>
                <summary>Advanced Cost Parameters</summary>
                <div className="advanced-fields">
                  <div className="field-grid">
                    <label>
                      Alpha (α)
                      <input
                        className="text-input"
                        type="number"
                        step="0.05"
                        value={config.default_alpha}
                        onChange={(event) => setConfig({ ...config, default_alpha: Number(event.target.value) })}
                      />
                    </label>
                    <label>
                      Beta (β)
                      <input
                        className="text-input"
                        type="number"
                        step="0.5"
                        value={config.default_beta}
                        onChange={(event) => setConfig({ ...config, default_beta: Number(event.target.value) })}
                      />
                    </label>
                  </div>
                  <label>
                    MSA Max Iterations
                    <input
                      className="text-input"
                      type="number"
                      min="5"
                      max="100"
                      value={config.max_iterations}
                      onChange={(event) => setConfig({ ...config, max_iterations: Number(event.target.value) })}
                    />
                  </label>
                </div>
              </details>
            </div>
          </section>

          {/* Section 2: Selected Road Segment Inspector */}
          <section className="panel">
            <div className="panel-header">
              <span>Selected Corridor Link</span>
              {selectedEdge && <code>{selectedEdge.id}</code>}
            </div>
            <div className="panel-body">
              {selectedEdge ? (
                <>
                  <strong>{selectedEdge.name || selectedEdge.id}</strong>
                  <div className="stat-row">
                    <span>Corridor Route</span>
                    <b>{selectedEdge.source} ➔ {selectedEdge.target}</b>
                  </div>
                  <div className="stat-row">
                    <span>Flow Volume</span>
                    <b>{Math.round(selectedMetric?.volume_vph || progress?.edge_volumes[selectedEdge.id] || 0).toLocaleString()} vph</b>
                  </div>
                  <div className="stat-row">
                    <span>Capacity / Lanes</span>
                    <b>{Math.round(selectedMetric?.capacity_vph || selectedEdge.capacity_vph).toLocaleString()} vph ({selectedEdge.lanes} ln)</b>
                  </div>
                  <div className="stat-row">
                    <span>V/C Congestion Ratio</span>
                    <b>{selectedMetric?.vc_ratio?.toFixed(2) || 'Calculating...'}</b>
                  </div>
                  <div className="stat-row">
                    <span>Equilibrium Speed</span>
                    <b>{selectedMetric ? `${selectedMetric.avg_speed_kmh} km/h` : 'Calculating...'}</b>
                  </div>
                  <div className="button-row">
                    <button className="btn btn-success" onClick={widen} disabled={loading}>
                      <Plus size={13} /> Widen (+1 Lane)
                    </button>
                    <button className="btn btn-danger" onClick={close} disabled={loading}>
                      <Ban size={13} /> {isSelectedClosed ? 'Reopen Link' : 'Block / Close Link'}
                    </button>
                  </div>
                </>
              ) : (
                <p className="muted">Click any road link on the map to inspect live flow telemetry or adjust capacity.</p>
              )}
            </div>
          </section>

          {/* Section 3: Performance Telemetry & Time Saved */}
          <section className="panel">
            <div className="panel-header">
              <span>Network Performance Telemetry</span>
              {interventions.length > 0 && (
                <button className="icon-btn" onClick={reset} title="Reset Interventions">
                  <RotateCcw size={14} />
                </button>
              )}
            </div>
            <div className="panel-body">
              {simulation ? (
                <>
                  <div className="telemetry-grid">
                    <div className="telemetry-col">
                      <div className="telemetry-label">Baseline</div>
                      <div className="stat-row">
                        <span>Avg Trip Time</span>
                        <b>{baselineSimulation?.summary_metrics.avg_travel_time_mins ?? simulation.summary_metrics.avg_travel_time_mins} min</b>
                      </div>
                      <div className="stat-row">
                        <span>Avg Speed</span>
                        <b>{baselineSimulation?.summary_metrics.avg_network_speed_kmh ?? simulation.summary_metrics.avg_network_speed_kmh} km/h</b>
                      </div>
                      <div className="stat-row">
                        <span>Congested Links</span>
                        <b>{baselineSimulation?.summary_metrics.severely_congested_edges_count ?? simulation.summary_metrics.severely_congested_edges_count}</b>
                      </div>
                    </div>

                    <div className="telemetry-col telemetry-current">
                      <div className="telemetry-label">Current{interventions.length > 0 ? ' (Intervention)' : ''}</div>
                      <div className="stat-row">
                        <span>Avg Trip Time</span>
                        <b className={baselineSimulation && simulation.summary_metrics.avg_travel_time_mins < baselineSimulation.summary_metrics.avg_travel_time_mins ? 'good' : baselineSimulation && simulation.summary_metrics.avg_travel_time_mins > baselineSimulation.summary_metrics.avg_travel_time_mins ? 'bad' : ''}>
                          {simulation.summary_metrics.avg_travel_time_mins} min
                          {baselineSimulation && simulation !== baselineSimulation ? ` (${((simulation.summary_metrics.avg_travel_time_mins - baselineSimulation.summary_metrics.avg_travel_time_mins) / Math.max(baselineSimulation.summary_metrics.avg_travel_time_mins, 0.001) * 100).toFixed(1)}%)` : ''}
                        </b>
                      </div>
                      <div className="stat-row">
                        <span>Avg Speed</span>
                        <b className={baselineSimulation && simulation.summary_metrics.avg_network_speed_kmh > baselineSimulation.summary_metrics.avg_network_speed_kmh ? 'good' : ''}>
                          {simulation.summary_metrics.avg_network_speed_kmh} km/h
                        </b>
                      </div>
                      <div className="stat-row">
                        <span>Congested Links</span>
                        <b className={baselineSimulation && simulation.summary_metrics.severely_congested_edges_count < (baselineSimulation.summary_metrics.severely_congested_edges_count ?? 0) ? 'good' : ''}>
                          {simulation.summary_metrics.severely_congested_edges_count}
                        </b>
                      </div>
                    </div>
                  </div>

                  <div className="stat-row" style={{ marginTop: '6px' }}>
                    <span>Assignment Convergence</span>
                    <b>{simulation.summary_metrics.converged ? 'Converged' : 'Max iterations'} ({simulation.summary_metrics.iterations_run} iters)</b>
                  </div>
                </>
              ) : (
                <p className="muted">Running equilibrium assignment...</p>
              )}

              {report && <div className="alert-box">{report.delta.summary_text}</div>}
              {error && <div className="alert-box error">{error}</div>}
            </div>
          </section>

          {/* Section 4: Multi-Core Optimizer Recommendations */}
          <section className="panel recommendations">
            <div className="panel-header">
              <span>Optimizer Recommendations</span>
              {(optimization || discoveredRecommendations.length > 0) && (
                <code>{optimization?.recommendations.length || discoveredRecommendations.length} actions</code>
              )}
            </div>
            <div className="panel-body">
              {(optimization?.recommendations || discoveredRecommendations).length > 0 ? (
                <>
                  <button className="btn btn-primary" onClick={applyAllRecommendations} disabled={loading || optimizing}>
                    Apply All Interventions & Resimulate
                  </button>
                  {(optimization?.recommendations || discoveredRecommendations).map((rec) => (
                    <div className="recommendation" key={rec.edge_id}>
                      <strong>{rec.type === 'REMOVE_ROAD' ? '🚫 Close' : '➕ Widen'} {rec.edge_name}</strong>
                      <span>Save {rec.travel_time_reduction_pct}% average trip latency</span>
                      <button className="btn" onClick={() => applyActions([...interventions, rec.action])} disabled={loading}>
                        Apply and Resimulate
                      </button>
                    </div>
                  ))}
                </>
              ) : (
                <p className="muted">Click <strong>Run Optimizer</strong> to scan candidate road closures (Braess paradox links) and lane widenings across all CPU cores.</p>
              )}
            </div>
          </section>
        </aside>

        {/* Right Map Canvas & Floating Toolbar */}
        <main className={`map-pane ${areaMode ? 'area-selecting' : ''}`}>
          {queryStatus && (
            <div className={`query-status-banner ${queryStatus.type}`}>
              {queryStatus.type === 'loading' && <div className="query-spinner" />}
              <span>{queryStatus.message}</span>
            </div>
          )}

          <div ref={mapRef} className="map-canvas" />

          {/* Floating Action Controls */}
          <div className="map-toolbar">
            <div className="map-actions">
              <button
                className={`btn ${areaMode ? 'btn-primary' : ''}`}
                onClick={() => setAreaMode(!areaMode)}
                title="Click and drag on map to select and extract a custom bounding box"
              >
                <Route size={14} /> {areaMode ? 'Drawing Square Area...' : 'Draw Custom Area'}
              </button>

              {areaId && (
                <button className="btn" onClick={clearAreaSelection} title="Clear custom area selection">
                  Clear Area
                </button>
              )}

              <button className="btn" onClick={() => setShowNodes(!showNodes)} title="Toggle node marker visibility">
                <CircleDot size={14} /> Nodes {showNodes ? 'on' : 'off'}
              </button>

              <button className="btn" onClick={() => setShowNames(!showNames)} title="Toggle road name tooltips">
                Names {showNames ? 'on' : 'off'}
              </button>

              <button className="btn" onClick={() => setShowFlow(!showFlow)} title="Toggle live traffic particle flow">
                Flow {showFlow ? 'on' : 'off'}
              </button>

              <button className="btn" onClick={() => setShowBasemap(!showBasemap)} title="Toggle OpenStreetMap basemap">
                <MapIcon size={14} /> Basemap
              </button>

              <button className="btn" onClick={fitNetwork} title="Recenter and fit network in view">
                <LocateFixed size={14} /> Fit
              </button>
            </div>

            <div className="map-info">
              <strong>Network Telemetry</strong>
              <span>{graph ? `${graph.nodes.length} nodes` : 'Loading...'}</span>
              <span>{graph ? `${graph.edges.length} links` : 'Loading...'}</span>
            </div>
          </div>

          {/* Map Legend */}
          <div className="legend">
            <span><i className="legend-line free" /> V/C &lt; 0.75 (Free)</span>
            <span><i className="legend-line moderate" /> V/C 0.75–0.95 (Moderate)</span>
            <span><i className="legend-line severe" /> V/C &ge; 0.95 (Bottleneck)</span>
            <span><i className="legend-line widened" /> Widened</span>
            <span><i className="legend-line closed" /> Closed</span>
          </div>
        </main>
      </div>
    </div>
  );
}