import { useEffect, useMemo, useState } from 'react';
import './App.css';
import { GraphCanvas } from './components/GraphCanvas';
import { Sidebar } from './components/Sidebar';
import { LoadingIndicator } from './components/LoadingIndicator';
import { useAtlasState } from './hooks/useAtlasState';
import { apiConfig } from './api/atlas';
import type { AtlasBuild } from './types';

function useSelectedNode(build: AtlasBuild | null, current: string | null) {
  const [selected, setSelected] = useState<string | null>(current);

  useEffect(() => {
    if (!build || !selected) return;
    if (!build.nodes.some((node) => node.id === selected)) {
      setSelected(null);
    }
  }, [build, selected]);

  return [selected, setSelected] as const;
}

export const App = () => {
  const { atlasState, isLoading, error } = useAtlasState();
  const build = atlasState?.data ?? null;
  const [selectedNode, setSelectedNode] = useSelectedNode(build, null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [colorScheme, setColorScheme] = useState<'arcane' | 'tier'>('tier');
  const [rebuildComplete, setRebuildComplete] = useState(false);
  const [lastSeenBuildId, setLastSeenBuildId] = useState<string | null>(null);
  const [wasBuilding, setWasBuilding] = useState(false);

  // Debounce search query for performance
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Use build completion time from backend, not client fetch time
  const buildCompletedAt = build?.completedAt ? new Date(build.completedAt) : null;

  // Lightweight polling: Check for new builds without disrupting the UI
  useEffect(() => {
    const checkForNewBuild = async () => {
      try {
        const response = await fetch(`${apiConfig.baseUrl}/api/status`);
        if (!response.ok) return;

        const status = await response.json();
        const currentBuildId = status.buildId;
        const isBuilding = status.building;

        console.log('[Background Poll]', {
          isBuilding,
          currentBuildId,
          lastSeenBuildId,
          wasBuilding,
        });

        // Track if we're currently building
        if (isBuilding && !wasBuilding) {
          console.log('[Background Poll] Build started');
          setWasBuilding(true);
          setRebuildComplete(false);
        }

        // Detect when build completes with a new buildId
        if (!isBuilding && wasBuilding && currentBuildId && currentBuildId !== lastSeenBuildId) {
          console.log('[Background Poll] BUILD COMPLETED - New buildId detected!');
          setRebuildComplete(true);
          setLastSeenBuildId(currentBuildId);
          setWasBuilding(false);
        }

        // Initialize lastSeenBuildId on first load
        if (currentBuildId && !lastSeenBuildId && !isBuilding) {
          console.log('[Background Poll] Initializing with buildId:', currentBuildId);
          setLastSeenBuildId(currentBuildId);
        }
      } catch (err) {
        console.error('[Background Poll] Error:', err);
      }
    };

    // Check immediately on mount
    checkForNewBuild();

    // Then poll every 10 seconds
    const pollInterval = setInterval(checkForNewBuild, 10000);
    return () => clearInterval(pollInterval);
  }, [lastSeenBuildId, wasBuilding]);

  const hasGraph = Boolean(build && build.nodes.length > 0 && build.edges.length > 0);

  // Search and highlight matching nodes
  const searchResults = useMemo(() => {
    if (!build || !debouncedSearchQuery.trim()) return [];
    const query = debouncedSearchQuery.trim().toLowerCase();

    // Only search if query is 3+ characters to reduce lag
    if (query.length < 3) return [];

    return build.nodes.filter((node) => {
      // Search by IP
      if (node.meta.ip && String(node.meta.ip).toLowerCase().includes(query)) return true;
      // Search by payment address
      if (node.meta.paymentAddress && String(node.meta.paymentAddress).toLowerCase().includes(query)) return true;
      // Search by collateral
      if (node.meta.collateral && String(node.meta.collateral).toLowerCase().includes(query)) return true;
      // Search by app name
      if (node.meta.apps && node.meta.apps.some(app => app.name.toLowerCase().includes(query))) return true;
      return false;
    });
  }, [build, debouncedSearchQuery]);

  // Memoize highlighted node IDs to prevent GraphCanvas re-renders
  const highlightedNodeIds = useMemo(() => {
    return searchResults.map((n) => n.id);
  }, [searchResults]);

  const graphPayload = useMemo(() => {
    if (!build) return null;
    return {
      nodes: build.nodes,
      edges: build.edges,
      buildId: build.buildId,
    };
  }, [build]);

  const showOverlay = Boolean(atlasState?.building) || rebuildComplete;

  const handleRefreshAfterRebuild = () => {
    // Reload the page to get the new graph data
    window.location.reload();
  };

  return (
    <div className="app-shell">
      <div className="graph-panel">
        {hasGraph && graphPayload ? (
          <GraphCanvas
            nodes={graphPayload.nodes}
            edges={graphPayload.edges}
            buildId={graphPayload.buildId}
            selectedNode={selectedNode}
            onNodeSelect={setSelectedNode}
            highlightedNodes={highlightedNodeIds}
            colorScheme={colorScheme}
          />
        ) : (
          <div className="graph-placeholder">
            {isLoading ? <LoadingIndicator label="Preparing network topology..." /> : <p>No data available yet.</p>}
          </div>
        )}
        {showOverlay ? (
          <div className="graph-overlay">
            {rebuildComplete ? (
              <div className="rebuild-complete">
                <div className="rebuild-complete-icon">✓</div>
                <span>Rebuild Complete!</span>
                <button onClick={handleRefreshAfterRebuild} className="refresh-prompt-button">
                  Refresh Now
                </button>
              </div>
            ) : (
              <LoadingIndicator label="Scanning the Network..." />
            )}
          </div>
        ) : null}
      </div>
      <div className="sidebar-container">
        <Sidebar
          build={build}
          isBuilding={Boolean(atlasState?.building)}
          lastUpdated={buildCompletedAt}
          error={error}
          selectedNode={selectedNode}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchResults={searchResults}
          onSearchResultClick={setSelectedNode}
          colorScheme={colorScheme}
          onColorSchemeChange={setColorScheme}
        />
        <div className="footer-section">
          <div className="footer-support">Support Development ❤️</div>
          <div
            className="footer-address"
            onClick={() => navigator.clipboard.writeText('t3aYE1U7yncYeCoAGmfpbEXo3dbQSegZCSP')}
            title="Click to copy"
          >
            t3aYE1U7yncYeCoAGmfpbEXo3dbQSegZCSP
          </div>
          <a
            href="https://github.com/Sikbik/Flux_Atlas"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-github-link"
          >
            <img src="/GitHub_Logo_White.png" alt="GitHub" className="footer-github-logo" />
          </a>
        </div>
      </div>
    </div>
  );
};

export default App;
