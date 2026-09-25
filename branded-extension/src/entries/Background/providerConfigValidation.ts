import type { ProviderSettings } from '@utils/types';

export function assertUsableProviderConfig(providerConfig: unknown): ProviderSettings {
  if (typeof providerConfig !== 'object' || providerConfig === null) {
    throw new Error('Provider configuration must be an object.');
  }

  const candidate = providerConfig as Partial<ProviderSettings>;
  if (typeof candidate.authLink !== 'string') {
    throw new Error('Provider configuration must define an https authLink.');
  }

  let authUrl: URL;
  try {
    authUrl = new URL(candidate.authLink);
  } catch {
    throw new Error('Provider configuration must define an https authLink.');
  }
  if (authUrl.protocol !== 'https:') {
    throw new Error('Provider configuration must define an https authLink.');
  }
  if (typeof candidate.metadata !== 'object' || candidate.metadata === null) {
    throw new Error('Provider configuration must define metadata.');
  }

  if (
    typeof candidate.metadata.platform !== 'string' ||
    !candidate.metadata.platform.trim() ||
    typeof candidate.metadata.method !== 'string' ||
    typeof candidate.metadata.urlRegex !== 'string' ||
    typeof candidate.metadata.transactionsExtraction !== 'object' ||
    candidate.metadata.transactionsExtraction === null
  ) {
    throw new Error('Provider configuration metadata is incomplete.');
  }

  if (!Array.isArray(candidate.paramNames) || !Array.isArray(candidate.paramSelectors)) {
    throw new Error('Provider configuration must define paramNames and paramSelectors arrays.');
  }
  if (candidate.paramNames.length !== candidate.paramSelectors.length) {
    throw new Error('Provider configuration paramNames and paramSelectors must have equal length.');
  }
  if (candidate.paramNames.some((name) => typeof name !== 'string' || !name.trim())) {
    throw new Error('Provider configuration contains an invalid param name.');
  }

  const allowedSources = new Set(['responseBody', 'requestBody', 'url']);
  for (const selector of candidate.paramSelectors as Array<{
    source?: unknown;
    type?: unknown;
    value?: unknown;
  }>) {
    if (
      typeof selector !== 'object' ||
      selector === null ||
      !['jsonPath', 'regex', 'xPath'].includes(String(selector.type)) ||
      typeof selector.value !== 'string'
    ) {
      throw new Error('Provider configuration contains an invalid param selector.');
    }
    if (selector.source !== undefined && !allowedSources.has(String(selector.source))) {
      throw new Error('Provider param selectors may read only responseBody, requestBody, or url.');
    }
  }

  return candidate as ProviderSettings;
}

export function buildProviderPatternList(providerConfig: ProviderSettings): string[] {
  const patternList: string[] = [];
  const metadata = providerConfig.metadata;

  if (metadata.urlRegex) {
    patternList.push(metadata.urlRegex);
  }
  if (metadata.fallbackUrlRegex) {
    patternList.push(metadata.fallbackUrlRegex);
  }
  if (metadata.metadataUrl) {
    const metadataUrlPattern = metadata.metadataUrl.replace(/\{\{[^}]+\}\}/g, '\\S+');
    if (!patternList.includes(metadataUrlPattern)) {
      patternList.push(metadataUrlPattern);
    }
  }

  if (patternList.length === 0) {
    throw new Error('Provider template does not define metadata intercept patterns.');
  }

  try {
    patternList.forEach((pattern) => RegExp(pattern));
  } catch {
    throw new Error('Provider template defines an invalid metadata intercept pattern.');
  }

  return patternList;
}
