import {
  messageDeliveryFactFromOutcome,
  resolveMessageDeliveryOutcome,
  selectStrongestMessageDeliveryOutcome,
} from '@core/common/functions/messageDeliveryOutcome';

describe('messageDeliveryOutcome', () => {
  it('lets a definitive provider failure override an initial sent ACK', () => {
    expect(
      selectStrongestMessageDeliveryOutcome(
        { patch: { is_sent: true } },
        { patch: {}, failed: true }
      )
    ).toBe('failed');
  });

  it('never lets a late failure downgrade delivered or read', () => {
    expect(
      selectStrongestMessageDeliveryOutcome(
        { patch: { is_delivered: true } },
        { failed: true }
      )
    ).toBe('delivered');
    expect(
      selectStrongestMessageDeliveryOutcome(
        { failed: true },
        { patch: { is_seen: true } }
      )
    ).toBe('read');
  });

  it('allows an authoritative sent receipt to resolve an ambiguous outcome', () => {
    expect(
      selectStrongestMessageDeliveryOutcome(
        { failed: true, ambiguous: true },
        { patch: { is_sent: true } }
      )
    ).toBe('sent');
  });

  it('round-trips every persisted outcome into a normalized fact', () => {
    for (const outcome of [
      'none',
      'ambiguous',
      'sent',
      'failed',
      'delivered',
      'read',
    ] as const) {
      expect(
        resolveMessageDeliveryOutcome(messageDeliveryFactFromOutcome(outcome))
      ).toBe(outcome);
    }
  });
});
