interface LoadingIndicatorProps {
  label?: string;
  progress?: number; // 0-100
  stage?: string;
  stages?: string[];
  currentStageIndex?: number;
  variant?: 'default' | 'compact' | 'overlay';
}

export const LoadingIndicator = ({
  label = 'Synchronizing Flux Atlas...',
  progress,
  stage,
  stages,
  currentStageIndex = 0,
  variant = 'default'
}: LoadingIndicatorProps) => (
  <div className={`loading-indicator loading-indicator--${variant}`}>
    <div className="loading-indicator__content">
      <div className="spinner" />
      <div className="loading-indicator__text">
        <span className="loading-indicator__label">{label}</span>
        {stage && <span className="loading-indicator__stage">{stage}</span>}
      </div>
    </div>
    {progress !== undefined && (
      <div className="loading-indicator__progress">
        <div className="loading-indicator__progress-bar">
          <div
            className="loading-indicator__progress-fill"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
        <span className="loading-indicator__progress-text">{Math.round(progress)}%</span>
      </div>
    )}
    {stages && stages.length > 0 && (
      <div className="loading-indicator__stages">
        {stages.map((s, i) => (
          <div
            key={i}
            className={`loading-indicator__stage-dot ${
              i < currentStageIndex ? 'completed' : i === currentStageIndex ? 'active' : ''
            }`}
            title={s}
          />
        ))}
      </div>
    )}
  </div>
);
