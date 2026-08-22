import 'reflect-metadata';

import { EWorkerPermissions } from '@core/common/enums/EPermissions/worker';
import { ChatTransferOptionsListerUseCase } from '@core/useCases/chat/ChatTransferOptionsLister.useCase';

const makeUseCase = () => {
  const sectorService = {
    listAllSectors: jest.fn(async () => []),
  };
  const workerService = {
    listAllWorkers: jest.fn(async () => [
      { id: 'worker-1', name: 'Varejo' },
      { id: 'worker-2', name: 'Atacado' },
    ]),
  };

  return new ChatTransferOptionsListerUseCase(
    sectorService as never,
    workerService as never
  );
};

describe('ChatTransferOptionsListerUseCase', () => {
  it('lists only directly allowed channels without the permission', async () => {
    const useCase = makeUseCase();

    await expect(
      useCase.execute('account-1', [{ id: 'worker-1', name: 'Varejo' }])
    ).resolves.toMatchObject({
      workers: [{ id: 'worker-1', name: 'Varejo' }],
    });
  });

  it('lists all channels with the transfer and forwarding permission', async () => {
    const useCase = makeUseCase();

    await expect(
      useCase.execute('account-1', [{ id: 'worker-1', name: 'Varejo' }], [
        {
          action_name:
            EWorkerPermissions.view_all_channels_for_transfer_and_forwarding,
        },
      ] as never)
    ).resolves.toMatchObject({
      workers: [
        { id: 'worker-1', name: 'Varejo' },
        { id: 'worker-2', name: 'Atacado' },
      ],
    });
  });
});
