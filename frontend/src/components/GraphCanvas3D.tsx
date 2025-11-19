import { useMemo, useRef, useEffect } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
// @ts-ignore
// import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import type { AtlasEdge, AtlasNode } from '../types';
import { getNodeColor } from '../theme';
import * as THREE from 'three';

interface GraphCanvasProps {
    nodes: AtlasNode[];
    edges: AtlasEdge[];
    buildId?: string;
    selectedNode: string | null;
    onNodeSelect: (nodeId: string | null) => void;
    highlightedNodes?: string[];
    colorScheme?: 'arcane' | 'tier';
}

export const GraphCanvas3D = ({
    nodes,
    edges,
    selectedNode,
    onNodeSelect,
    highlightedNodes = [],
    colorScheme = 'tier',
}: GraphCanvasProps) => {
    const fgRef = useRef<any>(null);
    const highlightLinesRef = useRef<THREE.LineSegments | null>(null);
    const highlightedSet = useMemo(() => new Set(highlightedNodes), [highlightedNodes]);

    // Filter and prepare graph data
    const graphData = useMemo(() => {
        // Filter out stub nodes and nodes with no connections
        const connectedNodeIds = new Set<string>();
        edges.forEach((edge) => {
            connectedNodeIds.add(edge.source);
            connectedNodeIds.add(edge.target);
        });

        const filteredNodes = nodes.filter(
            (node) =>
                node.kind === 'flux' &&
                (connectedNodeIds.has(node.id) || node.metrics.connectionCount > 0)
        );

        // Deduplicate edges
        const uniqueEdges = new Map<string, AtlasEdge>();
        edges.forEach((edge) => {
            const key = [edge.source, edge.target].sort().join('|');
            const existing = uniqueEdges.get(key);
            if (!existing || edge.weight > existing.weight) {
                uniqueEdges.set(key, edge);
            }
        });

        return {
            nodes: filteredNodes,
            links: Array.from(uniqueEdges.values()).map(e => ({ ...e })),
        };
    }, [nodes, edges]);

    // Create a shared circle texture
    const particleTexture = useMemo(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const context = canvas.getContext('2d');
        if (context) {
            context.fillStyle = '#ffffff';
            context.beginPath();
            context.arc(16, 16, 16, 0, 2 * Math.PI);
            context.fill();
        }
        return new THREE.CanvasTexture(canvas);
    }, []);

    // Handle Selection Highlighting Manually
    useEffect(() => {
        const fg = fgRef.current;
        if (!fg) return;

        const scene = fg.scene();

        // Remove previous highlight
        if (highlightLinesRef.current) {
            scene.remove(highlightLinesRef.current);
            highlightLinesRef.current.geometry.dispose();
            (highlightLinesRef.current.material as THREE.Material).dispose();
            highlightLinesRef.current = null;
        }

        if (!selectedNode) return;

        // Find connected edges
        const relevantLinks = graphData.links.filter(link => {
            const sourceId = typeof link.source === 'object' ? (link.source as any).id : link.source;
            const targetId = typeof link.target === 'object' ? (link.target as any).id : link.target;
            return sourceId === selectedNode || targetId === selectedNode;
        });

        if (relevantLinks.length === 0) return;

        // Create geometry for highlights
        const geometry = new THREE.BufferGeometry();
        const positions: number[] = [];

        relevantLinks.forEach(link => {
            const source = typeof link.source === 'object' ? link.source : graphData.nodes.find(n => n.id === link.source);
            const target = typeof link.target === 'object' ? link.target : graphData.nodes.find(n => n.id === link.target);

            if (source && target && (source as any).x !== undefined && (target as any).x !== undefined) {
                positions.push((source as any).x, (source as any).y, (source as any).z);
                positions.push((target as any).x, (target as any).y, (target as any).z);
            }
        });

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const material = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
        const lines = new THREE.LineSegments(geometry, material);

        highlightLinesRef.current = lines;
        scene.add(lines);

    }, [selectedNode, graphData]);

    // Mobile detection
    const isMobile = window.innerWidth <= 768;

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <ForceGraph3D
                ref={fgRef}
                graphData={graphData}
                nodeLabel="id"

                // STATIC Visuals (No dynamic props that depend on selection)
                nodeColor={node => getNodeColor(node.tier, node.kind, node.status, colorScheme)}
                nodeVal={node => {
                    const base = Math.log(1 + node.metrics.connectionCount);
                    // Larger base size on mobile for better visibility/touch
                    const mobileMultiplier = isMobile ? 1.5 : 1;
                    return Math.max(4, 1 + base * 0.5) * mobileMultiplier;
                }}

                // Performance: Use Sprites with SHARED texture
                nodeThreeObject={node => {
                    const isHighlighted = highlightedSet.has(node.id);
                    const isSelected = selectedNode === node.id;

                    let color = getNodeColor(node.tier, node.kind, node.status, colorScheme);
                    if (isHighlighted || isSelected) color = '#FFD700'; // Gold for search/selection

                    const material = new THREE.SpriteMaterial({ map: particleTexture, color: color });
                    const sprite = new THREE.Sprite(material);

                    // Increased size calculation
                    const base = Math.log(1 + node.metrics.connectionCount);
                    // Larger base size on mobile for better visibility/touch
                    const mobileMultiplier = isMobile ? 1.5 : 1;
                    let size = Math.max(4, 1 + base * 0.5) * mobileMultiplier;

                    if (isHighlighted || isSelected) size *= 2; // Double size for highlighted

                    sprite.scale.set(size, size, 1);
                    return sprite;
                }}

                // Performance: Pre-calculate layout
                warmupTicks={40} // Short warmup to let them explode outwards
                cooldownTicks={0} // Freeze immediately after

                // Physics Tuning: Low friction to allow spreading
                d3AlphaDecay={0.05}
                d3VelocityDecay={0.1} // Low drag = nodes fly further apart

                // EDGES: Completely static and invisible by default
                linkWidth={0}
                linkVisibility={false}
                linkDirectionalParticles={0}

                // Container styling
                backgroundColor="#00000000"
                showNavInfo={false}

                // Interaction
                enableNodeDrag={false} // Prevent dragging from waking physics
                onNodeClick={(node) => {
                    if (!node) {
                        onNodeSelect(null);
                        return;
                    }
                    onNodeSelect(node.id as string);

                    // Improved Camera Logic: Keep distance but look at node
                    const distance = isMobile ? 150 : 100; // Further back on mobile to see context
                    const x = node.x ?? 0;
                    const y = node.y ?? 0;
                    const z = node.z ?? 0;

                    // Move camera to a fixed offset from the node
                    fgRef.current.cameraPosition(
                        { x: x, y: y, z: z + distance }, // Just move back on Z axis relative to node
                        node, // Look at node
                        2000
                    );
                }}
                onBackgroundClick={() => onNodeSelect(null)}
                onEngineStop={() => {
                    // FREEZE the graph!
                    // Lock all nodes in their current position to prevent any future physics calculations

                    // Manual Camera Positioning: Ensure we start zoomed out
                    if (!fgRef.current.hasZoomed) {
                        // Calculate the radius of the graph
                        let maxDist = 0;
                        graphData.nodes.forEach((node: any) => {
                            const dist = Math.hypot(node.x, node.y, node.z);
                            if (dist > maxDist) maxDist = dist;
                        });

                        // If the graph is empty or collapsed, default to a reasonable distance
                        if (maxDist < 10) maxDist = 100;

                        // Position camera far enough away to see the whole sphere with context
                        // Multiplier 3.5 ensures it looks "small" in the center (zoomed out)
                        const zoomFactor = isMobile ? 4.0 : 3.0;
                        fgRef.current.cameraPosition(
                            { x: 0, y: 0, z: maxDist * zoomFactor }, // Position
                            { x: 0, y: 0, z: 0 }, // Look at center
                            0 // Instant (no animation)
                        );

                        fgRef.current.hasZoomed = true;
                    }

                    graphData.nodes.forEach((node: any) => {
                        node.fx = node.x;
                        node.fy = node.y;
                        node.fz = node.z;
                    });
                }}
            />

            {/* Reset View Button */}
            <button
                onClick={() => {
                    if (!fgRef.current) return;

                    // Calculate the radius of the graph
                    let maxDist = 0;
                    graphData.nodes.forEach((node: any) => {
                        const dist = Math.hypot(node.x, node.y, node.z);
                        if (dist > maxDist) maxDist = dist;
                    });

                    if (maxDist < 10) maxDist = 100;

                    const zoomFactor = isMobile ? 4.0 : 3.0;
                    fgRef.current.cameraPosition(
                        { x: 0, y: 0, z: maxDist * zoomFactor }, // Position
                        { x: 0, y: 0, z: 0 }, // Look at center
                        2000 // Smooth animation
                    );
                    onNodeSelect(null); // Also deselect any node
                }}
                style={{
                    position: 'absolute',
                    bottom: '20px',
                    right: '20px',
                    zIndex: 100,
                    background: 'rgba(16, 24, 45, 0.8)',
                    border: '1px solid rgba(56, 232, 255, 0.3)',
                    borderRadius: '8px',
                    padding: '8px 16px',
                    color: '#38e8ff',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 500,
                    backdropFilter: 'blur(4px)',
                    transition: 'all 0.2s ease',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(56, 232, 255, 0.15)';
                    e.currentTarget.style.borderColor = 'rgba(56, 232, 255, 0.6)';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(16, 24, 45, 0.8)';
                    e.currentTarget.style.borderColor = 'rgba(56, 232, 255, 0.3)';
                }}
            >
                Reset View
            </button>
        </div>
    );
};
