import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { createPinia, setActivePinia } from 'pinia';
import { EColor } from '@core/common/enums/EColor';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWhatsappConnectionStatus } from '@core/common/enums/EWhatsappConnectionStatus';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import {
  buildManagerWorkerRecreateCompletedStatusEvent,
  buildManagerWorkerRecreateRuntimeRetiredStatusEvent,
  buildManagerWorkerRecreateRuntimeStartedStatusEvent,
  buildManagerWorkerRecreatingStatusEvent,
  compareWorkerLifecycleOperationIds,
  evaluateManagerWorkerLifecycleCompletionFence,
  evaluateManagerWorkerLifecycleStatusFence,
  isManagerWorkerRecreateCompletedStatusEvent,
  isManagerWorkerRecreateRuntimeRetiredStatusEvent,
  isManagerWorkerRecreateRuntimeStartedStatusEvent,
  isWorkerLifecycleOperationIdV7,
  normalizeWorkerLifecycleOperationId,
  normalizeWorkerLifecycleRuntimeGeneration,
} from '@core/common/functions/workerLifecycleRealtimeStatus';
import {
  compareWhatsappConnectionStatusOrders,
  evaluateWhatsappRealtimeStatusFence,
  isWhatsappConnectionOnline,
  mergeWhatsappOrderedChannelHttpSnapshot,
  normalizeWhatsappConnectionStatus,
  normalizeWhatsappConnectionStatusOrder,
  projectWhatsappChannelDisplayStatus,
  projectWhatsappConnectionPublicStatus,
} from '@core/common/functions/whatsappConnectionStatus';

const axiosGet = jest.fn();
const axiosDelete = jest.fn();
const axiosPost = jest.fn();
const axiosPatch = jest.fn();
const logLocalConnectionStatus = jest.fn();

interface ChannelsStoreForTest {
  list: Array<Record<string, any>>;
  pagings: {
    current_page: number;
    total_pages: number;
    per_page: number;
    count: number;
    total: number;
  };
  channelDeletionTombstones: Record<string, true>;
  channelLifecycleOperationById: Record<string, string>;
  channelLifecycleCompletedOperationById: Record<string, string>;
  channelInitialCreationOperationById: Record<string, string>;
  sessionRemovalGenerationByWorkerId: Record<string, number>;
  sessionRemovalObservedAtByWorkerId: Record<string, string>;
  providerHandoffSourceRecoveryByWorkerId: Record<string, Record<string, any>>;
  listChannels: () => Promise<unknown>;
  deleteChannel: (workerId: string) => Promise<boolean>;
  disconnectConnectionChannel: (
    workerId: string
  ) => Promise<Record<string, any> | null>;
  releaseSessionRemovalFence: (workerId: string) => void;
  recreateChannel: (workerId: string) => Promise<Record<string, any> | null>;
  viewWhatsappProviderHandoff: (
    workerId: string,
    options?: { signal?: AbortSignal }
  ) => Promise<Record<string, any>>;
  resolveWhatsappProviderHandoff: (
    workerId: string,
    handoffId: string,
    action: 'discard' | 'return',
    options?: { signal?: AbortSignal }
  ) => Promise<Record<string, any> | null>;
  applyCanonicalProviderHandoffSourceRecovery: (
    channel: Record<string, any>,
    acceptance: Record<string, any>
  ) => boolean;
  updateStatusChannel: (input: Record<string, any>) => boolean;
  applyAcceptedCreateAck: (input: Record<string, any>) => boolean;
  applyInitialCreationTerminal: (
    worker: Record<string, any>,
    operationId: string
  ) => boolean;
}

const loadChannelsStore = (): (() => ChannelsStoreForTest) => {
  const filename = resolve(
    process.cwd(),
    'apps/web/src/@webcore/stores/channels.ts'
  );
  const source = readFileSync(filename, 'utf8');
  const transpiled = ts
    .transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: filename,
    })
    .outputText.replaceAll('import.meta.env.PROD', 'false');
  const loaded = { exports: {} as Record<string, unknown> };
  const moduleRequire = (moduleId: string): unknown => {
    if (moduleId === 'pinia') return require('pinia');
    if (moduleId === '@/plugins/i18n') {
      return { getI18n: () => ({ global: { t: (key: string) => key } }) };
    }
    if (moduleId === '@core/common/enums/EColor') return { EColor };
    if (moduleId === '@webcore/axios') {
      return {
        __esModule: true,
        default: {
          get: axiosGet,
          delete: axiosDelete,
          post: axiosPost,
          patch: axiosPatch,
        },
      };
    }
    if (moduleId === 'axios') {
      return { AxiosError: class AxiosError extends Error {} };
    }
    if (moduleId === '@core/common/enums/EWorkerStatus') {
      return { EWorkerStatus };
    }
    if (moduleId === '@core/common/enums/EWorkerType') return { EWorkerType };
    if (moduleId === '@core/common/enums/EWorkerAction') {
      return { EWorkerAction };
    }
    if (moduleId === '@webcore/utils/connectionLifecycleDebug') {
      return {
        connectionLifecycleDebugHeaders: () => undefined,
        createConnectionLifecycleDebugTraceId: () => undefined,
        isConnectionLifecycleDebugEnabled: () => false,
        logConnectionLifecycleDebug: () => undefined,
      };
    }
    if (moduleId === '@webcore/utils/localConnectionStatusLog') {
      return { logLocalConnectionStatus };
    }
    if (moduleId === '@webcore/stores/channelStatusPresentation') {
      return {
        isManagerPairingReadyPublication: (event: Record<string, unknown>) =>
          event.event_type === 'status' &&
          event.worker_status_id === EWorkerStatus.disponible &&
          event.status === EBaileysConnectionStatus.connecting &&
          event.code === ECodeMessage.awaitingReadQrCode &&
          event.qr_pending === true &&
          typeof event.connection_attempt_id === 'string' &&
          typeof event.runtime_generation === 'number' &&
          typeof event.worker_status_observed_at === 'string',
        isSessionRemovalTerminalPublication: (event: Record<string, unknown>) =>
          event.event_type === 'status' &&
          event.worker_status_id === EWorkerStatus.disponible &&
          event.session_removed === true &&
          event.disconnected_user === true &&
          typeof event.runtime_generation === 'number' &&
          typeof event.worker_status_observed_at === 'string',
      };
    }
    if (moduleId === '@core/common/functions/whatsappConnectionStatus') {
      return {
        compareWhatsappConnectionStatusOrders,
        evaluateWhatsappRealtimeStatusFence,
        isWhatsappConnectionOnline,
        mergeWhatsappOrderedChannelHttpSnapshot,
        normalizeWhatsappConnectionStatus,
        normalizeWhatsappConnectionStatusOrder,
      };
    }
    if (moduleId === '@core/common/functions/workerLifecycleRealtimeStatus') {
      return {
        buildManagerWorkerRecreateCompletedStatusEvent,
        buildManagerWorkerRecreateRuntimeRetiredStatusEvent,
        buildManagerWorkerRecreateRuntimeStartedStatusEvent,
        buildManagerWorkerRecreatingStatusEvent,
        compareWorkerLifecycleOperationIds,
        evaluateManagerWorkerLifecycleCompletionFence,
        evaluateManagerWorkerLifecycleStatusFence,
        isManagerWorkerRecreateCompletedStatusEvent,
        isManagerWorkerRecreateRuntimeRetiredStatusEvent,
        isManagerWorkerRecreateRuntimeStartedStatusEvent,
        isWorkerLifecycleOperationIdV7,
        normalizeWorkerLifecycleOperationId,
        normalizeWorkerLifecycleRuntimeGeneration,
      };
    }
    throw new Error(`Unexpected channels store dependency: ${moduleId}`);
  };
  const evaluate = new Function('require', 'module', 'exports', transpiled) as (
    requireModule: (moduleId: string) => unknown,
    module: typeof loaded,
    exports: Record<string, unknown>
  ) => void;
  evaluate(moduleRequire, loaded, loaded.exports);
  return loaded.exports.useChannelsStore as () => ChannelsStoreForTest;
};

const useChannelsStore = loadChannelsStore();
const workerId = '019ca10d-73e1-7e5e-9d1e-8b8148aeb245';
const accountId = '019ca10d-8682-7da3-a04a-a76163a6969a';
const baileysSourceId = '11111111-1111-4111-8111-111111111111';
const wwebjsSourceId = '22222222-2222-4222-8222-222222222222';
const recreateOperationId = '33333333-3333-7333-8333-333333333333';
const resolutionRecoveryOperationId = '3f333333-3333-7333-8333-333333333333';
const newerRecreateOperationId = '44444444-4444-7444-8444-444444444444';

const sourceRecoveryAcceptance = (overrides: Record<string, any> = {}) => ({
  releasedOperationId: recreateOperationId,
  terminalOperationId: recreateOperationId,
  operationIds: [recreateOperationId],
  runtimeGeneration: 2,
  observedAt: '2026-08-04T12:00:02.000Z',
  ...overrides,
});

const nativeStatus = (
  provider: 'baileys' | 'wwebjs',
  status: EWhatsappConnectionStatus,
  sequence: number
) => ({
  provider,
  status,
  connected: status === EWhatsappConnectionStatus.online,
  authenticated: status === EWhatsappConnectionStatus.online,
  sessionValid: true,
  recoverable: true,
  qrAvailable: false,
  sequence,
  changedAt: `2026-08-04T12:00:0${sequence}.000Z`,
});

const channel = () => ({
  id: workerId,
  name: 'Support',
  session_storage: 'postgres',
  number: null,
  status: { id: EWorkerStatus.offline, name: 'offline' },
  type: { id: EWorkerType.baileys, name: 'baileys' },
  server: { id: 'server-1', name: 'Primary' },
  account: { id: accountId, name: 'Account' },
  connection_date: null,
  last_connection_check_at: null,
  recreate_available_at: null,
  created_at: '2026-08-04T10:00:00.000Z',
  updated_at: '2026-08-04T10:00:00.000Z',
  connection_status: nativeStatus(
    'baileys',
    EWhatsappConnectionStatus.offline,
    1
  ),
  connection_status_source_id: baileysSourceId,
  connection_status_order: '10',
  connection_online_acknowledged: false,
  runtime_generation: 1,
});

const wwebjsOnlineEvent = (order = '20') => ({
  event_type: 'status',
  worker_id: workerId,
  account_id: accountId,
  worker_type_id: EWorkerType.wwebjs,
  worker_status_id: EWorkerStatus.online,
  status: 'open',
  code: 'connected',
  session_ready: true,
  can_send: true,
  can_receive_runtime: true,
  authenticated: true,
  phone: '5511999999999',
  connection_status: nativeStatus(
    'wwebjs',
    EWhatsappConnectionStatus.online,
    2
  ),
  connection_status_source_id: wwebjsSourceId,
  connection_status_order: order,
  connection_online_acknowledged: true,
  runtime_generation: 2,
});

describe('channels realtime native status projection', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    axiosGet.mockReset();
    axiosDelete.mockReset();
    axiosPost.mockReset();
    axiosPatch.mockReset();
    logLocalConnectionStatus.mockReset();
  });

  it('advances provider metadata atomically with a validated handoff event', () => {
    const store = useChannelsStore();
    store.list = [channel()];

    expect(store.updateStatusChannel(wwebjsOnlineEvent())).toBe(true);

    expect(store.list[0]).toMatchObject({
      name: 'Support',
      server: { id: 'server-1', name: 'Primary' },
      type: { id: EWorkerType.wwebjs, name: 'wwebjs' },
      status: { id: EWorkerStatus.online },
      connection_status: { provider: 'wwebjs', status: 'online' },
      connection_status_source_id: wwebjsSourceId,
      connection_status_order: '20',
      connection_online_acknowledged: true,
    });
  });

  it('updates a current provider row to connected from the strict realtime event without an HTTP reload', () => {
    const store = useChannelsStore();
    store.list = [
      {
        ...channel(),
        status: { id: EWorkerStatus.disponible, name: 'disponible' },
        connection_status: null,
        connection_status_source_id: null,
        connection_status_order: null,
        connection_online_acknowledged: false,
      },
    ];

    expect(
      store.updateStatusChannel({
        event_type: 'status',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.online,
        status: 'connected',
        code: 200,
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        phone: '556192037138',
        connection_status: nativeStatus(
          'baileys',
          EWhatsappConnectionStatus.online,
          2
        ),
        connection_status_source_id: baileysSourceId,
        connection_status_order: '11',
        connection_status_observed_at: '2026-08-04T12:00:02.000Z',
        worker_status_observed_at: '2026-08-04T12:00:02.000Z',
        connection_online_acknowledged: true,
        runtime_generation: 1,
      })
    ).toBe(true);
    expect(store.list[0]).toMatchObject({
      status: { id: EWorkerStatus.online },
      number: '556192037138',
      connection_status: { provider: 'baileys', status: 'online' },
      connection_status_order: '11',
      connection_online_acknowledged: true,
    });
    expect(
      projectWhatsappChannelDisplayStatus({
        workerTypeId: store.list[0]?.type?.id,
        workerStatusId: store.list[0]?.status?.id,
        connectionStatus: projectWhatsappConnectionPublicStatus(
          store.list[0]?.connection_status
        ),
        connectionOnlineAcknowledged:
          store.list[0]?.connection_online_acknowledged,
      })
    ).toEqual({ kind: 'worker', workerStatusId: EWorkerStatus.online });
    expect(axiosGet).not.toHaveBeenCalled();
  });

  it('projects an accepted QR attempt as available and clears stale session identity', () => {
    const store = useChannelsStore();
    store.list = [
      {
        ...channel(),
        number: '556192037138',
        status: { id: EWorkerStatus.offline, name: 'offline' },
        connection_date: '2026-08-10T20:54:00.000Z',
        last_connection_check_at: '2026-08-10T20:54:00.000Z',
      },
    ];

    expect(
      store.updateStatusChannel({
        event_type: 'status',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.disponible,
        worker_status_observed_at: '2026-08-10T21:02:00.000Z',
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingReadQrCode,
        connection_attempt_id: '00000000-0000-4000-8000-000000000040',
        qr_pending: true,
        runtime_generation: 1,
      })
    ).toBe(true);
    expect(store.list[0]).toMatchObject({
      status: { id: EWorkerStatus.disponible },
      number: null,
      connection_date: null,
      last_connection_check_at: null,
    });
  });

  it('does not let the logout intent (205) regress a connected row before the terminal event', () => {
    const store = useChannelsStore();
    store.list = [
      {
        ...channel(),
        number: '556192037138',
        status: { id: EWorkerStatus.online, name: 'online' },
        connection_status: nativeStatus(
          'baileys',
          EWhatsappConnectionStatus.online,
          2
        ),
        connection_status_source_id: baileysSourceId,
        connection_status_order: '11',
        connection_online_acknowledged: true,
      },
    ];

    expect(
      store.updateStatusChannel({
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: EWorkerType.baileys,
        status: 'info',
        code: 205,
        disconnected_user: true,
        runtime_generation: 1,
      })
    ).toBe(false);
    expect(store.list[0]).toMatchObject({
      status: { id: EWorkerStatus.online },
      number: '556192037138',
      connection_status: { status: 'online' },
      connection_online_acknowledged: true,
    });
  });

  it('applies a raw terminal session_removed publication to the row without waiting for DELETE or F5', () => {
    const store = useChannelsStore();
    store.list = [
      {
        ...channel(),
        number: '556192037138',
        status: { id: EWorkerStatus.online, name: 'online' },
        connection_date: '2026-08-09T10:00:00.000Z',
        last_connection_check_at: '2026-08-09T10:01:00.000Z',
        connection_status: nativeStatus(
          'baileys',
          EWhatsappConnectionStatus.online,
          2
        ),
        connection_status_source_id: baileysSourceId,
        connection_status_order: '20',
        connection_online_acknowledged: true,
        runtime_generation: 2,
      },
    ];
    const terminal = {
      event_type: 'status',
      worker_id: workerId,
      account_id: accountId,
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.disponible,
      status: 'disconnected',
      code: 401,
      session_removed: true,
      disconnected_user: true,
      runtime_generation: 2,
      worker_status_observed_at: '2026-08-09T10:02:00.000Z',
    };

    expect(store.updateStatusChannel(terminal)).toBe(true);
    expect(store.list[0]).toMatchObject({
      number: null,
      status: { id: EWorkerStatus.disponible },
      connection_date: null,
      last_connection_check_at: null,
      connection_status: null,
      connection_status_source_id: null,
      connection_status_order: null,
      connection_online_acknowledged: false,
      runtime_generation: 2,
    });
    expect(store.sessionRemovalGenerationByWorkerId[workerId]).toBe(2);
    expect(store.sessionRemovalObservedAtByWorkerId[workerId]).toBe(
      '2026-08-09T10:02:00.000Z'
    );
    expect(axiosDelete).not.toHaveBeenCalled();
    expect(axiosGet).not.toHaveBeenCalled();
  });

  it('projects native QR while the durable creation lifecycle is still finalizing', () => {
    const store = useChannelsStore();
    store.list = [
      {
        ...channel(),
        status: { id: EWorkerStatus.creating, name: 'creating' },
      },
    ];

    expect(
      store.updateStatusChannel({
        event_type: 'telemetry',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: EWorkerType.baileys,
        connection_status: {
          provider: 'baileys',
          status: EWhatsappConnectionStatus.qr,
          connected: false,
          authenticated: false,
          sessionValid: null,
          recoverable: true,
          qrAvailable: true,
          sequence: 2,
          changedAt: '2026-08-04T12:00:02.000Z',
        },
        connection_status_source_id: baileysSourceId,
        connection_status_order: '11',
        connection_online_acknowledged: false,
        runtime_generation: 1,
      })
    ).toBe(true);

    // Telemetry must not complete the database lifecycle early. The common
    // read projection nevertheless follows the newer provider-owned truth.
    expect(store.list[0]).toMatchObject({
      status: { id: EWorkerStatus.creating },
      connection_status: { provider: 'baileys', status: 'qr' },
      connection_status_order: '11',
    });
    const publicStatus = projectWhatsappConnectionPublicStatus(
      store.list[0]?.connection_status
    );
    expect(
      projectWhatsappChannelDisplayStatus({
        workerTypeId: store.list[0]?.type?.id,
        workerStatusId: store.list[0]?.status?.id,
        connectionStatus: publicStatus,
        connectionOnlineAcknowledged:
          store.list[0]?.connection_online_acknowledged,
      })
    ).toEqual({ kind: 'worker', workerStatusId: EWorkerStatus.creating });
  });

  it('keeps an active initial lifecycle as creating during HTTP reconciliation', async () => {
    const store = useChannelsStore();
    store.list = [];
    expect(
      store.applyAcceptedCreateAck({
        code: 202,
        status: 'queued',
        queued: true,
        worker_id: workerId,
        account_id: accountId,
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.creating,
        operation_id: recreateOperationId,
        reason: 'warm_activation_queued',
        session_storage: 'postgres',
      })
    ).toBe(true);
    axiosGet.mockResolvedValueOnce({
      data: {
        status: true,
        data: {
          results: [
            {
              ...channel(),
              status: { id: EWorkerStatus.recreating, name: 'recreating' },
              lifecycle_operation_id: recreateOperationId,
              recreate_phase: 'recreating',
            },
          ],
          pagings: {
            current_page: 1,
            total_pages: 1,
            per_page: 10,
            count: 1,
            total: 1,
          },
        },
      },
    });

    await store.listChannels();

    expect(store.list[0]?.status).toEqual({
      id: EWorkerStatus.creating,
      name: 'creating',
    });
    expect(store.channelLifecycleOperationById[workerId]).toBe(
      recreateOperationId
    );
    expect(store.channelInitialCreationOperationById[workerId]).toBe(
      recreateOperationId
    );

    axiosGet.mockResolvedValueOnce({
      data: {
        status: true,
        data: {
          results: [
            {
              ...channel(),
              status: { id: EWorkerStatus.disponible, name: 'disponible' },
              lifecycle_operation_id: null,
              runtime_generation: 1,
            },
          ],
          pagings: {
            current_page: 1,
            total_pages: 1,
            per_page: 10,
            count: 1,
            total: 1,
          },
        },
      },
    });

    await store.listChannels();

    expect(store.list[0]?.status?.id).toBe(EWorkerStatus.disponible);
    expect(store.channelLifecycleOperationById[workerId]).toBeUndefined();
    expect(store.channelInitialCreationOperationById[workerId]).toBeUndefined();
  });

  it('applies the exact terminal worker view for initial creation without waiting for another list response', () => {
    const store = useChannelsStore();
    store.list = [
      {
        ...channel(),
        status: { id: EWorkerStatus.creating, name: 'creating' },
        lifecycle_operation_id: recreateOperationId,
        runtime_generation: 1,
      },
    ];
    store.applyAcceptedCreateAck({
      code: 202,
      status: 'queued',
      queued: true,
      worker_id: workerId,
      account_id: accountId,
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.creating,
      operation_id: recreateOperationId,
      reason: 'warm_activation_queued',
      session_storage: 'postgres',
    });

    expect(
      store.applyInitialCreationTerminal(
        {
          ...channel(),
          status: { id: EWorkerStatus.disponible, name: 'disponible' },
          lifecycle_operation_id: null,
          runtime_generation: 1,
        },
        recreateOperationId
      )
    ).toBe(true);
    expect(store.list[0]).toMatchObject({
      status: { id: EWorkerStatus.disponible },
      runtime_generation: 1,
    });
    expect(store.list[0]?.lifecycle_operation_id).toBeUndefined();
    expect(store.channelLifecycleOperationById[workerId]).toBeUndefined();
    expect(store.channelInitialCreationOperationById[workerId]).toBeUndefined();
  });

  it('keeps a fresh provider bootstrap in creating until QR is available', () => {
    const store = useChannelsStore();
    store.list = [
      {
        ...channel(),
        status: { id: EWorkerStatus.creating, name: 'creating' },
      },
    ];

    expect(
      store.updateStatusChannel({
        event_type: 'telemetry',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: EWorkerType.baileys,
        connection_status: {
          provider: 'baileys',
          status: EWhatsappConnectionStatus.initializing,
          connected: false,
          authenticated: false,
          sessionValid: null,
          recoverable: true,
          qrAvailable: false,
          sequence: 2,
          changedAt: '2026-08-04T12:00:02.000Z',
        },
        connection_status_source_id: baileysSourceId,
        connection_status_order: '11',
        connection_online_acknowledged: false,
        runtime_generation: 1,
      })
    ).toBe(true);

    const publicStatus = projectWhatsappConnectionPublicStatus(
      store.list[0]?.connection_status
    );
    expect(publicStatus).toBeUndefined();
    expect(
      projectWhatsappChannelDisplayStatus({
        workerTypeId: store.list[0]?.type?.id,
        workerStatusId: store.list[0]?.status?.id,
        connectionStatus: publicStatus,
        connectionOnlineAcknowledged:
          store.list[0]?.connection_online_acknowledged,
      })
    ).toEqual({
      kind: 'worker',
      workerStatusId: EWorkerStatus.creating,
    });
  });

  it('does not let a stale event from the retired provider undo the handoff', () => {
    const store = useChannelsStore();
    store.list = [channel()];
    expect(store.updateStatusChannel(wwebjsOnlineEvent())).toBe(true);

    expect(
      store.updateStatusChannel({
        ...wwebjsOnlineEvent('19'),
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.offline,
        connection_status: nativeStatus(
          'baileys',
          EWhatsappConnectionStatus.offline,
          3
        ),
        connection_status_source_id: baileysSourceId,
        connection_online_acknowledged: false,
        runtime_generation: 1,
      })
    ).toBe(false);
    expect(store.list[0]).toMatchObject({
      type: { id: EWorkerType.wwebjs, name: 'wwebjs' },
      status: { id: EWorkerStatus.online },
      connection_status: { provider: 'wwebjs', status: 'online' },
      connection_status_order: '20',
    });
  });

  it('does not partially change provider or native state for weak ONLINE', () => {
    const store = useChannelsStore();
    store.list = [channel()];

    expect(
      store.updateStatusChannel({
        ...wwebjsOnlineEvent(),
        can_send: false,
      })
    ).toBe(false);
    expect(store.list[0]).toMatchObject({
      type: { id: EWorkerType.baileys, name: 'baileys' },
      status: { id: EWorkerStatus.offline },
      connection_status: { provider: 'baileys', status: 'offline' },
      connection_status_source_id: baileysSourceId,
      connection_status_order: '10',
      connection_online_acknowledged: false,
    });
  });

  it('applies a fenced manager recreation without weakening native provider ordering', () => {
    const store = useChannelsStore();
    store.list = [channel()];

    const event = buildManagerWorkerRecreatingStatusEvent(
      {
        action: EWorkerAction.recreate,
        worker_id: workerId,
        server_id: 'server-1',
        account_id: accountId,
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: recreateOperationId,
      },
      1
    );

    expect(store.updateStatusChannel(event)).toBe(true);
    expect(store.list[0]).toMatchObject({
      status: { id: EWorkerStatus.recreating, name: 'recreating' },
      type: { id: EWorkerType.baileys },
      connection_status: { provider: 'baileys', status: 'offline' },
      connection_status_order: '10',
      runtime_generation: 1,
    });
  });

  it.each([
    {
      name: 'runtime_retired',
      buildEvent: () =>
        buildManagerWorkerRecreateRuntimeRetiredStatusEvent(
          {
            action: EWorkerAction.recreate,
            worker_id: workerId,
            server_id: 'server-1',
            account_id: accountId,
            worker_type_id: EWorkerType.baileys,
            lifecycle_operation_id: recreateOperationId,
          },
          1,
          '2026-08-08T02:30:01.000Z'
        ),
    },
    {
      name: 'runtime_started',
      buildEvent: () =>
        buildManagerWorkerRecreateRuntimeStartedStatusEvent(
          {
            action: EWorkerAction.recreate,
            worker_id: workerId,
            server_id: 'server-1',
            account_id: accountId,
            worker_type_id: EWorkerType.baileys,
            lifecycle_operation_id: recreateOperationId,
          },
          2,
          '2026-08-08T02:30:02.000Z'
        ),
    },
  ])(
    'acknowledges the canonical manager $name phase without legacy side effects',
    ({ buildEvent }) => {
      const store = useChannelsStore();
      store.list = [channel()];
      const start = buildManagerWorkerRecreatingStatusEvent(
        {
          action: EWorkerAction.recreate,
          worker_id: workerId,
          server_id: 'server-1',
          account_id: accountId,
          worker_type_id: EWorkerType.baileys,
          lifecycle_operation_id: recreateOperationId,
        },
        1
      );
      expect(store.updateStatusChannel(start)).toBe(true);

      const channelBeforePhase = JSON.parse(JSON.stringify(store.list[0]));
      const activeOperationsBeforePhase = {
        ...store.channelLifecycleOperationById,
      };
      const completedOperationsBeforePhase = {
        ...store.channelLifecycleCompletedOperationById,
      };
      logLocalConnectionStatus.mockReset();

      expect(store.updateStatusChannel(buildEvent())).toBe(true);
      expect(store.list[0]).toEqual(channelBeforePhase);
      expect(store.channelLifecycleOperationById).toEqual(
        activeOperationsBeforePhase
      );
      expect(store.channelLifecycleCompletedOperationById).toEqual(
        completedOperationsBeforePhase
      );
      expect(logLocalConnectionStatus).not.toHaveBeenCalled();
    }
  );

  it('rejects a lifecycle_phase-only envelope before legacy status side effects', () => {
    const store = useChannelsStore();
    store.list = [channel()];
    const channelBeforeEvent = JSON.parse(JSON.stringify(store.list[0]));

    expect(
      store.updateStatusChannel({
        ...wwebjsOnlineEvent(),
        lifecycle_phase: 'runtime_started',
      })
    ).toBe(false);
    expect(store.list[0]).toEqual(channelBeforeEvent);
    expect(logLocalConnectionStatus).toHaveBeenCalledWith(
      'web.store.manager_lifecycle.fence_rejected',
      expect.objectContaining({ reason: 'invalid_manager_lifecycle_envelope' })
    );
  });

  it('rejects unverifiable and stale manager recreation events', () => {
    const store = useChannelsStore();
    store.list = [channel()];

    const withoutGeneration = buildManagerWorkerRecreatingStatusEvent({
      action: EWorkerAction.recreate,
      worker_id: workerId,
      server_id: 'server-1',
      account_id: accountId,
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: recreateOperationId,
    });
    expect(store.updateStatusChannel(withoutGeneration)).toBe(false);

    expect(
      store.updateStatusChannel(
        buildManagerWorkerRecreatingStatusEvent(
          {
            ...withoutGeneration,
            lifecycle_operation_id: newerRecreateOperationId,
          },
          1
        )
      )
    ).toBe(true);
    expect(
      store.updateStatusChannel(
        buildManagerWorkerRecreatingStatusEvent(
          {
            ...withoutGeneration,
            lifecycle_operation_id: recreateOperationId,
          },
          1
        )
      )
    ).toBe(false);
  });

  it('keeps recreating until exact completion even when a newer runtime publishes native state', () => {
    const store = useChannelsStore();
    store.list = [channel()];

    expect(
      store.updateStatusChannel(
        buildManagerWorkerRecreatingStatusEvent(
          {
            action: EWorkerAction.recreate,
            worker_id: workerId,
            server_id: 'server-1',
            account_id: accountId,
            worker_type_id: EWorkerType.baileys,
            worker_status_id: EWorkerStatus.recreating,
            lifecycle_operation_id: recreateOperationId,
          },
          1
        )
      )
    ).toBe(true);

    expect(
      store.updateStatusChannel({
        event_type: 'status',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.offline,
        status: 'close',
        code: 'disconnected',
        connection_status: nativeStatus(
          'baileys',
          EWhatsappConnectionStatus.offline,
          2
        ),
        connection_status_source_id: baileysSourceId,
        connection_status_order: '11',
        connection_online_acknowledged: false,
        runtime_generation: 1,
      })
    ).toBe(false);
    expect(store.list[0]).toMatchObject({
      status: { id: EWorkerStatus.recreating },
      connection_status_order: '10',
      runtime_generation: 1,
    });

    expect(
      store.updateStatusChannel({
        event_type: 'status',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.offline,
        status: 'close',
        code: 'disconnected',
        connection_status: nativeStatus(
          'baileys',
          EWhatsappConnectionStatus.offline,
          3
        ),
        connection_status_source_id: baileysSourceId,
        connection_status_order: '12',
        connection_online_acknowledged: false,
        runtime_generation: 2,
      })
    ).toBe(false);
    expect(store.list[0]).toMatchObject({
      status: { id: EWorkerStatus.recreating },
      connection_status_order: '10',
      runtime_generation: 1,
    });
  });

  it('accepts only the exact same-generation manager recovery completion', () => {
    const store = useChannelsStore();
    store.list = [channel()];
    const start = buildManagerWorkerRecreatingStatusEvent(
      {
        action: EWorkerAction.recreate,
        worker_id: workerId,
        server_id: 'server-1',
        account_id: accountId,
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: recreateOperationId,
      },
      1
    );
    expect(store.updateStatusChannel(start)).toBe(true);

    const mismatched = buildManagerWorkerRecreateCompletedStatusEvent(
      {
        ...start,
        action: EWorkerAction.recreate,
        lifecycle_operation_id: newerRecreateOperationId,
        worker_type_id: EWorkerType.baileys,
      },
      1,
      'a'.repeat(64),
      '2026-08-08T02:30:00.000Z'
    );
    expect(store.updateStatusChannel(mismatched)).toBe(false);
    expect(store.list[0]?.status?.id).toBe(EWorkerStatus.recreating);

    const wrongGeneration = {
      ...buildManagerWorkerRecreateCompletedStatusEvent(
        {
          ...start,
          action: EWorkerAction.recreate,
          lifecycle_operation_id: recreateOperationId,
          worker_type_id: EWorkerType.baileys,
        },
        2,
        'a'.repeat(64),
        '2026-08-08T02:30:00.000Z'
      ),
      runtime_generation: 0,
      recreate_completed_runtime_generation: 0,
    };
    expect(store.updateStatusChannel(wrongGeneration)).toBe(false);
    expect(store.list[0]?.status?.id).toBe(EWorkerStatus.recreating);

    const completed = buildManagerWorkerRecreateCompletedStatusEvent(
      {
        ...start,
        action: EWorkerAction.recreate,
        lifecycle_operation_id: recreateOperationId,
        worker_type_id: EWorkerType.baileys,
      },
      1,
      'a'.repeat(64),
      '2026-08-08T02:30:00.000Z'
    );
    expect(store.updateStatusChannel(completed)).toBe(true);
    expect(store.list[0]).toMatchObject({
      status: { id: EWorkerStatus.online, name: 'online' },
      connection_status: { provider: 'baileys', status: 'offline' },
      connection_status_order: '10',
      runtime_generation: 1,
    });

    // The exact completion is single-use; a replay cannot clear a newer or
    // absent lifecycle fence.
    expect(store.updateStatusChannel(completed)).toBe(false);
  });

  it('does not let an in-flight recreate snapshot replay a completed operation', async () => {
    const store = useChannelsStore();
    store.list = [channel()];
    const start = buildManagerWorkerRecreatingStatusEvent(
      {
        action: EWorkerAction.recreate,
        worker_id: workerId,
        server_id: 'server-1',
        account_id: accountId,
        worker_type_id: EWorkerType.baileys,
        lifecycle_operation_id: recreateOperationId,
      },
      1
    );
    expect(store.updateStatusChannel(start)).toBe(true);
    expect(
      store.updateStatusChannel(
        buildManagerWorkerRecreateCompletedStatusEvent(
          {
            ...start,
            action: EWorkerAction.recreate,
            lifecycle_operation_id: recreateOperationId,
            worker_type_id: EWorkerType.baileys,
          },
          1,
          'a'.repeat(64),
          '2026-08-08T02:30:00.000Z'
        )
      )
    ).toBe(true);

    axiosGet.mockResolvedValueOnce({
      data: {
        status: true,
        data: {
          results: [
            {
              ...channel(),
              status: {
                id: EWorkerStatus.recreating,
                name: 'recreating',
              },
              lifecycle_operation_id: recreateOperationId,
            },
          ],
          pagings: {
            current_page: 1,
            total_pages: 1,
            per_page: 10,
            count: 1,
            total: 1,
          },
        },
      },
    });
    await store.listChannels();

    expect(store.list[0]).toMatchObject({
      status: { id: EWorkerStatus.online, name: 'online' },
      runtime_generation: 1,
    });
    expect(store.updateStatusChannel(start)).toBe(false);
  });

  it('does not let an HTTP request started before recreation regress its lifecycle', async () => {
    const store = useChannelsStore();
    store.list = [channel()];
    let resolveRequest: ((value: unknown) => void) | undefined;
    axiosGet.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );

    const request = store.listChannels();
    expect(
      store.updateStatusChannel(
        buildManagerWorkerRecreatingStatusEvent(
          {
            action: EWorkerAction.recreate,
            worker_id: workerId,
            server_id: 'server-1',
            account_id: accountId,
            worker_type_id: EWorkerType.baileys,
            worker_status_id: EWorkerStatus.recreating,
            lifecycle_operation_id: recreateOperationId,
          },
          1
        )
      )
    ).toBe(true);
    resolveRequest?.({
      data: {
        status: true,
        data: {
          results: [channel()],
          pagings: {
            current_page: 1,
            total_pages: 1,
            per_page: 10,
            count: 1,
            total: 1,
          },
        },
      },
    });
    await request;

    expect(store.list[0]).toMatchObject({
      status: { id: EWorkerStatus.recreating },
      runtime_generation: 1,
    });

    axiosGet.mockResolvedValueOnce({
      data: {
        status: true,
        data: {
          results: [channel()],
          pagings: {
            current_page: 1,
            total_pages: 1,
            per_page: 10,
            count: 1,
            total: 1,
          },
        },
      },
    });
    await store.listChannels();
    expect(store.list[0]).toMatchObject({
      status: { id: EWorkerStatus.recreating },
      runtime_generation: 1,
    });

    axiosGet.mockResolvedValueOnce({
      data: {
        status: true,
        data: {
          results: [
            {
              ...channel(),
              runtime_generation: 2,
            },
          ],
          pagings: {
            current_page: 1,
            total_pages: 1,
            per_page: 10,
            count: 1,
            total: 1,
          },
        },
      },
    });
    await store.listChannels();
    expect(store.list[0]?.status).toEqual({
      id: EWorkerStatus.recreating,
      name: 'recreating',
    });

    axiosGet.mockResolvedValueOnce({
      data: {
        status: true,
        data: {
          results: [
            {
              ...channel(),
              status: { id: EWorkerStatus.online, name: 'online' },
              runtime_generation: 2,
              recreate_completed_operation_id: recreateOperationId,
              recreate_completed_runtime_generation: 2,
              recreate_completed_at: '2026-08-08T02:30:00.000Z',
            },
          ],
          pagings: {
            current_page: 1,
            total_pages: 1,
            per_page: 10,
            count: 1,
            total: 1,
          },
        },
      },
    });
    await store.listChannels();
    expect(store.list[0]?.status).toEqual({
      id: EWorkerStatus.online,
      name: 'online',
    });
  });

  it('restores the recreate runtime fence from a durable HTTP snapshot after reload', async () => {
    const store = useChannelsStore();
    axiosGet.mockResolvedValueOnce({
      data: {
        status: true,
        data: {
          results: [
            {
              ...channel(),
              status: {
                id: EWorkerStatus.recreating,
                name: 'recreating',
              },
              lifecycle_operation_id: recreateOperationId,
            },
          ],
          pagings: {
            current_page: 1,
            total_pages: 1,
            per_page: 10,
            count: 1,
            total: 1,
          },
        },
      },
    });

    await store.listChannels();

    expect(
      store.updateStatusChannel({
        event_type: 'status',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.offline,
        status: 'close',
        code: 'disconnected',
        connection_status: nativeStatus(
          'baileys',
          EWhatsappConnectionStatus.offline,
          2
        ),
        connection_status_source_id: baileysSourceId,
        connection_status_order: '11',
        connection_online_acknowledged: false,
        runtime_generation: 1,
      })
    ).toBe(false);
    expect(store.list[0]).toMatchObject({
      status: { id: EWorkerStatus.recreating },
      lifecycle_operation_id: recreateOperationId,
      connection_status_order: '10',
      runtime_generation: 1,
    });
  });

  it('applies the authoritative recreate HTTP ack immediately', async () => {
    const store = useChannelsStore();
    store.list = [channel()];
    axiosPatch.mockResolvedValueOnce({
      data: {
        status: true,
        message: 'queued',
        data: {
          code: 202,
          status: 'queued',
          queued: true,
          worker_id: workerId,
          account_id: accountId,
          server_id: 'server-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.recreating,
          operation_id: recreateOperationId,
          reason: 'recreate_queued',
          runtime_generation: 1,
        },
      },
    });

    await expect(store.recreateChannel(workerId)).resolves.toMatchObject({
      operation_id: recreateOperationId,
      worker_status_id: EWorkerStatus.recreating,
    });
    expect(store.list[0]?.status).toEqual({
      id: EWorkerStatus.recreating,
      name: 'recreating',
    });
  });

  it('rejects an exact recreate ack from an older runtime generation', async () => {
    const store = useChannelsStore();
    store.list = [
      {
        ...channel(),
        status: { id: EWorkerStatus.online, name: 'online' },
        number: '556192037138',
        runtime_generation: 2,
      },
    ];
    axiosPatch.mockResolvedValueOnce({
      data: {
        status: true,
        message: 'queued',
        data: {
          code: 202,
          status: 'queued',
          queued: true,
          worker_id: workerId,
          account_id: accountId,
          server_id: 'server-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.recreating,
          operation_id: recreateOperationId,
          reason: 'recreate_queued',
          runtime_generation: 1,
        },
      },
    });

    await expect(store.recreateChannel(workerId)).resolves.toBeNull();
    expect(store.channelLifecycleOperationById[workerId]).toBeUndefined();
    expect(store.list[0]?.status).toEqual({
      id: EWorkerStatus.online,
      name: 'online',
    });
  });

  it('mirrors an exact canonical source recovery and prevents the next HTTP refresh from replaying recreating', async () => {
    const store = useChannelsStore();
    const recreating = {
      ...channel(),
      status: { id: EWorkerStatus.recreating, name: 'recreating' },
      lifecycle_operation_id: recreateOperationId,
    };
    store.list = [recreating];
    store.channelLifecycleOperationById[workerId] = recreateOperationId;
    const recovered = {
      ...channel(),
      number: '556192037138',
      status: { id: EWorkerStatus.online, name: 'online' },
      connection_status: nativeStatus(
        'baileys',
        EWhatsappConnectionStatus.online,
        2
      ),
      connection_status_order: '20',
      connection_status_observed_at: '2026-08-04T12:00:02.000Z',
      connection_online_acknowledged: true,
      runtime_generation: 2,
      lifecycle_operation_id: null,
    };

    expect(
      store.applyCanonicalProviderHandoffSourceRecovery(
        recovered,
        sourceRecoveryAcceptance()
      )
    ).toBe(true);
    expect(store.channelLifecycleOperationById[workerId]).toBeUndefined();
    expect(store.list[0]).toMatchObject({
      status: { id: EWorkerStatus.online },
      type: { id: EWorkerType.baileys },
      connection_status_order: '20',
      runtime_generation: 2,
    });

    axiosGet.mockResolvedValueOnce({
      data: {
        status: true,
        data: {
          results: [recovered],
          pagings: {
            current_page: 1,
            total_pages: 1,
            per_page: 10,
            count: 1,
            total: 1,
          },
        },
      },
    });
    await store.listChannels();
    expect(store.list[0]?.status?.id).toBe(EWorkerStatus.online);
  });

  it('does not clear the legacy lifecycle mirror for another recovery operation', () => {
    const store = useChannelsStore();
    store.list = [
      {
        ...channel(),
        status: { id: EWorkerStatus.recreating, name: 'recreating' },
      },
    ];
    store.channelLifecycleOperationById[workerId] = recreateOperationId;

    expect(
      store.applyCanonicalProviderHandoffSourceRecovery(
        {
          ...channel(),
          status: { id: EWorkerStatus.online, name: 'online' },
          lifecycle_operation_id: null,
        },
        sourceRecoveryAcceptance({
          releasedOperationId: newerRecreateOperationId,
          terminalOperationId: newerRecreateOperationId,
          operationIds: [newerRecreateOperationId],
        })
      )
    ).toBe(false);
    expect(store.channelLifecycleOperationById[workerId]).toBe(
      recreateOperationId
    );
    expect(store.list[0]?.status?.id).toBe(EWorkerStatus.recreating);
  });

  it('releases an exact invisible-row lifecycle mirror after canonical recovery', () => {
    const store = useChannelsStore();
    store.list = [];
    store.channelLifecycleOperationById[workerId] = recreateOperationId;

    expect(
      store.applyCanonicalProviderHandoffSourceRecovery(
        {
          ...channel(),
          status: { id: EWorkerStatus.online, name: 'online' },
          lifecycle_operation_id: null,
        },
        sourceRecoveryAcceptance()
      )
    ).toBe(true);
    expect(store.channelLifecycleOperationById[workerId]).toBeUndefined();
    expect(store.list).toEqual([]);
  });

  it.each([
    [recreateOperationId, resolutionRecoveryOperationId],
    [resolutionRecoveryOperationId, recreateOperationId],
  ])(
    'clears either proven handoff operation %s when canonical released %s',
    (legacyOperationId, canonicalReleasedOperationId) => {
      const store = useChannelsStore();
      store.list = [
        {
          ...channel(),
          status: { id: EWorkerStatus.recreating, name: 'recreating' },
        },
      ];
      store.channelLifecycleOperationById[workerId] = legacyOperationId;
      expect(
        store.applyCanonicalProviderHandoffSourceRecovery(
          {
            ...channel(),
            status: { id: EWorkerStatus.online, name: 'online' },
            lifecycle_operation_id: null,
          },
          sourceRecoveryAcceptance({
            releasedOperationId: canonicalReleasedOperationId,
            terminalOperationId: resolutionRecoveryOperationId,
            operationIds: [recreateOperationId, resolutionRecoveryOperationId],
          })
        )
      ).toBe(true);
      expect(store.channelLifecycleOperationById[workerId]).toBeUndefined();
    }
  );

  it('neutralizes an in-flight stale lifecycle HTTP response after source recovery', async () => {
    const store = useChannelsStore();
    store.list = [
      {
        ...channel(),
        status: { id: EWorkerStatus.recreating, name: 'recreating' },
      },
    ];
    store.channelLifecycleOperationById[workerId] = recreateOperationId;
    let resolveList!: (value: unknown) => void;
    axiosGet.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveList = resolve;
      })
    );
    const staleRequest = store.listChannels();

    const recovered = {
      ...channel(),
      number: '556192037138',
      status: { id: EWorkerStatus.online, name: 'online' },
      connection_status: nativeStatus(
        'baileys',
        EWhatsappConnectionStatus.online,
        2
      ),
      connection_status_order: '20',
      connection_status_observed_at: '2026-08-04T12:00:02.000Z',
      connection_online_acknowledged: true,
      runtime_generation: 2,
      lifecycle_operation_id: null,
    };
    expect(
      store.applyCanonicalProviderHandoffSourceRecovery(
        recovered,
        sourceRecoveryAcceptance()
      )
    ).toBe(true);

    resolveList({
      data: {
        status: true,
        data: {
          results: [
            {
              ...channel(),
              status: { id: EWorkerStatus.recreating, name: 'recreating' },
              lifecycle_operation_id: recreateOperationId,
              runtime_generation: 2,
            },
          ],
          pagings: {
            current_page: 1,
            total_pages: 1,
            per_page: 10,
            count: 1,
            total: 1,
          },
        },
      },
    });
    await staleRequest;

    expect(store.channelLifecycleOperationById[workerId]).toBeUndefined();
    expect(store.list[0]).toMatchObject({
      status: { id: EWorkerStatus.online },
      connection_status_order: '20',
      runtime_generation: 2,
    });
    expect(
      store.providerHandoffSourceRecoveryByWorkerId[workerId]
    ).toMatchObject({ terminalOperationId: recreateOperationId });
  });

  it('rejects late manager envelopes from a recovered operation and accepts a newer UUIDv7', () => {
    const store = useChannelsStore();
    store.list = [
      {
        ...channel(),
        status: { id: EWorkerStatus.recreating, name: 'recreating' },
      },
    ];
    store.channelLifecycleOperationById[workerId] = recreateOperationId;
    expect(
      store.applyCanonicalProviderHandoffSourceRecovery(
        {
          ...channel(),
          status: { id: EWorkerStatus.online, name: 'online' },
          runtime_generation: 2,
          lifecycle_operation_id: null,
        },
        sourceRecoveryAcceptance()
      )
    ).toBe(true);

    const lifecycleInput = {
      action: EWorkerAction.recreate,
      worker_id: workerId,
      server_id: 'server-1',
      account_id: accountId,
      worker_type_id: EWorkerType.baileys,
      previous_worker_type_id: EWorkerType.wwebjs,
      lifecycle_operation_id: recreateOperationId,
    };
    expect(
      store.updateStatusChannel(
        buildManagerWorkerRecreatingStatusEvent(lifecycleInput, 2)
      )
    ).toBe(false);
    expect(
      store.updateStatusChannel(
        buildManagerWorkerRecreateRuntimeStartedStatusEvent(
          lifecycleInput,
          3,
          '2026-08-04T12:00:03.000Z'
        )
      )
    ).toBe(false);
    expect(
      store.updateStatusChannel(
        buildManagerWorkerRecreateRuntimeRetiredStatusEvent(
          lifecycleInput,
          3,
          '2026-08-04T12:00:03.000Z'
        )
      )
    ).toBe(false);
    expect(
      store.updateStatusChannel(
        buildManagerWorkerRecreateCompletedStatusEvent(
          lifecycleInput,
          3,
          'a'.repeat(64),
          '2026-08-04T12:00:03.000Z'
        )
      )
    ).toBe(false);

    expect(
      store.updateStatusChannel(
        buildManagerWorkerRecreatingStatusEvent(
          {
            ...lifecycleInput,
            lifecycle_operation_id: newerRecreateOperationId,
          },
          2
        )
      )
    ).toBe(true);
    expect(store.channelLifecycleOperationById[workerId]).toBe(
      newerRecreateOperationId
    );
  });

  it('does not let stale recovered-operation HTTP regress a newer active or completed lifecycle', async () => {
    const store = useChannelsStore();
    store.list = [
      {
        ...channel(),
        status: { id: EWorkerStatus.recreating, name: 'recreating' },
      },
    ];
    store.channelLifecycleOperationById[workerId] = recreateOperationId;
    const recovered = {
      ...channel(),
      status: { id: EWorkerStatus.online, name: 'online' },
      connection_status: nativeStatus(
        'baileys',
        EWhatsappConnectionStatus.online,
        2
      ),
      connection_status_order: '20',
      connection_status_observed_at: '2026-08-04T12:00:02.000Z',
      connection_online_acknowledged: true,
      runtime_generation: 2,
      lifecycle_operation_id: null,
    };
    expect(
      store.applyCanonicalProviderHandoffSourceRecovery(
        recovered,
        sourceRecoveryAcceptance()
      )
    ).toBe(true);

    const newerLifecycleInput = {
      action: EWorkerAction.recreate,
      worker_id: workerId,
      server_id: 'server-1',
      account_id: accountId,
      worker_type_id: EWorkerType.wwebjs,
      previous_worker_type_id: EWorkerType.baileys,
      lifecycle_operation_id: newerRecreateOperationId,
    };
    expect(
      store.updateStatusChannel(
        buildManagerWorkerRecreatingStatusEvent(newerLifecycleInput, 2)
      )
    ).toBe(true);
    expect(
      store.updateStatusChannel(
        buildManagerWorkerRecreateRuntimeStartedStatusEvent(
          newerLifecycleInput,
          2,
          '2026-08-04T12:00:03.000Z'
        )
      )
    ).toBe(true);

    const staleHttpResponse = {
      data: {
        status: true,
        data: {
          results: [
            {
              ...channel(),
              status: { id: EWorkerStatus.recreating, name: 'recreating' },
              lifecycle_operation_id: recreateOperationId,
              runtime_generation: 2,
            },
          ],
          pagings: {
            current_page: 1,
            total_pages: 1,
            per_page: 10,
            count: 1,
            total: 1,
          },
        },
      },
    };
    axiosGet.mockResolvedValueOnce(staleHttpResponse);
    await store.listChannels();
    expect(store.channelLifecycleOperationById[workerId]).toBe(
      newerRecreateOperationId
    );
    expect(store.list[0]).toMatchObject({
      status: { id: EWorkerStatus.recreating },
    });

    expect(
      store.updateStatusChannel(
        buildManagerWorkerRecreateCompletedStatusEvent(
          newerLifecycleInput,
          2,
          'b'.repeat(64),
          '2026-08-04T12:00:04.000Z'
        )
      )
    ).toBe(true);
    expect(store.channelLifecycleOperationById[workerId]).toBeUndefined();
    expect(store.channelLifecycleCompletedOperationById[workerId]).toBe(
      newerRecreateOperationId
    );

    axiosGet.mockResolvedValueOnce(staleHttpResponse);
    await store.listChannels();
    expect(store.channelLifecycleCompletedOperationById[workerId]).toBe(
      newerRecreateOperationId
    );
    expect(store.list[0]).toMatchObject({
      status: { id: EWorkerStatus.online },
      type: { id: EWorkerType.wwebjs },
      recreate_completed_operation_id: newerRecreateOperationId,
    });
  });

  it('does not let a delayed recreate ack overwrite newer provider truth', async () => {
    const store = useChannelsStore();
    store.list = [channel()];
    let resolveRequest: ((value: unknown) => void) | undefined;
    axiosPatch.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );

    const request = store.recreateChannel(workerId);
    expect(store.updateStatusChannel(wwebjsOnlineEvent())).toBe(true);
    resolveRequest?.({
      data: {
        status: true,
        message: 'queued',
        data: {
          code: 202,
          status: 'queued',
          queued: true,
          worker_id: workerId,
          account_id: accountId,
          server_id: 'server-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.recreating,
          operation_id: recreateOperationId,
          reason: 'recreate_queued',
          runtime_generation: 1,
        },
      },
    });
    await request;

    expect(store.list[0]).toMatchObject({
      status: { id: EWorkerStatus.online },
      type: { id: EWorkerType.wwebjs },
      connection_status_order: '20',
      runtime_generation: 2,
    });
  });

  it('derives an omitted event type from the persisted unofficial channel and rejects raw ONLINE', () => {
    const store = useChannelsStore();
    store.list = [channel()];

    expect(
      store.updateStatusChannel({
        ...wwebjsOnlineEvent(),
        worker_type_id: undefined,
        connection_status: undefined,
        connection_status_source_id: undefined,
        connection_status_order: undefined,
        connection_online_acknowledged: undefined,
      })
    ).toBe(false);
    expect(store.list[0]).toMatchObject({
      type: { id: EWorkerType.baileys },
      status: { id: EWorkerStatus.offline },
      connection_status_order: '10',
      runtime_generation: 1,
    });
  });

  it('rejects raw events from the retired provider and older runtime after handoff', () => {
    const store = useChannelsStore();
    store.list = [channel()];
    expect(store.updateStatusChannel(wwebjsOnlineEvent())).toBe(true);

    expect(
      store.updateStatusChannel({
        ...wwebjsOnlineEvent(),
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.offline,
        connection_status: undefined,
        connection_status_source_id: undefined,
        connection_status_order: undefined,
        connection_online_acknowledged: undefined,
        runtime_generation: 1,
      })
    ).toBe(false);
    expect(
      store.updateStatusChannel({
        ...wwebjsOnlineEvent(),
        worker_status_id: EWorkerStatus.offline,
        connection_status: undefined,
        connection_status_source_id: undefined,
        connection_status_order: undefined,
        connection_online_acknowledged: undefined,
        runtime_generation: 1,
      })
    ).toBe(false);
    expect(store.list[0]).toMatchObject({
      type: { id: EWorkerType.wwebjs },
      status: { id: EWorkerStatus.online },
      connection_status_order: '20',
      runtime_generation: 2,
    });
  });

  it('keeps a realtime provider handoff over a delayed old-provider HTTP response', async () => {
    const store = useChannelsStore();
    store.list = [channel()];
    let resolveRequest: ((value: unknown) => void) | undefined;
    axiosGet.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );

    const request = store.listChannels();
    expect(store.updateStatusChannel(wwebjsOnlineEvent())).toBe(true);
    resolveRequest?.({
      data: {
        status: true,
        data: {
          results: [
            {
              ...channel(),
              name: 'Fresh metadata',
              connection_status_order: '11',
            },
          ],
          pagings: {
            current_page: 1,
            total_pages: 1,
            per_page: 10,
            count: 1,
            total: 1,
          },
        },
      },
    });
    await request;

    expect(store.list[0]).toMatchObject({
      name: 'Fresh metadata',
      type: { id: EWorkerType.wwebjs, name: 'wwebjs' },
      status: { id: EWorkerStatus.online },
      connection_status: { provider: 'wwebjs', status: 'online' },
      connection_status_order: '20',
      connection_online_acknowledged: true,
    });
  });

  it('keeps deleting visible until a terminal delete publication arrives', () => {
    const store = useChannelsStore();
    store.list = [channel()];
    store.pagings = {
      current_page: 1,
      total_pages: 1,
      per_page: 10,
      count: 1,
      total: 1,
    };

    expect(
      store.updateStatusChannel({
        event_type: 'status',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.deleting,
        status: 'info',
        code: 'info',
      })
    ).toBe(true);

    expect(store.list).toHaveLength(1);
    expect(store.list[0]?.status).toEqual({
      id: EWorkerStatus.deleting,
      name: 'deleting',
    });
    expect(store.channelDeletionTombstones[workerId]).toBeUndefined();
    expect(store.pagings).toMatchObject({ count: 1, total: 1 });
  });

  it('applies terminal delete before the native runtime fence and is idempotent', () => {
    const store = useChannelsStore();
    store.list = [channel()];
    store.pagings = {
      current_page: 2,
      total_pages: 2,
      per_page: 10,
      count: 1,
      total: 11,
    };
    const terminalDelete = {
      event_type: 'status',
      worker_id: workerId,
      account_id: accountId,
      worker_status_id: EWorkerStatus.delete,
      status: 'info',
      code: 'info',
    };

    // The production terminal lifecycle publication intentionally has no
    // provider/native status envelope. It must not enter the connection fence.
    expect(store.updateStatusChannel(terminalDelete)).toBe(true);
    expect(store.list).toEqual([]);
    expect(store.channelDeletionTombstones[workerId]).toBe(true);
    expect(store.pagings).toEqual({
      current_page: 1,
      total_pages: 1,
      per_page: 10,
      count: 0,
      total: 10,
    });

    expect(store.updateStatusChannel(terminalDelete)).toBe(true);
    expect(store.list).toEqual([]);
    expect(store.pagings).toEqual({
      current_page: 1,
      total_pages: 1,
      per_page: 10,
      count: 0,
      total: 10,
    });
  });

  it('never treats a telemetry delete hint as a terminal lifecycle event', () => {
    const store = useChannelsStore();
    store.list = [channel()];

    expect(
      store.updateStatusChannel({
        event_type: 'telemetry',
        worker_id: workerId,
        account_id: accountId,
        worker_status_id: EWorkerStatus.delete,
        status: 'info',
        code: 'info',
      })
    ).toBe(false);
    expect(store.list).toHaveLength(1);
    expect(store.channelDeletionTombstones[workerId]).toBeUndefined();
  });

  it('never treats a payload without an explicit status type as terminal', () => {
    const store = useChannelsStore();
    store.list = [channel()];

    expect(
      store.updateStatusChannel({
        worker_id: workerId,
        account_id: accountId,
        worker_status_id: EWorkerStatus.delete,
        status: 'info',
        code: 'info',
      })
    ).toBe(false);
    expect(store.list).toHaveLength(1);
    expect(store.channelDeletionTombstones[workerId]).toBeUndefined();
  });

  it('keeps all-items pagination on a single page after terminal deletion', () => {
    const store = useChannelsStore();
    store.list = [
      channel(),
      {
        ...channel(),
        id: '019ca10d-73e1-7e5e-9d1e-8b8148aeb246',
      },
    ];
    store.pagings = {
      current_page: 1,
      total_pages: 1,
      per_page: -1,
      count: 2,
      total: 2,
    };

    expect(
      store.updateStatusChannel({
        event_type: 'status',
        worker_id: workerId,
        account_id: accountId,
        worker_status_id: EWorkerStatus.delete,
        status: 'info',
        code: 'info',
      })
    ).toBe(true);
    expect(store.pagings).toEqual({
      current_page: 1,
      total_pages: 1,
      per_page: -1,
      count: 1,
      total: 1,
    });
  });

  it('does not let a delayed HTTP snapshot resurrect a terminal deletion', async () => {
    const store = useChannelsStore();
    store.list = [channel()];
    store.pagings = {
      current_page: 1,
      total_pages: 1,
      per_page: 10,
      count: 1,
      total: 1,
    };
    let resolveRequest: ((value: unknown) => void) | undefined;
    axiosGet.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );

    const request = store.listChannels();
    expect(
      store.updateStatusChannel({
        event_type: 'status',
        worker_id: workerId,
        account_id: accountId,
        worker_status_id: EWorkerStatus.delete,
        status: 'info',
        code: 'info',
      })
    ).toBe(true);

    resolveRequest?.({
      data: {
        status: true,
        data: {
          results: [
            {
              ...channel(),
              status: { id: EWorkerStatus.deleting, name: 'deleting' },
            },
          ],
          pagings: {
            current_page: 1,
            total_pages: 1,
            per_page: 10,
            count: 1,
            total: 1,
          },
        },
      },
    });

    const result = (await request) as Record<string, any>;
    expect(store.list).toEqual([]);
    expect(store.pagings).toEqual({
      current_page: 1,
      total_pages: 1,
      per_page: 10,
      count: 0,
      total: 0,
    });
    expect(result.results).toEqual([]);
    expect(result.pagings).toEqual(store.pagings);
  });

  it('suppresses deleting rows returned by a fresh HTTP snapshot', async () => {
    const store = useChannelsStore();
    axiosGet.mockResolvedValueOnce({
      data: {
        status: true,
        data: {
          results: [
            {
              ...channel(),
              status: { id: EWorkerStatus.deleting, name: 'deleting' },
            },
          ],
          pagings: {
            current_page: 1,
            total_pages: 1,
            per_page: 10,
            count: 1,
            total: 1,
          },
        },
      },
    });

    const result = (await store.listChannels()) as Record<string, any>;

    expect(store.list).toEqual([]);
    expect(store.pagings).toEqual({
      current_page: 1,
      total_pages: 1,
      per_page: 10,
      count: 0,
      total: 0,
    });
    expect(result.results).toEqual([]);
    expect(result.pagings).toEqual(store.pagings);
  });

  it('tombstones the row when the durable DELETE claim is accepted', async () => {
    const store = useChannelsStore();
    store.list = [channel()];
    store.pagings = {
      current_page: 1,
      total_pages: 1,
      per_page: 10,
      count: 1,
      total: 1,
    };
    axiosDelete.mockResolvedValueOnce({
      data: {
        status: true,
        message: 'queued',
      },
    });

    await expect(store.deleteChannel(workerId)).resolves.toBe(true);
    expect(store.list).toEqual([]);
    expect(store.channelDeletionTombstones[workerId]).toBe(true);
    expect(store.pagings).toEqual({
      current_page: 1,
      total_pages: 1,
      per_page: 10,
      count: 0,
      total: 0,
    });
  });

  it('removes only the connection through DELETE and fences the retired session until reconnect', async () => {
    const store = useChannelsStore();
    store.list = [
      {
        ...channel(),
        number: '556192037138',
        status: { id: EWorkerStatus.online, name: 'online' },
        connection_date: '2026-08-09T10:00:00.000Z',
        last_connection_check_at: '2026-08-09T10:01:00.000Z',
        connection_status: nativeStatus(
          'baileys',
          EWhatsappConnectionStatus.online,
          2
        ),
        connection_status_source_id: baileysSourceId,
        connection_status_order: '20',
        connection_online_acknowledged: true,
        runtime_generation: 2,
      },
    ];
    axiosDelete.mockResolvedValueOnce({
      data: {
        status: true,
        message: 'session removed',
        data: {
          worker_id: workerId,
          worker_status_id: EWorkerStatus.disponible,
          session_removed: true,
          disconnected_user: true,
          runtime_generation: 2,
          container_id: null,
          worker_status_observed_at: '2026-08-09T10:02:00.000Z',
        },
      },
    });

    await expect(
      store.disconnectConnectionChannel(workerId)
    ).resolves.toMatchObject({
      worker_id: workerId,
      worker_status_id: EWorkerStatus.disponible,
      session_removed: true,
    });
    expect(axiosDelete).toHaveBeenCalledWith(
      '/worker/' + workerId + '/connection',
      {}
    );
    expect(axiosPost).not.toHaveBeenCalledWith(
      '/worker/' + workerId + '/connection/reset',
      expect.anything(),
      expect.anything()
    );
    expect(store.list[0]).toMatchObject({
      number: null,
      status: { id: EWorkerStatus.disponible },
      connection_date: null,
      last_connection_check_at: null,
      connection_status: null,
      connection_status_source_id: null,
      connection_status_order: null,
      connection_online_acknowledged: false,
      runtime_generation: 2,
    });
    expect(store.sessionRemovalGenerationByWorkerId[workerId]).toBe(2);
    expect(store.sessionRemovalObservedAtByWorkerId[workerId]).toBe(
      '2026-08-09T10:02:00.000Z'
    );

    const lateOnline = {
      event_type: 'status' as const,
      worker_id: workerId,
      account_id: accountId,
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.online,
      status: 'open',
      code: 'connectionEstablished',
      phone: '556192037138',
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      authenticated: true,
      connection_status: nativeStatus(
        'baileys',
        EWhatsappConnectionStatus.online,
        3
      ),
      connection_status_source_id: baileysSourceId,
      connection_status_order: '21',
      worker_status_observed_at: '2026-08-09T10:01:59.000Z',
      connection_status_observed_at: '2026-08-09T10:01:59.000Z',
      connection_online_acknowledged: true,
      runtime_generation: 2,
    };
    expect(store.updateStatusChannel(lateOnline)).toBe(false);
    expect(store.list[0]?.status?.id).toBe(EWorkerStatus.disponible);

    axiosGet.mockResolvedValueOnce({
      data: {
        status: true,
        data: {
          results: [
            {
              ...channel(),
              number: '556192037138',
              status: { id: EWorkerStatus.online, name: 'online' },
              runtime_generation: 2,
            },
          ],
          pagings: {
            current_page: 1,
            total_pages: 1,
            per_page: 10,
            count: 1,
            total: 1,
          },
        },
      },
    });
    await store.listChannels();
    expect(store.list[0]).toMatchObject({
      number: null,
      status: { id: EWorkerStatus.disponible },
      connection_status: null,
    });

    store.releaseSessionRemovalFence(workerId);
    expect(store.updateStatusChannel(lateOnline)).toBe(false);
    axiosGet.mockResolvedValueOnce({
      data: {
        status: true,
        data: {
          results: [
            {
              ...channel(),
              number: '556192037138',
              status: { id: EWorkerStatus.online, name: 'online' },
              worker_status_observed_at: '2026-08-09T10:01:59.000Z',
              connection_status_observed_at: '2026-08-09T10:01:59.000Z',
              runtime_generation: 2,
            },
          ],
          pagings: {
            current_page: 1,
            total_pages: 1,
            per_page: 10,
            count: 1,
            total: 1,
          },
        },
      },
    });
    await store.listChannels();
    expect(store.list[0]?.status?.id).toBe(EWorkerStatus.disponible);
    expect(
      store.updateStatusChannel({
        ...lateOnline,
        connection_status: nativeStatus(
          'baileys',
          EWhatsappConnectionStatus.online,
          4
        ),
        connection_status_order: '22',
        worker_status_observed_at: '2026-08-09T10:03:00.000Z',
        connection_status_observed_at: '2026-08-09T10:03:00.000Z',
      })
    ).toBe(true);
  });

  it('queries only the requested worker handoff and forwards cancellation', async () => {
    const store = useChannelsStore();
    const controller = new AbortController();
    const handoff = {
      worker_id: workerId,
      handoff_id: '33333333-3333-4333-8333-333333333333',
      lifecycle_operation_id: '44444444-4444-4444-8444-444444444444',
      state: 'failed',
    };
    axiosGet.mockResolvedValueOnce({
      data: { status: true, message: 'ok', data: handoff },
    });

    await expect(
      store.viewWhatsappProviderHandoff(workerId, {
        signal: controller.signal,
      })
    ).resolves.toEqual({ kind: 'found', handoff });
    expect(axiosGet).toHaveBeenCalledWith(
      `/worker/${workerId}/provider-handoff/latest`,
      expect.objectContaining({ signal: controller.signal })
    );
  });

  it('posts an explicit idempotent recovery decision for one handoff', async () => {
    const store = useChannelsStore();
    const handoffId = '33333333-3333-4333-8333-333333333333';
    const resolution = {
      action: 'discard',
      status: 'queued',
      reason: 'session_discard_queued',
      handoff: null,
      operation_id: handoffId,
    };
    axiosPost.mockResolvedValueOnce({
      data: { status: true, message: 'queued', data: resolution },
    });

    await expect(
      store.resolveWhatsappProviderHandoff(workerId, handoffId, 'discard')
    ).resolves.toEqual(resolution);
    expect(axiosPost).toHaveBeenCalledWith(
      `/worker/${workerId}/provider-handoff/${handoffId}/resolve`,
      { action: 'discard' },
      expect.any(Object)
    );
  });
});
