"""
Bottleneck, Bridge (Cut-edge), and Graph Topology Analyzer.
"""
import networkx as nx
from typing import List, Dict
from backend.app.core.graph_model import UrbanFlowGraph, BottleneckInfo


def analyze_graph_bridges(graph: UrbanFlowGraph) -> List[str]:
    """
    Identifies bridges (cut-edges) in the undirected representation of the network.
    Closing a bridge disconnects components of the graph.
    """
    G_undir = nx.Graph()
    for edge in graph.edges:
        G_undir.add_edge(edge.source, edge.target, edge_id=edge.id)
    
    bridges = list(nx.bridges(G_undir))
    bridge_edge_ids = set()
    for u, v in bridges:
        for edge in graph.edges:
            if (edge.source == u and edge.target == v) or (edge.source == v and edge.target == u):
                bridge_edge_ids.add(edge.id)
    
    return list(bridge_edge_ids)


def compute_edge_betweenness(graph: UrbanFlowGraph) -> Dict[str, float]:
    """
    Computes shortest-path betweenness centrality for all edges in the road graph.
    """
    G = nx.DiGraph()
    for edge in graph.edges:
        G.add_edge(edge.source, edge.target, weight=edge.length_m, edge_id=edge.id)
    
    betweenness = nx.edge_betweenness_centrality(G, weight="weight")
    edge_scores = {}
    for (u, v), score in betweenness.items():
        if G.has_edge(u, v) and "edge_id" in G[u][v]:
            edge_scores[G[u][v]["edge_id"]] = round(score, 4)
    return edge_scores
