import React, { useState, useEffect } from 'react';
import { Activity, Play, Plus, GitBranch, AlertTriangle, CheckCircle2, Sliders } from 'lucide-react';
import { UrbanFlowGraph, SimulationResult, InterventionReport, InterventionAction } from './types';
import { fetchGraph, runSimulation, evaluateIntervention, MOCK_BRAESS_BASELINE_GRAPH } from './services/api';

export default function App() {
  const [selectedScenario, setSelectedScenario] = useState<string>('braess_4node');
  const [graph, setGraph] = useState<UrbanFlowGraph>(MOCK_BRAESS_BASELINE_GRAPH);
  const [demandMultiplier, setDemandMultiplier] = useState<number>(1.0);
  const [activeInterventions, setActiveInterventions] = useState<InterventionAction[]>([]);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [interventionReport, setInterventionReport] = useState<InterventionReport | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Load selected graph on scenario change
  useEffect(() => {
    loadGraphData(selectedScenario);
  }, [selectedScenario]);

  const loadGraphData = async (graphId: string) => {
    setIsLoading(true);
    setActiveInterventions([]);
    setInterventionReport(null);
    const data = await fetchGraph(graphId);
    setGraph(data);
    const sim = await runSimulation(graphId, demandMultiplier);
    setSimulationResult(sim);
    setIsLoading(false);
  };

  const handleRunSimulation = async () => {
    setIsLoading(true);
    if (activeInterventions.length > 0) {
      const report = await evaluateIntervention({
        base_graph_id: selectedScenario,
        demand_multiplier: demandMultiplier,
        modifications: activeInterventions
      });
      setInterventionReport(report);
      setSimulationResult(report.intervention);
    } else {
      const sim = await runSimulation(selectedScenario, demandMultiplier);
      setSimulationResult(sim);
      setInterventionReport(null);
    }
    setIsLoading(false);
  };

  const toggleBraessShortcut = () => {
    const hasShortcut = activeInterventions.some(m => m.action === 'ADD' && m.new_edge?.id === 'e_BC');
    if (hasShortcut) {
      setActiveInterventions(activeInterventions.filter(m => !(m.action === 'ADD' && m.new_edge?.id === 'e_BC')));
    } else {
      const newEdge = {
        id: 'e_BC',
        source: 'B',
        target: 'C',
        name: 'B ➔ C (Zero-Cost Shortcut)',
        length_m: 100,
        lanes: 4,
        free_speed_kmh: 100,
        capacity_vph: 10000,
        geometry: [[76.320, 10.020], [76.320, 9.980]]
      };
      setActiveInterventions([...activeInterventions, { action: 'ADD', new_edge: newEdge }]);
    }
  };

  const selectedEdge = graph.edges.find(e => e.id === selectedEdgeId);
  const selectedMetric = selectedEdgeId && simulationResult ? simulationResult.edge_metrics[selectedEdgeId] : null;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header className="app-header">
        <div className="brand-container">
          <Activity size={24} color="#06b6d4" />
          <h1 className="brand-title">UrbanFlow</h1>
          <span className="brand-badge">PBL ENGINE v1.0</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <select
            className="select-input"
            style={{ width: 220 }}
            value={selectedScenario}
            onChange={(e) => setSelectedScenario(e.target.value)}
          >
            <option value="braess_4node">Braess Paradox Network</option>
            <option value="grid_3x3">3x3 Urban Grid Network</option>
            <option value="bottleneck_bridge">Bottleneck Bridge Hub</option>
            <option value="kochi_central">Kochi Central (Real OSM)</option>
          </select>

          <button
            className="btn btn-primary"
            onClick={handleRunSimulation}
            disabled={isLoading}
          >
            <Play size={16} />
            {isLoading ? 'Simulating...' : 'Run Simulation'}
          </button>
        </div>
      </header>

      {/* 3-Pane Dashboard Layout */}
      <div className="app-layout">
        {/* Left Pane: Intervention Studio */}
        <aside className="pane glass-panel">
          <div>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <GitBranch size={18} color="#06b6d4" />
              Intervention Studio
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Test candidate road modifications to evaluate their network-wide equilibrium effects.
            </p>
          </div>

          {selectedScenario === 'braess_4node' && (
            <div className="stat-card" style={{ borderLeft: '3px solid var(--accent-cyan)' }}>
              <h3 style={{ fontSize: '0.85rem', marginBottom: 8 }}>⚡ Quick Experiment</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
                Toggle the zero-cost shortcut road (B ➔ C) to observe the Braess Paradox.
              </p>
              <button
                className={`btn ${activeInterventions.some(m => m.action === 'ADD') ? 'btn-danger' : 'btn-secondary'}`}
                style={{ width: '100%' }}
                onClick={toggleBraessShortcut}
              >
                {activeInterventions.some(m => m.action === 'ADD') ? 'Remove Shortcut Road (B➔C)' : 'Add Shortcut Road (B➔C)'}
              </button>
            </div>
          )}

          {/* Selected Road Details */}
          <div className="stat-card">
            <h3 style={{ fontSize: '0.85rem', marginBottom: 8 }}>Selected Road Segment</h3>
            {selectedEdge ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.8rem' }}>
                <div><strong>Name:</strong> {selectedEdge.name || selectedEdge.id}</div>
                <div><strong>Lanes:</strong> {selectedEdge.lanes}</div>
                <div><strong>Capacity:</strong> {selectedEdge.capacity_vph} vph</div>
                <div><strong>Length:</strong> {selectedEdge.length_m} m</div>
                {selectedMetric && (
                  <>
                    <div><strong>Assigned Flow:</strong> {selectedMetric.volume_vph} vph</div>
                    <div><strong>V/C Ratio:</strong> {selectedMetric.vc_ratio}</div>
                    <div><strong>Status:</strong> <span style={{ textTransform: 'capitalize', color: selectedMetric.vc_ratio > 0.95 ? 'var(--status-red)' : 'var(--status-green)' }}>{selectedMetric.congestion_level}</span></div>
                  </>
                )}
              </div>
            ) : (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Click any road on the map to inspect or modify its capacity.
              </div>
            )}
          </div>

          {/* Staged modifications */}
          <div>
            <h3 style={{ fontSize: '0.85rem', marginBottom: 8 }}>Active Staged Changes ({activeInterventions.length})</h3>
            {activeInterventions.length === 0 ? (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No modifications staged.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {activeInterventions.map((mod, i) => (
                  <div key={i} style={{ fontSize: '0.75rem', padding: '6px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: 4, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{mod.action}: {mod.new_edge?.name || mod.edge_id}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Center: Graph / Map Canvas */}
        <main className="center-canvas-pane">
          {/* Braess Paradox Alert Banner */}
          {interventionReport?.delta.is_braess_paradox && (
            <div className="pulsing-alert" style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid var(--status-red)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <AlertTriangle color="#ef4444" size={20} />
              <div style={{ fontSize: '0.85rem', color: '#fca5a5' }}>
                <strong>Braess Paradox Phenomenon Detected!</strong> {interventionReport.delta.summary_text}
              </div>
            </div>
          )}

          <div className="graph-canvas-container">
            {/* 2D Synthetic SVG / Canvas Visualizer */}
            <svg style={{ width: '100%', height: '100%' }} viewBox="0 0 800 500">
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
                </marker>
                <marker id="arrow-congested" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
                </marker>
              </defs>

              {/* Render edges */}
              {graph.edges.map((edge) => {
                const isSelected = edge.id === selectedEdgeId;
                const metric = simulationResult?.edge_metrics[edge.id];
                const vc = metric?.vc_ratio || 0;
                
                let strokeColor = '#10b981';
                if (vc >= 1.0) strokeColor = '#ef4444';
                else if (vc >= 0.85) strokeColor = '#f59e0b';

                // Fixed 2D mapping for Braess Network demo
                const posMap: Record<string, [number, number]> = {
                  'A': [150, 250],
                  'B': [400, 120],
                  'C': [400, 380],
                  'D': [650, 250],
                  'N_0_0': [200, 100], 'N_0_1': [400, 100], 'N_0_2': [600, 100],
                  'N_1_0': [200, 250], 'N_1_1': [400, 250], 'N_1_2': [600, 250],
                  'N_2_0': [200, 400], 'N_2_1': [400, 400], 'N_2_2': [600, 400],
                  'W1': [100, 200], 'W2': [220, 250], 'W3': [340, 250],
                  'E1': [480, 250], 'E2': [600, 250], 'E3': [720, 300]
                };

                const [x1, y1] = posMap[edge.source] || [200, 250];
                const [x2, y2] = posMap[edge.target] || [600, 250];

                return (
                  <g key={edge.id} onClick={() => setSelectedEdgeId(edge.id)} style={{ cursor: 'pointer' }}>
                    <line
                      x1={x1} y1={y1} x2={x2} y2={y2}
                      stroke={isSelected ? '#06b6d4' : strokeColor}
                      strokeWidth={isSelected ? 6 : Math.max(3, edge.lanes * 2)}
                      markerEnd={vc >= 1.0 ? 'url(#arrow-congested)' : 'url(#arrow)'}
                      strokeOpacity={0.85}
                    />
                    {/* Edge Label */}
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2 - 8}
                      fill="#cbd5e1"
                      fontSize="11"
                      fontFamily="JetBrains Mono"
                      textAnchor="middle"
                    >
                      {edge.name ? edge.name.split(' ')[0] : edge.id} ({metric ? `${metric.volume_vph}vph` : ''})
                    </text>
                  </g>
                );
              })}

              {/* Render Active Added Road */}
              {activeInterventions.filter(m => m.action === 'ADD' && m.new_edge).map(mod => {
                const e = mod.new_edge!;
                return (
                  <line
                    key={e.id}
                    x1={400} y1={120} x2={400} y2={380}
                    stroke="#06b6d4"
                    strokeWidth={5}
                    strokeDasharray="6,4"
                    markerEnd="url(#arrow)"
                  />
                );
              })}

              {/* Render nodes */}
              {graph.nodes.map((node) => {
                const posMap: Record<string, [number, number]> = {
                  'A': [150, 250], 'B': [400, 120], 'C': [400, 380], 'D': [650, 250],
                  'N_0_0': [200, 100], 'N_0_1': [400, 100], 'N_0_2': [600, 100],
                  'N_1_0': [200, 250], 'N_1_1': [400, 250], 'N_1_2': [600, 250],
                  'N_2_0': [200, 400], 'N_2_1': [400, 400], 'N_2_2': [600, 400],
                  'W1': [100, 200], 'W2': [220, 250], 'W3': [340, 250],
                  'E1': [480, 250], 'E2': [600, 250], 'E3': [720, 300]
                };
                const [x, y] = posMap[node.id] || [400, 250];

                return (
                  <g key={node.id}>
                    <circle cx={x} cy={y} r={14} fill="#1e293b" stroke="#38bdf8" strokeWidth={2} />
                    <text x={x} y={y + 4} fill="#f8fafc" fontSize="11" fontWeight="600" textAnchor="middle">
                      {node.id}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Bottom demand slider */}
            <div style={{ position: 'absolute', bottom: 16, left: 16, right: 16, background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(10px)', padding: '10px 16px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 16 }}>
              <Sliders size={16} color="#94a3b8" />
              <span style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>Demand Factor: {(demandMultiplier * 100).toFixed(0)}%</span>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={demandMultiplier}
                onChange={(e) => setDemandMultiplier(parseFloat(e.target.value))}
                style={{ flex: 1, accentColor: 'var(--accent-cyan)' }}
              />
            </div>
          </div>
        </main>

        {/* Right Pane: Comparative Analytics HUD */}
        <aside className="pane glass-panel">
          <div>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Activity size={18} color="#06b6d4" />
              Simulation Metrics
            </h2>
          </div>

          {simulationResult && (
            <>
              <div className="stat-card">
                <div className="stat-label">Avg Vehicle Travel Time</div>
                <div className="stat-value">{simulationResult.summary_metrics.avg_travel_time_mins} <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>mins</span></div>
                {interventionReport && (
                  <div className={`stat-delta ${interventionReport.delta.avg_travel_time_change_pct <= 0 ? 'delta-good' : 'delta-bad'}`}>
                    {interventionReport.delta.avg_travel_time_change_pct > 0 ? '+' : ''}
                    {interventionReport.delta.avg_travel_time_change_pct}% vs baseline
                  </div>
                )}
              </div>

              <div className="stat-card">
                <div className="stat-label">Total Network Hours</div>
                <div className="stat-value">{simulationResult.summary_metrics.total_travel_time_hours} <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>hrs</span></div>
              </div>

              <div className="stat-card">
                <div className="stat-label">Average Network Speed</div>
                <div className="stat-value">{simulationResult.summary_metrics.avg_network_speed_kmh} <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>km/h</span></div>
              </div>

              <div className="stat-card">
                <div className="stat-label">Congested Road Count</div>
                <div className="stat-value" style={{ color: simulationResult.summary_metrics.severely_congested_edges_count > 0 ? 'var(--status-red)' : 'var(--status-green)' }}>
                  {simulationResult.summary_metrics.severely_congested_edges_count}
                </div>
              </div>

              {interventionReport && (
                <div className="stat-card" style={{ background: 'rgba(6, 182, 212, 0.08)', borderColor: 'rgba(6, 182, 212, 0.3)' }}>
                  <div className="stat-label" style={{ color: 'var(--accent-cyan)' }}>Intervention Evaluation</div>
                  <p style={{ fontSize: '0.8rem', marginTop: 4 }}>{interventionReport.delta.summary_text}</p>
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
