import { createHmac } from 'node:crypto';

export interface OutboundWebhookSignatureInput {
  secret: string;
  unixTimestamp: number;
  rawBody: Buffer;
}

/**
 * Signs the exact bytes sent to an outbound webhook endpoint.
 */
export const createOutboundWebhookSignature = (
  input: OutboundWebhookSignatureInput
): string => {
  const timestamp = Math.floor(input.unixTimestamp);

  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error('Outbound webhook timestamp must be a positive integer');
  }

  if (!input.secret) {
    throw new Error('Outbound webhook signing secret is required');
  }

  const digest = createHmac('sha256', input.secret)
    .update(`${timestamp}.`, 'utf8')
    .update(input.rawBody)
    .digest('hex');

  return `v1=${digest}`;
};
