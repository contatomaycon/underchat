import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { projectMobileChannelStatusEvent } from '@core/common/functions/mobileChannelStatusProjection';

const sourceId = '11111111-1111-4111-8111-111111111111';
const online = {
  provider: 'baileys',
  status: 'online',
  connected: true,
  authenticated: true,
  sessionValid: true,
  recoverable: true,
  qrAvailable: false,
  sequence: 2,
  changedAt: '2026-08-04T12:00:02.000Z',
};

describe('mobile realtime channel status projection', () => {
  it('keeps persisted ONLINE as truth while retaining native ordering', () => {
    const payload = {
      event_type: 'status' as const,
      worker_id: 'worker-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.online,
      connection_status: online,
      connection_status_source_id: sourceId,
      connection_status_order: '20',
      connection_online_acknowledged: false,
    };

    expect(projectMobileChannelStatusEvent({ payload })).toEqual({
      kind: 'status',
      statusId: EWorkerStatus.online,
      isOnline: true,
      publicStatus: undefined,
      nextOrder: '20',
    });
    expect(
      projectMobileChannelStatusEvent({
        payload: { ...payload, connection_online_acknowledged: true },
      })
    ).toEqual({
      kind: 'status',
      statusId: EWorkerStatus.online,
      isOnline: true,
      publicStatus: undefined,
      nextOrder: '20',
    });
  });

  it('rejects duplicate, stale and malformed native events', () => {
    const payload = {
      event_type: 'status' as const,
      worker_id: 'worker-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.online,
      connection_status: online,
      connection_status_source_id: sourceId,
      connection_status_order: '19',
      connection_online_acknowledged: true,
    };

    expect(
      projectMobileChannelStatusEvent({ payload, currentOrder: '20' })
    ).toEqual({ kind: 'ignored', reason: 'stale_native_status_order' });
    expect(
      projectMobileChannelStatusEvent({
        payload: { ...payload, connection_status_source_id: 'invalid' },
      })
    ).toEqual({ kind: 'ignored', reason: 'invalid_native_status_envelope' });
  });

  it('keeps an HTTP ONLINE(order 10) when buffered OFFLINE(order 9) is replayed', () => {
    expect(
      projectMobileChannelStatusEvent({
        currentStatusId: EWorkerStatus.online,
        currentOrder: '10',
        payload: {
          event_type: 'status',
          worker_id: 'worker-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.online,
          connection_status_source_id: sourceId,
          connection_status_order: '9',
          connection_online_acknowledged: false,
          connection_status: {
            ...online,
            status: 'offline',
            connected: false,
            sequence: 1,
            changedAt: '2026-08-04T12:00:01.000Z',
          },
        },
      })
    ).toEqual({ kind: 'ignored', reason: 'stale_native_status_order' });
  });

  it('uses a raw persisted unofficial ONLINE event as display truth', () => {
    expect(
      projectMobileChannelStatusEvent({
        payload: {
          event_type: 'status',
          worker_id: 'worker-1',
          worker_type_id: EWorkerType.wwebjs,
          worker_status_id: EWorkerStatus.online,
        },
      })
    ).toEqual({
      kind: 'status',
      statusId: EWorkerStatus.online,
      isOnline: true,
      publicStatus: undefined,
    });
  });

  it('derives the provider from persisted channel truth without rewriting ONLINE', () => {
    expect(
      projectMobileChannelStatusEvent({
        currentWorkerTypeId: EWorkerType.baileys,
        payload: {
          event_type: 'status',
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.online,
        },
      })
    ).toEqual({
      kind: 'status',
      statusId: EWorkerStatus.online,
      isOnline: true,
      publicStatus: undefined,
    });
  });

  it('accepts a native envelope without event type only against the persisted provider', () => {
    expect(
      projectMobileChannelStatusEvent({
        currentWorkerTypeId: EWorkerType.baileys,
        currentRuntimeGeneration: 2,
        currentOrder: '20',
        payload: {
          event_type: 'status',
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.online,
          runtime_generation: 2,
          connection_status: online,
          connection_status_source_id: sourceId,
          connection_status_order: '21',
          connection_online_acknowledged: true,
        },
      })
    ).toEqual({
      kind: 'status',
      statusId: EWorkerStatus.online,
      isOnline: true,
      publicStatus: undefined,
      nextOrder: '21',
    });
  });

  it('rejects raw lifecycle events from a retired provider or an older generation', () => {
    const current = {
      currentWorkerTypeId: EWorkerType.wwebjs,
      currentRuntimeGeneration: 2,
      currentOrder: '20',
    };

    expect(
      projectMobileChannelStatusEvent({
        ...current,
        payload: {
          event_type: 'status',
          worker_id: 'worker-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.offline,
          runtime_generation: 1,
        },
      })
    ).toEqual({ kind: 'ignored', reason: 'retired_provider_lifecycle' });
    expect(
      projectMobileChannelStatusEvent({
        ...current,
        payload: {
          event_type: 'status',
          worker_id: 'worker-1',
          worker_type_id: EWorkerType.wwebjs,
          worker_status_id: EWorkerStatus.offline,
          runtime_generation: 1,
        },
      })
    ).toEqual({ kind: 'ignored', reason: 'stale_runtime_generation' });
    expect(
      projectMobileChannelStatusEvent({
        ...current,
        payload: {
          event_type: 'status',
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.offline,
          runtime_generation: 2,
        },
      })
    ).toEqual({ kind: 'ignored', reason: 'unordered_raw_lifecycle' });
  });

  it('keeps deleting visible and removes only after the terminal delete event', () => {
    const current = {
      currentWorkerTypeId: EWorkerType.baileys,
      currentRuntimeGeneration: 3,
      currentOrder: '30',
    };

    expect(
      projectMobileChannelStatusEvent({
        ...current,
        payload: {
          event_type: 'status',
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.deleting,
        },
      })
    ).toEqual({
      kind: 'status',
      statusId: EWorkerStatus.deleting,
      isOnline: false,
    });

    expect(
      projectMobileChannelStatusEvent({
        ...current,
        payload: {
          event_type: 'status',
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.delete,
        },
      })
    ).toEqual({ kind: 'removed' });
  });

  it('ignores terminal-looking payloads without an explicit status event type', () => {
    expect(
      projectMobileChannelStatusEvent({
        currentStatusId: EWorkerStatus.deleting,
        currentWorkerTypeId: EWorkerType.baileys,
        payload: {
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.delete,
        },
      })
    ).toEqual({ kind: 'ignored', reason: 'invalid_event_type' });
  });

  it('never lets telemetry remove a deleting channel', () => {
    expect(
      projectMobileChannelStatusEvent({
        currentStatusId: EWorkerStatus.deleting,
        currentWorkerTypeId: EWorkerType.baileys,
        payload: {
          event_type: 'telemetry',
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.delete,
          worker_type_id: EWorkerType.baileys,
          connection_status: {
            ...online,
            status: 'offline',
            connected: false,
            sequence: 3,
          },
          connection_status_source_id: sourceId,
          connection_status_order: '31',
        },
      })
    ).toEqual({
      kind: 'status',
      statusId: EWorkerStatus.deleting,
      isOnline: false,
      publicStatus: undefined,
      nextOrder: '31',
    });
  });
});
