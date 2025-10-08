import type { NodeStatus, NodeTier } from '../types';
import { statusColors, tierColors } from '../theme';

interface StatusBadgeProps {
  type: 'tier' | 'status';
  value: NodeTier | NodeStatus;
}

export const StatusBadge = ({ type, value }: StatusBadgeProps) => {
  const color = type === 'tier' ? tierColors[value as NodeTier] : statusColors[value as NodeStatus];
  const label = value.toString().toUpperCase();

  return (
    <span className="status-badge" style={{ borderColor: color, color }}>
      {label}
    </span>
  );
};
