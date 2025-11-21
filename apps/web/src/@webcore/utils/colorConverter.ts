export const hexToRgb = (hex: string): string | null => {
  const shorthand = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  const normalized = hex.replace(
    shorthand,
    (_m, r: string, g: string, b: string) => `${r}${r}${g}${g}${b}${b}`
  );
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(normalized);

  if (!match) return null;

  return `${Number.parseInt(match[1], 16)},${Number.parseInt(match[2], 16)},${Number.parseInt(match[3], 16)}`;
};

export const rgbaToHex = (rgba: string, forceRemoveAlpha = false): string => {
  const stripped = rgba
    .replaceAll(/\s+/g, '')
    .replace(/^rgba?\(/, '')
    .replace(/\)$/, '');

  const parts = stripped.split(',');
  const out: string[] = [];
  const end = forceRemoveAlpha ? 3 : Math.min(parts.length, 4);

  for (let i = 0; i < end; i += 1) {
    const num =
      i === 3
        ? Math.round(Number.parseFloat(parts[i]) * 255)
        : Number.parseFloat(parts[i]);

    out.push(num.toString(16).padStart(2, '0'));
  }

  return `#${out.join('')}`;
};
