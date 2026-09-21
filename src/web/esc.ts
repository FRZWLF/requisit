/**
 * The one escaping helper (D-013). Every value that reaches a template goes through it —
 * templates take *data*, never raw HTML, so there is no second path by which a requisition
 * note, an item name or a rejection reason could reach the browser unescaped.
 *
 * Both quote characters are escaped, so the same function is correct in element text and in
 * a single- or double-quoted attribute value; `&` is replaced first by construction (the
 * character class is scanned once, left to right, and each match is replaced literally).
 */

const REPLACEMENTS: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function esc(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const text = typeof value === 'string' ? value : String(value);
  return text.replace(/[&<>"']/g, (character) => REPLACEMENTS[character] as string);
}
