import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveUnderchatProjectRoot } from '@core/common/functions/resolveUnderchatProjectRoot';

describe('resolveUnderchatProjectRoot', () => {
  it('finds the workspace root from a nested application directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'underchat-root-'));
    const nested = path.join(root, 'apps', 'service_api');
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{}');

    try {
      expect(resolveUnderchatProjectRoot(nested)).toBe(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when no workspace root can be proven', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'underchat-missing-'));

    try {
      expect(() => resolveUnderchatProjectRoot(root)).toThrow(
        'Unable to resolve Underchat project root'
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
