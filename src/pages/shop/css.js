// Inline-style helper for the storefront port.
//
// The legacy page carries hundreds of style="..." attributes. Rather than
// hand-translating each one into a JSX object literal (a typo farm), the
// original CSS declaration strings are kept VERBATIM in the JSX and parsed
// into React style objects at runtime by this helper. Parsing is trivial —
// split on ';', first ':' separates property from value, kebab-case →
// camelCase — and none of the page's inline styles contain ';' or '!'
// inside a value (verified by grep), so the result is byte-equivalent to
// what the browser computed from the original attribute strings.
export function css(str) {
  const out = {};
  String(str).split(';').forEach((decl) => {
    const i = decl.indexOf(':');
    if (i <= 0) return;
    const prop = decl.slice(0, i).trim();
    const val = decl.slice(i + 1).trim();
    if (!prop || !val) return;
    const key = prop.startsWith('--')
      ? prop
      : prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[key] = val;
  });
  return out;
}
