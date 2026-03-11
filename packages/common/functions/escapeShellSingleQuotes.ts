export function escapeShellSingleQuotes(value: string): string {
  return value.replaceAll("'", `'\"'\"'`);
}
