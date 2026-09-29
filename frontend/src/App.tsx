import { useState, useEffect } from 'react';
import {
  Activity,
  Play,
  Zap,
  Sliders,
  Settings2,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  GitFork
} from 'lucide-react';
import {
  UrbanFlowGraph,
  SimulationResult,
  InterventionReport,
  InterventionAction,
  OptimizationResult,
  SimulationConfig
} from './types';
import {
  fetchGraph,
  runSimulation,
  evaluateIntervention,
  fetchOptimizationRecommendations,
  MOCK_BRAESS_BASELINE_GRAPH
} from './services/api';

export default function App() {
  const [selectedScenario, setSelectedScenario] = useState<string>('braess_4node');
  const [graph, setGraph] = useState<UrbanFlowGraph>(MOCK_BRAESS_BASELINE_GRAPH);
  const [demandMultiplier, setDemandMultiplier] = useState<number>(1.0);
  const [activeInterventions, setActiveInterventions] = useState<InterventionAction[]>([]);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [interventionReport, setInterventionReport] = useState<InterventionReport | null>(null);
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);
  const [showConfigDrawer, setShowConfigDrawer] = useState<boolean>(false);
  const [showParticles, setShowParticles] = useState<boolean>(true);
  const [particleSpeed, setParticleSpeed] = useState<number>(1.2);

  // Engine Configuration State
  const [engineConfig, setEngineConfig] = useState<SimulationConfig>({
    algorithm: 'msa',
    max_iterations: 40,
    convergence_tolerance: 0.0001,
    default_alpha: 0.15,
    default_beta: 4.0,
    cost_model: 'bpr'
  });

  useEffect(() => {
    loadGraphData(selectedScenario);
  }, [selectedScenario]);

  const loadGraphData = async (graphId: string) => {
    setIsLoading(true);
    setActiveInterventions([]);
    setInterventionReport(null);
    setOptimizationResult(null);
    setSelectedEdgeId(null);

    const data = await fetchGraph(graphId);
    setGraph(data);

    const sim = await runSimulation(graphId, demandMultiplier, engineConfig);
    setSimulationResult(sim);
    setIsLoading(false);
  };

  const handleRunSimulation = async () => {
    setIsLoading(true);
    if (activeInterventions.length > 0) {
      const report = await evaluateIntervention({
        base_graph_id: selectedScenario,
        demand_multiplier: demandMultiplier,
        modifications: activeInterventions,
        config: engineConfig
      });
      setInterventionReport(report);
      setSimulationResult(report.intervention);
    } else {
      const sim = await runSimulation(selectedScenario, demandMultiplier, engineConfig);
      setSimulationResult(sim);
      setInterventionReport(null);
    }
    setIsLoading(false);
  };

  const handleRunOptimizer = async () => {
    setIsOptimizing(true);
    const opt = await fetchOptimizationRecommendations(selectedScenario, demandMultiplier, engineConfig);
    setOptimizationResult(opt);
    setIsOptimizing(false);
  };

  const handleApplyOptimizerRecommendation = (action: InterventionAction) => {
    // Add action to staged interventions and trigger simulation
    const updated = [...activeInterventions, action];
    setActiveInterventions(updated);
    evaluateIntervention({
      base_graph_id: selectedScenario,
      demand_multiplier: demandMultiplier,
      modifications: updated,
      config: engineConfig
    }).then(report => {
      setInterventionReport(report);
      setSimulationResult(report.intervention);
    });
  };

  const toggleBraessShortcut = () => {
    const hasShortcut = activeInterventions.some(m => m.action === 'ADD' && m.new_edge?.id === 'e_BC');
    if (hasShortcut) {
      const updated = activeInterventions.filter(m => !(m.action === 'ADD' && m.new_edge?.id === 'e_BC'));
      setActiveInterventions(updated);
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

  const handleWidenSelectedRoad = () => {
    if (!selectedEdgeId) return;
    const edge = graph.edges.find(e => e.id === selectedEdgeId);
    if (!edge) return;
    const action: InterventionAction = {
      action: 'WIDEN',
      edge_id: edge.id,
      new_lanes: edge.lanes + 1,
      new_capacity_vph: edge.capacity_vph * 1.5,
      rationale: `Widen ${edge.name || edge.id} (+1 Lane)`
    };
    setActiveInterventions([...activeInterventions, action]);
  };

  const handleCloseSelectedRoad = () => {
    if (!selectedEdgeId) return;
    const edge = graph.edges.find(e => e.id === selectedEdgeId);
    if (!edge) return;
    const action: InterventionAction = {
      action: 'CLOSE',
      edge_id: edge.id,
      rationale: `Close/Remove ${edge.name || edge.id}`
    };
    setActiveInterventions([...activeInterventions, action]);
  };

  const handleResetInterventions = () => {
    setActiveInterventions([]);
    setInterventionReport(null);
    runSimulation(selectedScenario, demandMultiplier, engineConfig).then(setSimulationResult);
  };

  const selectedEdge = graph.edges.find(e => e.id === selectedEdgeId);
  const selectedMetric = selectedEdgeId && simulationResult ? simulationResult.edge_metrics[selectedEdgeId] : null;

  // Node Cartesian 2D Coordinate Layout Mapping
  const posMap: Record<string, [number, number]> = {
    // 4-Node Braess Network
    'A': [140, 240], 'B': [380, 110], 'C': [380, 370], 'D': [640, 240],
    
    // 8-Node Expanded Multi-Hub Network
    'O1': [120, 120], 'O2': [120, 360],
    'H1': [280, 120], 'H2': [280, 280],
    'H3': [460, 160], 'H4': [460, 340],
    'D1': [660, 160], 'D2': [660, 340],

    // 3x3 Grid Network
    'N_0_0': [200, 100], 'N_0_1': [400, 100], 'N_0_2': [600, 100],
    'N_1_0': [200, 240], 'N_1_1': [400, 240], 'N_1_2': [600, 240],
    'N_2_0': [200, 380], 'N_2_1': [400, 380], 'N_2_2': [600, 380],

    // 6-Node Bottleneck Bridge Network
    'W1': [100, 180], 'W2': [220, 240], 'W3': [330, 240],
    'E1': [470, 240], 'E2': [580, 240], 'E3': [700, 300]
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top Navigation Bar */}
      <header className="app-header">
        <div className="brand-container">
          <Activity size={24} color="#06b6d4" />
          <h1 className="brand-title">UrbanFlow</h1>
          <span className="brand-badge">PBL OPTIMIZER</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <select
            className="select-input"
            style={{ width: 280 }}
            value={selectedScenario}
            onChange={(e) => setSelectedScenario(e.target.value)}
          >
            <option value="braess_4node">1. Classic Braess Paradox (4 Nodes)</option>
            <option value="expanded_8node">2. Expanded City Network (8 Nodes, Latent Braess)</option>
            <option value="grid_3x3">3. 3x3 Urban Grid Network (9 Nodes)</option>
            <option value="bottleneck_bridge">4. Bottleneck Bridge Hub (6 Nodes)</option>
          </select>

          <button
            className="btn btn-secondary"
            onClick={() => setShowConfigDrawer(!showConfigDrawer)}
            title="Tweak BPR & MSA Simulation Algorithms"
          >
            <Settings2 size={16} />
            Config
          </button>

          <button
            className="btn btn-secondary"
            style={{ borderColor: 'var(--accent-cyan)', color: 'var(--accent-cyan)' }}
            onClick={handleRunOptimizer}
            disabled={isOptimizing}
          >
            <Zap size={16} />
            {isOptimizing ? 'Analyzing Network...' : 'Run Optimizer'}
          </button>

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

      {/* Main 3-Pane Layout */}
      <div className="app-layout">
        {/* Left Pane: Intervention Studio & Optimizer Recommendations */}
        <aside className="pane glass-panel">
          <div>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Zap size={18} color="#06b6d4" />
              Network Optimizer & Studio
            </h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Automatically scans for Braess Paradox links to remove and bottlenecks to widen.
            </p>
          </div>

          {/* Scenario Specific Shortcut Quick Action */}
          {selectedScenario === 'braess_4node' && (
            <div className="stat-card" style={{ borderLeft: '3px solid var(--accent-cyan)' }}>
              <h3 style={{ fontSize: '0.85rem', marginBottom: 4 }}>⚡ Braess Paradox Experiment</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 10 }}>
                Toggle the shortcut road (B ➔ C) to observe travel time jumping from 65 min to 80 min.
              </p>
              <button
                className={`btn ${activeInterventions.some(m => m.action === 'ADD') ? 'btn-danger' : 'btn-primary'}`}
                style={{ width: '100%', fontSize: '0.8rem' }}
                onClick={toggleBraessShortcut}
              >
                {activeInterventions.some(m => m.action === 'ADD') ? 'Remove Shortcut (B➔C)' : 'Add Shortcut Road (B➔C)'}
              </button>
            </div>
          )}

          {/* Optimizer Recommendations List */}
          {optimizationResult && (
            <div className="stat-card glass-panel-glow" style={{ background: 'rgba(6, 182, 212, 0.06)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h3 style={{ fontSize: '0.85rem', color: 'var(--accent-cyan)', fontWeight: 600 }}>
                  ⚡ Optimizer Output ({optimizationResult.recommendations.length} Suggestions)
                </h3>
                <span style={{ fontSize: '0.7rem', color: 'var(--status-green)', fontWeight: 600 }}>
                  -{optimizationResult.projected_overall_improvement_pct}% Delay
                </span>
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 10 }}>
                {optimizationResult.summary}
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {optimizationResult.recommendations.map((rec) => (
                  <div
                    key={rec.rank}
                    style={{
                      padding: '10px',
                      background: 'rgba(15, 23, 42, 0.8)',
                      borderRadius: '8px',
                      border: `1px solid ${rec.is_braess_fix ? 'rgba(239, 68, 68, 0.4)' : 'rgba(16, 185, 129, 0.4)'}`
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span
                        style={{
                          fontSize: '0.7rem',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontWeight: 700,
                          background: rec.type === 'REMOVE_ROAD' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                          color: rec.type === 'REMOVE_ROAD' ? 'var(--status-red)' : 'var(--status-green)'
                        }}
                      >
                        {rec.type === 'REMOVE_ROAD' ? '🚫 REMOVE BRAESS LINK' : '➕ WIDEN BOTTLENECK'}
                      </span>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--status-green)' }}>
                        -{rec.travel_time_reduction_pct}% Time
                      </span>
                    </div>

                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#f8fafc', marginBottom: 4 }}>
                      {rec.edge_name}
                    </div>

                    <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.3, marginBottom: 8 }}>
                      {rec.explanation}
                    </p>

                    <button
                      className="btn btn-secondary"
                      style={{ width: '100%', fontSize: '0.75rem', padding: '5px 10px', borderColor: 'var(--accent-cyan)' }}
                      onClick={() => handleApplyOptimizerRecommendation(rec.action)}
                    >
                      <CheckCircle2 size={14} color="#06b6d4" />
                      Apply This Optimization
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Selected Road Segment Inspector & Actions */}
          <div className="stat-card">
            <h3 style={{ fontSize: '0.85rem', marginBottom: 8 }}>Selected Road Segment</h3>
            {selectedEdge ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.78rem' }}>
                <div><strong>Segment:</strong> {selectedEdge.name || selectedEdge.id}</div>
                <div><strong>From ➔ To:</strong> {selectedEdge.source} ➔ {selectedEdge.target}</div>
                <div><strong>Lanes:</strong> {selectedEdge.lanes} | <strong>Capacity:</strong> {selectedEdge.capacity_vph} vph</div>
                {selectedMetric && (
                  <>
                    <div><strong>Flow Volume:</strong> {selectedMetric.volume_vph} vph</div>
                    <div><strong>V/C Ratio:</strong> {selectedMetric.vc_ratio} (Speed: {selectedMetric.avg_speed_kmh} km/h)</div>
                  </>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
                  <button className="btn btn-secondary" style={{ fontSize: '0.75rem' }} onClick={handleWidenSelectedRoad}>
                    ➕ Widen (+1 Lane)
                  </button>
                  <button className="btn btn-danger" style={{ fontSize: '0.75rem' }} onClick={handleCloseSelectedRoad}>
                    🚫 Close Road
                  </button>
                </div>
              </div>
            ) : (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Click any road on the map to inspect or manually modify it.
              </p>
            )}
          </div>

          {/* Active Staged Interventions */}
          <div className="stat-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <h3 style={{ fontSize: '0.85rem' }}>Active Staged Changes ({activeInterventions.length})</h3>
              {activeInterventions.length > 0 && (
                <button
                  onClick={handleResetInterventions}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <RotateCcw size={12} /> Reset
                </button>
              )}
            </div>
            {activeInterventions.length === 0 ? (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No modifications staged.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {activeInterventions.map((mod, i) => (
                  <div key={i} style={{ fontSize: '0.75rem', padding: '6px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{mod.action}: {mod.new_edge?.name || mod.edge_id}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Center: Graph & Simulation Canvas */}
        <main className="center-canvas-pane">
          {/* Braess Paradox Alert Banner */}
          {interventionReport?.delta.is_braess_paradox && (
            <div className="pulsing-alert" style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid var(--status-red)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <AlertTriangle color="#ef4444" size={22} />
              <div style={{ fontSize: '0.85rem', color: '#fca5a5' }}>
                <strong>Braess Paradox Phenomenon Confirmed!</strong> {interventionReport.delta.summary_text}
              </div>
            </div>
          )}

          {/* Canvas SVG Container */}
          <div className="graph-canvas-container">
            <svg style={{ width: '100%', height: '100%' }} viewBox="0 0 800 480">
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
                </marker>
                <marker id="arrow-congested" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
                </marker>
                <marker id="arrow-selected" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#06b6d4" />
                </marker>
              </defs>

              {/* 1. Base Road Edges & Flow Stream Lines */}
              {graph.edges.map((edge) => {
                const isSelected = edge.id === selectedEdgeId;
                const isClosed = activeInterventions.some(m => m.action === 'CLOSE' && m.edge_id === edge.id);
                const isWidened = activeInterventions.some(m => m.action === 'WIDEN' && m.edge_id === edge.id);
                const metric = simulationResult?.edge_metrics[edge.id];
                const vc = metric?.vc_ratio || 0;
                const vol = metric?.volume_vph || 0;

                let strokeColor = '#10b981';
                if (isClosed) strokeColor = '#475569';
                else if (isWidened) strokeColor = '#06b6d4';
                else if (vc >= 1.0) strokeColor = '#ef4444';
                else if (vc >= 0.85) strokeColor = '#f59e0b';

                const [x1, y1] = posMap[edge.source] || [200, 240];
                const [x2, y2] = posMap[edge.target] || [600, 240];
                const pathId = `edge_path_${edge.id}`;

                return (
                  <g key={edge.id} onClick={() => setSelectedEdgeId(edge.id)} style={{ cursor: 'pointer' }}>
                    {/* Hidden motion path for vehicle particle animation */}
                    <path
                      id={pathId}
                      d={`M ${x1} ${y1} L ${x2} ${y2}`}
                      fill="none"
                      stroke="none"
                    />

                    {/* Base Road Asphalt Line */}
                    <line
                      x1={x1} y1={y1} x2={x2} y2={y2}
                      stroke={isSelected ? '#06b6d4' : strokeColor}
                      strokeWidth={isSelected ? 6 : Math.max(3.5, edge.lanes * 2.2)}
                      strokeDasharray={isClosed ? '6,6' : 'none'}
                      strokeOpacity={isClosed ? 0.35 : 0.85}
                      markerEnd={isSelected ? 'url(#arrow-selected)' : (vc >= 1.0 ? 'url(#arrow-congested)' : 'url(#arrow)')}
                    />

                    {/* Animated Flow Stream Overlay (when traffic is active and road not closed) */}
                    {!isClosed && vol > 10 && showParticles && (
                      <line
                        x1={x1} y1={y1} x2={x2} y2={y2}
                        stroke={vc >= 1.0 ? '#fca5a5' : '#ffffff'}
                        strokeWidth={Math.max(1.5, edge.lanes * 1.0)}
                        strokeOpacity={0.65}
                        className={vc >= 0.95 ? 'animated-flow-slow' : 'animated-flow-fast'}
                      />
                    )}

                    {/* Road Name & Volume Label */}
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2 - 9}
                      fill={isClosed ? '#64748b' : '#cbd5e1'}
                      fontSize="10.5"
                      fontFamily="JetBrains Mono"
                      textAnchor="middle"
                    >
                      {isClosed ? '🚫 CLOSED' : `${edge.name ? edge.name.split(' ')[0] : edge.id} (${metric ? `${metric.volume_vph}vph` : ''})`}
                    </text>
                  </g>
                );
              })}

              {/* 2. Render Active Added Road */}
              {activeInterventions.filter(m => m.action === 'ADD' && m.new_edge).map(mod => {
                const e = mod.new_edge!;
                const [x1, y1] = posMap[e.source] || [380, 110];
                const [x2, y2] = posMap[e.target] || [380, 370];
                const pathId = `edge_path_${e.id}`;
                return (
                  <g key={e.id}>
                    <path id={pathId} d={`M ${x1} ${y1} L ${x2} ${y2}`} fill="none" stroke="none" />
                    <line
                      x1={x1} y1={y1} x2={x2} y2={y2}
                      stroke="#06b6d4"
                      strokeWidth={5}
                      strokeDasharray="6,4"
                      markerEnd="url(#arrow-selected)"
                    />
                    <text x={(x1 + x2) / 2 + 10} y={(y1 + y2) / 2} fill="#38bdf8" fontSize="10" fontFamily="JetBrains Mono">
                      ➕ Shortcut Active
                    </text>
                  </g>
                );
              })}

              {/* 3. Dynamic Animated Vehicle Particles */}
              {showParticles && graph.edges.map((edge) => {
                const isClosed = activeInterventions.some(m => m.action === 'CLOSE' && m.edge_id === edge.id);
                const metric = simulationResult?.edge_metrics[edge.id];
                const vol = metric?.volume_vph || 0;
                const speed = metric?.avg_speed_kmh || 50;
                const vc = metric?.vc_ratio || 0;

                if (isClosed || vol < 50) return null;

                // Duration inversely proportional to vehicle speed (Slower cars in bottleneck)
                const baseDurationSec = Math.max(1.0, Math.min(5.5, 90.0 / Math.max(10, speed))) / particleSpeed;
                const particleCount = vol > 2500 ? 4 : (vol > 1200 ? 3 : 2);
                const particleColor = vc >= 1.0 ? '#ef4444' : (vc >= 0.85 ? '#f59e0b' : '#38bdf8');
                const pathId = `#edge_path_${edge.id}`;

                return (
                  <g key={`particles_${edge.id}`}>
                    {Array.from({ length: particleCount }).map((_, pIdx) => {
                      const delay = (baseDurationSec / particleCount) * pIdx;
                      return (
                        <circle key={pIdx} r={vc >= 1.0 ? 3.5 : 3.0} fill={particleColor} opacity={0.95}>
                          <animateMotion
                            dur={`${baseDurationSec.toFixed(2)}s`}
                            begin={`${delay.toFixed(2)}s`}
                            repeatCount="indefinite"
                            rotate="auto"
                          >
                            <mpath href={pathId} />
                          </animateMotion>
                        </circle>
                      );
                    })}
                  </g>
                );
              })}

              {/* 4. Active Added Road Particles */}
              {showParticles && activeInterventions.filter(m => m.action === 'ADD' && m.new_edge).map(mod => {
                const e = mod.new_edge!;
                const pathId = `#edge_path_${e.id}`;
                return (
                  <g key={`particles_${e.id}`}>
                    {[0, 0.4, 0.8].map((delay, pIdx) => (
                      <circle key={pIdx} r={3.2} fill="#38bdf8">
                        <animateMotion dur={`${(1.2 / particleSpeed).toFixed(2)}s`} begin={`${delay}s`} repeatCount="indefinite">
                          <mpath href={pathId} />
                        </animateMotion>
                      </circle>
                    ))}
                  </g>
                );
              })}

              {/* 5. Nodes, Ripples, and Congestion Halos */}
              {graph.nodes.map((node) => {
                const [x, y] = posMap[node.id] || [400, 240];
                const isOrigin = node.type === 'origin' || node.id.startsWith('O') || node.id === 'A';
                const isDest = node.type === 'destination' || node.id.startsWith('D') || node.id === 'D';

                // Check if any outgoing edge from this node is severely congested
                const hasSevereOutgoing = graph.edges.some(e => e.source === node.id && (simulationResult?.edge_metrics[e.id]?.vc_ratio || 0) >= 1.0);

                return (
                  <g key={node.id}>
                    {/* Ripple on origins */}
                    {isOrigin && showParticles && (
                      <circle cx={x} cy={y} fill="none" stroke="#38bdf8" strokeWidth="2" className="node-ripple-circle" />
                    )}

                    {/* Congestion warning halo */}
                    {hasSevereOutgoing && (
                      <circle cx={x} cy={y} r="26" fill="rgba(239, 68, 68, 0.25)" className="congestion-halo" />
                    )}

                    <circle
                      cx={x} cy={y} r={16}
                      fill={isOrigin ? '#1e3a8a' : (isDest ? '#065f46' : '#1e293b')}
                      stroke={isOrigin ? '#60a5fa' : (isDest ? '#34d399' : '#94a3b8')}
                      strokeWidth={2.5}
                    />
                    <text x={x} y={y + 4} fill="#f8fafc" fontSize="11" fontWeight="700" textAnchor="middle">
                      {node.id}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Bottom HUD: Demand Slider & Traffic Animation Controls */}
            <div style={{ position: 'absolute', bottom: 12, left: 16, right: 16, background: 'rgba(15, 23, 42, 0.90)', backdropFilter: 'blur(12px)', padding: '10px 18px', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, border: '1px solid var(--border-color)' }}>
              {/* Traffic Volume Slider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                <Sliders size={16} color="#94a3b8" />
                <span style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                  Demand Volume: <strong>{(demandMultiplier * 100).toFixed(0)}%</strong>
                </span>
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

              {/* Animation Particle & Speed Controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderLeft: '1px solid var(--border-color)', paddingLeft: 14 }}>
                <button
                  className="btn btn-secondary"
                  style={{
                    fontSize: '0.75rem',
                    padding: '4px 10px',
                    background: showParticles ? 'rgba(6, 182, 212, 0.15)' : 'transparent',
                    borderColor: showParticles ? 'var(--accent-cyan)' : 'var(--border-color)',
                    color: showParticles ? 'var(--accent-cyan)' : 'var(--text-muted)'
                  }}
                  onClick={() => setShowParticles(!showParticles)}
                >
                  🚗 Traffic Particles: {showParticles ? 'ON' : 'OFF'}
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  <span>Speed:</span>
                  {[0.8, 1.2, 2.0].map((spd) => (
                    <button
                      key={spd}
                      style={{
                        background: particleSpeed === spd ? 'var(--accent-cyan)' : 'rgba(255,255,255,0.06)',
                        color: particleSpeed === spd ? '#000' : '#fff',
                        border: 'none',
                        borderRadius: 4,
                        padding: '2px 6px',
                        cursor: 'pointer',
                        fontSize: '0.7rem',
                        fontWeight: 600
                      }}
                      onClick={() => setParticleSpeed(spd)}
                    >
                      {spd === 0.8 ? '0.5x' : (spd === 1.2 ? '1x' : '2x')}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </main>

        {/* Right Pane: Comparative Metrics & Equilibrium Path Flow Breakdown */}
        <aside className="pane glass-panel">
          <div>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Activity size={18} color="#06b6d4" />
              Simulation Metrics & Paths
            </h2>
          </div>

          {simulationResult && (
            <>
              {/* Average Travel Time Card */}
              <div className="stat-card">
                <div className="stat-label">Average Vehicle Travel Time</div>
                <div className="stat-value">
                  {simulationResult.summary_metrics.avg_travel_time_mins}{' '}
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>mins</span>
                </div>
                {interventionReport && (
                  <div className={`stat-delta ${interventionReport.delta.avg_travel_time_change_pct <= 0 ? 'delta-good' : 'delta-bad'}`}>
                    {interventionReport.delta.avg_travel_time_change_pct > 0 ? '+' : ''}
                    {interventionReport.delta.avg_travel_time_change_pct}% vs baseline
                  </div>
                )}
              </div>

              {/* Total Network Vehicle Hours */}
              <div className="stat-card">
                <div className="stat-label">Total Congestion Hours</div>
                <div className="stat-value">
                  {simulationResult.summary_metrics.total_travel_time_hours}{' '}
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>hrs</span>
                </div>
              </div>

              {/* Average Network Speed */}
              <div className="stat-card">
                <div className="stat-label">Average Network Speed</div>
                <div className="stat-value">
                  {simulationResult.summary_metrics.avg_network_speed_kmh}{' '}
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>km/h</span>
                </div>
              </div>

              {/* Equilibrium Path Flows Breakdown Card */}
              <div className="stat-card">
                <h3 style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <GitFork size={15} color="#06b6d4" />
                  Equilibrium Route Allocation
                </h3>
                {simulationResult.path_flows && simulationResult.path_flows.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {simulationResult.path_flows.map((p, i) => (
                      <div key={i} style={{ fontSize: '0.75rem', padding: '6px 8px', background: 'rgba(15, 23, 42, 0.8)', borderRadius: 6, border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ fontWeight: 600, color: '#f8fafc', marginBottom: 2 }}>
                          {p.path_nodes.join(' ➔ ')}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                          <span>Flow: <strong>{p.assigned_volume_vph} vph</strong></span>
                          <span>Latency: <strong>{p.travel_time_mins} min</strong></span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No path allocation records available.</p>
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      {/* Algorithm Tuning Modal / Drawer */}
      {showConfigDrawer && (
        <div style={{ position: 'fixed', top: 64, right: 0, width: 360, bottom: 0, background: 'rgba(10, 13, 20, 0.95)', borderLeft: '1px solid var(--border-color)', backdropFilter: 'blur(20px)', padding: 20, zIndex: 100, overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>⚙️ Algorithm Parameters</h2>
            <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => setShowConfigDrawer(false)}>✕</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, fontSize: '0.8rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: 4 }}>BPR Sensitivity Alpha (α): {engineConfig.default_alpha}</label>
              <input
                type="range" min="0.05" max="1.0" step="0.05"
                value={engineConfig.default_alpha}
                onChange={(e) => setEngineConfig({ ...engineConfig, default_alpha: parseFloat(e.target.value) })}
                style={{ width: '100%', accentColor: 'var(--accent-cyan)' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 4 }}>BPR Exponent Beta (β): {engineConfig.default_beta}</label>
              <input
                type="range" min="1.0" max="6.0" step="0.5"
                value={engineConfig.default_beta}
                onChange={(e) => setEngineConfig({ ...engineConfig, default_beta: parseFloat(e.target.value) })}
                style={{ width: '100%', accentColor: 'var(--accent-cyan)' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 4 }}>MSA Max Iterations: {engineConfig.max_iterations}</label>
              <input
                type="range" min="10" max="100" step="5"
                value={engineConfig.max_iterations}
                onChange={(e) => setEngineConfig({ ...engineConfig, max_iterations: parseInt(e.target.value) })}
                style={{ width: '100%', accentColor: 'var(--accent-cyan)' }}
              />
            </div>

            <button
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 10 }}
              onClick={() => {
                setShowConfigDrawer(false);
                handleRunSimulation();
              }}
            >
              Apply & Re-Simulate
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
