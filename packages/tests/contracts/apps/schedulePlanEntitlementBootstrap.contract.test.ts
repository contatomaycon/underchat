import fs from 'node:fs';
import path from 'node:path';

describe('schedule plan entitlement bootstrap', () => {
  it('registers entitlement telemetry before starting cron jobs', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'apps/schedule_api/src/index.ts'),
      'utf8'
    );

    const telemetryRegistration = source.indexOf(
      "safePlugin(planEntitlementTelemetryPlugin, 'planEntitlementTelemetry')"
    );
    const jobsStart = source.indexOf('startJobs(server');

    expect(source).toContain(
      "import planEntitlementTelemetryPlugin from '@core/plugins/planEntitlementTelemetry'"
    );
    expect(telemetryRegistration).toBeGreaterThan(-1);
    expect(jobsStart).toBeGreaterThan(telemetryRegistration);
  });
});
