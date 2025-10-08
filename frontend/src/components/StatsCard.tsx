interface StatsCardProps {
  label: string;
  value: string;
  accent?: 'primary' | 'secondary' | 'danger';
  helperText?: string;
}

export const StatsCard = ({ label, value, accent = 'primary', helperText }: StatsCardProps) => (
  <div className={`stats-card stats-card--${accent}`}>
    <span className="stats-card__label">{label}</span>
    <span className="stats-card__value">{value}</span>
    {helperText ? <span className="stats-card__helper">{helperText}</span> : null}
  </div>
);
