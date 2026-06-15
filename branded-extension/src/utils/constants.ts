import { BRAND } from '@config/brand';

// All runtime endpoints derive from the single brand config. The defaults point
// at the public Peer protocol services; override them in brand.config.json if
// you run your own API / attestation infrastructure.
export const DEFAULT_API_BASE_URL = BRAND.apiBaseUrl;
export const DEFAULT_ATTESTATION_SERVICE_URL = BRAND.attestationServiceUrl;
export const PROVIDER_TEMPLATE_API_ROOT = BRAND.providerTemplateApiRoot;
export const APP_WEB_URL = BRAND.webUrl;
