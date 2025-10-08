import Sigma from 'sigma';
import Graph from 'graphology';
import { useEffect, useRef, memo } from 'react';
import type { AtlasEdge, AtlasNode } from '../types';
import { getNodeColor, graphBackground } from '../theme';

interface GraphCanvasProps {
  nodes: AtlasNode[];
  edges: AtlasEdge[];
  buildId?: string;
  selectedNode: string | null;
  onNodeSelect: (nodeId: string | null) => void;
  highlightedNodes?: string[];
  colorScheme?: 'arcane' | 'tier';
}

const computeNodeSize = (node: AtlasNode) => {
  const base = Math.log(1 + node.metrics.connectionCount);
  const centralityBoost = Math.sqrt(Math.max(node.metrics.degreeCentrality, 0)) * 2;
  let size = 0.5 + base * 0.3 + centralityBoost;
  if (node.kind === 'stub') size *= 0.3;
  if (node.isHub) size *= 1.4;
  // Scale down slightly for crisper appearance
  return Math.min(5, Math.max(node.kind === 'stub' ? 0.3 : 0.6, size * 0.85));
};

const GraphCanvasComponent = ({ nodes, edges, buildId, selectedNode, onNodeSelect, highlightedNodes = [], colorScheme = 'tier' }: GraphCanvasProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Destroy previous instance
    if (sigmaRef.current) {
      sigmaRef.current.kill();
    }

    // Filter out stub nodes and nodes with no connections
    const connectedNodeIds = new Set<string>();
    edges.forEach(edge => {
      connectedNodeIds.add(edge.source);
      connectedNodeIds.add(edge.target);
    });
    const filteredNodes = nodes.filter(node =>
      node.kind === 'flux' && (connectedNodeIds.has(node.id) || node.metrics.connectionCount > 0)
    );

    // Deduplicate edges - keep only unique pairs
    const uniqueEdges = new Map<string, AtlasEdge>();
    edges.forEach(edge => {
      // Create a sorted key to ensure A->B and B->A are treated as same edge
      const key = [edge.source, edge.target].sort().join('|');
      const existing = uniqueEdges.get(key);
      // Keep edge with higher weight or first one
      if (!existing || edge.weight > existing.weight) {
        uniqueEdges.set(key, edge);
      }
    });

    // Create graph
    const graph = new Graph({ multi: false, type: 'undirected' });

    // Add nodes (without labels - labels only show in sidebar)
    const highlightedSet = new Set(highlightedNodes);
    filteredNodes.forEach(node => {
      const isHighlighted = highlightedSet.has(node.id);
      const nodeColor = getNodeColor(node.tier, node.kind, node.status, colorScheme);
      graph.addNode(node.id, {
        x: node.position.x,
        y: node.position.y,
        size: computeNodeSize(node) * (isHighlighted ? 2 : 1), // Make highlighted nodes larger
        color: isHighlighted ? '#FFD700' : nodeColor, // Gold color for highlighted
        originalColor: nodeColor, // Store original
        highlighted: isHighlighted,
      });
    });

    // Add unique edges only - store original color for highlighting
    uniqueEdges.forEach(edge => {
      if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
        try {
          const originalColor = edge.kind === 'flux-flux' ? '#2E68FF' : '#7E98D1';
          graph.addEdge(edge.source, edge.target, {
            color: '#00000000', // Completely transparent by default
            originalColor, // Store for highlighting
            size: 0.1,
          });
        } catch (e) {
          // Ignore errors
        }
      }
    });

    // Create Sigma instance with adjusted zoom limits
    const sigma = new Sigma(graph, containerRef.current, {
      renderEdgeLabels: false,
      defaultNodeType: 'circle',
      defaultEdgeType: 'line',
      minCameraRatio: 0.02, // Zoom IN closer (lower = closer)
      maxCameraRatio: 5,    // Zoom OUT limited (higher = further, was 50)
    });

    // Click handler
    sigma.on('clickNode', ({ node }) => {
      onNodeSelect(node);
    });

    sigma.on('clickStage', () => {
      onNodeSelect(null);
    });

    sigmaRef.current = sigma;

    return () => {
      sigma.kill();
    };
  }, [nodes, edges, buildId]);

  // Handle selection changes
  useEffect(() => {
    if (!sigmaRef.current) return;

    const sigma = sigmaRef.current;
    const graph = sigma.getGraph();

    if (!selectedNode) {
      // Reset all node and edge colors
      graph.forEachNode((node) => {
        const attrs = graph.getNodeAttributes(node);
        graph.setNodeAttribute(node, 'color', attrs.color);
      });
      graph.forEachEdge((edge) => {
        graph.setEdgeAttribute(edge, 'color', '#00000000'); // Completely transparent
        graph.setEdgeAttribute(edge, 'size', 0.1);
      });
      sigma.refresh();
      return;
    }

    if (!graph.hasNode(selectedNode)) return;

    // Get neighbors and connected edges
    const neighbors = new Set(graph.neighbors(selectedNode));
    neighbors.add(selectedNode);
    const connectedEdges = new Set(graph.edges(selectedNode));

    // Dim non-neighbors
    graph.forEachNode((node, attrs) => {
      if (neighbors.has(node)) {
        graph.setNodeAttribute(node, 'color', attrs.color);
      } else {
        graph.setNodeAttribute(node, 'color', attrs.color + '33'); // Add transparency
      }
    });

    // Highlight connected edges, hide others
    graph.forEachEdge((edge, attrs) => {
      if (connectedEdges.has(edge)) {
        graph.setEdgeAttribute(edge, 'color', attrs.originalColor); // Full color
        graph.setEdgeAttribute(edge, 'size', 2);
      } else {
        graph.setEdgeAttribute(edge, 'color', '#00000000'); // Completely transparent
        graph.setEdgeAttribute(edge, 'size', 0.1);
      }
    });

    sigma.refresh();
  }, [selectedNode]);

  // Handle color scheme changes
  useEffect(() => {
    if (!sigmaRef.current) return;

    const sigma = sigmaRef.current;
    const graph = sigma.getGraph();
    const highlightedSet = new Set(highlightedNodes);

    // Update all node colors based on color scheme
    graph.forEachNode((nodeId) => {
      const node = nodes.find(n => n.id === nodeId);
      if (node) {
        const newColor = getNodeColor(node.tier, node.kind, node.status, colorScheme);
        graph.setNodeAttribute(nodeId, 'originalColor', newColor);

        // Only update actual color if not highlighted
        if (!highlightedSet.has(nodeId)) {
          graph.setNodeAttribute(nodeId, 'color', newColor);
        }
      }
    });

    sigma.refresh();
  }, [colorScheme, nodes, highlightedNodes]);

  // Handle highlight changes (search results)
  useEffect(() => {
    if (!sigmaRef.current) return;

    const sigma = sigmaRef.current;
    const graph = sigma.getGraph();
    const highlightedSet = new Set(highlightedNodes);

    // Update all node colors and sizes based on highlight status
    graph.forEachNode((nodeId, attrs) => {
      const isHighlighted = highlightedSet.has(nodeId);
      const baseColor = attrs.originalColor || attrs.color;
      const wasHighlighted = attrs.highlighted;

      // Always update if highlight status changed
      if (wasHighlighted !== isHighlighted) {
        graph.setNodeAttribute(nodeId, 'highlighted', isHighlighted);

        // Reset to base color and size when unhighlighting
        const node = nodes.find(n => n.id === nodeId);
        if (node) {
          const baseSize = computeNodeSize(node);

          if (isHighlighted) {
            // Apply highlight: gold color and 2x size
            graph.setNodeAttribute(nodeId, 'color', '#FFD700');
            graph.setNodeAttribute(nodeId, 'size', baseSize * 2);
          } else {
            // Remove highlight: restore original color and size
            graph.setNodeAttribute(nodeId, 'color', baseColor);
            graph.setNodeAttribute(nodeId, 'size', baseSize);
          }
        }
      }
    });

    sigma.refresh();
  }, [highlightedNodes, nodes]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        background: graphBackground,
        borderRadius: '24px',
        position: 'relative',
      }}
    />
  );
};

export const GraphCanvas = memo(GraphCanvasComponent);
