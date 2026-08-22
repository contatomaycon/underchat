import { createOutboundWebhookSignature } from '@core/common/functions/outboundWebhookSignature';

describe('outbound webhook signature contract', () => {
  it('signs timestamp dot exact raw body with HMAC-SHA256', () => {
    const signature = createOutboundWebhookSignature({
      secret: 'uc_whsec_test',
      unixTimestamp: 1_710_000_000,
      rawBody: Buffer.from('{"hello":"world"}', 'utf8'),
    });

    expect(signature).toBe(
      'v1=0d46b83e1162d56bb9917de4a797efdc3cb86d38e8343e5549409a262a6d43ce'
    );
  });

  it('rejects an empty signing secret', () => {
    expect(() =>
      createOutboundWebhookSignature({
        secret: '',
        unixTimestamp: 1_710_000_000,
        rawBody: Buffer.from('{}'),
      })
    ).toThrow('signing secret is required');
  });
});
