const ipv4Regex = /^(\d{1,3})(?:\.(\d{1,3})){3}$/;
const ipv6Regex = /^[0-9a-fA-F:]+$/;

export interface HostPort {
  host: string;
  port?: number;
}

export const splitHostPort = (value: string): HostPort => {
  if (!value) {
    return { host: value };
  }

  if (value.startsWith("[")) {
    const match = value.match(/^\[(.+)](?::(\d+))?$/);
    if (match) {
      return { host: match[1], port: match[2] ? Number(match[2]) : undefined };
    }
  }

  const parts = value.split(":");
  if (parts.length === 1) {
    return { host: value };
  }

  const maybePort = parts[parts.length - 1];
  if (/^\d+$/.test(maybePort)) {
    return {
      host: parts.slice(0, -1).join(":"),
      port: Number(maybePort),
    };
  }

  return { host: value };
};

export const normalizeIp = (value: string): string => {
  if (!value) return value;
  const trimmed = value.trim();

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }

  if (trimmed.includes(":")) {
    const { host } = splitHostPort(trimmed);
    return host;
  }

  return trimmed;
};

export const isLikelyIPv4 = (value: string) => ipv4Regex.test(value);
export const isLikelyIPv6 = (value: string) => ipv6Regex.test(value);

export const makeNodeId = (ip: string, collateral?: string) => {
  // Use collateral as unique ID if available (handles multiple nodes behind same IP via uPNP)
  // Otherwise fall back to IP for stub nodes
  return collateral || normalizeIp(ip);
};

export const edgeKey = (a: string, b: string) => {
  const [left, right] = [a, b].sort();
  return left + "|" + right;
};
