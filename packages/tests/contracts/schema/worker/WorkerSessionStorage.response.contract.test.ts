import { Value } from '@sinclair/typebox/value';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { createWorkerSchema } from '@core/schema/worker/createWorker';
import { listWorkerResponseSchema } from '@core/schema/worker/listWorker/response.schema';

const worker = {
  id: 'worker-1',
  name: 'Canal',
  session_storage: EWorkerSessionStorage.postgres,
  number: null,
  status: { id: 'status-1', name: 'creating' },
  type: { id: 'type-1', name: 'baileys' },
  server: null,
  account: null,
  connection_date: null,
  last_connection_check_at: null,
  recreate_available_at: null,
  created_at: null,
  updated_at: null,
};

describe('Worker session storage response contracts', () => {
  it('requires the read-only backend in worker read models', () => {
    expect(Value.Check(listWorkerResponseSchema, worker)).toBe(true);

    const { session_storage: _sessionStorage, ...withoutStorage } = worker;
    expect(Value.Check(listWorkerResponseSchema, withoutStorage)).toBe(false);
  });

  it('exposes the selected default in create responses', () => {
    const response = {
      status: true,
      message: 'accepted',
      data: {
        code: 202,
        status: 'queued',
        queued: true,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: 'type-1',
        session_storage: EWorkerSessionStorage.postgres,
        worker_status_id: 'status-1',
        operation_id: 'operation-1',
        reason: 'create_queued',
      },
    };

    expect(Value.Check(createWorkerSchema.response[202], response)).toBe(true);
    expect(
      Value.Check(createWorkerSchema.response[202], {
        ...response,
        data: {
          ...response.data,
          session_storage: 'volume',
        },
      })
    ).toBe(false);
  });
});
