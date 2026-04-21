import 'reflect-metadata';
import { WorkerBalancerViewerRepository } from '@core/repositories/worker/WorkerBalancerViewer.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('WorkerBalancerViewerRepository', () => {
  it('returns null when no balancer is found', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new WorkerBalancerViewerRepository(dbMock.db as never);

    await expect(
      repository.viewWorkerBalancer('a-1', 'w-1')
    ).resolves.toBeNull();
  });

  it('returns worker balancer payload when found', async () => {
    const row = {
      server_id: 's-1',
      server_status_id: 'online',
      key: 'api-key',
      web_domain: 'example.com',
      web_port: 443,
      web_protocol: 'https',
      account_id: 'a-1',
    };
    const dbMock = createSelectDbMock([row]);
    const repository = new WorkerBalancerViewerRepository(dbMock.db as never);

    await expect(repository.viewWorkerBalancer('a-1', 'w-1')).resolves.toEqual(
      row
    );
  });
});
