import 'reflect-metadata';

import { EWorkerType } from '@core/common/enums/EWorkerType';
import { ChatWorkersListerUseCase } from '@core/useCases/chat/ChatWorkersLister.useCase';

describe('ChatWorkersListerUseCase', () => {
  it('preserves worker type metadata for chat worker fallback checks', async () => {
    const workerService = {
      listAllWorkers: jest.fn(async () => [
        {
          id: 'worker-official',
          name: 'Official WhatsApp',
          number: '5561999999999',
          type_id: EWorkerType.whatsapp,
          is_official: true,
          status: { id: 'online' },
        },
        {
          id: 'worker-baileys',
          name: 'Navegador',
          number: null,
          type_id: EWorkerType.baileys,
          is_official: false,
          status: { id: 'online' },
        },
      ]),
    };
    const useCase = new ChatWorkersListerUseCase(workerService as never);

    const result = await useCase.execute('account-1');

    expect(result).toEqual([
      {
        id: 'worker-official',
        name: 'Official WhatsApp',
        number: '5561999999999',
        type_id: EWorkerType.whatsapp,
        is_official: true,
      },
      {
        id: 'worker-baileys',
        name: 'Navegador',
        number: null,
        type_id: EWorkerType.baileys,
        is_official: false,
      },
    ]);
  });
});
