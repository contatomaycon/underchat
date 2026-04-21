import 'reflect-metadata';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { WebhookMappingSaverRepository } from '@core/repositories/webhookMapping/WebhookMappingSaver.repository';

describe('WebhookMappingSaverRepository', () => {
  it('returns false when index cannot be prepared', async () => {
    const repository = new WebhookMappingSaverRepository({
      indices: jest.fn(async () => null),
      view: jest.fn(),
      updateWithScriptOCC: jest.fn(),
    } as never);

    await expect(
      repository.saveWebhookMapping('acc-1', 'worker-1', {
        message_type: 'message',
      })
    ).resolves.toBe(false);
  });

  it('returns true when update result is created/updated/noop', async () => {
    const updateWithScriptOCC = jest
      .fn(async () => 'created')
      .mockResolvedValueOnce('updated')
      .mockResolvedValueOnce('noop');

    const repository = new WebhookMappingSaverRepository({
      indices: jest.fn(async () => true),
      view: jest.fn(async () => null),
      updateWithScriptOCC,
    } as never);

    await expect(
      repository.saveWebhookMapping('acc-1', 'worker-1', {
        message_type: 'message',
      })
    ).resolves.toBe(true);

    await expect(
      repository.saveWebhookMapping('acc-1', 'worker-1', {
        message_type: 'message',
      })
    ).resolves.toBe(true);

    await expect(
      repository.saveWebhookMapping('acc-1', 'worker-1', {
        message_type: 'message',
      })
    ).resolves.toBe(true);
  });

  it('returns false when update result is not accepted', async () => {
    const repository = new WebhookMappingSaverRepository({
      indices: jest.fn(async () => true),
      view: jest.fn(async () => null),
      updateWithScriptOCC: jest.fn(async () => 'conflict'),
    } as never);

    await expect(
      repository.saveWebhookMapping('acc-1', 'worker-1', {
        message_type: 'message',
      })
    ).resolves.toBe(false);
  });

  it('cleanTransferFields removes sector fields when transfer_user_id exists', () => {
    const repository = new WebhookMappingSaverRepository({} as never);

    const result = (repository as any).cleanTransferFields({
      message_type: 'message',
      transfer_user_id: 'user-1',
      transfer_sector_id: 'sector-1',
      transfer_sector_user_id: 'sector-user-1',
    });

    expect(result).toEqual({
      message_type: 'message',
      transfer_user_id: 'user-1',
    });
  });

  it('cleanTransferFields removes all transfer fields for plain message', () => {
    const repository = new WebhookMappingSaverRepository({} as never);

    const result = (repository as any).cleanTransferFields({
      message_type: 'message',
      transfer_user_id: '',
      transfer_sector_id: '',
      transfer_sector_user_id: '',
      queue: 'q1',
    });

    expect(result).toEqual({
      message_type: 'message',
      queue: 'q1',
    });
  });

  it('saveDocument sends OCC update with upsert and retries', async () => {
    const updateWithScriptOCC = jest.fn(async () => 'created');
    const repository = new WebhookMappingSaverRepository({
      updateWithScriptOCC,
    } as never);

    await expect(
      (repository as any).saveDocument('acc-1_worker-1', {
        account_id: 'acc-1',
        worker_id: 'worker-1',
        mapping: { message_type: 'message' },
        updated_at: '2026-04-21T10:00:00.000Z',
      })
    ).resolves.toBe('created');

    expect(updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.webhook_mapping,
      'acc-1_worker-1',
      expect.objectContaining({
        source: 'ctx._source = params.doc;',
      }),
      {
        upsert: true,
        maxRetries: 5,
      }
    );
  });
});
