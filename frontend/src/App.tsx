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
  Check
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

  const [settingsSavedAlert, setSettingsSavedAlert] = useState(false);

  const [config, setConfig] = useState<SimulationConfig>({
    algorithm: 'msa',
    max_iterations: optSettings.max_iterations,
    convergence_tolerance: optSettings.convergence_tolerance,
    default_alpha: optSettings.alpha,
    default_beta: optSettings.beta,
    cost_model: 'bpr'
  });

  const saveOptimizerSettings = () => {
    try {
      localStorage.setItem('urbanflow_optimizer_settings', JSON.stringify(optSettings));
      setConfig((prev) => ({
        ...prev,
        max_iterations: optSettings.max_iterations,
        default_alpha: optSettings.alpha,
        default_beta: optSettings.beta,
        convergence_tolerance: optSettings.convergence_tolerance
      }));
      setSettingsSavedAlert(true);
      setTimeout(() => setSettingsSavedAlert(false), 2500);
    } catch {}
  };

  const resetOptimizerSettings = () => {
    setOptSettings(DEFAULT_SETTINGS);
    try {
      localStorage.setItem('urbanflow_optimizer_settings', JSON.stringify(DEFAULT_SETTINGS));
      setConfig((prev) => ({
        ...prev,
        max_iterations: DEFAULT_SETTINGS.max_iterations,
        default_alpha: DEFAULT_SETTINGS.alpha,
        default_beta: DEFAULT_SETTINGS.beta,
        convergence_tolerance: DEFAULT_SETTINGS.convergence_tolerance
      }));
      setSettingsSavedAlert(true);
      setTimeout(() => setSettingsSavedAlert(false), 2500);
    } catch {}
  };

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

  const isSynthetic = ['braess_3route', 'braess_4node', 'expanded_8node', 'grid_3x3', 'bottleneck_bridge'].includes(selectedScenario);

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
        setGraph(data);
        runLiveSimulation(data.graph_id);
      })
      .catch((loadError: Error) => active && setError(loadError.message));

    return () => {
      active = false;
      stopStream.current?.();
    };
  }, [selectedScenario]);

  // Re-simulate baseline when demand/road-density/config change for the active graph.
  // Selected-scenario switches already trigger this via the selectedScenario effect;
  // area-extraction sets its own graph, which also triggers a fresh resim once extraction resolves.
  useEffect(() => {
    if (!graph || !mapInstance.current) return;

    stopStream.current?.();
    setLoading(true);
    setProgress(null);
    setError(null);

    stopStream.current = startSimulationStream(
      graph.graph_id,
      demandMultiplier,
      config,
      (event) => setProgress(event),
      (result) => {
        setSimulation(result);
        setBaselineSimulation(result);
        setLoading(false);
        setProgress(null);
      },
      (streamError) => { setError(streamError.message); setLoading(false); }
    );
  }, [graph?.graph_id, demandMultiplier, roadDensity, config]);

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
      (event) => setOptimizationProgress({
        current: event.current,
        total: event.total,
        name: event.name,
        action_type: event.action_type
      }),
      (recommendation) => setDiscoveredRecommendations((current) => [...current, recommendation]),
      (result) => {
        setOptimization(result);
        setOptimizing(false);
      },
      (optimizerError: Error) => {
        setError(optimizerError.message);
        setOptimizing(false);
      },
      {
        max_candidates: optSettings.max_candidates,
        min_savings_pct: optSettings.min_savings_pct
      }
    );
  };

  const applyAllRecommendations = () => {
    if (optimization?.optimal_combined_actions && optimization.optimal_combined_actions.length > 0) {
      applyActions(optimization.optimal_combined_actions);
      return;
    }
    const recommendations = optimization?.recommendations || discoveredRecommendations;
    if (recommendations.length > 0) {
      const safeActions: InterventionAction[] = [];
      const bestClosure = recommendations.find((r) => r.type === 'REMOVE_ROAD' || r.action.action === 'CLOSE');
      if (bestClosure) safeActions.push(bestClosure.action);
      for (const rec of recommendations) {
        if (rec.type === 'WIDEN_ROAD' || rec.action.action === 'WIDEN') {
          if (!safeActions.some((a) => a.edge_id === rec.action.edge_id)) {
            safeActions.push(rec.action);
          }
        }
        if (safeActions.length >= 3) break;
      }
      applyActions(safeActions.length > 0 ? safeActions : [recommendations[0].action]);
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

        {/* Real-time Header Telemetry */}
        {simulation && (
          <div className="header-telemetry">
            <div className="header-telemetry-item">
              <span className="telemetry-label">Avg Travel Time</span>
              <strong className="telemetry-val">
                {simulation.summary_metrics.avg_travel_time_mins.toFixed(1)} min
              </strong>
            </div>
            {baselineSimulation && baselineSimulation !== simulation && (
              <div
                className={`header-telemetry-item ${
                  simulation.summary_metrics.avg_travel_time_mins < baselineSimulation.summary_metrics.avg_travel_time_mins
                    ? 'telemetry-saved'
                    : 'telemetry-delayed'
                }`}
              >
                <span className="telemetry-label">
                  {simulation.summary_metrics.avg_travel_time_mins < baselineSimulation.summary_metrics.avg_travel_time_mins
                    ? '⚡ Time Saved'
                    : '⚠️ Travel Delay'}
                </span>
                <strong className="telemetry-val">
                  {simulation.summary_metrics.avg_travel_time_mins < baselineSimulation.summary_metrics.avg_travel_time_mins ? '-' : '+'}
                  {Math.abs(baselineSimulation.summary_metrics.avg_travel_time_mins - simulation.summary_metrics.avg_travel_time_mins).toFixed(1)} min
                  {' '}({Math.abs(((simulation.summary_metrics.avg_travel_time_mins - baselineSimulation.summary_metrics.avg_travel_time_mins) / Math.max(baselineSimulation.summary_metrics.avg_travel_time_mins, 0.001)) * 100).toFixed(1)}%)
                </strong>
              </div>
            )}
          </div>
        )}

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
              <option value="braess_3route">Canonical 3-Road Paradox (Three Routes A ➔ B)</option>
              <option value="braess_4node">Classic Braess Paradox (4 Nodes)</option>
              <option value="expanded_8node">Expanded Multi-Hub (8 Nodes, Latent Braess)</option>
              <option value="grid_3x3">3x3 Urban Grid Network (9 Nodes)</option>
              <option value="bottleneck_bridge">Bottleneck Bridge Hub (6 Nodes)</option>
            </optgroup>
          </select>

          <button className="btn" onClick={handleOptimizer} disabled={optimizing || loading}>
            <Zap size={14} />
            {optimizing
              ? `Optimizing ${optimizationProgress.total > 0 ? `${Math.round((optimizationProgress.current / optimizationProgress.total) * 100)}% (${optimizationProgress.current}/${optimizationProgress.total})` : '...'}`
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
                Traffic Demand: <strong>{Math.round(demandMultiplier * 100)}% {demandMultiplier === 1.0 ? '(Peak Rush Hour)' : ''}</strong>
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
                <summary>Optimizer & Simulation Settings</summary>
                <div className="advanced-fields">
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
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <button className="btn btn-primary btn-sm" onClick={saveOptimizerSettings} style={{ flex: 1 }}>
                      <Save size={12} /> Save Settings
                    </button>
                    <button className="btn btn-sm" onClick={resetOptimizerSettings}>
                      Reset
                    </button>
                  </div>
                  {settingsSavedAlert && (
                    <div className="settings-save-alert">
                      <Check size={13} /> Settings saved & applied!
                    </div>
                  )}
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
                    <span>Travel Time</span>
                    <b>{selectedMetric ? `${(selectedMetric.congested_time_sec / 60).toFixed(1)} min` : 'Calculating...'}</b>
                  </div>
                  {selectedEdgeId && baselineSimulation?.edge_metrics[selectedEdgeId] && selectedMetric && baselineSimulation !== simulation && (
                    <div className="stat-row">
                      <span>Time Saved vs Baseline</span>
                      <b className={selectedMetric.congested_time_sec < baselineSimulation.edge_metrics[selectedEdgeId].congested_time_sec ? 'good' : selectedMetric.congested_time_sec > baselineSimulation.edge_metrics[selectedEdgeId].congested_time_sec ? 'bad' : ''}>
                        {selectedMetric.congested_time_sec < baselineSimulation.edge_metrics[selectedEdgeId].congested_time_sec ? '-' : '+'}
                        {Math.abs((baselineSimulation.edge_metrics[selectedEdgeId].congested_time_sec - selectedMetric.congested_time_sec) / 60).toFixed(1)} min
                        {' '}({Math.abs(((baselineSimulation.edge_metrics[selectedEdgeId].congested_time_sec - selectedMetric.congested_time_sec) / Math.max(baselineSimulation.edge_metrics[selectedEdgeId].congested_time_sec, 0.1)) * 100).toFixed(1)}%)
                      </b>
                    </div>
                  )}
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
              {optimizing && (
                <div className="optimizer-progress-box">
                  <div className="progress-label-row">
                    <span><strong>Evaluating Candidates:</strong> {optimizationProgress.current} / {optimizationProgress.total || '...'}</span>
                    <strong>{optimizationProgress.total > 0 ? `${Math.round((optimizationProgress.current / optimizationProgress.total) * 100)}%` : '0%'}</strong>
                  </div>
                  <div className="progress-bar-track">
                    <div
                      className="progress-bar-fill"
                      style={{ width: `${optimizationProgress.total > 0 ? Math.round((optimizationProgress.current / optimizationProgress.total) * 100) : 5}%` }}
                    />
                  </div>
                  {optimizationProgress.name && (
                    <span className="candidate-status-text">
                      Testing {optimizationProgress.action_type === 'REMOVE_ROAD' ? '🚫 Closure' : '➕ Expansion'}: {optimizationProgress.name}
                    </span>
                  )}
                </div>
              )}

              {(optimization?.recommendations || discoveredRecommendations).length > 0 ? (
                <>
                  <button className="btn btn-primary" onClick={applyAllRecommendations} disabled={loading || optimizing} style={{ width: '100%', marginBottom: '8px' }}>
                    Apply Optimal Strategy Package & Resimulate
                  </button>
                  {(optimization?.recommendations || discoveredRecommendations).map((rec) => (
                    <div className="recommendation" key={rec.edge_id}>
                      <strong>{rec.type === 'REMOVE_ROAD' ? '🚫 Close' : '➕ Widen'} {rec.edge_name}</strong>
                      <span style={{ color: '#10b981', fontWeight: 600 }}>
                        Save {rec.travel_time_reduction_pct}% trip latency ({rec.avg_travel_time_before_mins}m ➔ {rec.avg_travel_time_after_mins}m)
                      </span>
                      {rec.explanation && <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: '4px 0 6px 0', lineHeight: 1.3 }}>{rec.explanation}</p>}
                      <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                        <button className="btn btn-sm" onClick={() => applyActions([rec.action])} disabled={loading} title="Apply this single action alone">
                          Apply Single Action
                        </button>
                        <button className="btn btn-sm" onClick={() => applyActions([...interventions.filter(a => a.edge_id !== rec.action.edge_id), rec.action])} disabled={loading} title="Add to active interventions">
                          + Add
                        </button>
                      </div>
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

          {/* Floating Action Controls (Vertical Bottom-Right Section) */}
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
      </div>
    </div>
  );
}