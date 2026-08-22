import { Value } from '@sinclair/typebox/value';
import { FormatRegistry } from '@sinclair/typebox';
import { EWorkerRecreatePhase } from '@core/common/enums/EWorkerRecreatePhase';
import { listChannelsStatusFinalResponseSchema } from '@core/schema/dashboard/listChannelsStatus/response.schema';
import { listOfflineChannelsFinalResponseSchema } from '@core/schema/dashboard/listOfflineChannels/response.schema';
import { listWorkerResponseSchema } from '@core/schema/worker/listWorker/response.schema';
import { viewWorkerResponseSchema } from '@core/schema/worker/viewWorker/response.schema';

const worker = {
  id: '019fd752-2c52-74fa-8924-a6e8f7d7df97',
  name: 'Channel',
  session_storage: 'postgres',
  number: null,
  status: {
    id: '019a930d-c6f6-766d-9c84-46093814d8e0',
    name: 'recreating',
  },
  type: { id: '019a930d-c6f6-766d-9c84-62b9c3e7d1f0', name: 'wwebjs' },
  server: null,
  account: null,
  connection_date: null,
  recreate_available_at: null,
  external_connection_revision: 1,
  created_at: '2026-08-07T12:00:00.000Z',
  updated_at: '2026-08-07T12:00:00.000Z',
  recreate_phase: EWorkerRecreatePhase.connecting,
  recreate_phase_observed_at: '2026-08-07T12:00:01.000Z',
  recreate_runtime_retired: false,
};

describe('worker recreate presentation phase response schemas', () => {
  const previousDateTimeFormat = FormatRegistry.Get('date-time');

  beforeAll(() => {
    FormatRegistry.Set('date-time', (value) =>
      Number.isFinite(Date.parse(value))
    );
  });

  afterAll(() => {
    if (previousDateTimeFormat) {
      FormatRegistry.Set('date-time', previousDateTimeFormat);
    } else {
      FormatRegistry.Delete('date-time');
    }
  });

  it('accepts only the two read-only recreate phases on list/view responses', () => {
    expect(
      Value.Check(listWorkerResponseSchema, {
        ...worker,
        last_connection_check_at: null,
      })
    ).toBe(true);
    expect(Value.Check(viewWorkerResponseSchema, worker)).toBe(true);

    const invalid = { ...worker, recreate_phase: 'booting' };
    expect(
      Value.Check(listWorkerResponseSchema, {
        ...invalid,
        last_connection_check_at: null,
      })
    ).toBe(false);
    expect(Value.Check(viewWorkerResponseSchema, invalid)).toBe(false);
  });

  it('keeps dashboard snapshot schemas compatible with the same phase', () => {
    const channel = {
      id: worker.id,
      name: worker.name,
      worker_type_id: worker.type.id,
      session_identity_present: false,
      status: worker.status,
      recreate_phase: EWorkerRecreatePhase.recreating,
      recreate_phase_observed_at: '2026-08-07T12:00:02.000Z',
      recreate_runtime_retired: true,
    };
    expect(Value.Check(listChannelsStatusFinalResponseSchema, [channel])).toBe(
      true
    );
    expect(Value.Check(listOfflineChannelsFinalResponseSchema, [channel])).toBe(
      true
    );
  });

  it('rejects a non-boolean runtime retirement projection', () => {
    expect(
      Value.Check(viewWorkerResponseSchema, {
        ...worker,
        recreate_runtime_retired: 'true',
      })
    ).toBe(false);
  });
});
