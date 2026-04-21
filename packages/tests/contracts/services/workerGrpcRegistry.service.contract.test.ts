import 'reflect-metadata';
import { WorkerGrpcRegistryService } from '@core/services/workerGrpcRegistry.service';

jest.mock('@core/config/environments', () => ({
  balanceEnvironment: {
    grpcPort: 50051,
  },
}));

describe('WorkerGrpcRegistryService', () => {
  it('returns host and grpc port when server exists', async () => {
    const service = new WorkerGrpcRegistryService({
      viewServerWebById: jest.fn(async () => ({ web_domain: 'worker.local' })),
    } as never);

    await expect(service.getAddress('server-1')).resolves.toEqual({
      host: 'worker.local',
      port: 50051,
    });
  });

  it('throws when server is not found', async () => {
    const service = new WorkerGrpcRegistryService({
      viewServerWebById: jest.fn(async () => null),
    } as never);

    await expect(service.getAddress('server-1')).rejects.toThrow(
      'Server not found: server-1'
    );
  });
});
