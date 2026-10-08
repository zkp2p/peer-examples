import { isAutoApprovedConnectionHost } from '@utils/trustedPeerDomains';

export type PeerConnectionStatus = 'connected' | 'disconnected' | 'pending';

export function isAutoApprovedHost(hostname: string): boolean {
  return isAutoApprovedConnectionHost(hostname);
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
