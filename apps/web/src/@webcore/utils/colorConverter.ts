export const hexToRgb = (hex: string) => {
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;

  hex = hex.replace(
    shorthandRegex,
    (m: string, r: string, g: string, b: string) => {
      return r + r + g + g + b + b;
    }
  );

  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);

  return result
    ? `${Number.parseInt(result[1], 16)},${Number.parseInt(result[2], 16)},${Number.parseInt(result[3], 16)}`
    : null;
};

export const rgbaToHex = (rgba: string, forceRemoveAlpha = false) => {
  return `#${rgba
    .replace(/(?:^rgba?\()|\s+|(?:\)$)/g, '')
    .split(',')
    .filter((_, index) => !forceRemoveAlpha || index !== 3)
    .map((string) => Number.parseFloat(string))
    .map((number, index) => (index === 3 ? Math.round(number * 255) : number))
    .map((number) => number.toString(16))
    .map((string) => (string.length === 1 ? `0${string}` : string))
    .join('')}`;
};
