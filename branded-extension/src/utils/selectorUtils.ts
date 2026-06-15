export function interpolateIndex(input: string, index: number): string {
  if (typeof input !== 'string') return String(input);
  const replacement = String(index);
  return input.replace(/\{\{INDEX\}\}/g, replacement);
}

export function evaluateRegexSelector(pattern: string, source: string, index: number): string {
  try {
    const compiled = new RegExp(interpolateIndex(pattern, index), 'g');
    const matches = Array.from(source.matchAll(compiled));
    if (!matches.length) return '';
    const selected = matches[Math.min(index, matches.length - 1)];
    if (!selected) return '';
    return selected[1] !== undefined ? String(selected[1]) : String(selected[0] ?? '');
  } catch (e) {
    console.error('[selectorUtils] Error evaluating regex selector:', e);
    return '';
  }
}

export function evaluateXPathSelector(
  expression: string,
  documentNode: Document,
  index: number,
  contextNode?: Node | null,
): string {
  try {
    const withIndex = interpolateIndex(expression, index);
    const result = documentNode.evaluate(
      withIndex,
      contextNode || documentNode,
      null,
      XPathResult.STRING_TYPE,
      null,
    ).stringValue;
    return (result || '').trim();
  } catch (e) {
    console.error('[selectorUtils] Error evaluating XPath selector:', e);
    return '';
  }
}
