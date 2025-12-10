import { useEffect, useMemo, useState, useCallback } from 'react';
import './App.css';
import { GraphCanvas3D } from './components/GraphCanvas3D';
import { GraphCanvas } from './components/GraphCanvas';
import { Sidebar } from './components/Sidebar';
import { LoadingIndicator } from './components/LoadingIndicator';
import { LandingPage, type ViewMode } from './components/LandingPage';
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

// Always start at landing page
const getInitialViewMode = (): ViewMode | null => {
  return null;
};

export const App = () => {
  const { atlasState, isLoading, error, refresh } = useAtlasState();
  const build = atlasState?.data ?? null;
  const [selectedNode, setSelectedNode] = useSelectedNode(build, null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [colorScheme, setColorScheme] = useState<'arcane' | 'tier'>('tier');
  const [rebuildComplete, setRebuildComplete] = useState(false);
  const [lastSeenBuildId, setLastSeenBuildId] = useState<string | null>(null);
  const [wasBuilding, setWasBuilding] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // View mode state: null = landing page, '2d' or '3d' = graph view
  const [viewMode, setViewMode] = useState<ViewMode | null>(getInitialViewMode);

  // Handle view selection from landing page
  const handleSelectView = useCallback((mode: ViewMode) => {
    setViewMode(mode);
  }, []);

  // Handle returning to landing page
  const handleBackToLanding = useCallback(() => {
    setViewMode(null);
  }, []);

  // Smart debounce: shorter delay for longer queries (user knows what they want)
  useEffect(() => {
    const debounceMs = searchQuery.length >= 3 ? 150 : 400;
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, debounceMs);
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

  // Search matching nodes - return ALL matches for both list and highlighting
  const searchResults = useMemo(() => {
    if (!build || !debouncedSearchQuery.trim()) return [];
    const query = debouncedSearchQuery.trim().toLowerCase();

    // Allow 2+ character searches for better UX
    if (query.length < 2) return [];

    const results: typeof build.nodes = [];

    // Helper to check if node matches query
    const nodeMatches = (node: typeof build.nodes[0]): boolean => {
      // Search by IP (most common)
      if (node.meta.ip && String(node.meta.ip).toLowerCase().includes(query)) return true;
      // Search by payment address
      if (node.meta.paymentAddress && String(node.meta.paymentAddress).toLowerCase().includes(query)) return true;
      // Search by collateral
      if (node.meta.collateral && String(node.meta.collateral).toLowerCase().includes(query)) return true;
      // Search by app name
      if (node.meta.apps && node.meta.apps.some(app => app.name.toLowerCase().includes(query))) return true;
      // Search by tier
      if (node.tier.toLowerCase().includes(query)) return true;
      return false;
    };

    // Collect ALL matching nodes
    for (const node of build.nodes) {
      if (nodeMatches(node)) {
        results.push(node);
      }
    }

    return results;
  }, [build, debouncedSearchQuery]);

  // All matching node IDs for graph highlighting
  const highlightedNodeIds = useMemo(() => {
    return searchResults.map(n => n.id);
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

  // Show landing page if no view mode selected
  if (viewMode === null) {
    return (
      <LandingPage
        onSelectView={handleSelectView}
        isLoading={isLoading}
        nodeCount={build?.stats?.totalFluxNodes}
        onDataReady={refresh}
      />
    );
  }

  // Render the selected graph view
  const renderGraphView = () => {
    if (!hasGraph || !graphPayload) {
      return (
        <div className="graph-placeholder">
          {isLoading ? <LoadingIndicator label="Preparing network topology..." /> : <p>No data available yet.</p>}
        </div>
      );
    }

    if (viewMode === '2d') {
      return (
        <GraphCanvas
          nodes={graphPayload.nodes}
          edges={graphPayload.edges}
          buildId={graphPayload.buildId}
          selectedNode={selectedNode}
          onNodeSelect={setSelectedNode}
          highlightedNodes={highlightedNodeIds}
          colorScheme={colorScheme}
          onColorSchemeChange={setColorScheme}
        />
      );
    }

    return (
      <GraphCanvas3D
        nodes={graphPayload.nodes}
        edges={graphPayload.edges}
        buildId={graphPayload.buildId}
        selectedNode={selectedNode}
        onNodeSelect={setSelectedNode}
        highlightedNodes={highlightedNodeIds}
        colorScheme={colorScheme}
        onColorSchemeChange={setColorScheme}
      />
    );
  };

  return (
    <div className="app-shell">
      <div className="graph-panel">
        {renderGraphView()}
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

        {/* Back to landing button */}
        <button
          className="back-to-landing-btn"
          onClick={handleBackToLanding}
          aria-label="Back to view selection"
          title="Change view mode"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
            <path d="M9 22V12h6v10"/>
          </svg>
        </button>

        {/* Mobile sidebar toggle button */}
        <button
          className="mobile-sidebar-toggle"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        >
          {sidebarOpen ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M6 18L18 6M6 6l12 12"/>
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="1"/>
              <circle cx="12" cy="5" r="1"/>
              <circle cx="12" cy="19" r="1"/>
            </svg>
          )}
        </button>
      </div>

      {/* Backdrop for mobile sidebar */}
      {sidebarOpen && (
        <div
          className="mobile-sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className={`sidebar-container ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <Sidebar
          build={build}
          isBuilding={Boolean(atlasState?.building)}
          lastUpdated={buildCompletedAt}
          error={error}
          selectedNode={selectedNode}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchResults={searchResults}
          totalSearchMatches={searchResults.length}
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
