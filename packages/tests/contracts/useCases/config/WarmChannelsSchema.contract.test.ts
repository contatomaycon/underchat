import 'reflect-metadata';
import { Value } from '@sinclair/typebox/value';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerWarmPoolState } from '@core/common/enums/EWorkerWarmPoolState';
import { listWarmChannelsSchema } from '@core/schema/config/listWarmChannels';
import { recreateWarmChannelSchema } from '@core/schema/config/recreateWarmChannel';
import { recreateWarmChannelsAllSchema } from '@core/schema/config/recreateWarmChannelsAll';

const check = (schema: unknown, value: unknown) =>
  Value.Check(schema as never, value);

describe('Warm channels API schemas', () => {
  it('accepts the list query filters and response shape', () => {
    expect(
      check(listWarmChannelsSchema.querystring, {
        current_page: 1,
        per_page: 10,
        server_id: 'srv-1',
        type: EWorkerType.baileys,
        warm_pool_id: 'warm',
        container_id: 'container',
        container_name: 'warm-container',
        session_volume_name: 'volume',
        search: 'server',
        created_at_from: '2026-06-01T00:00:00.000Z',
        created_at_to: '2026-06-02T00:00:00.000Z',
        updated_at_from: '2026-06-03T00:00:00.000Z',
        updated_at_to: '2026-06-04T00:00:00.000Z',
        last_health_at_from: '2026-06-05T00:00:00.000Z',
        last_health_at_to: '2026-06-06T00:00:00.000Z',
      })
    ).toBe(true);

    expect(
      check(listWarmChannelsSchema.response[200], {
        status: true,
        message: 'ok',
        data: {
          pagings: {
            current_page: 1,
            total_pages: 1,
            per_page: 10,
            count: 1,
            total: 1,
          },
          results: [
            {
              warm_pool_id: 'warm-1',
              server: { id: 'srv-1', name: 'Server 1' },
              type: { id: EWorkerType.baileys, name: 'Baileys' },
              state: EWorkerWarmPoolState.ready,
              container_id: 'container-1',
              container_name: 'warm-container-1',
              session_volume_name: 'volume-1',
              last_health_at: '2026-06-05T12:00:00.000Z',
              last_error: null,
              created_at: '2026-06-05T10:00:00.000Z',
              updated_at: '2026-06-05T12:00:00.000Z',
            },
          ],
        },
      })
    ).toBe(true);
  });

  it('exposes recreate params/body and accepted response contracts', () => {
    expect(recreateWarmChannelSchema.params).toBeDefined();
    expect(
      check(recreateWarmChannelsAllSchema.body, {
        server_id: 'srv-1',
        type: EWorkerType.baileys,
        warm_pool_id: 'warm',
        container_id: null,
        container_name: 'container',
        session_volume_name: 'volume',
        search: 'server',
      })
    ).toBe(true);

    expect(
      check(recreateWarmChannelSchema.response[202], {
        status: true,
        message: 'accepted',
        data: { enqueued: 1 },
      })
    ).toBe(true);
    expect(
      check(recreateWarmChannelsAllSchema.response[202], {
        status: true,
        message: 'accepted',
        data: { enqueued: 2 },
      })
    ).toBe(true);
  });
});
