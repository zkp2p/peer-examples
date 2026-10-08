import type { PeerCapturePlugin } from '@utils/types/captureProgram';
import { capturePluginDigest } from './capturePlugin';
import { PROVIDER_TEMPLATE_API_ROOT } from './constants';

const REGISTRY_URL = `${PROVIDER_TEMPLATE_API_ROOT}capture-plugins.json`;

/** Only Curator can attest to a plugin's contents; the requesting site cannot. */
export async function isApprovedCapturePlugin(plugin: PeerCapturePlugin): Promise<boolean> {
  const digest = await capturePluginDigest(plugin);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(REGISTRY_URL, {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    if (!response.ok) return false;

    const registry: unknown = await response.json();
    if (!registry || typeof registry !== 'object' || !('plugins' in registry)) return false;
    if (!Array.isArray(registry.plugins)) return false;
    return registry.plugins.some(
      (entry: unknown) =>
        entry !== null &&
        typeof entry === 'object' &&
        'id' in entry &&
        'sha256' in entry &&
        entry.id === plugin.id &&
        entry.sha256 === digest,
    );
  } catch {
    // Offline, redirects and invalid responses must never grant verified status.
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
