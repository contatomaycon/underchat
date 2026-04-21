import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getPackageVersion } from '@core/common/functions/getPackageVersion';

describe('getPackageVersion', () => {
  it('reads and returns version field from package json file', () => {
    const filePath = path.join(
      os.tmpdir(),
      `package-version-${Date.now()}-${Math.random()}.json`
    );
    fs.writeFileSync(filePath, JSON.stringify({ version: '1.2.3' }), 'utf8');

    try {
      expect(getPackageVersion(filePath)).toBe('1.2.3');
    } finally {
      fs.unlinkSync(filePath);
    }
  });
});
