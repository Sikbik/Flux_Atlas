import { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import type { AtlasEdge, AtlasNode } from '../types';
import { getNodeColor } from '../theme';
import { GraphControls } from './GraphControls';
import * as THREE from 'three';

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

export const GraphCanvas3D = ({
    nodes,
    edges,
    selectedNode,
    onNodeSelect,
    highlightedNodes = [],
    colorScheme = 'tier',
    onColorSchemeChange,
}: GraphCanvasProps) => {
    const fgRef = useRef<any>(null);
    const highlightLinesRef = useRef<THREE.LineSegments | null>(null);
    const highlightedSet = useMemo(() => new Set(highlightedNodes), [highlightedNodes]);
    const [isSimulationDone, setIsSimulationDone] = useState(false);

    // Count all flux nodes for display (total network count, not just visible)
    const totalNodeCount = useMemo(() => {
        return nodes.filter(node => node.kind === 'flux').length;
    }, [nodes]);

    // Filter and prepare graph data - use pre-computed 3D positions from backend
    const graphData = useMemo(() => {
        const connectedNodeIds = new Set<string>();
        edges.forEach((edge) => {
            connectedNodeIds.add(edge.source);
            connectedNodeIds.add(edge.target);
        });

        // Map nodes WITH pre-computed 3D positions for instant rendering
        const filteredNodes = nodes
            .filter(
                (node) =>
                    node.kind === 'flux' &&
                    (connectedNodeIds.has(node.id) || node.metrics.connectionCount > 0)
            )
            .map((node) => ({
                ...node,
                // Use pre-computed 3D positions from backend
                x: node.position3d?.x,
                y: node.position3d?.y,
                z: node.position3d?.z,
                // Fix positions so simulation doesn't move them
                fx: node.position3d?.x,
                fy: node.position3d?.y,
                fz: node.position3d?.z,
            }));

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

    // Create a shared circle texture (cached) - high resolution for crisp nodes
    const particleTexture = useMemo(() => {
        const size = 128; // Higher resolution for crisp circles
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        if (context) {
            const center = size / 2;
            const radius = size / 2 - 2; // Small margin for anti-aliasing

            // Draw crisp filled circle with subtle edge
            context.beginPath();
            context.arc(center, center, radius, 0, 2 * Math.PI);
            context.fillStyle = '#ffffff';
            context.fill();

            // Add subtle inner glow for depth
            const gradient = context.createRadialGradient(center, center, radius * 0.7, center, center, radius);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0.15)');
            context.fillStyle = gradient;
            context.fill();
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        return texture;
    }, []);

    // Calculate graph radius for camera positioning
    const getGraphRadius = useCallback(() => {
        let maxDist = 0;
        graphData.nodes.forEach((node: any) => {
            const dist = Math.hypot(node.x || 0, node.y || 0, node.z || 0);
            if (dist > maxDist) maxDist = dist;
        });
        return maxDist < 10 ? 100 : maxDist;
    }, [graphData.nodes]);

    // Mobile detection
    const isMobile = window.innerWidth <= 768;
    // Lower = more zoomed in. Zoomed out for better overview
    const zoomFactor = isMobile ? 0.78 : 0.6;

    // Zoom controls with smoother animation
    const handleZoomIn = useCallback(() => {
        if (!fgRef.current) return;
        const camera = fgRef.current.camera();
        const controls = fgRef.current.controls();
        const pos = camera.position.clone();
        const target = controls.target.clone();

        // Move toward target
        const direction = target.clone().sub(pos).normalize();
        const newPos = pos.clone().add(direction.multiplyScalar(pos.length() * 0.3));

        fgRef.current.cameraPosition(
            { x: newPos.x, y: newPos.y, z: newPos.z },
            { x: target.x, y: target.y, z: target.z },
            400
        );
    }, []);

    const handleZoomOut = useCallback(() => {
        if (!fgRef.current) return;
        const camera = fgRef.current.camera();
        const controls = fgRef.current.controls();
        const pos = camera.position.clone();
        const target = controls.target.clone();

        // Move away from target
        const direction = pos.clone().sub(target).normalize();
        const newPos = pos.clone().add(direction.multiplyScalar(pos.length() * 0.4));

        fgRef.current.cameraPosition(
            { x: newPos.x, y: newPos.y, z: newPos.z },
            { x: target.x, y: target.y, z: target.z },
            400
        );
    }, []);

    const handleResetView = useCallback(() => {
        if (!fgRef.current) return;
        const radius = getGraphRadius();
        fgRef.current.cameraPosition(
            { x: 0, y: 0, z: radius * zoomFactor },
            { x: 0, y: 0, z: 0 },
            1000
        );
        onNodeSelect(null);
    }, [getGraphRadius, zoomFactor, onNodeSelect]);

    const handleFitToScreen = useCallback(() => {
        if (!fgRef.current) return;
        const radius = getGraphRadius();
        // Orbit to a nice angle
        fgRef.current.cameraPosition(
            { x: radius * 0.8, y: radius * 0.5, z: radius * 2 },
            { x: 0, y: 0, z: 0 },
            1200
        );
    }, [getGraphRadius]);

    // Handle Selection Highlighting
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
                positions.push((source as any).x, (source as any).y, (source as any).z || 0);
                positions.push((target as any).x, (target as any).y, (target as any).z || 0);
            }
        });

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const material = new THREE.LineBasicMaterial({
            color: 0x38e8ff,
            transparent: true,
            opacity: 0.7,
            linewidth: 2
        });
        const lines = new THREE.LineSegments(geometry, material);

        highlightLinesRef.current = lines;
        scene.add(lines);

    }, [selectedNode, graphData]);

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <ForceGraph3D
                ref={fgRef}
                graphData={graphData}

                // Tooltip on hover
                nodeLabel={(node: any) => `
                    <div style="
                        background: linear-gradient(135deg, rgba(16, 24, 45, 0.95) 0%, rgba(24, 32, 60, 0.95) 100%);
                        border: 1px solid rgba(56, 232, 255, 0.3);
                        border-radius: 12px;
                        padding: 16px 20px;
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        min-width: 220px;
                        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
                    ">
                        <div style="font-size: 16px; font-weight: 600; color: #fff; margin-bottom: 10px; word-break: break-all;">
                            ${node.meta?.ip || node.id}
                        </div>
                        <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                            <span style="
                                padding: 4px 10px;
                                background: rgba(56, 232, 255, 0.15);
                                border-radius: 5px;
                                color: #38e8ff;
                                font-size: 12px;
                                font-weight: 600;
                                text-transform: uppercase;
                            ">${node.tier}</span>
                            ${node.isHub ? `<span style="
                                padding: 4px 10px;
                                background: rgba(83, 242, 157, 0.15);
                                border-radius: 5px;
                                color: #53f29d;
                                font-size: 12px;
                                font-weight: 600;
                            ">HUB</span>` : ''}
                            ${node.status === 'ARCANE' ? `<span style="
                                padding: 4px 10px;
                                background: rgba(97, 242, 255, 0.15);
                                border-radius: 5px;
                                color: #61f2ff;
                                font-size: 12px;
                                font-weight: 600;
                            ">ARCANE</span>` : ''}
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; font-size: 13px;">
                            <div>
                                <div style="color: rgba(255,255,255,0.5); font-size: 11px; text-transform: uppercase;">Outgoing</div>
                                <div style="color: #fff; font-weight: 600; font-size: 15px;">${node.metrics?.outgoingPeers || 0}</div>
                            </div>
                            <div>
                                <div style="color: rgba(255,255,255,0.5); font-size: 11px; text-transform: uppercase;">Incoming</div>
                                <div style="color: #fff; font-weight: 600; font-size: 15px;">${node.metrics?.incomingPeers || 0}</div>
                            </div>
                            <div>
                                <div style="color: rgba(255,255,255,0.5); font-size: 11px; text-transform: uppercase;">Apps</div>
                                <div style="color: #fff; font-weight: 600; font-size: 15px;">${node.meta?.apps?.length || 0}</div>
                            </div>
                        </div>
                        <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 12px; color: rgba(255,255,255,0.4);">
                            Click to select
                        </div>
                    </div>
                `}

                // Node visuals - using sprites for performance
                nodeColor={node => getNodeColor(node.tier, node.kind, node.status, colorScheme)}
                nodeVal={node => {
                    const base = Math.log(1 + node.metrics.connectionCount);
                    const mobileMultiplier = isMobile ? 1.2 : 1;
                    // Smaller, crisper nodes
                    return Math.max(1.5, 0.5 + base * 0.3) * mobileMultiplier;
                }}

                // PERFORMANCE: Use sprites with shared texture
                nodeThreeObject={(node: any) => {
                    const isHighlighted = highlightedSet.has(node.id);
                    const isSelected = selectedNode === node.id;

                    let color = getNodeColor(node.tier, node.kind, node.status, colorScheme);
                    if (isHighlighted || isSelected) color = '#FFD700';

                    const material = new THREE.SpriteMaterial({
                        map: particleTexture,
                        color: color,
                        transparent: true,
                        depthWrite: false,
                    });
                    const sprite = new THREE.Sprite(material);

                    const base = Math.log(1 + node.metrics.connectionCount);
                    const mobileMultiplier = isMobile ? 1.2 : 1;
                    // Smaller, crisper nodes - matching nodeVal
                    let size = Math.max(1.5, 0.5 + base * 0.3) * mobileMultiplier;
                    if (isHighlighted || isSelected) size *= 1.5;

                    sprite.scale.set(size, size, 1);
                    return sprite;
                }}
                nodeThreeObjectExtend={false}

                // SIMULATION: Skip entirely - positions pre-computed by backend
                warmupTicks={0} // No simulation needed - positions are pre-computed
                cooldownTicks={0} // No cooldown needed

                // Forces disabled - positions are fixed
                d3AlphaDecay={1} // Instant stop
                d3VelocityDecay={1} // No movement

                // EDGES: Hidden by default, shown on selection
                linkWidth={0}
                linkVisibility={false}
                linkDirectionalParticles={0}

                // Rendering
                backgroundColor="#00000000"
                showNavInfo={false}

                // Controls
                enableNodeDrag={false} // Disabled since we freeze positions
                controlType="orbit"

                // Interactions
                onNodeClick={(node) => {
                    if (!node) {
                        onNodeSelect(null);
                        return;
                    }
                    onNodeSelect(node.id as string);

                    const distance = isMobile ? 120 : 80;
                    const x = node.x ?? 0;
                    const y = node.y ?? 0;
                    const z = node.z ?? 0;

                    fgRef.current?.cameraPosition(
                        { x: x, y: y - distance * 0.3, z: z + distance },
                        { x, y, z },
                        1000
                    );
                }}
                onBackgroundClick={() => onNodeSelect(null)}

                // Set initial camera position on engine ready
                onEngineStop={() => {
                    if (!isSimulationDone && fgRef.current) {
                        // Set camera to good initial position
                        const radius = getGraphRadius();
                        fgRef.current.cameraPosition(
                            { x: 0, y: 0, z: radius * zoomFactor },
                            { x: 0, y: 0, z: 0 },
                            400 // Faster transition since graph is already positioned
                        );

                        setIsSimulationDone(true);
                    }
                }}
            />

            {/* Graph Controls */}
            <GraphControls
                onZoomIn={handleZoomIn}
                onZoomOut={handleZoomOut}
                onResetView={handleResetView}
                onFitToScreen={handleFitToScreen}
                colorScheme={colorScheme}
                onColorSchemeChange={onColorSchemeChange || (() => {})}
                nodeCount={totalNodeCount}
                edgeCount={graphData.links.length}
            />
        </div>
    );
};
