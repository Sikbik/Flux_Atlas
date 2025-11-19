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

/**
 * Checks if an IP address is in a private or reserved range (SSRF protection)
 * Blocks: RFC 1918 private ranges, localhost, link-local, multicast, reserved
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  if (!ip) return true;

  const trimmed = ip.trim();

  // Check for IPv4
  const ipv4Match = trimmed.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map(Number);

    // Validate octets are in range 0-255
    if (octets.some(octet => octet < 0 || octet > 255)) {
      return true;
    }

    // RFC 1918 - Private ranges
    if (octets[0] === 10) return true; // 10.0.0.0/8
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true; // 172.16.0.0/12
    if (octets[0] === 192 && octets[1] === 168) return true; // 192.168.0.0/16

    // Localhost
    if (octets[0] === 127) return true; // 127.0.0.0/8

    // Link-local
    if (octets[0] === 169 && octets[1] === 254) return true; // 169.254.0.0/16

    // Multicast (224.0.0.0/4)
    if (octets[0] >= 224 && octets[0] <= 239) return true;

    // Reserved/Future use (240.0.0.0/4)
    if (octets[0] >= 240) return true;

    // 0.0.0.0/8 - Current network (only valid as source)
    if (octets[0] === 0) return true;

    // Broadcast
    if (octets.every(octet => octet === 255)) return true;

    return false;
  }

  // Check for IPv6 private/reserved ranges
  const lowerIp = trimmed.toLowerCase();

  // Localhost
  if (lowerIp === '::1' || lowerIp === '::ffff:127.0.0.1') return true;

  // Link-local (fe80::/10)
  if (lowerIp.startsWith('fe80:')) return true;

  // Unique local addresses (fc00::/7)
  if (lowerIp.startsWith('fc') || lowerIp.startsWith('fd')) return true;

  // Multicast (ff00::/8)
  if (lowerIp.startsWith('ff')) return true;

  // Unspecified address
  if (lowerIp === '::' || lowerIp === '0000:0000:0000:0000:0000:0000:0000:0000') return true;

  // If we can't parse it as IPv4 or recognize it as IPv6, block it
  if (!isLikelyIPv6(trimmed)) {
    return true;
  }

  return false;
}
