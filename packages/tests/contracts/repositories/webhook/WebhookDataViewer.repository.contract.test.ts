import 'reflect-metadata';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { WebhookDataViewerRepository } from '@core/repositories/webhook/WebhookDataViewer.repository';

describe('WebhookDataViewerRepository', () => {
  it('builds document id with account and worker ids', async () => {
    const view = jest.fn(async () => ({ ok: true }));
    const repository = new WebhookDataViewerRepository({ view } as never);

    await expect(
      repository.viewWebhookData('acc-1', 'worker-1')
    ).resolves.toEqual({
      ok: true,
    });

    expect(view).toHaveBeenCalledWith(EElasticIndex.webhook, 'acc-1_worker-1');
  });
});
