import { createHash } from 'node:crypto';

interface IWebhookIntegrationIdentityInput {
  account_id?: string | null;
  worker_id?: string | null;
  operation_id?: string | null;
  contact_id?: string | null;
  phone?: string | null;
}

function normalize(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

export function buildWebhookIntegrationEntityKey(
  input: IWebhookIntegrationIdentityInput
): string {
  const accountId = normalize(input.account_id) ?? 'unknown-account';
  const workerId = normalize(input.worker_id) ?? 'unknown-worker';
  const entity =
    normalize(input.contact_id) ?? normalize(input.phone) ?? 'unknown-contact';

  return `webhook-integration:${accountId}:${workerId}:${entity}`;
}

export function buildWebhookIntegrationStanzaId(
  input: IWebhookIntegrationIdentityInput
): string | null {
  const accountId = normalize(input.account_id);
  const workerId = normalize(input.worker_id);
  const operationId = normalize(input.operation_id);
  if (!accountId || !workerId || !operationId) {
    return null;
  }

  const digest = createHash('sha256')
    .update(['v1', accountId, workerId, operationId].join('\0'))
    .digest('hex');

  return `webhook_v1_${digest}`;
}
