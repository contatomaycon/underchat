import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('database connector timezone', () => {
  it('configures both Postgres pools with Sao Paulo session timezone', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'packages/config/database/index.ts'),
      'utf8'
    );

    expect(source).toContain(
      "import { APP_TIMEZONE } from '@core/common/constants/timezone';"
    );
    expect(source).toContain(
      'const postgresSessionOptions = `-c timezone=${APP_TIMEZONE}`;'
    );
    expect(source.match(/options: postgresSessionOptions/g)).toHaveLength(2);
  });
});
