interface LoadingIndicatorProps {
  label?: string;
}

export const LoadingIndicator = ({ label = 'Synchronizing Flux Atlas...' }: LoadingIndicatorProps) => (
  <div className="loading-indicator">
    <div className="spinner" />
    <span>{label}</span>
  </div>
);
