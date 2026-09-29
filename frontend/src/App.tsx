import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Layers, Play, RotateCcw, Sliders, Zap, Plus, Ban, LocateFixed, Map, Route } from 'lucide-react';
import {
  evaluateIntervention,
  fetchGraph,
  importOSMPlace,
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
const scenarios = [
  ['braess_4node', 'Classic Braess paradox'],
  ['expanded_8node', 'Expanded multi-hub'],
  ['grid_3x3', '3x3 urban grid'],
  ['bottleneck_bridge', 'Bottleneck bridge'],
  ['kochi_central', 'Kochi arterial network']
];

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
  const [scenario, setScenario] = useState('kochi_central');
  const [importedScenario, setImportedScenario] = useState<[string, string] | null>(null);
  const [importingPlace, setImportingPlace] = useState(false);
  const [viewMode, setViewMode] = useState<'live' | 'graph'>('live');
  const [livePlace, setLivePlace] = useState<'kochi' | 'new_york' | 'custom'>('kochi');
  const [graph, setGraph] = useState<UrbanFlowGraph | null>(null);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [progress, setProgress] = useState<SimulationProgressEvent | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [interventions, setInterventions] = useState<InterventionAction[]>([]);
  const [report, setReport] = useState<InterventionReport | null>(null);
  const [optimization, setOptimization] = useState<OptimizationResult | null>(null);
  const [discoveredRecommendations, setDiscoveredRecommendations] = useState<OptimizationResult['recommendations']>([]);
  const [optimizationProgress, setOptimizationProgress] = useState({ current: 0, total: 0 });
  const [showNames, setShowNames] = useState(true);
  const [monochrome, setMonochrome] = useState(false);
  const [showBasemap, setShowBasemap] = useState(true);
  const [showFlow, setShowFlow] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [analysisScope, setAnalysisScope] = useState<'network' | 'area'>('network');
  const [areaMode, setAreaMode] = useState(false);
  const [areaId, setAreaId] = useState<string | null>(null);
  const [demandMultiplier, setDemandMultiplier] = useState(1);
  const [config, setConfig] = useState<SimulationConfig>({ algorithm: 'msa', max_iterations: 30, convergence_tolerance: 0.001, default_alpha: 0.15, default_beta: 4, cost_model: 'bpr' });
  const [loading, setLoading] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const layerGroup = useRef<L.LayerGroup | null>(null);
  const flowLayerGroup = useRef<L.LayerGroup | null>(null);
  const tileLayer = useRef<L.TileLayer | null>(null);
  const stopStream = useRef<(() => void) | null>(null);
  const stopOptimizer = useRef<(() => void) | null>(null);
  const areaRect = useRef<L.Rectangle | null>(null);
  const areaModeRef = useRef(false);

  const runLiveSimulation = (graphId: string, nextConfig = config) => {
    stopStream.current?.();
    setLoading(true);
    setProgress(null);
    setError(null);
    stopStream.current = startSimulationStream(graphId, demandMultiplier, nextConfig,
      (event) => setProgress(event),
      (result) => {
        setSimulation(result);
        setLoading(false);
        setProgress(null);
      },
      (streamError) => {
        setError(streamError.message);
        setLoading(false);
      });
  };

  const handleLivePlaceChange = async (place: 'kochi' | 'new_york' | 'custom') => {
    setLivePlace(place);
    if (place === 'custom') {
      setViewMode('live');
      setAreaMode(true);
      return;
    }
    if (place === 'kochi') {
      setViewMode('live');
      setScenario('kochi_central');
      return;
    }
    setImportingPlace(true);
    setError(null);
    try {
      const imported = await importOSMPlace({ place: 'New York, New York, USA', network_type: 'drive', demand_multiplier: demandMultiplier, config });
      setImportedScenario([imported.graph.graph_id, imported.graph.name]);
      setScenario(imported.graph.graph_id);
      setGraph(imported.graph);
      setSimulation(imported.result);
      setAnalysisScope('network');
    } catch (importError) {
      setError((importError as Error).message);
    } finally {
      setImportingPlace(false);
    }
  };

  useEffect(() => {
    let active = true;
    setGraph(null);
    setSimulation(null);
    setInterventions([]);
    setReport(null);
    setOptimization(null);
    setDiscoveredRecommendations([]);
    setAreaId(null);
    setAnalysisScope('network');
    fetchGraph(scenario).then((data) => {
      if (!active) return;
      setGraph(data);
      runLiveSimulation(data.graph_id);
    }).catch((loadError: Error) => active && setError(loadError.message));
    return () => { active = false; stopStream.current?.(); };
  }, [scenario]);

  useEffect(() => {
    areaModeRef.current = areaMode;
  }, [areaMode]);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;
    const map = L.map(mapRef.current, { zoomControl: true, preferCanvas: true, attributionControl: true }).setView([9.9816, 76.2999], 12);
    mapInstance.current = map;
    map.dragging.disable();
    layerGroup.current = L.layerGroup().addTo(map);
    flowLayerGroup.current = L.layerGroup().addTo(map);
    requestAnimationFrame(() => map.invalidateSize({ pan: false }));
    const container = map.getContainer();
    let panStart: { x: number; y: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      if (areaModeRef.current || event.button !== 0) return;
      panStart = { x: event.clientX, y: event.clientY };
      container.setPointerCapture?.(event.pointerId);
      container.style.cursor = 'grabbing';
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!panStart || areaModeRef.current) return;
      const dx = event.clientX - panStart.x;
      const dy = event.clientY - panStart.y;
      if (dx === 0 && dy === 0) return;
      map.panBy([-dx, -dy], { animate: false });
      panStart = { x: event.clientX, y: event.clientY };
    };
    const onPointerUp = (event: PointerEvent) => {
      panStart = null;
      container.releasePointerCapture?.(event.pointerId);
      container.style.cursor = '';
    };
    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerUp);
    const cleanup = (): void => {
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerUp);
      map.off();
      map.remove();
      mapInstance.current = null;
      layerGroup.current = null;
    };
    return cleanup;
  }, []);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    map.dragging.disable();
    if (areaMode) {
      map.scrollWheelZoom.disable();
    } else {
      map.scrollWheelZoom.enable();
    }
    const onMouseDown = (event: L.LeafletMouseEvent) => {
      if (!areaMode) return;
      event.originalEvent.preventDefault();
      event.originalEvent.stopPropagation();
      const start = event.latlng;
      const move = (moveEvent: L.LeafletMouseEvent) => {
        areaRect.current?.remove();
        areaRect.current = L.rectangle(L.latLngBounds(start, moveEvent.latlng), { color: '#172033', weight: 2, fillOpacity: 0.08 }).addTo(map);
      };
      const end = async (endEvent: L.LeafletMouseEvent) => {
        map.off('mousemove', move); map.off('mouseup', end);
        const bounds = L.latLngBounds(start, endEvent.latlng);
        if (bounds.getNorthEast().equals(bounds.getSouthWest())) return;
        try {
          setLoading(true); setError(null);
          const analyzed = await analyzeArea({ graph_id: graph?.graph_id || scenario, min_lat: bounds.getSouth(), min_lng: bounds.getWest(), max_lat: bounds.getNorth(), max_lng: bounds.getEast(), demand_multiplier: demandMultiplier, config, fetch_osm: true });
          setAreaId(analyzed.area_id); setGraph(analyzed.graph); setSimulation(analyzed.result); setAnalysisScope('area'); setAreaMode(false);
        } catch (analysisError) { setError((analysisError as Error).message); }
        finally { setLoading(false); }
      };
      map.on('mousemove', move); map.on('mouseup', end);
    };
    map.on('mousedown', onMouseDown);
    return () => {
      map.off('mousedown', onMouseDown);
      map.scrollWheelZoom.enable();
    };
  }, [areaMode, scenario, demandMultiplier, config, graph?.graph_id]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    if (scenario === 'kochi_central' && showBasemap) {
      if (!tileLayer.current) tileLayer.current = L.tileLayer(TILE_URL, { maxZoom: 19, attribution: import.meta.env.VITE_MAP_ATTRIBUTION || '&copy; OpenStreetMap contributors' }).addTo(map);
    } else {
      tileLayer.current?.remove();
      tileLayer.current = null;
    }
  }, [scenario, showBasemap]);

  useEffect(() => {
    const map = mapInstance.current;
    const layers = layerGroup.current;
    if (!map || !layers || !graph) return;
    layers.clearLayers();
    const bounds = L.latLngBounds([]);
    graph.nodes.forEach((node) => bounds.extend([node.lat, node.lng]));
    graph.edges.forEach((edge) => {
      const points = edgePath(graph, edge);
      if (points.length < 2) return;
      points.forEach((point) => bounds.extend(point));
      const metric = simulation?.edge_metrics[edge.id];
      const volume = metric?.volume_vph ?? progress?.edge_volumes[edge.id] ?? 0;
      const edgeActions = interventions.filter((action) => action.edge_id === edge.id);
      const closed = edgeActions.length > 0 && edgeActions[edgeActions.length - 1].action === 'CLOSE';
      const widened = interventions.some((action) => action.action === 'WIDEN' && action.edge_id === edge.id);
      const vc = metric?.vc_ratio ?? volume / Math.max(edge.capacity_vph, 1);
      const recommendation = (optimization?.recommendations || discoveredRecommendations).find((item) => item.edge_id === edge.id);
      const line = L.polyline(points, { color: monochrome ? '#334155' : edgeColor(vc, closed, widened), weight: selectedEdgeId === edge.id ? 8 : Math.max(3, Math.min(9, edge.lanes + 1)), opacity: closed ? 0.45 : 0.88, dashArray: closed ? '8 7' : undefined });
      if (showNames) line.bindTooltip(`${edge.name || edge.id} | ${Math.round(volume).toLocaleString()} vph`, { sticky: true });
      line.bindPopup(`<strong>${edge.name || edge.id}</strong><br>${edge.source} → ${edge.target}<br>Vehicles: ${Math.round(volume).toLocaleString()} vph<br>Road capacity: ${Math.round(edge.capacity_vph).toLocaleString()} vph<br>Lanes: ${edge.lanes}<br>V/C: ${vc.toFixed(2)}${recommendation ? `<br><b>Optimizer: ${recommendation.type === 'REMOVE_ROAD' ? 'CLOSE' : 'WIDEN'}</b>` : ''}`);
      line.on('click', () => setSelectedEdgeId(edge.id));
      line.addTo(layers);
      if (recommendation) {
        line.setStyle({ color: recommendation.type === 'REMOVE_ROAD' ? '#dc2626' : '#2563eb', weight: 9, dashArray: recommendation.type === 'REMOVE_ROAD' ? '10 6' : undefined });
      }
    });
    graph.nodes.forEach((node) => {
      const marker = L.circleMarker([node.lat, node.lng], { radius: node.type === 'intersection' ? 4 : 7, color: '#172033', weight: 1, fillColor: node.type === 'origin' ? '#2563eb' : node.type === 'destination' ? '#059669' : '#ffffff', fillOpacity: 1 });
      if (showNames) marker.bindTooltip(node.label || node.id);
      marker.addTo(layers);
    });
    if (bounds.isValid() && map.getZoom() < 3) map.fitBounds(bounds.pad(0.08), { maxZoom: graph.nodes.length > 50 ? 15 : 14 });
  }, [graph, simulation, progress, selectedEdgeId, interventions, optimization, discoveredRecommendations, showNames, monochrome]);

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
      const marker = L.circleMarker(points[0], { radius: 3, color: '#0f172a', weight: 1, fillColor: monochrome ? '#334155' : edgeColor(metric?.vc_ratio ?? 0), fillOpacity: 1 }).addTo(layers);
      particles.push({ marker, points, offset: (edgeIndex * 0.17) % 1 });
    });
    const animate = () => {
      frame = window.requestAnimationFrame(animate);
      const now = (Date.now() % 5000) / 5000;
      particles.forEach(({ marker, points, offset }) => {
        const position = (now + offset) % 1;
        const segment = Math.min(points.length - 2, Math.floor(position * (points.length - 1)));
        const local = position * (points.length - 1) - segment;
        const a = L.latLng(points[segment]); const b = L.latLng(points[segment + 1]);
        marker.setLatLng([a.lat + (b.lat - a.lat) * local, a.lng + (b.lng - a.lng) * local]);
      });
    };
    animate();
    return () => { window.cancelAnimationFrame(frame); layers.clearLayers(); };
  }, [graph, simulation, progress, showFlow, monochrome]);

  const selectedEdge = graph?.edges.find((edge) => edge.id === selectedEdgeId);
  const selectedMetric = selectedEdgeId ? simulation?.edge_metrics[selectedEdgeId] : undefined;

  const applyActions = async (actions: InterventionAction[]) => {
    if (!graph) return;
    setLoading(true);
    setError(null);
    try {
      const nextReport = await evaluateIntervention({ base_graph_id: graph.graph_id, demand_multiplier: demandMultiplier, modifications: actions, config });
      setInterventions(actions);
      setReport(nextReport);
      setSimulation(nextReport.intervention);
    } catch (actionError) { setError((actionError as Error).message); }
    finally { setLoading(false); }
  };

  const handleOptimizer = () => {
    const targetGraphId = analysisScope === 'area' && areaId ? areaId : scenario;
    stopOptimizer.current?.();
    setOptimizing(true); setError(null); setOptimization(null); setDiscoveredRecommendations([]); setOptimizationProgress({ current: 0, total: 0 });
    stopOptimizer.current = startOptimizationStream(targetGraphId, demandMultiplier, config,
      (event) => setOptimizationProgress({ current: event.current, total: event.total }),
      (recommendation) => setDiscoveredRecommendations((current) => [...current, recommendation]),
      (result) => { setOptimization(result); setOptimizing(false); },
      (optimizerError: Error) => { setError(optimizerError.message); setOptimizing(false); });
  };

  const applyAllRecommendations = () => {
    const recommendations = optimization?.recommendations || discoveredRecommendations;
    if (recommendations.length > 0) applyActions(recommendations.map((recommendation) => recommendation.action));
  };

  const clearAreaSelection = () => {
    areaRect.current?.remove();
    areaRect.current = null;
    setAreaId(null);
    setAnalysisScope('network');
    setAreaMode(false);
    if (graph?.graph_id.includes('_area_')) {
      fetchGraph(scenario).then((data) => { setGraph(data); runLiveSimulation(data.graph_id); });
    }
  };

  const widen = () => selectedEdge && applyActions([...interventions, { action: 'WIDEN', edge_id: selectedEdge.id, new_lanes: selectedEdge.lanes + 1, new_capacity_vph: selectedEdge.capacity_vph * 1.5 }]);
  const isSelectedClosed = selectedEdge ? interventions.filter((action) => action.edge_id === selectedEdge.id).slice(-1)[0]?.action === 'CLOSE' : false;
  const close = () => selectedEdge && applyActions(isSelectedClosed ? [...interventions, { action: 'OPEN', edge_id: selectedEdge.id }] : [...interventions, { action: 'CLOSE', edge_id: selectedEdge.id }]);
  const reset = () => { setInterventions([]); setReport(null); if (graph) runLiveSimulation(graph.graph_id); };
  const fitNetwork = () => {
    if (!graph || !mapInstance.current) return;
    const bounds = L.latLngBounds(graph.nodes.map((node) => [node.lat, node.lng] as L.LatLngExpression));
    mapInstance.current.fitBounds(bounds.pad(0.08), { maxZoom: 15 });
  };

  return <div className="app-shell">
    <header className="app-header"><div className="brand-container"><Layers size={18} /><strong className="brand-title">URBANFLOW</strong><span className="brand-badge">LIVE NETWORK LAB</span></div><div className="header-actions"><select className="select-input mode-select" value={viewMode} onChange={(event) => setViewMode(event.target.value as 'live' | 'graph')}><option value="live">Live map mode</option><option value="graph">Synthetic graph mode</option></select>{viewMode === 'live' ? <select className="select-input scenario-select" value={livePlace} onChange={(event) => handleLivePlaceChange(event.target.value as 'kochi' | 'new_york' | 'custom')}><option value="kochi">Kochi</option><option value="new_york">New York</option><option value="custom">Custom square</option></select> : <select className="select-input scenario-select" value={scenario} onChange={(event) => setScenario(event.target.value)}>{scenarios.map(([id, label]) => <option key={id} value={id}>{label}</option>)}{importedScenario && <option value={importedScenario[0]}>{importedScenario[1]}</option>}</select>}<select className="select-input scope-select" value={analysisScope} onChange={(event) => setAnalysisScope(event.target.value as 'network' | 'area')}><option value="network">Whole network</option><option value="area" disabled={!areaId}>Selected area</option></select><button className="btn" onClick={handleOptimizer} disabled={optimizing || loading}><Zap size={14} />{optimizing ? `Analyzing ${optimizationProgress.total ? `${Math.round((optimizationProgress.current / optimizationProgress.total) * 100)}%` : ''}` : 'Run optimizer'}</button><button className="btn btn-primary" onClick={() => graph && runLiveSimulation(graph.graph_id)} disabled={loading || !graph}><Play size={14} />{loading ? `Simulating${progress ? ` ${progress.iteration}/${progress.max_iterations}` : ''}` : 'Simulate'}</button></div></header>
    <div className="app-layout"><aside className="sidebar-pane">
      <section className="panel"><div className="panel-header"><span><Sliders size={14} /> Simulation values</span><span className="muted">{config.algorithm.toUpperCase()}</span></div><div className="panel-body"><label>Demand pressure <strong>{demandMultiplier.toFixed(1)}×</strong></label><input type="range" min="0.5" max="2.5" step="0.1" value={demandMultiplier} onChange={(event) => setDemandMultiplier(Number(event.target.value))} /><small className="muted">Higher pressure increases OD vehicle demand and exposes equilibrium effects such as the Braess paradox.</small>{report && <div className="comparison-box"><div><span>Baseline average</span><b>{report.baseline.summary_metrics.avg_travel_time_mins} min</b></div><div><span>All paths result</span><b>{report.intervention.summary_metrics.avg_travel_time_mins} min</b></div><strong className={report.delta.avg_travel_time_change_pct <= 0 ? 'good' : 'bad'}>{report.delta.avg_travel_time_change_pct <= 0 ? '' : '+'}{report.delta.avg_travel_time_change_pct.toFixed(1)}% vs baseline</strong></div>}<details open={showAdvanced} onToggle={(event) => setShowAdvanced((event.currentTarget as HTMLDetailsElement).open)}><summary>Advanced settings</summary><div className="advanced-fields"><div className="field-grid"><label>BPR alpha<input className="text-input" type="number" step="0.05" value={config.default_alpha} onChange={(event) => setConfig({ ...config, default_alpha: Number(event.target.value) })} /></label><label>BPR beta<input className="text-input" type="number" step="0.5" value={config.default_beta} onChange={(event) => setConfig({ ...config, default_beta: Number(event.target.value) })} /></label></div><label>MSA iterations<input className="text-input" type="number" min="1" max="500" value={config.max_iterations} onChange={(event) => setConfig({ ...config, max_iterations: Number(event.target.value) })} /></label></div></details></div></section>
      <section className="panel"><div className="panel-header"><span>Selected link</span>{selectedEdge && <code>{selectedEdge.id}</code>}</div><div className="panel-body">{selectedEdge ? <><strong>{selectedEdge.name || selectedEdge.id}</strong><div className="stat-row"><span>Vehicles / hour</span><b>{Math.round(selectedMetric?.volume_vph || progress?.edge_volumes[selectedEdge.id] || 0).toLocaleString()}</b></div><div className="stat-row"><span>Road capacity</span><b>{Math.round(selectedMetric?.capacity_vph || selectedEdge.capacity_vph).toLocaleString()} vph</b></div><div className="stat-row"><span>V/C ratio</span><b>{selectedMetric?.vc_ratio?.toFixed(2) || 'pending'}</b></div><div className="stat-row"><span>Travel time</span><b>{selectedMetric ? `${(selectedMetric.congested_time_sec / 60).toFixed(1)} min` : 'pending'}</b></div><div className="button-row"><button className="btn btn-success" onClick={widen} disabled={loading}><Plus size={13} /> Widen</button><button className="btn btn-danger" onClick={close} disabled={loading}><Ban size={13} /> {isSelectedClosed ? 'Open' : 'Close'}</button></div></> : <p className="muted">Select a road on the map to inspect the live backend metrics.</p>}</div></section>
      <section className="panel"><div className="panel-header"><span>Network telemetry</span>{interventions.length > 0 && <button className="icon-btn" onClick={reset} title="Reset interventions"><RotateCcw size={14} /></button>}</div><div className="panel-body">{simulation ? <><div className="stat-row"><span>Vehicles in demand</span><b>{Math.round(simulation.summary_metrics.total_vehicles).toLocaleString()}</b></div><div className="stat-row"><span>Average trip</span><b>{simulation.summary_metrics.avg_travel_time_mins} min</b></div><div className="stat-row"><span>Network speed</span><b>{simulation.summary_metrics.avg_network_speed_kmh} km/h</b></div><div className="stat-row"><span>Congested links</span><b>{simulation.summary_metrics.severely_congested_edges_count}</b></div><div className="stat-row"><span>Assignment</span><b>{simulation.summary_metrics.converged ? 'Converged' : 'Max iterations'}</b></div></> : <p className="muted">Waiting for the backend assignment.</p>}{report && <div className="alert-box">{report.delta.summary_text}</div>}{error && <div className="alert-box error">{error}</div>}</div></section>
      <section className="panel recommendations"><div className="panel-header"><span>Optimizer results</span>{(optimization || discoveredRecommendations.length > 0) && <code>{optimization?.recommendations.length || discoveredRecommendations.length} actions</code>}</div><div className="panel-body">{(optimization?.recommendations || discoveredRecommendations).length > 0 ? <><button className="btn btn-primary" onClick={applyAllRecommendations} disabled={loading || optimizing}>Apply all paths and resimulate</button>{(optimization?.recommendations || discoveredRecommendations).map((recommendation) => <div className="recommendation" key={recommendation.edge_id}><strong>{recommendation.type === 'REMOVE_ROAD' ? 'Close' : 'Widen'} {recommendation.edge_name}</strong><span>Save {recommendation.travel_time_reduction_pct}% average time</span><button className="btn" onClick={() => applyActions([...interventions, recommendation.action])} disabled={loading}>Apply and resimulate</button></div>)}</> : <p className="muted">Run the optimizer to evaluate closures and capacity changes with the backend engine.</p>}</div></section>
    </aside><main className={`map-pane ${areaMode ? 'area-selecting' : ''}`}><div ref={mapRef} className="map-canvas" /><div className="map-toolbar"><div className="map-actions"><button className="btn" onClick={() => setAreaMode(!areaMode)} title="Toggle between map navigation and area drawing"><Route size={14} /> {areaMode ? 'Pan map' : 'Select area'}</button>{areaId && <button className="btn" onClick={clearAreaSelection} title="Clear selected analysis area">Clear area</button>}<button className="btn" onClick={() => setShowNames(!showNames)} title="Toggle road and node names">Names {showNames ? 'on' : 'off'}</button><button className="btn" onClick={() => setMonochrome(!monochrome)} title="Toggle monochrome network">Mono {monochrome ? 'on' : 'off'}</button><button className="btn" onClick={() => setShowFlow(!showFlow)} title="Toggle moving traffic markers">Flow {showFlow ? 'on' : 'off'}</button><button className="btn" onClick={() => setShowBasemap(!showBasemap)} title="Toggle OpenStreetMap basemap"><Map size={14} /> Map</button><button className="btn" onClick={fitNetwork} title="Fit network to view"><LocateFixed size={14} /></button></div><div className="map-info"><strong>Network view</strong><span>{graph ? `${graph.nodes.length} nodes` : 'Loading nodes'}</span><span>{graph ? `${graph.edges.length} links` : 'Loading links'}</span></div></div><div className="legend"><span><i className="legend-line free" /> Free</span><span><i className="legend-line moderate" /> Moderate</span><span><i className="legend-line severe" /> Bottleneck</span><span><i className="legend-line widened" /> Widened</span></div></main></div>
  </div>;
}