export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
