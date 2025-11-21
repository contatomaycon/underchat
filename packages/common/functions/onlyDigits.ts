export function onlyDigits(v: string) {
  return v.replaceAll(/\D/g, '');
}
