import { BRAND } from '@config/brand';

export type PeerConnectionStatus = 'connected' | 'disconnected' | 'pending';

// Hosts that never require an explicit connection prompt: localhost (for local
// development) plus every host-app origin declared in brand.config.json. A page
// served from one of these is treated as first-party to this extension.
const ALWAYS_LOCAL = ['localhost', '127.0.0.1'];

function hostnameFromMatchPattern(pattern: string): string | null {
  const match = pattern.match(/^[a-z]+:\/\/([^/]+)\//i);
  return match ? match[1].toLowerCase() : null;
}

const exactHosts = new Set<string>(ALWAYS_LOCAL);
const wildcardSuffixes: string[] = [];

for (const pattern of BRAND.appOrigins) {
  const host = hostnameFromMatchPattern(pattern);
  if (!host) continue;
  if (host.startsWith('*.')) {
    wildcardSuffixes.push(host.slice(1)); // "*.example.com" -> ".example.com"
  } else {
    exactHosts.add(host);
  }
}

export function isAutoApprovedHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (exactHosts.has(normalized)) return true;
  return wildcardSuffixes.some((suffix) => normalized.endsWith(suffix));
}

export function isConnectedToHost(status: PeerConnectionStatus, hostname: string): boolean {
  return status === 'connected' || isAutoApprovedHost(hostname);
}

export function requiresConnectionApproval(
  status: PeerConnectionStatus,
  hostname: string,
): boolean {
  return !isConnectedToHost(status, hostname);
}
