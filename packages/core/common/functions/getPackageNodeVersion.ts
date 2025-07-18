import fs from 'fs';
import path from 'path';

export function getPackageNodeVersion(patch: string): string {
  const packageJsonPath = path.resolve(patch);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  return packageJson.engines.node;
}
