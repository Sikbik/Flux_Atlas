import { useState, useEffect } from 'react';
import type { AtlasBuild, AtlasNode } from '../types';
import { formatCompact, formatNumber, formatPercentage } from '../utils/format';
import { StatsCard } from './StatsCard';
import { NodeDetails } from './NodeDetails';
import { palette, tierColors } from '../theme';

interface SidebarProps {
  build: AtlasBuild | null;
  isBuilding: boolean;
  lastUpdated: Date | null;
  error: string | null;
  selectedNode: string | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchResults: AtlasNode[];
  totalSearchMatches: number;
  onSearchResultClick: (nodeId: string) => void;
  colorScheme: 'arcane' | 'tier';
  onColorSchemeChange: (scheme: 'arcane' | 'tier') => void;
}

const formatUpdatedLabel = (isBuilding: boolean, lastUpdated: Date | null) => {
  if (isBuilding) return 'Scanning the network...';
  if (!lastUpdated) return 'Waiting for first network scan...';
  return `Latest network scan: ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

const RESULTS_PER_PAGE = 25;

export const Sidebar = ({
  build,
  isBuilding,
  lastUpdated,
  error,
  selectedNode,
  searchQuery,
  onSearchChange,
  searchResults,
  totalSearchMatches,
  onSearchResultClick,
  colorScheme,
  onColorSchemeChange
}: SidebarProps) => {
  const stats = build?.stats;
  const selected = build?.nodes.find((node) => node.id === selectedNode) ?? null;

  // Pagination state
  const [currentPage, setCurrentPage] = useState(0);
  const totalPages = Math.ceil(searchResults.length / RESULTS_PER_PAGE);
  const paginatedResults = searchResults.slice(
    currentPage * RESULTS_PER_PAGE,
    (currentPage + 1) * RESULTS_PER_PAGE
  );

  // Reset to first page when search changes
  useEffect(() => {
    setCurrentPage(0);
  }, [searchQuery]);

  return (
    <aside className="sidebar">
      <header className="sidebar__header">
        <div style={{ alignSelf: 'center' }}>
          <h1>Flux Network Atlas</h1>
          <p style={isBuilding ? { animation: 'pulse-text 2s ease-in-out infinite' } : undefined}>
            {formatUpdatedLabel(isBuilding, lastUpdated)}
          </p>
        </div>
        <a
          href="https://runonflux.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="flux-logo-link"
          style={{
            display: 'flex',
            alignItems: 'center',
            opacity: 0.8,
            transition: 'opacity 0.2s',
            marginLeft: '-20px'
          }}
          onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
          onMouseLeave={(e) => e.currentTarget.style.opacity = '0.8'}
        >
          <img src="/Flux_symbol_blue-white.png" alt="Flux" className="flux-logo" style={{ height: '90px' }} />
        </a>
      </header>

      {error ? (
        <div className="sidebar__error">
          <strong>API Error</strong>
          <p>{error}</p>
        </div>
      ) : null}

      {/* Search Section */}
      <section className="sidebar__section">
        <h2>Search Nodes</h2>
        <div className="search-input-wrapper">
          <input
            type="text"
            placeholder="Search by IP, address, tier, or app..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="search-input"
          />
          {searchQuery && (
            <button
              className="search-clear-btn"
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          )}
        </div>
        {searchResults.length > 0 && (
          <div className="search-results">
            <div className="search-results__header">
              <p className="search-results__count">
                {totalSearchMatches} node{totalSearchMatches !== 1 ? 's' : ''} found
                {totalSearchMatches > searchResults.length && (
                  <span className="search-results__all-highlighted"> (all highlighted)</span>
                )}
              </p>
              {totalPages > 1 && (
                <div className="search-results__pagination">
                  <button
                    className="search-results__page-btn"
                    onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                    disabled={currentPage === 0}
                    aria-label="Previous page"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M15 18l-6-6 6-6"/>
                    </svg>
                  </button>
                  <span className="search-results__page-info">
                    {currentPage + 1} / {totalPages}
                  </span>
                  <button
                    className="search-results__page-btn"
                    onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={currentPage >= totalPages - 1}
                    aria-label="Next page"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M9 18l6-6-6-6"/>
                    </svg>
                  </button>
                </div>
              )}
            </div>
            <div className="search-results__list">
              {paginatedResults.map((node) => (
                <button
                  key={node.id}
                  onClick={() => onSearchResultClick(node.id)}
                  className={`search-result-item ${selectedNode === node.id ? 'selected' : ''}`}
                >
                  <div className="search-result-item__ip">{String(node.meta.ip || node.id)}</div>
                  <div className="search-result-item__meta">
                    <span className="search-result-item__tier">{node.tier}</span>
                    {node.meta.paymentAddress && (
                      <span className="search-result-item__address">
                        {String(node.meta.paymentAddress).slice(0, 12)}...
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
        {searchQuery && searchQuery.trim().length === 1 && (
          <p className="search-hint">Type one more character to search</p>
        )}
        {searchQuery && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
          <p className="search-hint">No nodes found matching "{searchQuery}"</p>
        )}
      </section>

      {stats ? (
        <section className="sidebar__section">
          <div className="stats-grid">
            <StatsCard label="Flux Nodes" value={formatNumber(stats.totalFluxNodes)} />
            <StatsCard label="Hubs" value={formatNumber(stats.hubCount)} accent="primary" />
            <StatsCard label="Edges" value={formatCompact(stats.totalEdgesTrimmed)} accent="secondary" />
          </div>
        </section>
      ) : null}

      {stats ? (
        <section className="sidebar__section">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <h2 style={{ margin: 0 }}>ArcaneOS Adoption</h2>
            <button
              onClick={() => onColorSchemeChange(colorScheme === 'arcane' ? 'tier' : 'arcane')}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                background: colorScheme === 'tier' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(56, 232, 255, 0.15)',
                border: colorScheme === 'tier' ? '1px solid rgba(255, 255, 255, 0.2)' : '1px solid rgba(56, 232, 255, 0.4)',
                borderRadius: '4px',
                color: colorScheme === 'tier' ? '#ffffff' : '#38e8ff',
                cursor: 'pointer',
                fontWeight: 500,
                transition: 'all 0.2s',
                whiteSpace: 'nowrap',
              }}
            >
              {colorScheme === 'tier' ? 'Toggle Arcane Mode' : 'Toggle Tier Mode'}
            </button>
          </div>
          <div style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px' }}>
              <span>Legacy: <strong>{formatNumber(stats.totalFluxNodes - stats.statusTotals.ARCANE)}</strong></span>
              <span>Arcane: <strong>{formatNumber(stats.statusTotals.ARCANE)}</strong></span>
            </div>
            <div style={{
              width: '100%',
              height: '8px',
              background: 'rgba(255, 255, 255, 0.1)',
              borderRadius: '4px',
              overflow: 'hidden'
            }}>
              <div style={{
                width: `${((stats.statusTotals.ARCANE / Math.max(stats.totalFluxNodes, 1)) * 100).toFixed(1)}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #ffd166, #61f2ff)',
                transition: 'width 0.3s ease'
              }} />
            </div>
            <div style={{ marginTop: '6px', fontSize: '12px', color: 'rgba(255, 255, 255, 0.6)', textAlign: 'right' }}>
              {formatPercentage(stats.statusTotals.ARCANE / Math.max(stats.totalFluxNodes, 1))} adoption
            </div>
          </div>
        </section>
      ) : null}

      {stats ? (
        <section className="sidebar__section sidebar__section--tiers">
          <h2>Tier Presence</h2>
          <ul className="tier-list">
            {(Object.entries(stats.tierTotals) as Array<[string, number]>)
              .filter(([tier]) => tier.toUpperCase() !== 'UNKNOWN')
              .map(([tier, value]) => (
                <li key={tier}>
                  <span className="tier-dot" style={{ backgroundColor: tierColors[tier as keyof typeof tierColors] ?? palette.accent }} />
                  <span>{tier}</span>
                  <span>{formatNumber(value)}</span>
                </li>
              ))}
          </ul>
        </section>
      ) : null}


      <section className="sidebar__section sidebar__section--details">
        <h2>Node Spotlight</h2>
        <NodeDetails node={selected} />
      </section>
    </aside>
  );
};
