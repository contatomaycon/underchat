import {
  buildWebhookIntegrationEntityKey,
  buildWebhookIntegrationStanzaId,
} from '@core/common/functions/webhookIntegrationIdentity';

describe('webhookIntegrationIdentity', () => {
  const base = {
    account_id: 'account-1',
    worker_id: 'worker-1',
    operation_id: 'operation-1',
    contact_id: 'contact-1',
    phone: '5511999999999',
  };

  it('keeps command ordering scoped to account, worker and contact', () => {
    expect(buildWebhookIntegrationEntityKey(base)).toBe(
      'webhook-integration:account-1:worker-1:contact-1'
    );
    expect(
      buildWebhookIntegrationEntityKey({
        ...base,
        contact_id: '',
      })
    ).toBe('webhook-integration:account-1:worker-1:5511999999999');
  });

  it('uses only the physical operation identity for the synthetic stanza', () => {
    const first = buildWebhookIntegrationStanzaId(base);

    expect(first).toBe(buildWebhookIntegrationStanzaId({ ...base }));
    expect(first).not.toBe(
      buildWebhookIntegrationStanzaId({
        ...base,
        operation_id: 'operation-2',
      })
    );
    expect(
      buildWebhookIntegrationStanzaId({
        ...base,
        operation_id: '',
      })
    ).toBeNull();
  });
});
