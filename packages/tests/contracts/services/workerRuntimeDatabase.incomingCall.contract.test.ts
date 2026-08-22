import 'reflect-metadata';

import { container } from 'tsyringe';
import { EWorkerConfigStatus } from '@core/common/enums/EWorkerConfigStatus';
import { EWorkerConfigType } from '@core/common/enums/EWorkerConfigType';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { WorkerRuntimeDatabaseService } from '@core/services/workerRuntimeDatabase.service';
import { getWorkerPostgresPool } from '@core/services/workerPostgresPool';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));

jest.mock('@core/services/workerPostgresPool', () => ({
  getWorkerPostgresPool: jest.fn(),
}));

const workerId = '01900000-0000-7000-8000-000000000201';
const accountId = '01900000-0000-7000-8000-000000000202';

describe('WorkerRuntimeDatabaseService direct incoming-call rendering', () => {
  const query = jest.fn();

  beforeEach(() => {
    process.env.WORKER_ID = workerId;
    process.env.ACCOUNT_ID = accountId;
    process.env.RUNTIME_GENERATION = '7';
    process.env.WORKER_RUNTIME_CAPABILITY = 'a'.repeat(64);
    process.env.WORKER_WRITER_EPOCH = '01900000-0000-7000-8000-000000000203';
    process.env.WORKER_TYPE_ID = EWorkerType.wwebjs;
    process.env.HOSTNAME = '0123456789ab';
    jest.mocked(getWorkerPostgresPool).mockReturnValue({ query } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function configRows(template: string) {
    return {
      rows: [
        {
          account_name: 'Acme',
          worker_name: 'Suporte',
          worker_config_type_id: EWorkerConfigType.reject_call,
          worker_config_status_id: EWorkerConfigStatus.active,
          value: null,
        },
        {
          account_name: 'Acme',
          worker_name: 'Suporte',
          worker_config_type_id: EWorkerConfigType.show_message_on_call,
          worker_config_status_id: EWorkerConfigStatus.active,
          value: template,
        },
      ],
    };
  }

  it('resolves a dynamic template directly through the worker ChatService', async () => {
    query.mockResolvedValueOnce(configRows('Olá {{user}}'));
    const renderIncomingCallTemplate = jest.fn(async () => 'Olá Ana');
    jest
      .spyOn(container, 'resolve')
      .mockReturnValue({ renderIncomingCallTemplate } as never);

    await expect(
      new WorkerRuntimeDatabaseService().resolveIncomingCallAction({
        worker_id: workerId,
        account_id: accountId,
        call_jid: '5511999999999@s.whatsapp.net',
        call_phone: '5511999999999',
      })
    ).resolves.toEqual({
      reject_call: true,
      show_message_on_call: true,
      show_message_text: 'Olá Ana',
    });

    expect(renderIncomingCallTemplate).toHaveBeenCalledWith({
      accountId,
      accountName: 'Acme',
      workerId,
      workerName: 'Suporte',
      template: 'Olá {{user}}',
      callJid: '5511999999999@s.whatsapp.net',
      callPhone: '5511999999999',
    });
    expect(String(query.mock.calls[0]?.[0])).toContain(
      'read_whatsapp_worker_call_config'
    );
    expect(query.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([
        'wwebjs',
        7,
        'a'.repeat(64),
        '0123456789ab',
        'wwebjs',
      ])
    );
  });

  it('keeps the static fallback and reject decision when rendering fails', async () => {
    query.mockResolvedValueOnce(configRows('Não atendemos. {{protocol}}'));
    jest.spyOn(container, 'resolve').mockReturnValue({
      renderIncomingCallTemplate: jest.fn(async () => {
        throw new Error('elasticsearch_unavailable');
      }),
    } as never);

    await expect(
      new WorkerRuntimeDatabaseService().resolveIncomingCallAction({
        worker_id: workerId,
        account_id: accountId,
        call_phone: '5511999999999',
      })
    ).resolves.toEqual({
      reject_call: true,
      show_message_on_call: true,
      show_message_text: 'Não atendemos. {{protocol}}',
    });
  });

  it('fails closed when the current runtime fence no longer matches', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(
      new WorkerRuntimeDatabaseService().resolveIncomingCallAction({
        worker_id: workerId,
        account_id: accountId,
        call_phone: '5511999999999',
      })
    ).rejects.toThrow('worker_runtime_database_fence_rejected');
  });

  it('rejects a sibling worker before reading its call configuration', async () => {
    await expect(
      new WorkerRuntimeDatabaseService().resolveIncomingCallAction({
        worker_id: '01900000-0000-7000-8000-000000000299',
        account_id: accountId,
        call_phone: '5511999999999',
      })
    ).rejects.toThrow('worker_runtime_database_scope_rejected');
    expect(query).not.toHaveBeenCalled();
  });
});
