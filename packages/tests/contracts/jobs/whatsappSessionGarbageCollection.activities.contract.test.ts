import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { WhatsappSessionGarbageCollectionActivity } from '@core/jobs/activities/whatsappSessionGarbageCollection.activities';

describe('WhatsApp session garbage-collection job contract', () => {
  it('runs from the hourly manager cron instead of the five-second lease heartbeat', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'packages/jobs/cronJobs.ts'),
      'utf8'
    );
    const jobStart = source.indexOf(
      "jobId: 'whatsapp-session-garbage-collection-schedule'"
    );
    expect(jobStart).toBeGreaterThan(-1);
    const definition = source.slice(jobStart, jobStart + 320);
    expect(definition).toContain("cronExpression: '0 25 * * * *'");
    expect(definition).toContain('collectExpiredRevisions');
    expect(definition).not.toContain("cronExpression: '*/5 * * * * *'");
  });

  it('delegates one bounded pass to the collector service', async () => {
    const garbageCollector = {
      collectOnce: jest.fn().mockResolvedValue({ claimed: 0 }),
    };
    const activity = new WhatsappSessionGarbageCollectionActivity(
      garbageCollector as never
    );

    await expect(activity.collectExpiredRevisions()).resolves.toBeUndefined();
    expect(garbageCollector.collectOnce).toHaveBeenCalledTimes(1);
  });
});
