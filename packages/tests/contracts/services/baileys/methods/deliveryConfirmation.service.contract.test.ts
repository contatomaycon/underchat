import 'reflect-metadata';
import { BaileysDeliveryConfirmationService } from '@core/services/baileys/methods/deliveryConfirmation.service';

describe('BaileysDeliveryConfirmationService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves sent/failed and timeout flows', async () => {
    const service = new BaileysDeliveryConfirmationService();

    const sentPromise = service.waitForOutcome('msg-1', 1000);
    service.markSent('msg-1');
    await expect(sentPromise).resolves.toBe('sent');

    const failedPromise = service.waitForOutcome('msg-2', 1000);
    service.markFailed('msg-2');
    await expect(failedPromise).resolves.toBe('failed');

    const timeoutPromise = service.waitForOutcome('msg-3', 1000);
    jest.advanceTimersByTime(1001);
    await expect(timeoutPromise).resolves.toBe('timeout');
  });

  it('returns cached outcome and ignores invalid ids', async () => {
    const service = new BaileysDeliveryConfirmationService();

    service.markSent('true_5511@c.us_stanza-1');
    await expect(
      service.waitForOutcome(' true_5511@c.us_stanza-1 ')
    ).resolves.toBe('sent');
    await expect(service.waitForOutcome('   ', 10)).resolves.toBe('timeout');

    jest.setSystemTime(new Date('2026-01-01T00:03:00Z'));
    const expiredPromise = service.waitForOutcome(
      'true_5511@c.us_stanza-1',
      10
    );
    jest.advanceTimersByTime(11);
    await expect(expiredPromise).resolves.toBe('timeout');
  });
});
