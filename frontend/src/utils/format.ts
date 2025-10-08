const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact' });

export const formatNumber = (value: number) => numberFormatter.format(value);
export const formatCompact = (value: number) => compactNumber.format(value);

export const formatDuration = (ms: number) => {
  if (!Number.isFinite(ms) || ms < 0) return '�';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
};

export const formatPercentage = (value: number) => `${(value * 100).toFixed(1)}%`;

/**
 * Format bandwidth speed in MB/s or GB/s
 * 0-999 MB/s, 1.00+ GB/s if >= 1000 MB/s
 */
export const formatBandwidth = (mbps: number): string => {
  if (mbps < 1000) {
    return `${Math.round(mbps)} MB/s`;
  }
  const gbps = mbps / 1000;
  return `${gbps.toFixed(2)} GB/s`;
};
