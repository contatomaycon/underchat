export function escapeShellDoubleQuotes(value: string): string {
  return value.replace(/[$`"\\]/g, '\\$&');
}
