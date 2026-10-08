import { BRAND } from '@config/brand';

export const BRAND_SURFACE = BRAND.theme.surface;
export const BRAND_FOREGROUND = BRAND.theme.text;
export const BRAND_BORDER = BRAND.theme.muted;
export const BRAND_IGNITE_YELLOW = BRAND.theme.brand;
export const BRAND_SHADOW_LG = '0 20px 60px rgba(0, 0, 0, 0.35)';
export const BRAND_FONT_STACK = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";
export const BRAND_LOGO_PATH = 'icon-128.png';
export const BRAND_LOGO_URL = chrome.runtime.getURL(BRAND_LOGO_PATH);
