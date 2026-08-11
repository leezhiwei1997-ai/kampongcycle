// src/utils/color.js

/**
 * Returns `color` at the given alpha.
 *
 * Exists because string-concatenating an alpha suffix (`${c}22`) only works
 * on 6-digit hex. React Native Paper's MD3 themes hand back `rgba(...)` for
 * several roles, and `rgba(125, 82, 96, 1)22` is not a colour — it throws at
 * render time, which is exactly how this got found.
 */
export function withAlpha(color, alpha = 0.13) {
  if (typeof color !== 'string') return color;
  const c = color.trim();

  const rgbaMatch = c.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgbaMatch) {
    const [, r, g, b] = rgbaMatch;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  if (c.startsWith('#')) {
    let hex = c.slice(1);
    if (hex.length === 3) hex = hex.split('').map((ch) => ch + ch).join('');
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }

  // Named colours and anything unrecognised: return as-is rather than
  // producing a string that crashes the renderer.
  return c;
}

export default withAlpha;
