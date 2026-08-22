import 'reflect-metadata';

import {
  OfficialWhatsappPhoneAlreadyConnectedError,
  WorkerWhatsappOfficialConnectionRepository,
} from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';

const ACTIVE_PHONE_NUMBER_UNIQUE_INDEX =
  'worker_whatsapp_official_connection_active_phone_number_uidx';

function buildRepository(transactionError: unknown) {
  const dbRw = {
    transaction: jest.fn(async () => {
      throw transactionError;
    }),
  };

  return new WorkerWhatsappOfficialConnectionRepository(
    dbRw as never,
    {} as never
  );
}

describe('WorkerWhatsappOfficialConnectionRepository', () => {
  it('normalizes an active-phone unique violation from the embedded reconnect transaction', async () => {
    const repository = buildRepository({
      cause: {
        code: '23505',
        constraint: ACTIVE_PHONE_NUMBER_UNIQUE_INDEX,
      },
    });

    await expect(
      repository.createWithWorkerAndMigrateChannelAccess({} as never)
    ).rejects.toBeInstanceOf(OfficialWhatsappPhoneAlreadyConnectedError);
  });

  it('normalizes an active-phone unique violation from an existing-worker reconnect', async () => {
    const repository = buildRepository({
      code: '23505',
      constraint: ACTIVE_PHONE_NUMBER_UNIQUE_INDEX,
    });

    await expect(
      repository.createForExistingWorker({} as never)
    ).rejects.toBeInstanceOf(OfficialWhatsappPhoneAlreadyConnectedError);
  });

  it('does not hide unrelated database errors', async () => {
    const originalError = {
      code: '23505',
      constraint: 'another_unique_index',
    };
    const repository = buildRepository(originalError);

    await expect(
      repository.createWithWorkerAndMigrateChannelAccess({} as never)
    ).rejects.toBe(originalError);
  });
});
