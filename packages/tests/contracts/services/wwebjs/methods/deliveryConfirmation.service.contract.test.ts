import 'reflect-metadata';
import { WwebjsDeliveryConfirmationService } from '@core/services/wwebjs/methods/deliveryConfirmation.service';

describe('WwebjsDeliveryConfirmationService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves sent/failed and timeout flows', async () => {
    const service = new WwebjsDeliveryConfirmationService();

    const sentPromise = service.waitForOutcome('msg-1', 1000);
    expect(service.markSent('msg-1')).toBe(true);
    await expect(sentPromise).resolves.toBe('sent');

    const failedPromise = service.waitForOutcome('msg-2', 1000);
    expect(service.markFailed('msg-2')).toBe(true);
    await expect(failedPromise).resolves.toBe('failed');

    const timeoutPromise = service.waitForOutcome('msg-3', 1000);
    jest.advanceTimersByTime(1001);
    await expect(timeoutPromise).resolves.toBe('timeout');
  });

  it('returns cached outcome and ignores invalid ids', async () => {
    const service = new WwebjsDeliveryConfirmationService();

    service.markSent('false_5511@s.whatsapp.net_stanza-1');
    await expect(
      service.waitForOutcome(' false_5511@s.whatsapp.net_stanza-1 ')
    ).resolves.toBe('sent');
    expect(service.markSent('   ')).toBe(false);
    expect(service.markFailed('   ')).toBe(false);
    await expect(service.waitForOutcome('   ', 10)).resolves.toBe('timeout');

    jest.setSystemTime(new Date('2026-01-01T00:03:00Z'));
    const expiredPromise = service.waitForOutcome(
      'false_5511@s.whatsapp.net_stanza-1',
      10
    );
    jest.advanceTimersByTime(11);
    await expect(expiredPromise).resolves.toBe('timeout');
  });

  it('keeps sent terminal across serialized and raw stanza aliases', async () => {
    const service = new WwebjsDeliveryConfirmationService();

    const serializedId = 'true_158733669765176@lid_3EB0568349A91325BAD72D';
    const rawStanzaId = '3EB0568349A91325BAD72D';

    expect(service.markSent(serializedId)).toBe(true);
    expect(service.markFailed(rawStanzaId)).toBe(false);
    await expect(service.waitForOutcome(serializedId, 1000)).resolves.toBe(
      'sent'
    );
    await expect(service.waitForOutcome(rawStanzaId, 1000)).resolves.toBe(
      'sent'
    );

    const secondSerializedId =
      'false_5511999999999@c.us_3EB0568349A91325BAD72E';
    const secondRawStanzaId = '3EB0568349A91325BAD72E';

    expect(service.markSent(secondRawStanzaId)).toBe(true);
    expect(service.markFailed(secondSerializedId)).toBe(false);
    await expect(
      service.waitForOutcome(secondSerializedId, 1000)
    ).resolves.toBe('sent');
  });

  it('allows sent to recover failed across serialized and raw stanza aliases', async () => {
    const service = new WwebjsDeliveryConfirmationService();

    const serializedId = 'true_158733669765176@lid_3EB0568349A91325BAD72D';
    const rawStanzaId = '3EB0568349A91325BAD72D';

    expect(service.markFailed(serializedId)).toBe(true);
    await expect(service.waitForOutcome(rawStanzaId, 1000)).resolves.toBe(
      'failed'
    );
    expect(service.markSent(rawStanzaId)).toBe(true);
    await expect(service.waitForOutcome(serializedId, 1000)).resolves.toBe(
      'sent'
    );

    const secondSerializedId =
      'false_5511999999999@c.us_3EB0568349A91325BAD72E';
    const secondRawStanzaId = '3EB0568349A91325BAD72E';

    expect(service.markFailed(secondRawStanzaId)).toBe(true);
    await expect(
      service.waitForOutcome(secondSerializedId, 1000)
    ).resolves.toBe('failed');
    expect(service.markSent(secondSerializedId)).toBe(true);
    await expect(service.waitForOutcome(secondRawStanzaId, 1000)).resolves.toBe(
      'sent'
    );
  });
});
