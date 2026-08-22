import fs from 'node:fs';
import path from 'node:path';

export function resolveUnderchatProjectRoot(
  startDirectory = process.cwd()
): string {
  let candidate = path.resolve(startDirectory);

  for (let depth = 0; depth <= 6; depth += 1) {
    if (
      fs.existsSync(path.join(candidate, 'package.json')) &&
      fs.existsSync(path.join(candidate, 'node_modules'))
    ) {
      return candidate;
    }

    const parent = path.dirname(candidate);
    if (parent === candidate) {
      break;
    }
    candidate = parent;
  }

  throw new Error(
    `Unable to resolve Underchat project root from ${startDirectory}`
  );
}
