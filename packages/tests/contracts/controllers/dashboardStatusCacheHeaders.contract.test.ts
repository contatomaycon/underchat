import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const statusControllers = [
  'packages/controllers/dashboard/methods/listOfflineChannels.ts',
  'packages/controllers/dashboard/methods/listChannelsStatus.ts',
  'apps/manager_api/src/controllers/dashboard/methods/getDashboardStats.ts',
];

describe('dashboard connectivity HTTP cache policy', () => {
  it.each(statusControllers)(
    'prevents stale HTTP status caching in %s',
    (file) => {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source).toContain(
        "reply.header('Cache-Control', 'no-store, max-age=0')"
      );
    }
  );
});
