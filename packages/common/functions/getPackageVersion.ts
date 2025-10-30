import fs from 'node:fs';
import path from 'node:path';

export function getPackageVersion(patch: string): string {
  const packageJsonPath = path.resolve(patch);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  return packageJson.version;
}
