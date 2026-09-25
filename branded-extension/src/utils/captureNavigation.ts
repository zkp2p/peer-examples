export type CaptureNavigation = { navigate: { url: string } };

// A nested value distinguishes a continuation from flat verifier params.
export function captureNavigationUrl(value: unknown, origin: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('navigate' in value))
    return null;
  const target = value.navigate;
  if (!target || typeof target !== 'object') return null;
  if (
    Object.keys(value).length !== 1 ||
    Array.isArray(target) ||
    Object.keys(target).length !== 1 ||
    !('url' in target) ||
    typeof target.url !== 'string' ||
    target.url.length > 2_048
  ) {
    throw new Error('Capture navigation is invalid.');
  }
  const url = new URL(target.url);
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) {
    throw new Error('Capture navigation must remain on the provider origin.');
  }
  return url.href;
}
