import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getPackageNodeVersion } from '@core/common/functions/getPackageNodeVersion';

describe('getPackageNodeVersion', () => {
  it('reads and returns engines.node field from package json file', () => {
    const filePath = path.join(
      os.tmpdir(),
      `package-node-version-${Date.now()}-${Math.random()}.json`
    );
    fs.writeFileSync(
      filePath,
      JSON.stringify({ engines: { node: '>=20.0.0' } }),
      'utf8'
    );

    try {
      expect(getPackageNodeVersion(filePath)).toBe('>=20.0.0');
    } finally {
      fs.unlinkSync(filePath);
    }
  });
});
