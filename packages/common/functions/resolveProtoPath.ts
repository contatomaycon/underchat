import fs from 'node:fs';
import path from 'node:path';

export function resolveProtoPath(fileName: string): string {
  const candidates = [
    path.resolve(process.cwd(), 'packages', 'proto', fileName),
    path.resolve(process.cwd(), '..', '..', 'packages', 'proto', fileName),
  ];

  return (
    candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
  );
}
