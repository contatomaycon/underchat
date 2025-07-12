import fs from 'fs';
import path from 'path';

export function getPackageVersion(patch: string): string {
  const packageJsonPath = path.resolve(patch);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  return packageJson.version;
}
