import Sigma from 'sigma';
import Graph from 'graphology';
import { useEffect, useMemo, useRef, memo, useCallback, useState } from 'react';
import type { AtlasEdge, AtlasNode } from '../types';
import { getNodeColor, graphBackground } from '../theme';
import { GraphControls } from './GraphControls';

interface GraphCanvasProps {
  nodes: AtlasNode[];
  edges: AtlasEdge[];
  buildId?: string;
  selectedNode: string | null;
  onNodeSelect: (nodeId: string | null) => void;
  highlightedNodes?: string[];
  colorScheme?: 'arcane' | 'tier';
  onColorSchemeChange?: (scheme: 'arcane' | 'tier') => void;
}

const computeNodeSize = (node: AtlasNode, viewportWidth: number = window.innerWidth) => {
  const base = Math.log(1 + node.metrics.connectionCount);
  const centralityBoost = Math.sqrt(Math.max(node.metrics.degreeCentrality, 0)) * 0.7;
  // Balanced node size
  let size = 0.5 + base * 0.18 + centralityBoost;
  if (node.kind === 'stub') size *= 0.3;
  if (node.isHub) size *= 1.25;

  // Apply viewport-based scaling factor for mobile devices
  let scaleFactor = 1.0;
  if (viewportWidth <= 480) {
    scaleFactor = 0.55; // Small phones
  } else if (viewportWidth <= 640) {
    scaleFactor = 0.65; // Phones
  } else if (viewportWidth <= 768) {
    scaleFactor = 0.75; // Large phones
  } else if (viewportWidth <= 1024) {
    scaleFactor = 0.875; // Tablets
  }

  // Apply scaling
  size = size * scaleFactor;

  // Adjusted min/max
  return Math.min(3.0, Math.max(node.kind === 'stub' ? 0.3 : 0.4, size));
};

const dimColor = (color: string): string => {
  if (color.startsWith('#')) {
    const hex = color.length === 4
      ? color.slice(1).split('').map((c) => c + c).join('')
      : color.slice(1);
    return `#${hex}33`;
  }

  const rgbaMatch = color.match(/^rgba\((\s*\d+\.?\d*\s*),(\s*\d+\.?\d*\s*),(\s*\d+\.?\d*\s*),(\s*\d+\.?\d*\s*)\)$/i);
  if (rgbaMatch) {
    const [, r, g, b, a] = rgbaMatch;
    const alpha = Math.max(0, Math.min(1, parseFloat(a) * 0.5));
    return `rgba(${r.trim()}, ${g.trim()}, ${b.trim()}, ${alpha.toFixed(2)})`;
  }

  const rgbMatch = color.match(/^rgb\((\s*\d+\.?\d*\s*),(\s*\d+\.?\d*\s*),(\s*\d+\.?\d*\s*)\)$/i);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch;
    return `rgba(${r.trim()}, ${g.trim()}, ${b.trim()}, 0.2)`;
  }

  return color;
};

const GraphCanvasComponent = ({ nodes, edges, buildId, selectedNode, onNodeSelect, highlightedNodes = [], colorScheme = 'tier', onColorSchemeChange }: GraphCanvasProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const viewportWidthRef = useRef<number>(window.innerWidth);
  const centroidRef = useRef<{ x: number; y: number }>({ x: 0.5, y: 0.5 });
  const [hoveredNode, setHoveredNode] = useState<AtlasNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const nodeMap = useMemo(() => {
    const map = new Map<string, AtlasNode>();
    nodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [nodes]);


  // Zoom controls for 2D view
  const handleZoomIn = useCallback(() => {
    if (!sigmaRef.current) return;
    const camera = sigmaRef.current.getCamera();
    camera.animatedZoom({ duration: 300, factor: 1.5 });
  }, []);

  const handleZoomOut = useCallback(() => {
    if (!sigmaRef.current) return;
    const camera = sigmaRef.current.getCamera();
    camera.animatedUnzoom({ duration: 300, factor: 1.5 });
  }, []);

  const handleResetView = useCallback(() => {
    if (!sigmaRef.current) return;
    const camera = sigmaRef.current.getCamera();
    // Center on the stored centroid
    camera.animate({ x: centroidRef.current.x, y: centroidRef.current.y, ratio: 0.4 }, { duration: 500 });
    onNodeSelect(null);
  }, [onNodeSelect]);

  const handleFitToScreen = useCallback(() => {
    if (!sigmaRef.current) return;
    const camera = sigmaRef.current.getCamera();
    camera.animate({ x: 0.5, y: 0.5, ratio: 1.2 }, { duration: 500 });
  }, []);

  // Count all flux nodes for display (total network count, not just visible)
  const nodeCount = useMemo(() => {
    return nodes.filter(node => node.kind === 'flux').length;
  }, [nodes]);

  // Count edges
  const edgeCount = useMemo(() => {
    const uniqueEdges = new Map<string, AtlasEdge>();
    edges.forEach(edge => {
      const key = [edge.source, edge.target].sort().join('|');
      if (!uniqueEdges.has(key)) uniqueEdges.set(key, edge);
    });
    return uniqueEdges.size;
  }, [edges]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Update viewport width
    viewportWidthRef.current = window.innerWidth;

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

    // Normalize positions while preserving aspect ratio for proper shape
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    filteredNodes.forEach(node => {
      if (node.position.x < minX) minX = node.position.x;
      if (node.position.x > maxX) maxX = node.position.x;
      if (node.position.y < minY) minY = node.position.y;
      if (node.position.y > maxY) maxY = node.position.y;
    });
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    // Use the larger range for both to preserve aspect ratio
    const maxRange = Math.max(rangeX, rangeY);

    // Compute centroid of normalized positions (where nodes actually cluster)
    let sumNormX = 0, sumNormY = 0;
    filteredNodes.forEach(node => {
      sumNormX += (node.position.x - minX) / maxRange;
      sumNormY += (node.position.y - minY) / maxRange;
    });
    const centroidX = sumNormX / filteredNodes.length;
    const centroidY = sumNormY / filteredNodes.length;
    centroidRef.current = { x: centroidX, y: centroidY };

    // Add nodes with normalized positions (preserving aspect ratio)
    const highlightedSet = new Set(highlightedNodes);
    const viewportWidth = viewportWidthRef.current;
    filteredNodes.forEach(node => {
      const isHighlighted = highlightedSet.has(node.id);
      const nodeColor = getNodeColor(node.tier, node.kind, node.status, colorScheme);
      // Normalize position using same scale for both axes to preserve shape
      const normX = (node.position.x - minX) / maxRange;
      const normY = (node.position.y - minY) / maxRange;
      graph.addNode(node.id, {
        x: normX,
        y: normY,
        size: computeNodeSize(node, viewportWidth) * (isHighlighted ? 2 : 1),
        color: isHighlighted ? '#FFD700' : nodeColor,
        originalColor: nodeColor,
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

    // Hover handlers for tooltip
    sigma.on('enterNode', ({ node, event }) => {
      const nodeData = nodeMap.get(node);
      if (nodeData) {
        setHoveredNode(nodeData);
        setTooltipPos({ x: event.x, y: event.y });
      }
    });

    sigma.on('leaveNode', () => {
      setHoveredNode(null);
    });

    // Track mouse movement while hovering for tooltip position
    const container = containerRef.current;
    const handleMouseMove = (e: MouseEvent) => {
      if (hoveredNode) {
        const rect = container?.getBoundingClientRect();
        if (rect) {
          setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        }
      }
    };
    container?.addEventListener('mousemove', handleMouseMove);

    sigmaRef.current = sigma;

    // Center on the actual centroid of nodes, not bounding box center
    sigma.once('afterRender', () => {
      const cam = sigma.getCamera();
      cam.setState({ x: centroidX, y: centroidY, ratio: 0.4, angle: 0 });
    });

    // Handle window resize to update node sizes on orientation change
    const handleResize = () => {
      const newWidth = window.innerWidth;
      if (Math.abs(newWidth - viewportWidthRef.current) > 100) {
        viewportWidthRef.current = newWidth;

        // Update all node sizes
        filteredNodes.forEach(node => {
          if (graph.hasNode(node.id)) {
            const attrs = graph.getNodeAttributes(node.id);
            const isHighlighted = attrs.highlighted || false;
            const newSize = computeNodeSize(node, newWidth) * (isHighlighted ? 2 : 1);
            graph.setNodeAttribute(node.id, 'size', newSize);
          }
        });

        sigma.refresh();
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      container?.removeEventListener('mousemove', handleMouseMove);
      sigma.kill();
    };
  }, [nodes, edges, buildId, nodeMap]);

  // Handle selection changes
  useEffect(() => {
    if (!sigmaRef.current) return;

    const sigma = sigmaRef.current;
    const graph = sigma.getGraph();

    if (!selectedNode) {
      // Reset all node and edge colors
      graph.forEachNode((node) => {
        const attrs = graph.getNodeAttributes(node);
        const baseColor = attrs.originalColor ?? attrs.color;
        graph.setNodeAttribute(node, 'color', baseColor);
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
      const baseColor = attrs.originalColor ?? attrs.color;
      if (neighbors.has(node)) {
        graph.setNodeAttribute(node, 'color', baseColor);
      } else {
        graph.setNodeAttribute(node, 'color', dimColor(baseColor)); // Dim non-neighbors
      }
    });

    // Highlight connected edges, hide others
    graph.forEachEdge((edge, attrs) => {
      if (connectedEdges.has(edge)) {
        graph.setEdgeAttribute(edge, 'color', attrs.originalColor); // Full color
        graph.setEdgeAttribute(edge, 'size', 0.8); // Thinner edges
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
      const node = nodeMap.get(nodeId);
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
  }, [colorScheme, highlightedNodes, nodeMap]);

  // Handle highlight changes (search results)
  useEffect(() => {
    if (!sigmaRef.current) return;

    const sigma = sigmaRef.current;
    const graph = sigma.getGraph();
    const highlightedSet = new Set(highlightedNodes);
    const viewportWidth = viewportWidthRef.current;

    // Update all node colors and sizes based on highlight status
    graph.forEachNode((nodeId, attrs) => {
      const isHighlighted = highlightedSet.has(nodeId);
      const baseColor = attrs.originalColor || attrs.color;
      const wasHighlighted = attrs.highlighted;

      // Always update if highlight status changed
      if (wasHighlighted !== isHighlighted) {
        graph.setNodeAttribute(nodeId, 'highlighted', isHighlighted);

        // Reset to base color and size when unhighlighting
        const node = nodeMap.get(nodeId);
        if (node) {
          const baseSize = computeNodeSize(node, viewportWidth);

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
  }, [highlightedNodes, nodeMap]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
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
      {/* Hover Tooltip */}
      {hoveredNode && (
        <div
          style={{
            position: 'absolute',
            left: tooltipPos.x + 15,
            top: tooltipPos.y - 10,
            background: 'linear-gradient(135deg, rgba(16, 24, 45, 0.95) 0%, rgba(24, 32, 60, 0.95) 100%)',
            border: '1px solid rgba(56, 232, 255, 0.3)',
            borderRadius: '12px',
            padding: '16px 20px',
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            minWidth: '220px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
            pointerEvents: 'none',
            zIndex: 1000,
          }}
        >
          <div style={{ fontSize: '16px', fontWeight: 600, color: '#fff', marginBottom: '10px', wordBreak: 'break-all' }}>
            {String(hoveredNode.meta?.ip || hoveredNode.id)}
          </div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <span style={{
              padding: '4px 10px',
              background: 'rgba(56, 232, 255, 0.15)',
              borderRadius: '5px',
              color: '#38e8ff',
              fontSize: '12px',
              fontWeight: 600,
              textTransform: 'uppercase',
            }}>{hoveredNode.tier}</span>
            {hoveredNode.isHub && (
              <span style={{
                padding: '4px 10px',
                background: 'rgba(83, 242, 157, 0.15)',
                borderRadius: '5px',
                color: '#53f29d',
                fontSize: '12px',
                fontWeight: 600,
              }}>HUB</span>
            )}
            {hoveredNode.status === 'ARCANE' && (
              <span style={{
                padding: '4px 10px',
                background: 'rgba(97, 242, 255, 0.15)',
                borderRadius: '5px',
                color: '#61f2ff',
                fontSize: '12px',
                fontWeight: 600,
              }}>ARCANE</span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', fontSize: '13px' }}>
            <div>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px', textTransform: 'uppercase' }}>Outgoing</div>
              <div style={{ color: '#fff', fontWeight: 600, fontSize: '15px' }}>{hoveredNode.metrics?.outgoingPeers || 0}</div>
            </div>
            <div>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px', textTransform: 'uppercase' }}>Incoming</div>
              <div style={{ color: '#fff', fontWeight: 600, fontSize: '15px' }}>{hoveredNode.metrics?.incomingPeers || 0}</div>
            </div>
            <div>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px', textTransform: 'uppercase' }}>Apps</div>
              <div style={{ color: '#fff', fontWeight: 600, fontSize: '15px' }}>{hoveredNode.meta?.apps?.length || 0}</div>
            </div>
          </div>
          <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>
            Click to select
          </div>
        </div>
      )}
      {/* Graph Controls */}
      <GraphControls
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetView={handleResetView}
        onFitToScreen={handleFitToScreen}
        colorScheme={colorScheme}
        onColorSchemeChange={onColorSchemeChange || (() => {})}
        nodeCount={nodeCount}
        edgeCount={edgeCount}
      />
    </div>
  );
};

export const GraphCanvas = memo(GraphCanvasComponent);
