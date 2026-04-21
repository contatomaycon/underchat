import 'reflect-metadata';
import { WebhookMappingViewerRepository } from '@core/repositories/webhookMapping/WebhookMappingViewer.repository';

describe('WebhookMappingViewerRepository', () => {
  it('returns null when index creation/check fails', async () => {
    const repository = new WebhookMappingViewerRepository({
      indices: jest.fn(async () => null),
      view: jest.fn(),
    } as never);

    await expect(
      repository.viewWebhookMapping('acc-1', 'worker-1')
    ).resolves.toBe(null);
  });

  it('returns null when document is not found', async () => {
    const repository = new WebhookMappingViewerRepository({
      indices: jest.fn(async () => true),
      view: jest.fn(async () => null),
    } as never);

    await expect(
      repository.viewWebhookMapping('acc-1', 'worker-1')
    ).resolves.toBe(null);
  });

  it('returns webhook mapping document when available', async () => {
    const row = {
      account_id: 'acc-1',
      worker_id: 'worker-1',
      mapping: {
        message_type: 'message',
      },
      created_at: '2026-04-21T10:00:00.000Z',
      updated_at: '2026-04-21T11:00:00.000Z',
    };

    const repository = new WebhookMappingViewerRepository({
      indices: jest.fn(async () => true),
      view: jest.fn(async () => row),
    } as never);

    await expect(
      repository.viewWebhookMapping('acc-1', 'worker-1')
    ).resolves.toEqual(row);
  });
});
