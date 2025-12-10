import { useState, useMemo } from 'react';
import { tierColors, statusColors } from '../theme';

interface GraphControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onFitToScreen: () => void;
  colorScheme: 'arcane' | 'tier';
  onColorSchemeChange: (scheme: 'arcane' | 'tier') => void;
  nodeCount?: number;
  edgeCount?: number;
}

export const GraphControls = ({
  onZoomIn,
  onZoomOut,
  onResetView,
  onFitToScreen,
  colorScheme,
  onColorSchemeChange,
  nodeCount,
  edgeCount
}: GraphControlsProps) => {
  const [showHelp, setShowHelp] = useState(false);

  // Detect mobile for showing appropriate help controls
  const isMobile = useMemo(() => {
    return window.innerWidth < 768 || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
  }, []);

  const legendItems = colorScheme === 'tier'
    ? [
        { label: 'Cumulus', color: tierColors.CUMULUS },
        { label: 'Nimbus', color: tierColors.NIMBUS },
        { label: 'Stratus', color: tierColors.STRATUS },
      ]
    : [
        { label: 'ArcaneOS', color: statusColors.ARCANE },
        { label: 'Legacy', color: statusColors.LEGACY },
      ];

  return (
    <div className="graph-controls">
      {/* Navigation Controls */}
      <div className="graph-controls__group">
        <button
          className="graph-controls__btn"
          onClick={onZoomIn}
          title="Zoom In"
          aria-label="Zoom In"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>
        <button
          className="graph-controls__btn"
          onClick={onZoomOut}
          title="Zoom Out"
          aria-label="Zoom Out"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>
        <button
          className="graph-controls__btn"
          onClick={onFitToScreen}
          title="Orbit View"
          aria-label="Orbit View"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <ellipse cx="12" cy="12" rx="10" ry="4" />
          </svg>
        </button>
        <button
          className="graph-controls__btn"
          onClick={onResetView}
          title="Reset View"
          aria-label="Reset View"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>
        <button
          className={`graph-controls__btn ${showHelp ? 'active' : ''}`}
          onClick={() => setShowHelp(!showHelp)}
          title="Help"
          aria-label="Help"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </button>
      </div>

      {/* Help Tooltip */}
      {showHelp && (
        <div className="graph-controls__help">
          <div className="graph-controls__help-title">Navigation</div>
          {isMobile ? (
            <>
              <div className="graph-controls__help-item">
                <span className="graph-controls__help-key">Drag</span>
                <span>Pan / Rotate</span>
              </div>
              <div className="graph-controls__help-item">
                <span className="graph-controls__help-key">Pinch</span>
                <span>Zoom in/out</span>
              </div>
              <div className="graph-controls__help-item">
                <span className="graph-controls__help-key">Tap node</span>
                <span>Select & focus</span>
              </div>
            </>
          ) : (
            <>
              <div className="graph-controls__help-item">
                <span className="graph-controls__help-key">Drag</span>
                <span>Rotate view</span>
              </div>
              <div className="graph-controls__help-item">
                <span className="graph-controls__help-key">Scroll</span>
                <span>Zoom in/out</span>
              </div>
              <div className="graph-controls__help-item">
                <span className="graph-controls__help-key">Right-drag</span>
                <span>Pan view</span>
              </div>
              <div className="graph-controls__help-item">
                <span className="graph-controls__help-key">Click node</span>
                <span>Select & focus</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Color Scheme Toggle */}
      <div className="graph-controls__group">
        <button
          className={`graph-controls__btn graph-controls__btn--toggle ${colorScheme === 'tier' ? 'active' : ''}`}
          onClick={() => onColorSchemeChange('tier')}
          title="Color by Tier"
        >
          <span className="graph-controls__toggle-label">Tier</span>
        </button>
        <button
          className={`graph-controls__btn graph-controls__btn--toggle ${colorScheme === 'arcane' ? 'active' : ''}`}
          onClick={() => onColorSchemeChange('arcane')}
          title="Color by ArcaneOS"
        >
          <span className="graph-controls__toggle-label">Arcane</span>
        </button>
      </div>

      {/* Color Legend */}
      <div className="graph-controls__legend">
        {legendItems.map((item) => (
          <div key={item.label} className="graph-controls__legend-item">
            <span
              className="graph-controls__legend-dot"
              style={{ backgroundColor: item.color }}
            />
            <span className="graph-controls__legend-label">{item.label}</span>
          </div>
        ))}
      </div>

      {/* Stats */}
      {nodeCount !== undefined && edgeCount !== undefined && (
        <div className="graph-controls__stats">
          <span>{nodeCount.toLocaleString()} nodes</span>
          <span className="graph-controls__stats-divider">•</span>
          <span>{edgeCount.toLocaleString()} edges</span>
        </div>
      )}
    </div>
  );
};
