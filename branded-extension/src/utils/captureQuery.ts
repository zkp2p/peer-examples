import { parse, Kind } from '@0no-co/graphql.web';
import { isRecord as record } from './valueGuards';

export type CaptureQuery = {
  query: {
    url: string;
    headers: Record<string, string>;
    body: { query: string; operationName: string; variables: Record<string, unknown> };
  };
};

// No arbitrary fetch/POST capability: one same-origin GraphQL query, with
// browser-owned credentials. Revalidate at the privileged host boundary.
export function captureQuery(value: unknown, origin: string): CaptureQuery['query'] | null {
  if (!record(value) || !record(value.query)) return null;
  const request = value.query;
  if (
    Object.keys(value).length !== 1 ||
    Object.keys(request).some((key) => !['url', 'headers', 'body'].includes(key)) ||
    typeof request.url !== 'string' ||
    request.url.length > 2048 ||
    !record(request.headers) ||
    !record(request.body) ||
    JSON.stringify(request).length > 32 * 1024
  )
    throw new Error('Capture query is invalid.');
  const url = new URL(request.url);
  if (
    url.protocol !== 'https:' ||
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error('Capture query must remain on the provider origin.');
  }
  const { query, operationName, variables } = request.body;
  if (
    Object.keys(request.body).some(
      (key) => !['query', 'operationName', 'variables'].includes(key),
    ) ||
    typeof query !== 'string' ||
    typeof operationName !== 'string' ||
    !record(variables)
  )
    throw new Error('Capture query body is invalid.');
  const definitions: readonly { kind: string; operation?: string; name?: { value: string } }[] =
    parse(query).definitions;
  const operations = definitions.filter((node) => node.kind === Kind.OPERATION_DEFINITION);
  if (
    definitions.some(
      (node) => node.kind !== Kind.OPERATION_DEFINITION && node.kind !== Kind.FRAGMENT_DEFINITION,
    ) ||
    operations.length !== 1 ||
    operations[0].operation !== 'query' ||
    operations[0].name?.value !== operationName
  )
    throw new Error('Capture may only execute a single named GraphQL query.');
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    const key = name.toLowerCase();
    if (
      !/^[a-z][a-z0-9-]{0,63}$/.test(key) ||
      typeof value !== 'string' ||
      value.length > 256 ||
      /[\r\n]/.test(value) ||
      key in headers ||
      /^(?:sec-|proxy-)/.test(key) ||
      [
        'authorization',
        'cookie',
        'cookie2',
        'host',
        'origin',
        'referer',
        'user-agent',
        'connection',
        'content-length',
        'content-type',
        'transfer-encoding',
        'x-http-method',
        'x-http-method-override',
        'x-method-override',
      ].includes(key)
    )
      throw new Error('Capture query header is not allowed.');
    headers[key] = value;
  }
  return { url: url.href, headers, body: { query, operationName, variables } };
}
