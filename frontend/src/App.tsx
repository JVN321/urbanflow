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
  CircleDot,
  Tag,
  Save,
  Check,
  Dices
} from 'lucide-react';
import {
  evaluateIntervention,
  fetchGraph,
  analyzeArea,
  fetchRandomOsmArea,
  startOptimizationStream,
  SimulationProgressEvent,
  startSimulationStream,
  allowedRoadTypes
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

function getEdgeMidpoint(points: L.LatLngExpression[]): L.LatLng {
  if (points.length === 0) return L.latLng(0, 0);
  const latLngs = points.map((p) => {
    if (Array.isArray(p)) return L.latLng(p[0], p[1]);
    return L.latLng(p as L.LatLngLiteral);
  });
  if (latLngs.length === 1) return latLngs[0];
  if (latLngs.length === 2) {
    return L.latLng((latLngs[0].lat + latLngs[1].lat) / 2, (latLngs[0].lng + latLngs[1].lng) / 2);
  }
  let totalDist = 0;
  const dists: number[] = [0];
  for (let i = 1; i < latLngs.length; i++) {
    totalDist += latLngs[i].distanceTo(latLngs[i - 1]);
    dists.push(totalDist);
  }
  const halfDist = totalDist / 2;
  for (let i = 1; i < dists.length; i++) {
    if (dists[i] >= halfDist) {
      const segLen = dists[i] - dists[i - 1];
      const ratio = segLen > 0 ? (halfDist - dists[i - 1]) / segLen : 0;
      return L.latLng(
        latLngs[i - 1].lat + ratio * (latLngs[i].lat - latLngs[i - 1].lat),
        latLngs[i - 1].lng + ratio * (latLngs[i].lng - latLngs[i - 1].lng)
      );
    }
  }
  return latLngs[Math.floor(latLngs.length / 2)];
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
  const [optimizationProgress, setOptimizationProgress] = useState<{
    current: number;
    total: number;
    name?: string;
    action_type?: string;
  }>({ current: 0, total: 0 });

  // Map & Visual States
  const [showNames, setShowNames] = useState(true);
  const [showNodes, setShowNodes] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [mapZoom, setMapZoom] = useState<number>(13);
  const [showBasemap, setShowBasemap] = useState(true);
  const [showFlow, setShowFlow] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [areaMode, setAreaMode] = useState(false);
  const [areaId, setAreaId] = useState<string | null>(null);
  const [demandMultiplier, setDemandMultiplier] = useState(1.0);
  const [roadDensity, setRoadDensity] = useState(1.0);

  // Persistent Optimizer & Simulation Settings
  interface OptimizerSettings {
    max_iterations: number;
    max_candidates: number;
    min_savings_pct: number;
    alpha: number;
    beta: number;
    convergence_tolerance: number;
  }

  const DEFAULT_SETTINGS: OptimizerSettings = {
    max_iterations: 30,
    max_candidates: 20,
    min_savings_pct: 0.5,
    alpha: 0.15,
    beta: 4.0,
    convergence_tolerance: 0.001
  };

  const [optSettings, setOptSettings] = useState<OptimizerSettings>(() => {
    try {
      const saved = localStorage.getItem('urbanflow_optimizer_settings');
      if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_SETTINGS;
  });

  const [config, setConfig] = useState<SimulationConfig>({
    algorithm: 'msa',
    max_iterations: optSettings.max_iterations,
    convergence_tolerance: optSettings.convergence_tolerance,
    default_alpha: optSettings.alpha,
    default_beta: optSettings.beta,
    cost_model: 'bpr'
  });

  const [loading, setLoading] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queryStatus, setQueryStatus] = useState<{ type: 'loading' | 'success' | 'error'; message: string } | null>(null);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const layerGroup = useRef<L.LayerGroup | null>(null);
  const flowLayerGroup = useRef<L.LayerGroup | null>(null);
  const tileLayer = useRef<L.TileLayer | null>(null);
  const stopStream = useRef<(() => void) | null>(null);
  const stopOptimizer = useRef<(() => void) | null>(null);
  const areaRect = useRef<L.Rectangle | null>(null);
  const fittedGraphIdRef = useRef<string | null>(null);
  const skipNextStreamRef = useRef<boolean>(false);
  const simulationStartTimeRef = useRef<number>(0);
  const optimizationStartTimeRef = useRef<number>(0);
  const masterGraphRef = useRef<UrbanFlowGraph | null>(null);

  const [simulationEta, setSimulationEta] = useState<number | null>(null);
  const [optimizationEta, setOptimizationEta] = useState<number | null>(null);

  const filterGraphByDensity = (sourceGraph: UrbanFlowGraph, density: number): UrbanFlowGraph => {
    if (density >= 0.98) return sourceGraph;
    const allowed = allowedRoadTypes(density);
    const activeEdges = sourceGraph.edges.filter((e) => allowed.has(e.road_type || 'tertiary'));
    const edgesToKeep = activeEdges.length >= 2 ? activeEdges : sourceGraph.edges;
    const activeNodeIds = new Set(edgesToKeep.flatMap((e) => [e.source, e.target]));
    const activeNodes = sourceGraph.nodes.filter((n) => activeNodeIds.has(n.id));
    return {
      ...sourceGraph,
      nodes: activeNodes.length > 0 ? activeNodes : sourceGraph.nodes,
      edges: edgesToKeep
    };
  };

  const handleRoadDensityChange = (newDensity: number) => {
    setRoadDensity(newDensity);
    if (!masterGraphRef.current) return;
    const filtered = filterGraphByDensity(masterGraphRef.current, newDensity);
    setGraph(filtered);
    // Realtime: updates road network view instantly without triggering simulation!
  };

  const isSynthetic = ['braess_3route', 'braess_4node', 'expanded_8node', 'grid_3x3', 'bottleneck_bridge'].includes(selectedScenario);

  const handleRandomSelection = async (cityName?: string) => {
    try {
      setLoading(true);
      setError(null);
      setAreaMode(false);
      setInterventions([]);
      setReport(null);
      setOptimization(null);
      setDiscoveredRecommendations([]);
      setShowBasemap(true);
      setQueryStatus({
        type: 'loading',
        message: cityName
          ? `Fetching road network for ${cityName} from OpenStreetMap...`
          : 'Extracting random world city road network from OpenStreetMap...'
      });

      const res = await fetchRandomOsmArea(cityName, demandMultiplier, roadDensity);

      masterGraphRef.current = res.graph;
      const filtered = filterGraphByDensity(res.graph, roadDensity);

      skipNextStreamRef.current = true;
      setAreaId(res.area_id);
      setSelectedScenario(res.area_id);
      setGraph(filtered);
      setSimulation(res.result);
      setBaselineSimulation(res.result);

      setQueryStatus({
        type: 'success',
        message: `Loaded ${res.city}, ${res.country}: ${res.graph.edges.length} road links, ${res.graph.nodes.length} junctions (${res.result.summary_metrics.avg_travel_time_mins} min avg trip).`
      });
      setTimeout(() => setQueryStatus(null), 5000);

      const map = mapInstance.current;
      if (map) {
        map.dragging.enable();
        map.scrollWheelZoom.enable();
        const newBounds = L.latLngBounds(res.graph.nodes.map((n) => [n.lat, n.lng]));
        if (newBounds.isValid()) {
          map.fitBounds(newBounds.pad(0.08), { maxZoom: 16 });
        }
      }
    } catch (err: any) {
      const errMsg = err?.message || 'Failed to fetch random area';
      setError(errMsg);
      setQueryStatus({
        type: 'error',
        message: `⚠️ ${errMsg}`
      });
      setTimeout(() => setQueryStatus(null), 5000);
    } finally {
      setLoading(false);
    }
  };

  const runLiveSimulation = (graphId: string, nextConfig = config) => {
    stopStream.current?.();
    setLoading(true);
    setProgress(null);
    setSimulationEta(null);
    setError(null);
    simulationStartTimeRef.current = Date.now();

    stopStream.current = startSimulationStream(
      graphId,
      demandMultiplier,
      nextConfig,
      (event) => {
        setProgress(event);
        const elapsed = (Date.now() - simulationStartTimeRef.current) / 1000;
        if (event.eta_sec !== undefined && event.eta_sec !== null) {
          setSimulationEta(event.eta_sec);
        } else if (event.iteration > 0 && event.max_iterations > event.iteration) {
          const rem = (elapsed / event.iteration) * (event.max_iterations - event.iteration);
          setSimulationEta(Math.max(0.1, Math.round(rem * 10) / 10));
        } else {
          setSimulationEta(0);
        }
      },
      (result) => {
        setSimulation(result);
        setBaselineSimulation((prev) => prev ?? result);
        setLoading(false);
        setProgress(null);
        setSimulationEta(null);
      },
      (streamError) => {
        setError(streamError.message);
        setLoading(false);
        setProgress(null);
        setSimulationEta(null);
      },
      roadDensity
    );
  };

  const handleScenarioChange = (scenarioId: string) => {
    if (scenarioId === 'custom_square') {
      setAreaMode(true);
      setShowBasemap(true);
      return;
    }
    if (scenarioId === 'random_world_city') {
      handleRandomSelection();
      return;
    }
    setAreaMode(false);
    setSelectedScenario(scenarioId);
    setInterventions([]);
    setReport(null);
    setOptimization(null);
    setDiscoveredRecommendations([]);
    if (scenarioId.startsWith('braess') || scenarioId === 'grid_3x3' || scenarioId === 'bottleneck_bridge') {
      setShowBasemap(false);
    } else {
      setShowBasemap(true);
    }
  };

  const handleDemandChange = (val: number) => {
    setDemandMultiplier(val);
    setInterventions([]);
    setReport(null);
    setOptimization(null);
    setDiscoveredRecommendations([]);
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
        masterGraphRef.current = data;
        const filtered = filterGraphByDensity(data, roadDensity);
        setGraph(filtered);
        runLiveSimulation(filtered.graph_id);
      })
      .catch((loadError: Error) => active && setError(loadError.message));

    return () => {
      active = false;
      stopStream.current?.();
    };
  }, [selectedScenario]);

  // Re-simulate baseline when demand/config change for the active graph.
  // Road density does NOT auto-simulate: it filters the cached road network in real-time,
  // and recalculates only when the user explicitly clicks the Simulate button.
  useEffect(() => {
    if (!graph || !mapInstance.current) return;
    if (skipNextStreamRef.current) {
      skipNextStreamRef.current = false;
      return;
    }

    stopStream.current?.();
    setLoading(true);
    setProgress(null);
    setSimulationEta(null);
    setError(null);
    simulationStartTimeRef.current = Date.now();

    stopStream.current = startSimulationStream(
      graph.graph_id,
      demandMultiplier,
      config,
      (event) => {
        setProgress(event);
        const elapsed = (Date.now() - simulationStartTimeRef.current) / 1000;
        if (event.eta_sec !== undefined && event.eta_sec !== null) {
          setSimulationEta(event.eta_sec);
        } else if (event.iteration > 0 && event.max_iterations > event.iteration) {
          const rem = (elapsed / event.iteration) * (event.max_iterations - event.iteration);
          setSimulationEta(Math.max(0.1, Math.round(rem * 10) / 10));
        } else {
          setSimulationEta(0);
        }
      },
      (result) => {
        setSimulation(result);
        setBaselineSimulation(result);
        setLoading(false);
        setProgress(null);
        setSimulationEta(null);
      },
      (streamError) => {
        setError(streamError.message);
        setLoading(false);
        setProgress(null);
        setSimulationEta(null);
      },
      roadDensity
    );
  }, [graph?.graph_id, demandMultiplier, config]);

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

    // Initial mount: load basemap tile layer immediately so first click toggle works reliably
    if (showBasemap && !tileLayer.current) {
      tileLayer.current = L.tileLayer(TILE_URL, {
        maxZoom: 19,
        attribution: import.meta.env.VITE_MAP_ATTRIBUTION || '&copy; OpenStreetMap contributors'
      }).addTo(map);
    }

    map.on('zoomend', () => {
      setMapZoom(map.getZoom());
    });

    requestAnimationFrame(() => map.invalidateSize());

    return () => {
      map.off();
      map.remove();
      mapInstance.current = null;
      layerGroup.current = null;
      flowLayerGroup.current = null;
      tileLayer.current = null;
    };
  }, []);

  // Custom Bounding Box Area Selection (Only active when areaMode is toggled on)
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    if (!areaMode) {
      map.dragging.enable();
      map.scrollWheelZoom.enable();
      return;
    }

    map.dragging.disable();
    map.scrollWheelZoom.disable();

    const onMouseDown = (event: L.LeafletMouseEvent) => {
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

          masterGraphRef.current = analyzed.graph;
          const filtered = filterGraphByDensity(analyzed.graph, roadDensity);
          skipNextStreamRef.current = true;
          setAreaId(analyzed.area_id);
          setSelectedScenario(analyzed.area_id);
          setGraph(filtered);
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
          const errMsg = (analysisError as Error).message || '';
          const isTimeout = errMsg.toLowerCase().includes('timeout') || errMsg.toLowerCase().includes('timed out');
          setError(errMsg);
          setQueryStatus({
            type: 'error',
            message: isTimeout
              ? '⚠️ OpenStreetMap request timed out. Please select a smaller square or retry.'
              : `⚠️ Extraction error: ${errMsg}`
          });
          setTimeout(() => setQueryStatus(null), 5500);
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

      // Distinctive discoloration for modified and recommended roads
      let strokeColor = edgeColor(vc, closed, widened);
      let strokeWidth = Math.max(3.5, Math.min(8.5, (edge.lanes || 1) * 1.8 + 1));
      let strokeDashArray: string | undefined = undefined;
      let strokeOpacity = 0.88;

      if (closed) {
        // Discolor closed / removed roads to high-contrast slate grey with dashed styling
        strokeColor = '#64748b';
        strokeWidth = 5;
        strokeDashArray = '6 5';
        strokeOpacity = 0.65;
      } else if (widened) {
        // Discolor widened roads to vibrant electric cyan/blue
        strokeColor = '#0284c7';
        strokeWidth = 8.5;
        strokeOpacity = 0.95;
      } else if (recommendation?.type === 'REMOVE_ROAD') {
        // Highlight proposed Braess paradox removals in warning hazard amber/yellow dashed
        strokeColor = '#f59e0b';
        strokeWidth = 6.5;
        strokeDashArray = '8 4';
        strokeOpacity = 0.95;
      } else if (recommendation?.type === 'WIDEN_ROAD') {
        // Highlight proposed widenings in vibrant cyan
        strokeColor = '#06b6d4';
        strokeWidth = 8.0;
        strokeOpacity = 0.95;
      }

      if (selectedEdgeId === edge.id) {
        strokeWidth = 9;
        strokeColor = closed ? '#64748b' : (widened ? '#0284c7' : '#0f172a');
      }

      const line = L.polyline(points, {
        color: strokeColor,
        weight: strokeWidth,
        opacity: strokeOpacity,
        dashArray: strokeDashArray,
        bubblingMouseEvents: true
      });

      // Tooltip with detailed traffic flow and time saved
      let tooltipContent = `<strong>${edge.name || edge.id}</strong><br>${edge.source} ➔ ${edge.target}<br>Flow: ${Math.round(volume).toLocaleString()} vph | Capacity: ${edge.capacity_vph.toLocaleString()} vph<br>Time: ${currentTimeMins.toFixed(1)} min (V/C: ${vc.toFixed(2)})`;
      if (closed) {
        tooltipContent += `<br><span style="color: #64748b; font-weight: bold;">🚫 ROAD BLOCKED / CLOSED</span>`;
      } else if (widened) {
        tooltipContent += `<br><span style="color: #0284c7; font-weight: bold;">➕ ROAD EXPANDED (+1 LANE)</span>`;
      }
      if (Math.abs(timeSavedMins) > 0.05) {
        tooltipContent += `<br><span style="color: ${timeSavedMins > 0 ? '#059669' : '#dc2626'}; font-weight: bold;">${timeSavedMins > 0 ? `⚡ Time Saved: -${timeSavedMins.toFixed(1)} min` : `⚠️ Delay: +${Math.abs(timeSavedMins).toFixed(1)} min`}</span>`;
      }
      if (recommendation) {
        tooltipContent += `<br><strong style="color: ${recommendation.type === 'REMOVE_ROAD' ? '#f59e0b' : '#06b6d4'};">⚡ Optimizer: ${recommendation.type === 'REMOVE_ROAD' ? '🚫 Proposed Closure (Braess Fix)' : '➕ Proposed Expansion'} (-${recommendation.travel_time_reduction_pct}% latency)</strong>`;
      }

      if (showNames) {
        line.bindTooltip(tooltipContent, { sticky: true });
      }

      line.on('click', () => setSelectedEdgeId(edge.id));
      line.addTo(layers);

      // On-Graph Badge / On-Path Route Travel Time & Time Saved Label
      if (showLabels && points.length >= 2) {
        const midLatLng = getEdgeMidpoint(points);
        let badgeHtml: string | null = null;
        let isRec = false;

        if (closed) {
          badgeHtml = `<div class="on-graph-badge badge-closed">🚫 CLOSED</div>`;
        } else if (widened) {
          badgeHtml = `<div class="on-graph-badge badge-widened">➕ WIDENED</div>`;
        } else if (recommendation) {
          isRec = true;
          badgeHtml = recommendation.type === 'REMOVE_ROAD'
            ? `<div class="on-graph-badge badge-remove" title="Click to apply this road closure">🚫 BLOCK -${recommendation.travel_time_reduction_pct.toFixed(0)}%</div>`
            : `<div class="on-graph-badge badge-widen" title="Click to apply this widening">➕ WIDEN -${recommendation.travel_time_reduction_pct.toFixed(0)}%</div>`;
        } else {
          // Regular route travel time & time saved label
          const hasSignificantDelta = Math.abs(timeSavedMins) > 0.05 && baselineSimulation && baselineSimulation !== simulation;
          const isDense = graph.edges.length > 25;

          // Visibility filter for dense networks so text doesn't overflow or occlude
          let shouldShow = false;
          if (!isDense) {
            shouldShow = true;
          } else if (hasSignificantDelta) {
            shouldShow = true;
          } else if (mapZoom < 13) {
            shouldShow = volume >= 500;
          } else if (mapZoom < 15) {
            shouldShow = volume >= 120;
          } else {
            shouldShow = volume >= 20;
          }

          if (shouldShow && (volume > 0 || !isDense)) {
            const timeStr = currentTimeMins < 10 ? currentTimeMins.toFixed(1) + 'm' : Math.round(currentTimeMins) + 'm';
            const volStr = volume >= 1000 ? (volume / 1000).toFixed(1) + 'k' : Math.round(volume).toString();

            if (hasSignificantDelta) {
              const deltaStr = timeSavedMins > 0
                ? `-${timeSavedMins < 10 ? timeSavedMins.toFixed(1) : Math.round(timeSavedMins)}m`
                : `+${Math.abs(timeSavedMins) < 10 ? Math.abs(timeSavedMins).toFixed(1) : Math.round(Math.abs(timeSavedMins))}m`;
              const deltaClass = timeSavedMins > 0 ? 'delta-save' : 'delta-delay';
              const borderClass = timeSavedMins > 0 ? 'border-save' : 'border-delay';

              badgeHtml = `<div class="on-path-label ${borderClass} ${!isDense ? 'synthetic' : ''}" title="${edge.name || edge.id}: ${timeStr}, Saved: ${deltaStr}"><span class="path-time">${timeStr}</span> <span class="${deltaClass}">(${deltaStr})</span></div>`;
            } else {
              badgeHtml = `<div class="on-path-label ${!isDense ? 'synthetic' : ''}" title="${edge.name || edge.id}: ${timeStr} | ${Math.round(volume)} vph"><span class="path-time">${timeStr}</span>${!isDense || mapZoom >= 14 ? `<span class="path-sep">|</span><span class="path-vol">${volStr}</span>` : ''}</div>`;
            }
          }
        }

        if (badgeHtml) {
          const badgeIcon = L.divIcon({
            className: 'on-path-container',
            html: badgeHtml,
            iconSize: undefined
          });

          const badgeMarker = L.marker(midLatLng, { icon: badgeIcon, interactive: true });
          if (isRec && recommendation) {
            badgeMarker.on('click', (e) => {
              L.DomEvent.stopPropagation(e);
              applyActions([...interventions, recommendation.action]);
            });
          } else {
            badgeMarker.on('click', (e) => {
              L.DomEvent.stopPropagation(e);
              setSelectedEdgeId(edge.id);
            });
          }
          badgeMarker.addTo(layers);
        }
      }
    });

    // Intersection Node Display: only render nodes on the current graph that are real intersections or centroids
    if (showNodes) {
      // Calculate intersection degrees based strictly on current active edges
      const nodeDegrees = new Map<string, number>();
      graph.edges.forEach((edge) => {
        nodeDegrees.set(edge.source, (nodeDegrees.get(edge.source) || 0) + 1);
        nodeDegrees.set(edge.target, (nodeDegrees.get(edge.target) || 0) + 1);
      });

      const selectedNodeIds = new Set<string>();
      if (selectedEdge) {
        selectedNodeIds.add(selectedEdge.source);
        selectedNodeIds.add(selectedEdge.target);
      }

      graph.nodes.forEach((node) => {
        const degree = nodeDegrees.get(node.id) || 0;
        const isOrigin = node.type === 'origin' || node.id.startsWith('O') || node.id === 'A';
        const isDest = node.type === 'destination' || node.id.startsWith('D') || node.id === 'D';
        const isSelectedEndpoint = selectedNodeIds.has(node.id);
        const isRealIntersection = degree >= 2;

        // Render only if the node is a real intersection, centroid, or selected endpoint
        if (!isRealIntersection && !isOrigin && !isDest && !isSelectedEndpoint) {
          return;
        }

        const marker = L.circleMarker([node.lat, node.lng], {
          radius: isSelectedEndpoint ? 8 : (isOrigin || isDest ? 6 : (degree >= 3 ? 4.5 : 3.5)),
          color: isSelectedEndpoint ? '#0284c7' : '#0f172a',
          weight: isSelectedEndpoint ? 2.5 : 1.5,
          fillColor: isOrigin ? '#2563eb' : (isDest ? '#059669' : (isSelectedEndpoint ? '#38bdf8' : '#ffffff')),
          fillOpacity: 1
        });
        if (showNames) marker.bindTooltip(`${node.label || node.id} (${degree} connections)`);
        marker.addTo(layers);
      });
    }

    if (graph && fittedGraphIdRef.current !== graph.graph_id) {
      fittedGraphIdRef.current = graph.graph_id;
      map.fitBounds(bounds.pad(0.08), { maxZoom: graph.nodes.length > 60 ? 15 : 14 });
    }
  }, [graph, simulation, baselineSimulation, progress, selectedEdgeId, interventions, optimization, discoveredRecommendations, showNames, showNodes, showLabels, mapZoom]);

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
        fillOpacity: 1,
        interactive: false
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
    // Reset all previous optimized interventions, reports, and selection when rerunning
    setInterventions([]);
    setReport(null);
    setSelectedEdgeId(null);
    setOptimization(null);
    setDiscoveredRecommendations([]);

    const targetGraphId = areaId || selectedScenario;
    stopOptimizer.current?.();
    setOptimizing(true);
    setError(null);
    optimizationStartTimeRef.current = Date.now();
    setOptimizationEta(null);
    setOptimizationProgress({ current: 0, total: optSettings.max_candidates });

    stopOptimizer.current = startOptimizationStream(
      targetGraphId,
      demandMultiplier,
      {
        ...config,
        max_iterations: optSettings.max_iterations,
        default_alpha: optSettings.alpha,
        default_beta: optSettings.beta,
        convergence_tolerance: optSettings.convergence_tolerance
      },
      (event) => {
        let eta = event.eta_sec ?? null;
        if (eta === null && optimizationStartTimeRef.current && event.current > 0 && event.total > 0) {
          const elapsed = (Date.now() - optimizationStartTimeRef.current) / 1000;
          eta = Math.max(0, (elapsed / event.current) * (event.total - event.current));
        }
        setOptimizationEta(eta !== null ? Number(eta.toFixed(1)) : null);
        setOptimizationProgress({
          current: event.current,
          total: event.total,
          name: event.name,
          action_type: event.action_type
        });
      },
      (recommendation) => setDiscoveredRecommendations((current) => [...current, recommendation]),
      (result) => {
        setOptimization(result);
        setOptimizing(false);
        setOptimizationEta(null);
      },
      (optimizerError: Error) => {
        setError(optimizerError.message);
        setOptimizing(false);
        setOptimizationEta(null);
      },
      {
        max_candidates: optSettings.max_candidates,
        min_savings_pct: optSettings.min_savings_pct
      }
    );
  };

  const deduplicateActions = (actions: InterventionAction[]): InterventionAction[] => {
    const seen = new Set<string>();
    const result: InterventionAction[] = [];
    for (const a of actions) {
      const key = a.edge_id || `${a.action}_${result.length}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(a);
      }
    }
    return result;
  };

  const recommendations = optimization?.recommendations || discoveredRecommendations;
  const closeRecommendations = recommendations.filter((r) => r.type === 'REMOVE_ROAD' || r.action.action === 'CLOSE');
  const widenRecommendations = recommendations.filter((r) => r.type === 'WIDEN_ROAD' || r.action.action === 'WIDEN');
  interface ScenarioResult {
    report: InterventionReport;
    actions: InterventionAction[];
  }
  const [closingsResult, setClosingsResult] = useState<ScenarioResult | null>(null);
  const [wideningsResult, setWideningsResult] = useState<ScenarioResult | null>(null);
  const [combinedResult, setCombinedResult] = useState<ScenarioResult | null>(null);
  const [activeScenarioMode, setActiveScenarioMode] = useState<'baseline' | 'closings' | 'widenings' | 'combined'>('baseline');
  const [activeStepRunning, setActiveStepRunning] = useState<'baseline' | 'closings' | 'widenings' | 'combined' | null>(null);
  const [configPresetSaved, setConfigPresetSaved] = useState(false);

  const saveConfigPreset = () => {
    try {
      const data = {
        demandMultiplier,
        roadDensity,
        config,
        optSettings
      };
      localStorage.setItem('urbanflow_config_preset', JSON.stringify(data));
      setConfigPresetSaved(true);
      setTimeout(() => setConfigPresetSaved(false), 2500);
    } catch {}
  };

  const resetConfigPreset = () => {
    setDemandMultiplier(1.0);
    setRoadDensity(1.0);
    setConfig({
      algorithm: 'msa',
      max_iterations: 30,
      convergence_tolerance: 1e-3,
      default_alpha: 0.15,
      default_beta: 4.0,
      cost_model: 'bpr'
    });
    setOptSettings(DEFAULT_SETTINGS);
    localStorage.removeItem('urbanflow_config_preset');
    if (masterGraphRef.current) {
      setGraph(filterGraphByDensity(masterGraphRef.current, 1.0));
    }
  };

  const runBaselineStep = async () => {
    if (!graph) return;
    setActiveStepRunning('baseline');
    setInterventions([]);
    setReport(null);
    setActiveScenarioMode('baseline');
    try {
      await runLiveSimulation(graph.graph_id);
    } finally {
      setActiveStepRunning(null);
    }
  };

  const runClosingsOnlyStep = async () => {
    if (!graph || closeRecommendations.length === 0) return;
    const actions = deduplicateActions(closeRecommendations.map((r) => r.action));
    setActiveStepRunning('closings');
    setLoading(true);
    setError(null);
    try {
      const nextReport = await evaluateIntervention({
        base_graph_id: graph.graph_id,
        demand_multiplier: demandMultiplier,
        modifications: actions,
        config
      });
      setClosingsResult({ report: nextReport, actions });
      setInterventions(actions);
      setReport(nextReport);
      setSimulation(nextReport.intervention);
      setActiveScenarioMode('closings');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setActiveStepRunning(null);
    }
  };

  const runWideningsOnlyStep = async () => {
    if (!graph || widenRecommendations.length === 0) return;
    const actions = deduplicateActions(widenRecommendations.map((r) => r.action));
    setActiveStepRunning('widenings');
    setLoading(true);
    setError(null);
    try {
      const nextReport = await evaluateIntervention({
        base_graph_id: graph.graph_id,
        demand_multiplier: demandMultiplier,
        modifications: actions,
        config
      });
      setWideningsResult({ report: nextReport, actions });
      setInterventions(actions);
      setReport(nextReport);
      setSimulation(nextReport.intervention);
      setActiveScenarioMode('widenings');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setActiveStepRunning(null);
    }
  };

  const runAllOperationsStep = async () => {
    if (!graph || recommendations.length === 0) return;
    const actions = optimization?.optimal_combined_actions?.length
      ? optimization.optimal_combined_actions
      : deduplicateActions(recommendations.map((r) => r.action));
    setActiveStepRunning('combined');
    setLoading(true);
    setError(null);
    try {
      const nextReport = await evaluateIntervention({
        base_graph_id: graph.graph_id,
        demand_multiplier: demandMultiplier,
        modifications: actions,
        config
      });
      setCombinedResult({ report: nextReport, actions });
      setInterventions(actions);
      setReport(nextReport);
      setSimulation(nextReport.intervention);
      setActiveScenarioMode('combined');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setActiveStepRunning(null);
    }
  };

  const viewScenarioOnMap = (mode: 'baseline' | 'closings' | 'widenings' | 'combined') => {
    setActiveScenarioMode(mode);
    if (mode === 'baseline') {
      setInterventions([]);
      if (baselineSimulation) {
        setSimulation(baselineSimulation);
        setReport(null);
      } else if (graph) {
        runLiveSimulation(graph.graph_id);
      }
    } else if (mode === 'closings' && closingsResult) {
      setInterventions(closingsResult.actions);
      setReport(closingsResult.report);
      setSimulation(closingsResult.report.intervention);
    } else if (mode === 'widenings' && wideningsResult) {
      setInterventions(wideningsResult.actions);
      setReport(wideningsResult.report);
      setSimulation(wideningsResult.report.intervention);
    } else if (mode === 'combined' && combinedResult) {
      setInterventions(combinedResult.actions);
      setReport(combinedResult.report);
      setSimulation(combinedResult.report.intervention);
    }
  };

  const formatActionDescription = (action: InterventionAction) => {
    const edge = graph?.edges.find((e) => e.id === action.edge_id);
    const edgeName = edge?.name || action.edge_id;
    if (action.action === 'CLOSE') {
      return `🚫 Close ${edgeName}`;
    }
    if (action.action === 'WIDEN') {
      return `➕ Widen ${edgeName} (+1 lane)`;
    }
    return `⚡ ${action.action} ${edgeName}`;
  };

  const clearAreaSelection = () => {
    areaRect.current?.remove();
    areaRect.current = null;
    setAreaId(null);
    setAreaMode(false);
    fetchGraph(selectedScenario).then((data) => {
      masterGraphRef.current = data;
      setGraph(filterGraphByDensity(data, roadDensity));
      runLiveSimulation(data.graph_id);
    });
  };

  const widen = () => selectedEdge && applyActions([...interventions, { action: 'WIDEN', edge_id: selectedEdge.id, new_lanes: selectedEdge.lanes + 1, new_capacity_vph: selectedEdge.capacity_vph * 1.5 }]);
  const isSelectedClosed = selectedEdge ? interventions.filter((action) => action.edge_id === selectedEdge.id).slice(-1)[0]?.action === 'CLOSE' : false;
  const close = () => selectedEdge && applyActions(isSelectedClosed ? [...interventions, { action: 'OPEN', edge_id: selectedEdge.id }] : [...interventions, { action: 'CLOSE', edge_id: selectedEdge.id }]);
  const reset = () => {
    setInterventions([]);
    setReport(null);
    setClosingsResult(null);
    setWideningsResult(null);
    setCombinedResult(null);
    setActiveScenarioMode('baseline');
    if (graph) runLiveSimulation(graph.graph_id);
  };
  const fitNetwork = () => {
    if (!graph || !mapInstance.current) return;
    const bounds = L.latLngBounds(graph.nodes.map((node) => [node.lat, node.lng] as L.LatLngExpression));
    mapInstance.current.fitBounds(bounds.pad(0.08), { maxZoom: 15 });
  };

  return (
    <div className="app-shell">
      {/* Top Navigation Bar: Minimal & Uncluttered */}
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
              <option value="random_world_city">🎲 Fetch Random World City Area</option>
            </optgroup>
            <optgroup label="⚙️ Synthetic Networks">
              <option value="braess_3route">Canonical 3-Road Paradox (Three Routes A ➔ B)</option>
              <option value="braess_4node">Classic Braess Paradox (4 Nodes)</option>
              <option value="expanded_8node">Expanded Multi-Hub (8 Nodes, Latent Braess)</option>
              <option value="grid_3x3">3x3 Urban Grid Network (9 Nodes)</option>
              <option value="bottleneck_bridge">Bottleneck Bridge Hub (6 Nodes)</option>
            </optgroup>
          </select>

          <button className="btn" onClick={() => handleRandomSelection()} disabled={loading} title="Extract random world city road network from OpenStreetMap">
            <Dices size={14} />
            Random Area
          </button>
        </div>
      </header>

      {/* 3-Column Full-Bleed Layout */}
      <div className="app-layout">
        {/* LEFT SIDEBAR: Saveable Configuration & Selected Route Inspector */}
        <aside className="sidebar-left-pane">
          {/* Configuration Card (Saveable) */}
          <section className="step-card">
            <div className="step-card-header">
              <span className="step-card-title">
                <Sliders size={14} /> Network Configuration
              </span>
              {configPresetSaved && (
                <span style={{ fontSize: '0.7rem', color: '#059669', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <Check size={11} /> Saved
                </span>
              )}
            </div>
            <div className="step-card-body">
              <label>
                Traffic Demand: <strong>{Math.round(demandMultiplier * 100)}% {demandMultiplier === 1.0 ? '(Peak Rush)' : ''}</strong>
              </label>
              <input
                type="range"
                min="0.2"
                max="3.0"
                step="0.1"
                value={demandMultiplier}
                onChange={(event) => handleDemandChange(Number(event.target.value))}
              />

              {!isSynthetic && (
                <>
                  <label style={{ marginTop: '4px' }}>
                    Road Density Filter: <strong>{roadDensity < 0.3 ? 'Motorways' : roadDensity < 0.6 ? 'Arterials' : roadDensity < 0.85 ? 'Tertiary' : 'All Roads'} ({Math.round(roadDensity * 100)}%)</strong>
                  </label>
                  <input
                    type="range"
                    min="0.0"
                    max="1.0"
                    step="0.05"
                    value={roadDensity}
                    onChange={(event) => handleRoadDensityChange(Number(event.target.value))}
                  />
                </>
              )}

              <details open={showAdvanced} onToggle={(event) => setShowAdvanced((event.currentTarget as HTMLDetailsElement).open)} style={{ marginTop: '4px' }}>
                <summary style={{ fontSize: '0.74rem' }}>Advanced Engine Settings</summary>
                <div className="advanced-fields" style={{ paddingTop: '6px' }}>
                  <div className="field-grid">
                    <label>
                      Alpha (α)
                      <input
                        className="text-input"
                        type="number"
                        step="0.05"
                        value={optSettings.alpha}
                        onChange={(event) => setOptSettings({ ...optSettings, alpha: Number(event.target.value) })}
                      />
                    </label>
                    <label>
                      Beta (β)
                      <input
                        className="text-input"
                        type="number"
                        step="0.5"
                        value={optSettings.beta}
                        onChange={(event) => setOptSettings({ ...optSettings, beta: Number(event.target.value) })}
                      />
                    </label>
                  </div>
                  <div className="field-grid">
                    <label>
                      MSA Iterations
                      <input
                        className="text-input"
                        type="number"
                        min="5"
                        max="100"
                        value={optSettings.max_iterations}
                        onChange={(event) => setOptSettings({ ...optSettings, max_iterations: Number(event.target.value) })}
                      />
                    </label>
                    <label>
                      Max Candidates
                      <input
                        className="text-input"
                        type="number"
                        min="5"
                        max="50"
                        value={optSettings.max_candidates}
                        onChange={(event) => setOptSettings({ ...optSettings, max_candidates: Number(event.target.value) })}
                      />
                    </label>
                  </div>
                  <div className="field-grid">
                    <label>
                      Min Savings %
                      <input
                        className="text-input"
                        type="number"
                        step="0.1"
                        min="0.1"
                        max="10"
                        value={optSettings.min_savings_pct}
                        onChange={(event) => setOptSettings({ ...optSettings, min_savings_pct: Number(event.target.value) })}
                      />
                    </label>
                    <label>
                      Conv. Tolerance
                      <input
                        className="text-input"
                        type="number"
                        step="0.0005"
                        min="0.0001"
                        max="0.05"
                        value={optSettings.convergence_tolerance}
                        onChange={(event) => setOptSettings({ ...optSettings, convergence_tolerance: Number(event.target.value) })}
                      />
                    </label>
                  </div>
                </div>
              </details>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '4px' }}>
                <button className="btn btn-sm" onClick={saveConfigPreset} title="Save current settings to localStorage preset">
                  <Save size={12} /> Save Config
                </button>
                <button className="btn btn-sm" onClick={resetConfigPreset} title="Reset all settings to default values">
                  <RotateCcw size={12} /> Reset
                </button>
              </div>
            </div>
          </section>

          {/* Route Details Inspector */}
          <section className="step-card">
            <div className="step-card-header">
              <span className="step-card-title">
                <Route size={14} /> Route Inspector
              </span>
              {selectedEdge && (
                <button className="icon-btn" onClick={() => setSelectedEdgeId(null)} title="Clear selection">
                  ✕
                </button>
              )}
            </div>
            <div className="step-card-body">
              {selectedEdge ? (
                <div className="route-inspector-card">
                  <strong style={{ fontSize: '0.85rem' }}>{selectedEdge.name || selectedEdge.id}</strong>
                  <div className="inspector-meta-row">
                    <span>Edge ID</span>
                    <code>{selectedEdge.id}</code>
                  </div>
                  <div className="inspector-meta-row">
                    <span>Corridor Endpoints</span>
                    <b>{selectedEdge.source} ➔ {selectedEdge.target}</b>
                  </div>
                  <div className="inspector-meta-row">
                    <span>Road Type</span>
                    <b>{selectedEdge.road_type || 'tertiary'}</b>
                  </div>
                  <div className="inspector-meta-row">
                    <span>Length & Lanes</span>
                    <b>{selectedEdge.length_m >= 1000 ? `${(selectedEdge.length_m / 1000).toFixed(2)} km` : `${Math.round(selectedEdge.length_m)} m`} ({selectedEdge.lanes} {selectedEdge.lanes > 1 ? 'lanes' : 'lane'})</b>
                  </div>
                  <div className="inspector-meta-row">
                    <span>Free Speed / Capacity</span>
                    <b>{selectedEdge.free_speed_kmh} km/h · {Math.round(selectedEdge.capacity_vph).toLocaleString()} vph</b>
                  </div>
                  <div className="inspector-meta-row">
                    <span>Current Speed</span>
                    <b style={{ color: selectedMetric && selectedMetric.avg_speed_kmh < selectedEdge.free_speed_kmh * 0.6 ? '#dc2626' : '#059669' }}>
                      {selectedMetric ? `${selectedMetric.avg_speed_kmh} km/h` : 'Simulating...'}
                    </b>
                  </div>
                  <div className="inspector-meta-row">
                    <span>Current Volume</span>
                    <b>{Math.round(selectedMetric?.volume_vph || progress?.edge_volumes[selectedEdge.id] || 0).toLocaleString()} vph</b>
                  </div>
                  <div className="inspector-meta-row">
                    <span>V/C Ratio</span>
                    <b style={{
                      color: (selectedMetric?.vc_ratio ?? 0) >= 0.95 ? '#dc2626' : (selectedMetric?.vc_ratio ?? 0) >= 0.75 ? '#d97706' : '#059669'
                    }}>
                      {selectedMetric?.vc_ratio?.toFixed(2) || '0.00'} {(selectedMetric?.vc_ratio ?? 0) >= 0.95 ? '(Bottleneck)' : (selectedMetric?.vc_ratio ?? 0) >= 0.75 ? '(Congested)' : '(Free)'}
                    </b>
                  </div>

                  <div className="button-row" style={{ marginTop: '6px' }}>
                    <button className="btn btn-success btn-sm" onClick={widen} disabled={loading}>
                      <Plus size={12} /> Widen (+1 Lane)
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={close} disabled={loading}>
                      <Ban size={12} /> {isSelectedClosed ? 'Reopen Link' : 'Close Link'}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="muted" style={{ padding: '4px 0' }}>
                  Click any road link on the map to inspect its capacity, speed, traffic volume, and congestion metrics.
                </p>
              )}
            </div>
          </section>
        </aside>

        {/* CENTER: Interactive Map Canvas */}
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
                <Route size={14} /> {areaMode ? 'Drawing Area...' : 'Draw Area'}
              </button>

              {areaId && (
                <button className="btn" onClick={clearAreaSelection} title="Clear custom area selection">
                  Clear Area
                </button>
              )}

              <button className="btn" onClick={() => setShowLabels(!showLabels)} title="Toggle route travel times & time saved labels">
                <Tag size={14} /> Labels {showLabels ? 'on' : 'off'}
              </button>

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
                <MapIcon size={14} /> Basemap {showBasemap ? 'on' : 'off'}
              </button>

              <button className="btn" onClick={fitNetwork} title="Recenter and fit network in view">
                <LocateFixed size={14} /> Recenter Fit
              </button>
            </div>

            <div className="map-info">
              <strong>Network Info</strong>
              <span>{graph ? `${graph.nodes.length}n · ${graph.edges.length}e` : 'Loading...'}</span>
            </div>
          </div>

          {/* Map Legend */}
          <div className="legend">
            <span><i className="legend-line free" /> V/C &lt; 0.75 (Free)</span>
            <span><i className="legend-line moderate" /> V/C 0.75–0.95 (Moderate)</span>
            <span><i className="legend-line severe" /> V/C &ge; 0.95 (Bottleneck)</span>
            <span><i className="legend-line widened" /> Widened</span>
            <span><i className="legend-line closed" /> Closed</span>
            <span><i className="legend-line proposed-remove" /> Proposed Closure</span>
            <span><i className="legend-line proposed-widen" /> Proposed Widening</span>
          </div>
        </main>

        {/* RIGHT SIDEBAR: Step-by-Step Workflow & Results */}
        <aside className="sidebar-right-pane">
          {/* STEP 1: Simulate Baseline */}
          <section className="step-card">
            <div className="step-card-header">
              <span className="step-card-title">
                <Play size={14} /> Step 1: Baseline Simulation
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {baselineSimulation && <span style={{ fontSize: '0.7rem', color: '#059669', fontWeight: 700 }}>✓ SIMULATED</span>}
                {interventions.length > 0 && (
                  <button className="icon-btn" onClick={reset} title="Reset Network to Baseline">
                    <RotateCcw size={13} />
                  </button>
                )}
              </div>
            </div>
            <div className="step-card-body">
              <button
                className="btn btn-primary step-action-btn"
                onClick={runBaselineStep}
                disabled={loading || optimizing || !graph}
                title="Simulate current baseline traffic network without interventions"
              >
                <Play size={14} />
                1. Simulate Baseline
              </button>

              {/* Step 1 Progress & ETA Indicator */}
              {activeStepRunning === 'baseline' && progress && (
                <div className="optimizer-progress-box" style={{ borderLeft: '3px solid #0284c7' }}>
                  <div className="progress-label-row">
                    <span><strong>Simulating Baseline:</strong> Iteration {progress.iteration} / {progress.max_iterations}</span>
                    <strong>
                      {Math.round((progress.iteration / progress.max_iterations) * 100)}%
                      {simulationEta !== null && <span style={{ marginLeft: '6px', color: '#0284c7' }}>ETA: {simulationEta}s</span>}
                    </strong>
                  </div>
                  <div className="progress-bar-track">
                    <div
                      className="progress-bar-fill"
                      style={{ width: `${Math.round((progress.iteration / progress.max_iterations) * 100)}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Baseline Results Section */}
              {baselineSimulation ? (
                <div className="comparison-box" style={{ marginTop: '2px' }}>
                  <div>
                    <span>Avg Travel Time</span>
                    <b>{baselineSimulation.summary_metrics.avg_travel_time_mins.toFixed(1)} min</b>
                  </div>
                  <div>
                    <span>Avg Network Speed</span>
                    <b>{baselineSimulation.summary_metrics.avg_network_speed_kmh.toFixed(1)} km/h</b>
                  </div>
                  <div>
                    <span>Congested Corridors</span>
                    <b>{baselineSimulation.summary_metrics.severely_congested_edges_count} links</b>
                  </div>
                  <div>
                    <span>Assignment Status</span>
                    <b>{baselineSimulation.summary_metrics.converged ? 'Converged' : 'Max iterations'} ({baselineSimulation.summary_metrics.iterations_run} iters)</b>
                  </div>
                </div>
              ) : (
                <p className="muted" style={{ padding: '2px 0' }}>
                  Click <strong>1. Simulate Baseline</strong> to calculate equilibrium travel times for the selected road density and traffic demand.
                </p>
              )}
            </div>
          </section>

          {/* STEP 2: Network Optimizer */}
          <section className="step-card">
            <div className="step-card-header">
              <span className="step-card-title">
                <Zap size={14} /> Step 2: Network Optimizer
              </span>
              {recommendations.length > 0 && <code>{recommendations.length} actions</code>}
            </div>
            <div className="step-card-body">
              <button
                className="btn step-action-btn"
                onClick={handleOptimizer}
                disabled={optimizing || loading || !graph}
                title="Scan candidate road closures and widenings across CPU cores"
              >
                <Zap size={14} />
                2. Run Optimizer
              </button>

              {/* Step 2 Candidate Streaming Progress & ETA */}
              {optimizing && (
                <div className="optimizer-progress-box" style={{ borderLeft: '3px solid #8b5cf6' }}>
                  <div className="progress-label-row">
                    <span><strong>Evaluating Candidates:</strong> {optimizationProgress.current} / {optimizationProgress.total || '...'}</span>
                    <strong>
                      {optimizationProgress.total > 0 ? `${Math.round((optimizationProgress.current / optimizationProgress.total) * 100)}%` : '0%'}
                      {optimizationEta !== null && <span style={{ marginLeft: '6px', color: '#8b5cf6' }}>ETA: {optimizationEta}s</span>}
                    </strong>
                  </div>
                  <div className="progress-bar-track">
                    <div
                      className="progress-bar-fill"
                      style={{
                        width: `${optimizationProgress.total > 0 ? Math.round((optimizationProgress.current / optimizationProgress.total) * 100) : 5}%`,
                        background: '#8b5cf6'
                      }}
                    />
                  </div>
                  {optimizationProgress.name && (
                    <span className="candidate-status-text">
                      Testing {optimizationProgress.action_type === 'REMOVE_ROAD' ? '🚫 Closure' : '➕ Expansion'}: {optimizationProgress.name}
                    </span>
                  )}
                </div>
              )}

              {/* Optimizer Discovered Recommendations Summary */}
              {recommendations.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto' }}>
                  {recommendations.map((rec) => (
                    <div className="recommendation" key={rec.edge_id} style={{ padding: '6px', background: '#ffffff', border: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong style={{ fontSize: '0.78rem' }}>{rec.type === 'REMOVE_ROAD' ? '🚫 Close' : '➕ Widen'} {rec.edge_name}</strong>
                        <span style={{ color: '#059669', fontWeight: 700 }}>-{rec.travel_time_reduction_pct}%</span>
                      </div>
                      <span style={{ color: '#64748b', fontSize: '0.72rem' }}>
                        {rec.avg_travel_time_before_mins}m ➔ {rec.avg_travel_time_after_mins}m
                      </span>
                    </div>
                  ))}
                </div>
              ) : !optimizing ? (
                <p className="muted" style={{ padding: '2px 0' }}>
                  Click <strong>2. Run Optimizer</strong> to discover candidate road closures (Braess paradox links) and expansions.
                </p>
              ) : null}
            </div>
          </section>

          {/* STEP 3: Three Scenario Simulations & Sections */}
          <section className="step-card">
            <div className="step-card-header">
              <span className="step-card-title">
                <Sliders size={14} /> Step 3: Evaluate Interventions
              </span>
            </div>
            <div className="step-card-body">
              {/* 3 Step Buttons (Fixed Sizes) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <button
                  className="btn step-action-btn"
                  onClick={runClosingsOnlyStep}
                  disabled={loading || optimizing || closeRecommendations.length === 0}
                  style={{ borderLeft: '4px solid #ef4444' }}
                  title="Simulate ONLY candidate road closures (non-stacking)"
                >
                  🚫 Simulate Closings Only ({closeRecommendations.length})
                </button>

                <button
                  className="btn step-action-btn"
                  onClick={runWideningsOnlyStep}
                  disabled={loading || optimizing || widenRecommendations.length === 0}
                  style={{ borderLeft: '4px solid #10b981' }}
                  title="Simulate ONLY candidate road widenings (non-stacking)"
                >
                  ➕ Simulate Widenings Only ({widenRecommendations.length})
                </button>

                <button
                  className="btn btn-primary step-action-btn"
                  onClick={runAllOperationsStep}
                  disabled={loading || optimizing || recommendations.length === 0}
                  title="Simulate ALL recommended operations combined (non-stacking)"
                >
                  ⚡ Simulate All Operations ({recommendations.length})
                </button>
              </div>

              {/* Step 3 Simulating Indicator */}
              {(activeStepRunning === 'closings' || activeStepRunning === 'widenings' || activeStepRunning === 'combined') && (
                <div className="optimizer-progress-box" style={{ borderLeft: '3px solid #0284c7' }}>
                  <div className="progress-label-row">
                    <span><strong>Simulating {activeStepRunning === 'closings' ? 'Closings' : activeStepRunning === 'widenings' ? 'Widenings' : 'All Operations'}...</strong></span>
                  </div>
                </div>
              )}

              {/* THREE DEDICATED SECTIONS */}
              {report && (
                <div className="alert-box" style={{ fontSize: '0.72rem', margin: '4px 0' }}>
                  {report.delta.summary_text}
                </div>
              )}
              {error && (
                <div className="alert-box error" style={{ fontSize: '0.72rem', margin: '4px 0' }}>
                  {error}
                </div>
              )}
              <div className="scenario-sections-grid" style={{ marginTop: '4px' }}>
                {/* Section 1: Closings Only */}
                <div className={`scenario-card ${activeScenarioMode === 'closings' ? 'active-map-view' : ''}`}>
                  <div className="scenario-card-header">
                    <span className="scenario-card-title" style={{ color: '#ef4444' }}>
                      🚫 Section 1: Closings Only
                    </span>
                    {closingsResult && (
                      <button
                        className={`btn btn-sm ${activeScenarioMode === 'closings' ? 'btn-primary' : ''}`}
                        onClick={() => viewScenarioOnMap('closings')}
                      >
                        {activeScenarioMode === 'closings' ? '✓ On Map' : 'View'}
                      </button>
                    )}
                  </div>
                  {closingsResult ? (
                    <>
                      <div className="comparison-box">
                        <div>
                          <span>Travel Time</span>
                          <b>{closingsResult.report.intervention.summary_metrics.avg_travel_time_mins.toFixed(1)} min</b>
                        </div>
                        <div>
                          <span>Average Speed</span>
                          <b>{closingsResult.report.intervention.summary_metrics.avg_network_speed_kmh.toFixed(1)} km/h</b>
                        </div>
                        <strong className={closingsResult.report.delta.avg_travel_time_change_pct <= 0 ? 'good' : 'bad'}>
                          {closingsResult.report.delta.avg_travel_time_change_pct <= 0 ? '' : '+'}
                          {closingsResult.report.delta.avg_travel_time_change_pct.toFixed(1)}% vs baseline
                        </strong>
                      </div>
                      <div className="scenario-changes-list">
                        <strong style={{ fontSize: '0.7rem', color: '#475569' }}>Changes Applied ({closingsResult.actions.length}):</strong>
                        {closingsResult.actions.map((act, idx) => (
                          <div key={idx} className="scenario-change-item">
                            {formatActionDescription(act)}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="muted" style={{ fontSize: '0.72rem' }}>
                      Click <strong>Simulate Closings Only</strong> to evaluate the impact of closing Braess shortcut links alone.
                    </p>
                  )}
                </div>

                {/* Section 2: Widenings Only */}
                <div className={`scenario-card ${activeScenarioMode === 'widenings' ? 'active-map-view' : ''}`}>
                  <div className="scenario-card-header">
                    <span className="scenario-card-title" style={{ color: '#10b981' }}>
                      ➕ Section 2: Widenings Only
                    </span>
                    {wideningsResult && (
                      <button
                        className={`btn btn-sm ${activeScenarioMode === 'widenings' ? 'btn-primary' : ''}`}
                        onClick={() => viewScenarioOnMap('widenings')}
                      >
                        {activeScenarioMode === 'widenings' ? '✓ On Map' : 'View'}
                      </button>
                    )}
                  </div>
                  {wideningsResult ? (
                    <>
                      <div className="comparison-box">
                        <div>
                          <span>Travel Time</span>
                          <b>{wideningsResult.report.intervention.summary_metrics.avg_travel_time_mins.toFixed(1)} min</b>
                        </div>
                        <div>
                          <span>Average Speed</span>
                          <b>{wideningsResult.report.intervention.summary_metrics.avg_network_speed_kmh.toFixed(1)} km/h</b>
                        </div>
                        <strong className={wideningsResult.report.delta.avg_travel_time_change_pct <= 0 ? 'good' : 'bad'}>
                          {wideningsResult.report.delta.avg_travel_time_change_pct <= 0 ? '' : '+'}
                          {wideningsResult.report.delta.avg_travel_time_change_pct.toFixed(1)}% vs baseline
                        </strong>
                      </div>
                      <div className="scenario-changes-list">
                        <strong style={{ fontSize: '0.7rem', color: '#475569' }}>Changes Applied ({wideningsResult.actions.length}):</strong>
                        {wideningsResult.actions.map((act, idx) => (
                          <div key={idx} className="scenario-change-item">
                            {formatActionDescription(act)}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="muted" style={{ fontSize: '0.72rem' }}>
                      Click <strong>Simulate Widenings Only</strong> to evaluate the impact of corridor capacity expansions alone.
                    </p>
                  )}
                </div>

                {/* Section 3: All Operations Combined */}
                <div className={`scenario-card ${activeScenarioMode === 'combined' ? 'active-map-view' : ''}`}>
                  <div className="scenario-card-header">
                    <span className="scenario-card-title" style={{ color: '#0284c7' }}>
                      ⚡ Section 3: All Operations (Combined)
                    </span>
                    {combinedResult && (
                      <button
                        className={`btn btn-sm ${activeScenarioMode === 'combined' ? 'btn-primary' : ''}`}
                        onClick={() => viewScenarioOnMap('combined')}
                      >
                        {activeScenarioMode === 'combined' ? '✓ On Map' : 'View'}
                      </button>
                    )}
                  </div>
                  {combinedResult ? (
                    <>
                      <div className="comparison-box">
                        <div>
                          <span>Travel Time</span>
                          <b>{combinedResult.report.intervention.summary_metrics.avg_travel_time_mins.toFixed(1)} min</b>
                        </div>
                        <div>
                          <span>Average Speed</span>
                          <b>{combinedResult.report.intervention.summary_metrics.avg_network_speed_kmh.toFixed(1)} km/h</b>
                        </div>
                        <strong className={combinedResult.report.delta.avg_travel_time_change_pct <= 0 ? 'good' : 'bad'}>
                          {combinedResult.report.delta.avg_travel_time_change_pct <= 0 ? '' : '+'}
                          {combinedResult.report.delta.avg_travel_time_change_pct.toFixed(1)}% vs baseline
                        </strong>
                      </div>
                      <div className="scenario-changes-list">
                        <strong style={{ fontSize: '0.7rem', color: '#475569' }}>Changes Applied ({combinedResult.actions.length}):</strong>
                        {combinedResult.actions.map((act, idx) => (
                          <div key={idx} className="scenario-change-item">
                            {formatActionDescription(act)}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="muted" style={{ fontSize: '0.72rem' }}>
                      Click <strong>Simulate All Operations</strong> to evaluate closures and widenings combined.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}