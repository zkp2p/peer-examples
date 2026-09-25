import { isRecord } from './valueGuards';

export type CaptureHighlight = { highlight: { pathPrefix: string } };

// A passive guide may identify links, never arbitrary selectors, markup or copy.
export function captureHighlight(value: unknown): CaptureHighlight['highlight'] | null {
  if (!isRecord(value) || !isRecord(value.highlight)) return null;
  const { pathPrefix } = value.highlight;
  if (
    Object.keys(value).length !== 1 ||
    Object.keys(value.highlight).length !== 1 ||
    typeof pathPrefix !== 'string' ||
    pathPrefix.length > 2_048 ||
    !/^\/(?!\/)[^?#\\]+\/$/.test(pathPrefix) ||
    new URL(pathPrefix, 'https://provider.example').pathname !== pathPrefix
  ) {
    throw new Error('Capture highlight requires a canonical provider path prefix.');
  }
  return { pathPrefix };
}
