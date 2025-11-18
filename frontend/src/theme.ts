import type { NodeStatus, NodeTier, NodeKind } from './types';

export const palette = {
  background: '#050814',
  surface: '#0f172a',
  surfaceAlt: '#111c32',
  textPrimary: '#f8fafc',
  textSecondary: '#cbd5f5',
  border: '#1e2745',
  accent: '#38e8ff',
  danger: '#ff6b6b',
  success: '#53f29d',
};

export const tierColors: Record<NodeTier, string> = {
  CUMULUS: '#4da6ff',
  NIMBUS: '#b388ff',
  STRATUS: '#ff8f4d',
  UNKNOWN: '#7d89b0',
};

export const statusColors: Record<NodeStatus, string> = {
  ARCANE: '#38e8ff',
  LEGACY: '#ffd166',
  UNVERIFIED: '#8892b0',
};

export const stubColor = 'rgba(148, 163, 211, 0.45)';

export const graphBackground = 'linear-gradient(160deg, #040a1a 0%, #070e26 50%, #0b172f 100%)';

export const getNodeColor = (tier: NodeTier, kind: NodeKind, status: NodeStatus, colorScheme?: 'arcane' | 'tier'): string => {
  const scheme = colorScheme ?? 'tier';
  if (kind === 'stub') {
    return stubColor;
  }
  if (scheme === 'arcane') {
    if (status === 'ARCANE') {
      return '#61f2ff';
    }
    return '#ffd166'; // Legacy nodes in gold
  }
  // scheme === 'tier'
  return tierColors[tier] ?? tierColors.UNKNOWN;
};
