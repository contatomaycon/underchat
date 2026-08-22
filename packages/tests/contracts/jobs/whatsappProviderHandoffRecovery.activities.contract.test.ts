import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { WhatsappProviderHandoffRecoveryActivity } from '@core/jobs/activities/whatsappProviderHandoffRecovery.activities';

describe('WhatsApp provider handoff recovery job contract', () => {
  it('runs frequently under the manager distributed cron fence', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'packages/jobs/cronJobs.ts'),
      'utf8'
    );
    const jobStart = source.indexOf(
      "jobId: 'whatsapp-provider-handoff-recovery-schedule'"
    );
    expect(jobStart).toBeGreaterThan(-1);
    const definition = source.slice(jobStart, jobStart + 360);
    expect(definition).toContain("cronExpression: '*/15 * * * * *'");
    expect(definition).toContain('recoverPendingHandoffs');
    expect(definition).not.toContain('useDistributedLock: false');
  });

  it('checks the cron lease before and after a bounded recovery pass', async () => {
    const recovery = {
      recoverOnce: jest.fn().mockResolvedValue({ claimed: 0 }),
    };
    const lease = { assertActive: jest.fn() };
    const activity = new WhatsappProviderHandoffRecoveryActivity(
      recovery as never
    );

    await expect(
      activity.recoverPendingHandoffs(lease as never)
    ).resolves.toBeUndefined();
    expect(recovery.recoverOnce).toHaveBeenCalledTimes(1);
    expect(lease.assertActive).toHaveBeenCalledTimes(2);
  });
});
