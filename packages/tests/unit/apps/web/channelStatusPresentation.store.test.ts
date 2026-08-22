import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { createPinia, setActivePinia } from 'pinia';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EColor } from '@core/common/enums/EColor';
import { EWhatsappConnectionStatus } from '@core/common/enums/EWhatsappConnectionStatus';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerRecreatePhase } from '@core/common/enums/EWorkerRecreatePhase';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import * as whatsappConnectionStatus from '@core/common/functions/whatsappConnectionStatus';
import * as workerLifecycleRealtimeStatus from '@core/common/functions/workerLifecycleRealtimeStatus';
import {
  buildManagerWorkerRecreateRuntimeRetiredStatusEvent,
  buildManagerWorkerRecreateRuntimeStartedStatusEvent,
  buildManagerWorkerRecreateTerminalStatusEvent,
  buildManagerWorkerRecreatingStatusEvent,
} from '@core/common/functions/workerLifecycleRealtimeStatus';
import type { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import type { WhatsappConnectionPublicStatus } from '@core/common/functions/whatsappConnectionStatus';

interface PresentationSnapshot {
  workerId: string;
  workerTypeId: string | null;
  workerStatusId: string | null;
  sessionIdentityPresent: boolean;
  workerStatusObservedAt: string | null;
  sessionRemovalObservedAt: string | null;
  connectionStatus: WhatsappConnectionPublicStatus | null;
  connectionStatusOrder: string | null;
  connectionStatusObservedAt: string | null;
  connectionOnlineAcknowledged: boolean;
  runtimeGeneration: number | null;
  lifecycleOperationId: string | null;
  completedLifecycleOperationId: string | null;
  completedLifecycleRuntimeGeneration: number | null;
  completedLifecycleAt: string | null;
  recreateBaselineConnectionStatusOrder: string | null;
  recreatePhase: EWorkerRecreatePhase | null;
  recreatePhaseObservedAt: string | null;
  recreateRuntimeRetired: boolean;
}

interface PresentationStoreForTest {
  providerHandoffSourceRecoveryByWorkerId: Record<
    string,
    Record<string, unknown>
  >;
  initialCreationOperationByWorkerId: Record<string, string>;
  sessionRemovalGenerationByWorkerId: Record<string, number>;
  snapshot: (workerId: string) => PresentationSnapshot | undefined;
  hydrateWorkerChannel: (channel: Record<string, unknown>) => boolean;
  hydrateOfflineChannel: (channel: Record<string, unknown>) => boolean;
  hydrateDashboardChannelStatus: (channel: Record<string, unknown>) => boolean;
  reconcileProviderHandoffSourceRecovery: (
    channel: Record<string, unknown>,
    handoff: Record<string, unknown>
  ) => Record<string, unknown> | null;
  applyRealtimeEvent: (event: IBaileysConnectionState) => boolean;
  applySessionRemovalTerminal: (result: Record<string, unknown>) => boolean;
  releaseSessionRemovalFence: (workerId: string) => void;
  applyAcceptedRecreateAck: (ack: Record<string, unknown>) => boolean;
  applyAcceptedCreateAck: (ack: Record<string, unknown>) => boolean;
}

interface PresentationDescriptor {
  color: EColor;
  text: string;
  online: boolean;
}

const transpileModule = (
  relativePath: string,
  dependencies: Record<string, unknown>
): Record<string, unknown> => {
  const filename = resolve(process.cwd(), relativePath);
  const source = readFileSync(filename, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} as Record<string, unknown> };
  const evaluate = new Function('require', 'module', 'exports', transpiled) as (
    requireModule: (moduleId: string) => unknown,
    module: typeof loaded,
    exports: Record<string, unknown>
  ) => void;
  evaluate(
    (moduleId) => {
      if (moduleId in dependencies) return dependencies[moduleId];
      throw new Error(`Unexpected presentation dependency: ${moduleId}`);
    },
    loaded,
    loaded.exports
  );
  return loaded.exports;
};

const storeModule = transpileModule(
  'apps/web/src/@webcore/stores/channelStatusPresentation.ts',
  {
    pinia: require('pinia'),
    '@core/common/enums/EWorkerRecreatePhase': { EWorkerRecreatePhase },
    '@core/common/enums/EWorkerAction': { EWorkerAction },
    '@core/common/enums/EWorkerStatus': { EWorkerStatus },
    '@core/common/enums/EWorkerType': { EWorkerType },
    '@core/common/enums/EBaileysConnectionStatus': {
      EBaileysConnectionStatus,
    },
    '@core/common/enums/ECodeMessage': { ECodeMessage },
    '@core/common/functions/whatsappConnectionStatus': whatsappConnectionStatus,
    '@core/common/functions/workerLifecycleRealtimeStatus':
      workerLifecycleRealtimeStatus,
  }
);
const presentationModule = transpileModule(
  'apps/web/src/@webcore/utils/channelStatusPresentation.ts',
  {
    '@core/common/enums/EColor': { EColor },
    '@core/common/enums/EWorkerRecreatePhase': { EWorkerRecreatePhase },
    '@core/common/enums/EWorkerStatus': { EWorkerStatus },
    '@core/common/functions/whatsappConnectionStatus': whatsappConnectionStatus,
  }
);

const usePresentationStore =
  storeModule.useChannelStatusPresentationStore as () => PresentationStoreForTest;
const canonicalSnapshotIncludesPublication =
  storeModule.canonicalSnapshotIncludesPublication as (
    snapshot: PresentationSnapshot | undefined,
    event: IBaileysConnectionState
  ) => boolean;
const resolvePresentation =
  presentationModule.resolveChannelStatusPresentation as (
    input: PresentationSnapshot,
    translate: (key: string) => string
  ) => PresentationDescriptor;

const workerId = '019fd88a-2894-739b-9471-cd3502f648df';
const accountId = '019a930d-c6f4-75ad-88ff-8d2fcd5839e1';
const sourceId = '22222222-2222-4222-8222-222222222222';
const operationId = '019fdf2c-63af-73e2-8107-3442eeeb8e19';
const olderOperationId = '019fdf2c-63af-73e2-8107-3442eeeb8e18';
const resolutionOperationId = '019fdf2d-63af-73e2-8107-3442eeeb8e19';
const nextOperationId = '019fdf2e-63af-73e2-8107-3442eeeb8e19';
const recoveryOperationId = '91d3d1bf-b6f5-48fa-8934-53ed56f50f20';
const unrelatedRecoveryOperationId = '11ef2d76-c48a-4d2f-b339-b78a34a0b901';
const completedAt = '2026-08-08T03:05:00.000Z';

const dashboardChannelStatus = (input?: {
  generation?: number;
  workerType?: EWorkerType;
  status?: EWorkerStatus;
  observedAt?: string;
  completedOperationId?: string;
  completedGeneration?: number;
  completedAt?: string;
}) => ({
  id: workerId,
  name: 'channel',
  worker_type_id: input?.workerType ?? EWorkerType.wwebjs,
  session_identity_present: true,
  status: {
    id: input?.status ?? EWorkerStatus.online,
    name: input?.status ?? EWorkerStatus.online,
  },
  connection_status_source_id: sourceId,
  connection_status_order: '10',
  runtime_generation: input?.generation ?? 5,
  connection_status_observed_at:
    input?.observedAt ?? '2026-08-08T03:00:00.000Z',
  ...(input?.completedOperationId &&
  input.completedGeneration &&
  input.completedAt
    ? {
        recreate_completed_operation_id: input.completedOperationId,
        recreate_completed_runtime_generation: input.completedGeneration,
        recreate_completed_at: input.completedAt,
      }
    : {}),
});

const nativeStatus = (
  provider: 'wwebjs' | 'baileys' | 'whatsmeow',
  status: EWhatsappConnectionStatus,
  sequence: number,
  changedAt?: string
) => ({
  provider,
  status,
  connected: status === EWhatsappConnectionStatus.online,
  authenticated: status === EWhatsappConnectionStatus.online,
  sessionValid: true,
  recoverable: true,
  qrAvailable: false,
  sequence,
  changedAt:
    changedAt ?? `2026-08-08T03:00:${String(sequence).padStart(2, '0')}.000Z`,
});

const workerChannel = (input: {
  order: string;
  generation: number;
  workerType?: EWorkerType;
  status?: EWorkerStatus;
  native?: EWhatsappConnectionStatus;
  nativeChangedAt?: string;
  acknowledged?: boolean;
  observedAt?: string;
  lifecycleOperationId?: string | null;
  recreatePhase?: EWorkerRecreatePhase;
  recreatePhaseObservedAt?: string;
  recreateRuntimeRetired?: boolean;
  completedOperationId?: string;
  completedGeneration?: number;
  completedAt?: string;
}) => {
  const workerType = input.workerType ?? EWorkerType.wwebjs;
  const provider =
    workerType === EWorkerType.baileys
      ? 'baileys'
      : workerType === EWorkerType.whatsmeow
        ? 'whatsmeow'
        : 'wwebjs';
  return {
    id: workerId,
    name: 'channel',
    session_storage: 'postgres',
    number: '556192037138',
    status: {
      id: input.status ?? EWorkerStatus.online,
      name: input.status ?? EWorkerStatus.online,
    },
    type: { id: workerType, name: provider },
    connection_date: null,
    last_connection_check_at: null,
    recreate_available_at: null,
    created_at: null,
    updated_at: null,
    connection_status: nativeStatus(
      provider,
      input.native ?? EWhatsappConnectionStatus.online,
      input.generation,
      input.nativeChangedAt
    ),
    connection_status_source_id: sourceId,
    connection_status_order: input.order,
    connection_status_observed_at:
      input.observedAt ?? '2026-08-08T03:00:00.000Z',
    connection_online_acknowledged: input.acknowledged ?? true,
    runtime_generation: input.generation,
    ...(input.lifecycleOperationId !== undefined
      ? { lifecycle_operation_id: input.lifecycleOperationId }
      : {}),
    ...(input.recreatePhase ? { recreate_phase: input.recreatePhase } : {}),
    ...(input.recreatePhaseObservedAt
      ? { recreate_phase_observed_at: input.recreatePhaseObservedAt }
      : input.recreatePhase === EWorkerRecreatePhase.connecting
        ? { recreate_phase_observed_at: '2026-08-08T03:01:00.000Z' }
        : {}),
    ...(input.recreateRuntimeRetired !== undefined
      ? { recreate_runtime_retired: input.recreateRuntimeRetired }
      : input.recreatePhase
        ? { recreate_runtime_retired: false }
        : {}),
    ...(input.completedOperationId &&
    input.completedGeneration &&
    input.completedAt
      ? {
          recreate_completed_operation_id: input.completedOperationId,
          recreate_completed_runtime_generation: input.completedGeneration,
          recreate_completed_at: input.completedAt,
        }
      : {}),
  };
};

const nativeRealtimeEvent = (input: {
  order: string;
  generation: number;
  workerType?: EWorkerType;
  acknowledged?: boolean;
  observedAt?: string;
  native?: EWhatsappConnectionStatus;
  nativeChangedAt?: string;
  lifecycleOperationId?: string;
  recreatePhase?: EWorkerRecreatePhase;
  recreatePhaseObservedAt?: string;
  recreateRuntimeRetired?: boolean;
}): IBaileysConnectionState => {
  const workerType = input.workerType ?? EWorkerType.wwebjs;
  const provider =
    workerType === EWorkerType.baileys
      ? 'baileys'
      : workerType === EWorkerType.whatsmeow
        ? 'whatsmeow'
        : 'wwebjs';
  return {
    event_type: 'telemetry',
    worker_id: workerId,
    account_id: accountId,
    worker_type_id: workerType,
    status: EBaileysConnectionStatus.connected,
    code: ECodeMessage.connectionEstablished,
    connection_status: nativeStatus(
      provider,
      input.native ?? EWhatsappConnectionStatus.online,
      input.generation,
      input.nativeChangedAt
    ),
    connection_status_source_id: sourceId,
    connection_status_order: input.order,
    connection_status_observed_at:
      input.observedAt ?? '2026-08-08T03:00:00.000Z',
    connection_online_acknowledged: input.acknowledged ?? false,
    runtime_generation: input.generation,
    ...(input.lifecycleOperationId
      ? { lifecycle_operation_id: input.lifecycleOperationId }
      : {}),
    ...(input.recreatePhase ? { recreate_phase: input.recreatePhase } : {}),
    ...(input.recreatePhaseObservedAt
      ? { recreate_phase_observed_at: input.recreatePhaseObservedAt }
      : input.recreatePhase
        ? { recreate_phase_observed_at: '2026-08-08T03:01:00.000Z' }
        : {}),
    ...(input.recreatePhase
      ? {
          recreate_runtime_retired: input.recreateRuntimeRetired === true,
        }
      : {}),
  };
};

const managerStartEvent = (input?: {
  operationId?: string;
  generation?: number;
  workerType?: EWorkerType;
  previousWorkerType?: EWorkerType;
}): IBaileysConnectionState =>
  buildManagerWorkerRecreatingStatusEvent(
    {
      action: EWorkerAction.recreate,
      worker_id: workerId,
      server_id: 'server-1',
      account_id: accountId,
      worker_type_id: input?.workerType ?? EWorkerType.baileys,
      previous_worker_type_id: input?.previousWorkerType ?? EWorkerType.wwebjs,
      lifecycle_operation_id: input?.operationId ?? operationId,
    },
    input?.generation ?? 5
  );

const runtimeStartedEvent = (input?: {
  operationId?: string;
  generation?: number;
  workerType?: EWorkerType;
  previousWorkerType?: EWorkerType;
  observedAt?: string;
}): IBaileysConnectionState => {
  const phaseObservedAt = input?.observedAt ?? '2026-08-08T03:01:00.000Z';
  return buildManagerWorkerRecreateRuntimeStartedStatusEvent(
    {
      action: EWorkerAction.recreate,
      worker_id: workerId,
      server_id: 'server-1',
      account_id: accountId,
      worker_type_id: input?.workerType ?? EWorkerType.baileys,
      previous_worker_type_id: input?.previousWorkerType ?? EWorkerType.wwebjs,
      lifecycle_operation_id: input?.operationId ?? operationId,
    },
    input?.generation ?? 6,
    phaseObservedAt
  );
};

const runtimeRetiredEvent = (input?: {
  operationId?: string;
  generation?: number;
  workerType?: EWorkerType;
  previousWorkerType?: EWorkerType;
  observedAt?: string;
}): IBaileysConnectionState =>
  buildManagerWorkerRecreateRuntimeRetiredStatusEvent(
    {
      action: EWorkerAction.recreate,
      worker_id: workerId,
      server_id: 'server-1',
      account_id: accountId,
      worker_type_id: input?.workerType ?? EWorkerType.baileys,
      previous_worker_type_id: input?.previousWorkerType ?? EWorkerType.wwebjs,
      lifecycle_operation_id: input?.operationId ?? operationId,
    },
    input?.generation ?? 6,
    input?.observedAt ?? '2026-08-08T03:02:00.000Z'
  );

const terminalEvent = (input?: {
  operationId?: string;
  generation?: number;
  workerType?: EWorkerType;
  previousWorkerType?: EWorkerType;
  workerStatus?: EWorkerStatus.online | EWorkerStatus.disponible;
  completedAt?: string;
}): IBaileysConnectionState => {
  const event = buildManagerWorkerRecreateTerminalStatusEvent(
    {
      action: EWorkerAction.recreate,
      worker_id: workerId,
      server_id: 'server-1',
      account_id: accountId,
      worker_type_id: input?.workerType ?? EWorkerType.baileys,
      previous_worker_type_id: input?.previousWorkerType ?? EWorkerType.wwebjs,
      lifecycle_operation_id: input?.operationId ?? operationId,
    },
    input?.generation ?? 6,
    input?.workerStatus ?? EWorkerStatus.online,
    input?.completedAt ?? completedAt
  );
  return {
    ...event,
    connection_status_observed_at: input?.completedAt ?? completedAt,
  };
};

const sourceRecoveryHandoff = (overrides: Record<string, unknown> = {}) => ({
  worker_id: workerId,
  handoff_id: '63aa24e4-f03f-41ab-801c-becf8f195ad5',
  lifecycle_operation_id: operationId,
  handoff_lifecycle_operation_id: operationId,
  state: 'failed',
  source_provider: 'wwebjs',
  target_provider: 'baileys',
  source_revision_id: '2060',
  target_revision_id: '2068',
  error_code: 'checkpoint_failed',
  recovery_state: 'completed',
  recovery_error_code: null,
  source_revision_preserved: true,
  source_runtime_restored: true,
  resolution_required: true,
  can_return: true,
  can_discard: true,
  resolution_status: 'awaiting_decision',
  resolution_action: null,
  resolution_state: null,
  resolution_operation_id: null,
  created_at: '2026-08-08T03:00:00.000Z',
  updated_at: '2026-08-08T03:04:00.000Z',
  ...overrides,
});

const descriptor = (snapshot: PresentationSnapshot | undefined) => {
  if (!snapshot) throw new Error('presentation snapshot missing');
  return resolvePresentation(snapshot, (key) => key);
};

describe('shared web channel status presentation', () => {
  it('lets the persisted worker status replace native telemetry that arrived before hydration', () => {
    const store = usePresentationStore();
    const earlyNative = nativeRealtimeEvent({
      order: '1',
      generation: 5,
      workerType: EWorkerType.baileys,
      native: EWhatsappConnectionStatus.connecting,
      observedAt: '2026-08-10T19:00:01.000Z',
    });
    earlyNative.worker_status_observed_at = '2026-08-10T19:00:01.000Z';

    expect(store.applyRealtimeEvent(earlyNative)).toBe(true);
    expect(store.snapshot(workerId)?.workerStatusId).toBeNull();
    expect(store.snapshot(workerId)?.workerStatusObservedAt).toBeNull();

    expect(
      store.hydrateWorkerChannel(
        workerChannel({
          order: '1',
          generation: 5,
          workerType: EWorkerType.baileys,
          status: EWorkerStatus.disponible,
          native: EWhatsappConnectionStatus.connecting,
          acknowledged: false,
          observedAt: '2026-08-10T19:00:00.000Z',
        })
      )
    ).toBe(true);
    const hydrated = store.snapshot(workerId);
    expect(hydrated?.workerStatusId).toBe(EWorkerStatus.disponible);
    if (!hydrated) throw new Error('expected hydrated worker snapshot');
    expect(resolvePresentation(hydrated, (key) => key)).toEqual(
      expect.objectContaining({
        text: 'awaiting_qr_code',
        online: false,
      })
    );
  });

  beforeEach(() => setActivePinia(createPinia()));

  it.each([
    ['runtime_started', false],
    ['runtime_retired', true],
  ] as const)(
    'releases one exact failed handoff source recovery from %s without manufacturing a recreate completion',
    (_phase, runtimeRetired) => {
      const store = usePresentationStore();
      store.hydrateWorkerChannel(
        workerChannel({
          order: '60',
          generation: 5,
          workerType: EWorkerType.wwebjs,
          observedAt: '2026-08-08T03:00:00.000Z',
        })
      );
      expect(
        store.applyRealtimeEvent(
          runtimeRetired
            ? runtimeRetiredEvent({ operationId, generation: 6 })
            : runtimeStartedEvent({ operationId, generation: 6 })
        )
      ).toBe(true);
      expect(descriptor(store.snapshot(workerId)).text).toBe(
        runtimeRetired ? 'recreating' : 'connecting'
      );

      expect(
        store.reconcileProviderHandoffSourceRecovery(
          workerChannel({
            order: '61',
            generation: 6,
            workerType: EWorkerType.wwebjs,
            status: EWorkerStatus.online,
            acknowledged: true,
            observedAt: '2026-08-08T03:04:00.000Z',
            nativeChangedAt: '2026-08-08T03:04:00.000Z',
            lifecycleOperationId: null,
          }),
          sourceRecoveryHandoff()
        )
      ).toMatchObject({
        releasedOperationId: operationId,
        terminalOperationId: operationId,
        operationIds: [operationId],
        runtimeGeneration: 6,
      });
      expect(store.snapshot(workerId)).toMatchObject({
        workerTypeId: EWorkerType.wwebjs,
        workerStatusId: EWorkerStatus.online,
        connectionStatus: 'online',
        connectionOnlineAcknowledged: true,
        runtimeGeneration: 6,
        lifecycleOperationId: null,
        completedLifecycleOperationId: null,
        recreatePhase: null,
        recreatePhaseObservedAt: null,
        recreateRuntimeRetired: false,
      });
      expect(descriptor(store.snapshot(workerId))).toMatchObject({
        color: EColor.success,
        text: 'channel_connected',
        online: true,
      });
    }
  );

  it.each([
    ['wrong operation', { lifecycle_operation_id: olderOperationId }, {}],
    [
      'wrong handoff worker',
      { worker_id: '2a95f3ca-adb7-4240-830b-9524743151fd' },
      {},
    ],
    ['wrong source provider', { source_provider: 'whatsmeow' }, {}],
    ['source and target provider equal', { target_provider: 'wwebjs' }, {}],
    ['source revision not preserved', { source_revision_preserved: false }, {}],
    ['source not restored', { source_runtime_restored: false }, {}],
    ['recovery not completed', { recovery_state: 'running' }, {}],
    [
      'recovery carries an error',
      { recovery_error_code: 'restore_failed' },
      {},
    ],
    [
      'automatic recovery is not awaiting a decision',
      { resolution_required: false },
      {},
    ],
    [
      'authoritative target provider is online',
      {},
      { workerType: EWorkerType.baileys },
    ],
    [
      'authoritative source offline',
      {},
      {
        status: EWorkerStatus.offline,
        native: EWhatsappConnectionStatus.offline,
        acknowledged: false,
      },
    ],
    ['authoritative source lacks ACK', {}, { acknowledged: false }],
    [
      'authoritative native projection is not online',
      {},
      { native: EWhatsappConnectionStatus.offline },
    ],
    ['authoritative order is missing', {}, { order: '' }],
    ['authoritative order is stale', {}, { order: '60' }],
    [
      'authoritative observation is missing',
      {},
      { observedAt: '', nativeChangedAt: '' },
    ],
    [
      'authoritative observation predates the lifecycle phase',
      {},
      {
        observedAt: '2026-08-08T03:00:30.000Z',
        nativeChangedAt: '2026-08-08T03:00:30.000Z',
      },
    ],
  ] as const)(
    'rejects provider handoff source recovery with %s',
    (_case, handoffOverrides, channelOverrides) => {
      const store = usePresentationStore();
      store.hydrateWorkerChannel(
        workerChannel({
          order: '60',
          generation: 5,
          workerType: EWorkerType.wwebjs,
        })
      );
      expect(
        store.applyRealtimeEvent(
          runtimeStartedEvent({ operationId, generation: 6 })
        )
      ).toBe(true);

      expect(
        store.reconcileProviderHandoffSourceRecovery(
          workerChannel({
            order: '61',
            generation: 6,
            workerType: EWorkerType.wwebjs,
            status: EWorkerStatus.online,
            acknowledged: true,
            observedAt: '2026-08-08T03:04:00.000Z',
            nativeChangedAt: '2026-08-08T03:04:00.000Z',
            lifecycleOperationId: null,
            ...channelOverrides,
          }),
          sourceRecoveryHandoff(handoffOverrides)
        )
      ).toBeNull();
      expect(store.snapshot(workerId)?.lifecycleOperationId).toBe(operationId);
    }
  );

  it('rejects an authoritative worker GET for another worker', () => {
    const store = usePresentationStore();
    store.hydrateWorkerChannel(
      workerChannel({
        order: '60',
        generation: 5,
        workerType: EWorkerType.wwebjs,
      })
    );
    store.applyRealtimeEvent(
      runtimeStartedEvent({ operationId, generation: 6 })
    );

    expect(
      store.reconcileProviderHandoffSourceRecovery(
        {
          ...workerChannel({
            order: '61',
            generation: 6,
            workerType: EWorkerType.wwebjs,
            status: EWorkerStatus.online,
            observedAt: '2026-08-08T03:04:00.000Z',
            lifecycleOperationId: null,
          }),
          id: '2a95f3ca-adb7-4240-830b-9524743151fd',
        },
        sourceRecoveryHandoff()
      )
    ).toBeNull();
    expect(store.snapshot(workerId)?.lifecycleOperationId).toBe(operationId);
  });

  it.each([operationId, resolutionOperationId])(
    'accepts an exact completed return when the tab still tracks operation %s',
    (activeOperationId) => {
      const store = usePresentationStore();
      store.hydrateWorkerChannel(
        workerChannel({
          order: '60',
          generation: 6,
          workerType: EWorkerType.baileys,
          status: EWorkerStatus.recreating,
          lifecycleOperationId: activeOperationId,
          recreatePhase: EWorkerRecreatePhase.connecting,
          recreatePhaseObservedAt: '2026-08-08T03:02:00.000Z',
        })
      );

      expect(
        store.reconcileProviderHandoffSourceRecovery(
          workerChannel({
            order: '61',
            generation: 6,
            workerType: EWorkerType.wwebjs,
            status: EWorkerStatus.online,
            acknowledged: true,
            observedAt: '2026-08-08T03:04:00.000Z',
            nativeChangedAt: '2026-08-08T03:04:00.000Z',
            lifecycleOperationId: null,
          }),
          sourceRecoveryHandoff({
            resolution_required: false,
            resolution_status: 'completed',
            resolution_action: 'return',
            resolution_state: 'completed',
            resolution_operation_id: resolutionOperationId,
          })
        )
      ).toMatchObject({
        releasedOperationId: activeOperationId,
        terminalOperationId: resolutionOperationId,
        operationIds: [operationId, resolutionOperationId],
      });
      expect(store.snapshot(workerId)).toMatchObject({
        workerTypeId: EWorkerType.wwebjs,
        workerStatusId: EWorkerStatus.online,
        lifecycleOperationId: null,
        completedLifecycleOperationId: null,
      });
    }
  );

  it('accepts a completed return whose durable current operation is the exact resolution operation', () => {
    const store = usePresentationStore();
    store.hydrateWorkerChannel(
      workerChannel({
        order: '60',
        generation: 6,
        workerType: EWorkerType.baileys,
        status: EWorkerStatus.recreating,
        lifecycleOperationId: resolutionOperationId,
        recreatePhase: EWorkerRecreatePhase.connecting,
        recreatePhaseObservedAt: '2026-08-08T03:02:00.000Z',
      })
    );

    expect(
      store.reconcileProviderHandoffSourceRecovery(
        workerChannel({
          order: '61',
          generation: 6,
          workerType: EWorkerType.wwebjs,
          status: EWorkerStatus.online,
          acknowledged: true,
          observedAt: '2026-08-08T03:04:00.000Z',
          nativeChangedAt: '2026-08-08T03:04:00.000Z',
          lifecycleOperationId: null,
        }),
        sourceRecoveryHandoff({
          lifecycle_operation_id: resolutionOperationId,
          resolution_required: false,
          resolution_status: 'completed',
          resolution_action: 'return',
          resolution_state: 'completed',
          resolution_operation_id: resolutionOperationId,
        })
      )
    ).toMatchObject({
      releasedOperationId: resolutionOperationId,
      terminalOperationId: resolutionOperationId,
      operationIds: [operationId, resolutionOperationId],
    });
  });

  it.each([
    [
      'discard completion',
      resolutionOperationId,
      {
        resolution_required: false,
        resolution_status: 'completed',
        resolution_action: 'discard',
        resolution_state: 'completed',
        resolution_operation_id: resolutionOperationId,
      },
    ],
    [
      'wrong resolution operation',
      resolutionOperationId,
      {
        resolution_required: false,
        resolution_status: 'completed',
        resolution_action: 'return',
        resolution_state: 'completed',
        resolution_operation_id: nextOperationId,
      },
    ],
    [
      'substituted current lifecycle operation',
      nextOperationId,
      {
        resolution_required: false,
        resolution_status: 'completed',
        resolution_action: 'return',
        resolution_state: 'completed',
        resolution_operation_id: resolutionOperationId,
      },
    ],
  ] as const)(
    'rejects completed source recovery with %s',
    (_case, activeOperationId, handoffOverrides) => {
      const store = usePresentationStore();
      store.hydrateWorkerChannel(
        workerChannel({
          order: '60',
          generation: 6,
          workerType: EWorkerType.baileys,
          status: EWorkerStatus.recreating,
          lifecycleOperationId: activeOperationId,
          recreatePhase: EWorkerRecreatePhase.connecting,
          recreatePhaseObservedAt: '2026-08-08T03:02:00.000Z',
        })
      );
      expect(
        store.reconcileProviderHandoffSourceRecovery(
          workerChannel({
            order: '61',
            generation: 6,
            workerType: EWorkerType.wwebjs,
            status: EWorkerStatus.online,
            observedAt: '2026-08-08T03:04:00.000Z',
            nativeChangedAt: '2026-08-08T03:04:00.000Z',
            lifecycleOperationId: null,
          }),
          sourceRecoveryHandoff(handoffOverrides)
        )
      ).toBeNull();
    }
  );

  it('records an idempotent terminal recovery fence after a fresh online hydration', () => {
    const store = usePresentationStore();
    const recovered = workerChannel({
      order: '61',
      generation: 6,
      workerType: EWorkerType.wwebjs,
      status: EWorkerStatus.online,
      observedAt: '2026-08-08T03:04:00.000Z',
      nativeChangedAt: '2026-08-08T03:04:00.000Z',
      lifecycleOperationId: null,
    });
    store.hydrateWorkerChannel(recovered);

    expect(
      store.reconcileProviderHandoffSourceRecovery(
        recovered,
        sourceRecoveryHandoff()
      )
    ).toMatchObject({
      releasedOperationId: null,
      terminalOperationId: operationId,
    });
    expect(
      store.providerHandoffSourceRecoveryByWorkerId[workerId]
    ).toMatchObject({ terminalOperationId: operationId });
    expect(descriptor(store.snapshot(workerId)).text).toBe('channel_connected');
  });

  it('accepts an F5 source-restored active lifecycle at the same order only after its durable phase', () => {
    const store = usePresentationStore();
    store.hydrateWorkerChannel(
      workerChannel({
        order: '61',
        generation: 6,
        workerType: EWorkerType.wwebjs,
        status: EWorkerStatus.online,
        acknowledged: true,
        observedAt: '2026-08-08T03:03:00.000Z',
        nativeChangedAt: '2026-08-08T03:03:00.000Z',
        lifecycleOperationId: operationId,
        recreatePhase: EWorkerRecreatePhase.connecting,
        recreatePhaseObservedAt: '2026-08-08T03:02:00.000Z',
      })
    );
    expect(
      store.snapshot(workerId)?.recreateBaselineConnectionStatusOrder
    ).toBeNull();

    expect(
      store.reconcileProviderHandoffSourceRecovery(
        workerChannel({
          order: '61',
          generation: 6,
          workerType: EWorkerType.wwebjs,
          status: EWorkerStatus.online,
          acknowledged: true,
          observedAt: '2026-08-08T03:04:00.000Z',
          nativeChangedAt: '2026-08-08T03:04:00.000Z',
          lifecycleOperationId: null,
        }),
        sourceRecoveryHandoff()
      )
    ).toMatchObject({
      releasedOperationId: operationId,
      terminalOperationId: operationId,
    });
    expect(store.snapshot(workerId)).toMatchObject({
      lifecycleOperationId: null,
      recreatePhase: null,
      connectionStatusOrder: '61',
      connectionStatusObservedAt: '2026-08-08T03:04:00.000Z',
    });
  });

  it('requires a strictly newer order when an explicit recreate baseline exists', () => {
    const store = usePresentationStore();
    store.hydrateWorkerChannel(
      workerChannel({
        order: '60',
        generation: 5,
        workerType: EWorkerType.wwebjs,
        status: EWorkerStatus.online,
        acknowledged: true,
      })
    );
    expect(
      store.applyRealtimeEvent(
        runtimeStartedEvent({ operationId, generation: 6 })
      )
    ).toBe(true);
    expect(
      store.applyRealtimeEvent({
        ...nativeRealtimeEvent({
          order: '62',
          generation: 6,
          workerType: EWorkerType.wwebjs,
          acknowledged: true,
          observedAt: '2026-08-08T03:03:00.000Z',
          nativeChangedAt: '2026-08-08T03:03:00.000Z',
          lifecycleOperationId: operationId,
          recreatePhase: EWorkerRecreatePhase.connecting,
          recreatePhaseObservedAt: '2026-08-08T03:01:00.000Z',
        }),
        worker_status_id: EWorkerStatus.online,
      })
    ).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      workerTypeId: EWorkerType.wwebjs,
      workerStatusId: EWorkerStatus.recreating,
      connectionStatus: EWhatsappConnectionStatus.online,
      connectionOnlineAcknowledged: true,
      connectionStatusOrder: '62',
      recreateBaselineConnectionStatusOrder: '60',
    });

    expect(
      store.reconcileProviderHandoffSourceRecovery(
        workerChannel({
          order: '61',
          generation: 6,
          workerType: EWorkerType.wwebjs,
          status: EWorkerStatus.online,
          acknowledged: true,
          observedAt: '2026-08-08T03:04:00.000Z',
          nativeChangedAt: '2026-08-08T03:04:00.000Z',
          lifecycleOperationId: null,
        }),
        sourceRecoveryHandoff()
      )
    ).toBeNull();
    expect(store.snapshot(workerId)).toMatchObject({
      lifecycleOperationId: operationId,
      connectionStatusOrder: '62',
      recreateBaselineConnectionStatusOrder: '60',
    });
  });

  it.each([operationId, resolutionOperationId])(
    'heals F5 source ONLINE after a late same-generation manager start for completed return operation %s',
    (lateOperationId) => {
      const store = usePresentationStore();
      store.hydrateWorkerChannel(
        workerChannel({
          order: '61',
          generation: 6,
          workerType: EWorkerType.wwebjs,
          status: EWorkerStatus.online,
          acknowledged: true,
          observedAt: '2026-08-08T03:03:00.000Z',
          nativeChangedAt: '2026-08-08T03:03:00.000Z',
          lifecycleOperationId: null,
        })
      );
      expect(
        store.applyRealtimeEvent({
          ...managerStartEvent({
            operationId: lateOperationId,
            generation: 6,
            workerType: EWorkerType.baileys,
            previousWorkerType: EWorkerType.wwebjs,
          }),
          connection_status_observed_at: '2026-08-08T03:03:30.000Z',
        })
      ).toBe(true);
      expect(store.snapshot(workerId)).toMatchObject({
        lifecycleOperationId: lateOperationId,
        recreateBaselineConnectionStatusOrder: '61',
        connectionStatus: null,
        connectionOnlineAcknowledged: false,
      });

      expect(
        store.reconcileProviderHandoffSourceRecovery(
          workerChannel({
            order: '61',
            generation: 6,
            workerType: EWorkerType.wwebjs,
            status: EWorkerStatus.online,
            acknowledged: true,
            observedAt: '2026-08-08T03:04:00.000Z',
            nativeChangedAt: '2026-08-08T03:04:00.000Z',
            lifecycleOperationId: null,
          }),
          sourceRecoveryHandoff({
            resolution_required: false,
            resolution_status: 'completed',
            resolution_action: 'return',
            resolution_state: 'completed',
            resolution_operation_id: resolutionOperationId,
          })
        )
      ).toMatchObject({
        releasedOperationId: lateOperationId,
        terminalOperationId: resolutionOperationId,
        operationIds: [operationId, resolutionOperationId],
      });
      expect(store.snapshot(workerId)).toMatchObject({
        workerTypeId: EWorkerType.wwebjs,
        workerStatusId: EWorkerStatus.online,
        connectionStatus: EWhatsappConnectionStatus.online,
        connectionOnlineAcknowledged: true,
        connectionStatusOrder: '61',
        lifecycleOperationId: null,
        recreatePhase: null,
      });
      expect(
        store.providerHandoffSourceRecoveryByWorkerId[workerId]
      ).toMatchObject({ terminalOperationId: resolutionOperationId });
      expect(
        store.applyRealtimeEvent({
          ...managerStartEvent({
            operationId: lateOperationId,
            generation: 6,
            workerType: EWorkerType.baileys,
            previousWorkerType: EWorkerType.wwebjs,
          }),
          connection_status_observed_at: '2026-08-08T03:05:00.000Z',
        })
      ).toBe(false);
      expect(descriptor(store.snapshot(workerId)).text).toBe(
        'channel_connected'
      );
    }
  );

  it('keeps failed-handoff recovery terminal against late HTTP and every manager envelope, then accepts a newer operation', () => {
    const store = usePresentationStore();
    store.hydrateWorkerChannel(
      workerChannel({
        order: '60',
        generation: 5,
        workerType: EWorkerType.wwebjs,
      })
    );
    expect(store.applyRealtimeEvent(runtimeStartedEvent())).toBe(true);
    expect(
      store.reconcileProviderHandoffSourceRecovery(
        workerChannel({
          order: '61',
          generation: 6,
          workerType: EWorkerType.wwebjs,
          status: EWorkerStatus.online,
          observedAt: '2026-08-08T03:04:00.000Z',
          nativeChangedAt: '2026-08-08T03:04:00.000Z',
          lifecycleOperationId: null,
        }),
        sourceRecoveryHandoff()
      )
    ).not.toBeNull();

    expect(
      store.hydrateWorkerChannel(
        workerChannel({
          order: '60',
          generation: 6,
          workerType: EWorkerType.baileys,
          status: EWorkerStatus.recreating,
          lifecycleOperationId: operationId,
          recreatePhase: EWorkerRecreatePhase.connecting,
        })
      )
    ).toBe(false);
    expect(store.applyRealtimeEvent(managerStartEvent())).toBe(false);
    expect(
      store.applyRealtimeEvent(
        runtimeStartedEvent({ operationId, generation: 7 })
      )
    ).toBe(false);
    expect(
      store.applyRealtimeEvent(
        runtimeRetiredEvent({ operationId, generation: 7 })
      )
    ).toBe(false);
    expect(
      store.applyRealtimeEvent(terminalEvent({ operationId, generation: 7 }))
    ).toBe(false);
    expect(descriptor(store.snapshot(workerId)).text).toBe('channel_connected');

    expect(
      store.applyRealtimeEvent(
        managerStartEvent({ operationId: nextOperationId, generation: 6 })
      )
    ).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      lifecycleOperationId: nextOperationId,
      workerStatusId: EWorkerStatus.recreating,
    });
  });

  it('keeps an accepted initial creation as creating and releases it from the exact terminal HTTP snapshot without a recreate tombstone', () => {
    const store = usePresentationStore();

    expect(
      store.applyAcceptedCreateAck({
        code: 202,
        status: 'queued',
        queued: true,
        worker_id: workerId,
        account_id: accountId,
        server_id: 'server-1',
        worker_type_id: EWorkerType.whatsmeow,
        worker_status_id: EWorkerStatus.creating,
        operation_id: operationId,
        reason: 'create_queued',
        runtime_generation: 1,
        session_storage: 'postgres',
      })
    ).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      workerStatusId: EWorkerStatus.creating,
      sessionIdentityPresent: false,
      lifecycleOperationId: operationId,
      recreatePhase: null,
      source: 'create_ack',
    });

    expect(
      store.hydrateWorkerChannel(
        workerChannel({
          order: '1',
          generation: 1,
          workerType: EWorkerType.whatsmeow,
          status: EWorkerStatus.creating,
          lifecycleOperationId: operationId,
        })
      )
    ).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      workerStatusId: EWorkerStatus.creating,
      lifecycleOperationId: operationId,
      recreatePhase: null,
    });
    expect(descriptor(store.snapshot(workerId)).text).toBe('creating');

    expect(
      store.hydrateWorkerChannel(
        workerChannel({
          order: '2',
          generation: 1,
          workerType: EWorkerType.whatsmeow,
          status: EWorkerStatus.disponible,
          lifecycleOperationId: null,
          acknowledged: false,
          native: EWhatsappConnectionStatus.offline,
          observedAt: '2026-08-08T03:02:00.000Z',
        })
      )
    ).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      workerStatusId: EWorkerStatus.disponible,
      lifecycleOperationId: null,
      recreatePhase: null,
    });
    expect(store.initialCreationOperationByWorkerId[workerId]).toBeUndefined();
    expect(descriptor(store.snapshot(workerId)).text).toBe('awaiting_qr_code');
  });

  it('projects three queued recreate ACKs in the same render turn, including two recovered-handoff workers', () => {
    const store = usePresentationStore();
    const inputs = [
      {
        workerId: '019fd752-2c52-74fa-8924-a6e8f7d7df97',
        workerType: EWorkerType.baileys,
        operationId: '019fe400-0000-7000-8000-000000000001',
      },
      {
        workerId: '019fd88a-2894-739b-9471-cd3502f648df',
        workerType: EWorkerType.wwebjs,
        operationId: '019fe400-0000-7000-8000-000000000002',
      },
      {
        workerId: '019fdf3a-ab05-753d-be9a-c3fedc4f7a92',
        workerType: EWorkerType.whatsmeow,
        operationId: '019fe400-0000-7000-8000-000000000003',
      },
    ] as const;

    for (const [index, input] of inputs.entries()) {
      store.hydrateWorkerChannel({
        ...workerChannel({
          order: String(70 + index),
          generation: 6,
          workerType: input.workerType,
          status: EWorkerStatus.online,
        }),
        id: input.workerId,
      });
      if (index < 2) {
        store.providerHandoffSourceRecoveryByWorkerId[input.workerId] = {
          releasedOperationId: null,
          terminalOperationId: resolutionOperationId,
          operationIds: [operationId, resolutionOperationId],
          runtimeGeneration: 6,
          observedAt: '2026-08-08T03:04:00.000Z',
        };
      }
    }

    expect(
      inputs.map((input) =>
        store.applyAcceptedRecreateAck({
          code: 202,
          status: 'queued',
          queued: true,
          worker_id: input.workerId,
          account_id: accountId,
          server_id: 'server-1',
          worker_type_id: input.workerType,
          worker_status_id: EWorkerStatus.recreating,
          operation_id: input.operationId,
          reason: 'recreate_queued',
          runtime_generation: 6,
        })
      )
    ).toEqual([true, true, true]);

    for (const input of inputs) {
      expect(store.snapshot(input.workerId)).toMatchObject({
        workerId: input.workerId,
        workerTypeId: input.workerType,
        workerStatusId: EWorkerStatus.recreating,
        lifecycleOperationId: input.operationId,
        recreatePhase: EWorkerRecreatePhase.recreating,
        connectionStatus: null,
        connectionOnlineAcknowledged: false,
      });
      expect(descriptor(store.snapshot(input.workerId))).toMatchObject({
        color: EColor.warning,
        text: 'recreating',
        online: false,
      });
    }

    const secondWorker = inputs[1];
    expect(
      store.applyAcceptedRecreateAck({
        code: 202,
        status: 'queued',
        queued: true,
        worker_id: secondWorker.workerId,
        account_id: accountId,
        server_id: 'server-1',
        worker_type_id: secondWorker.workerType,
        worker_status_id: EWorkerStatus.recreating,
        operation_id: '019fe3ff-ffff-7fff-8fff-ffffffffffff',
        reason: 'delayed_recreate_queued',
        runtime_generation: 6,
      })
    ).toBe(false);
    expect(store.snapshot(secondWorker.workerId)?.lifecycleOperationId).toBe(
      secondWorker.operationId
    );

    expect(
      store.applyRealtimeEvent(
        managerStartEvent({
          operationId,
          generation: 6,
          workerType: EWorkerType.baileys,
          previousWorkerType: EWorkerType.wwebjs,
        })
      )
    ).toBe(false);
  });

  it('rejects a recreate ACK from an older runtime generation and a divergent provider ACK', () => {
    const store = usePresentationStore();
    store.hydrateWorkerChannel(
      workerChannel({
        order: '75',
        generation: 2,
        workerType: EWorkerType.wwebjs,
        status: EWorkerStatus.online,
      })
    );

    expect(
      store.applyAcceptedRecreateAck({
        code: 202,
        status: 'queued',
        queued: true,
        worker_id: workerId,
        account_id: accountId,
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.recreating,
        operation_id: operationId,
        reason: 'recreate_queued',
        runtime_generation: 1,
      })
    ).toBe(false);
    expect(store.snapshot(workerId)).toMatchObject({
      workerTypeId: EWorkerType.wwebjs,
      workerStatusId: EWorkerStatus.online,
      runtimeGeneration: 2,
      lifecycleOperationId: null,
    });

    setActivePinia(createPinia());
    const divergentStore = usePresentationStore();
    divergentStore.hydrateWorkerChannel(
      workerChannel({
        order: '76',
        generation: 2,
        workerType: EWorkerType.wwebjs,
        status: EWorkerStatus.online,
      })
    );
    expect(
      divergentStore.applyAcceptedRecreateAck({
        code: 202,
        status: 'queued',
        queued: true,
        worker_id: workerId,
        account_id: accountId,
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.recreating,
        operation_id: operationId,
        reason: 'stale_provider_recreate_queued',
        runtime_generation: 2,
      })
    ).toBe(false);
    expect(divergentStore.snapshot(workerId)?.workerStatusId).toBe(
      EWorkerStatus.online
    );
  });

  it.each(['malformed', operationId])(
    'rejects source recovery while the raw worker GET still carries lifecycle %s',
    (rawLifecycleOperationId) => {
      const store = usePresentationStore();
      store.hydrateWorkerChannel(
        workerChannel({
          order: '60',
          generation: 5,
          workerType: EWorkerType.wwebjs,
        })
      );
      store.applyRealtimeEvent(runtimeStartedEvent());
      expect(
        store.reconcileProviderHandoffSourceRecovery(
          workerChannel({
            order: '61',
            generation: 6,
            workerType: EWorkerType.wwebjs,
            status: EWorkerStatus.online,
            observedAt: '2026-08-08T03:04:00.000Z',
            lifecycleOperationId: rawLifecycleOperationId,
          }),
          sourceRecoveryHandoff()
        )
      ).toBeNull();
    }
  );

  it('rejects source recovery without a positive current runtime generation', () => {
    const store = usePresentationStore();
    store.hydrateWorkerChannel({
      ...workerChannel({
        order: '60',
        generation: 6,
        workerType: EWorkerType.baileys,
        status: EWorkerStatus.recreating,
        lifecycleOperationId: operationId,
        recreatePhase: EWorkerRecreatePhase.connecting,
      }),
      runtime_generation: null,
    });
    expect(
      store.reconcileProviderHandoffSourceRecovery(
        workerChannel({
          order: '61',
          generation: 6,
          workerType: EWorkerType.wwebjs,
          status: EWorkerStatus.online,
          observedAt: '2026-08-08T03:04:00.000Z',
          lifecycleOperationId: null,
        }),
        sourceRecoveryHandoff()
      )
    ).toBeNull();
  });

  it('uses observedAt to revoke ACK without allowing an older HTTP replay', () => {
    const store = usePresentationStore();
    expect(
      store.hydrateWorkerChannel(
        workerChannel({
          order: '20',
          generation: 5,
          acknowledged: true,
          observedAt: '2026-08-08T03:00:10.000Z',
        })
      )
    ).toBe(true);
    expect(
      store.hydrateWorkerChannel(
        workerChannel({
          order: '20',
          generation: 5,
          acknowledged: false,
          observedAt: '2026-08-08T03:00:09.000Z',
        })
      )
    ).toBe(true);
    expect(store.snapshot(workerId)?.connectionOnlineAcknowledged).toBe(true);

    expect(
      store.hydrateWorkerChannel(
        workerChannel({
          order: '20',
          generation: 5,
          acknowledged: false,
          observedAt: '2026-08-08T03:00:11.000Z',
        })
      )
    ).toBe(true);
    expect(store.snapshot(workerId)?.connectionOnlineAcknowledged).toBe(false);
    expect(descriptor(store.snapshot(workerId))).toMatchObject({
      color: EColor.success,
      text: 'channel_connected',
      online: true,
    });
  });

  it('advances one exact recreate G to G+1 and keeps both UI colors canonical', () => {
    const store = usePresentationStore();
    store.hydrateWorkerChannel(workerChannel({ order: '30', generation: 5 }));
    const started = buildManagerWorkerRecreatingStatusEvent(
      {
        action: EWorkerAction.recreate,
        worker_id: workerId,
        server_id: 'server-1',
        account_id: accountId,
        worker_type_id: EWorkerType.baileys,
        previous_worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: operationId,
      },
      5
    );
    expect(store.applyRealtimeEvent(started)).toBe(true);
    expect(descriptor(store.snapshot(workerId))).toMatchObject({
      color: EColor.warning,
      text: 'recreating',
    });

    const runtimeStarted = buildManagerWorkerRecreateRuntimeStartedStatusEvent(
      {
        action: EWorkerAction.recreate,
        worker_id: workerId,
        server_id: 'server-1',
        account_id: accountId,
        worker_type_id: EWorkerType.baileys,
        previous_worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: operationId,
      },
      6,
      '2026-08-08T03:01:00.000Z'
    );
    expect(store.applyRealtimeEvent(runtimeStarted)).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      workerTypeId: EWorkerType.baileys,
      runtimeGeneration: 6,
      recreatePhase: EWorkerRecreatePhase.connecting,
    });
    expect(descriptor(store.snapshot(workerId))).toMatchObject({
      color: EColor.info,
      text: 'connecting',
    });

    expect(store.applyRealtimeEvent(started)).toBe(true);
    expect(store.snapshot(workerId)?.recreatePhase).toBe(
      EWorkerRecreatePhase.connecting
    );
    expect(
      store.applyRealtimeEvent(
        nativeRealtimeEvent({ order: '31', generation: 5 })
      )
    ).toBe(false);
    expect(
      store.applyRealtimeEvent(
        nativeRealtimeEvent({
          order: '31',
          generation: 6,
          workerType: EWorkerType.baileys,
          acknowledged: true,
          lifecycleOperationId: operationId,
          recreatePhase: EWorkerRecreatePhase.connecting,
        })
      )
    ).toBe(true);

    const completed = buildManagerWorkerRecreateTerminalStatusEvent(
      {
        action: EWorkerAction.recreate,
        worker_id: workerId,
        server_id: 'server-1',
        account_id: accountId,
        worker_type_id: EWorkerType.baileys,
        previous_worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: operationId,
      },
      6,
      EWorkerStatus.online,
      completedAt
    );
    expect(store.applyRealtimeEvent(completed)).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      workerTypeId: EWorkerType.baileys,
      workerStatusId: EWorkerStatus.online,
      runtimeGeneration: 6,
      lifecycleOperationId: null,
      completedLifecycleOperationId: operationId,
      completedLifecycleRuntimeGeneration: 6,
      completedLifecycleAt: completedAt,
      connectionOnlineAcknowledged: true,
    });
    expect(descriptor(store.snapshot(workerId))).toMatchObject({
      color: EColor.success,
      text: 'channel_connected',
      online: true,
    });
    expect(store.applyRealtimeEvent(started)).toBe(false);
  });

  it('orders exact runtime retirement irreversibly and rejects late native/manager replays', () => {
    const store = usePresentationStore();
    store.hydrateWorkerChannel(workerChannel({ order: '30', generation: 5 }));
    const started = {
      ...buildManagerWorkerRecreatingStatusEvent(
        {
          action: EWorkerAction.recreate,
          worker_id: workerId,
          server_id: 'server-1',
          account_id: accountId,
          worker_type_id: EWorkerType.baileys,
          previous_worker_type_id: EWorkerType.wwebjs,
          lifecycle_operation_id: operationId,
        },
        5
      ),
      connection_status_observed_at: '2099-08-08T03:00:00.000Z',
    };
    expect(store.applyRealtimeEvent(started)).toBe(true);
    expect(store.snapshot(workerId)?.recreatePhaseObservedAt).toBeNull();

    const runtimeStarted = runtimeStartedEvent({
      observedAt: '2026-08-08T03:01:00.000Z',
    });
    expect(store.applyRealtimeEvent(runtimeStarted)).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      recreatePhase: EWorkerRecreatePhase.connecting,
      recreatePhaseObservedAt: '2026-08-08T03:01:00.000Z',
      recreateRuntimeRetired: false,
    });

    const retired = runtimeRetiredEvent({
      observedAt: '2026-08-08T03:02:00.000Z',
    });
    expect(store.applyRealtimeEvent(retired)).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      recreatePhase: EWorkerRecreatePhase.recreating,
      recreatePhaseObservedAt: '2026-08-08T03:02:00.000Z',
      recreateRuntimeRetired: true,
      connectionOnlineAcknowledged: false,
    });
    expect(descriptor(store.snapshot(workerId))).toMatchObject({
      color: EColor.warning,
      text: 'recreating',
      online: false,
    });

    expect(store.applyRealtimeEvent(runtimeStarted)).toBe(false);
    expect(
      store.applyRealtimeEvent(
        runtimeStartedEvent({ observedAt: '2099-08-08T03:03:00.000Z' })
      )
    ).toBe(false);
    expect(
      store.applyRealtimeEvent(
        nativeRealtimeEvent({
          order: '31',
          generation: 6,
          workerType: EWorkerType.baileys,
          lifecycleOperationId: operationId,
          recreatePhase: EWorkerRecreatePhase.connecting,
          recreatePhaseObservedAt: '2026-08-08T03:01:00.000Z',
        })
      )
    ).toBe(false);
    expect(
      store.applyRealtimeEvent(
        nativeRealtimeEvent({
          order: '32',
          generation: 6,
          workerType: EWorkerType.baileys,
          lifecycleOperationId: operationId,
          recreatePhase: EWorkerRecreatePhase.recreating,
          recreatePhaseObservedAt: '2026-08-08T03:02:00.000Z',
          recreateRuntimeRetired: true,
        })
      )
    ).toBe(true);

    expect(
      store.hydrateWorkerChannel(
        workerChannel({
          order: '33',
          generation: 6,
          workerType: EWorkerType.baileys,
          status: EWorkerStatus.recreating,
          lifecycleOperationId: operationId,
          recreatePhase: EWorkerRecreatePhase.recreating,
        })
      )
    ).toBe(false);
    expect(
      store.hydrateWorkerChannel(
        workerChannel({
          order: '33',
          generation: 6,
          workerType: EWorkerType.baileys,
          status: EWorkerStatus.recreating,
          lifecycleOperationId: operationId,
          recreatePhase: EWorkerRecreatePhase.recreating,
          recreatePhaseObservedAt: '2026-08-08T03:02:00.000Z',
          recreateRuntimeRetired: true,
        })
      )
    ).toBe(true);

    expect(
      store.hydrateWorkerChannel(
        workerChannel({
          order: '34',
          generation: 7,
          workerType: EWorkerType.baileys,
          status: EWorkerStatus.recreating,
          lifecycleOperationId: operationId,
          recreatePhase: EWorkerRecreatePhase.recreating,
        })
      )
    ).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      runtimeGeneration: 7,
      recreatePhase: EWorkerRecreatePhase.recreating,
      recreatePhaseObservedAt: null,
      recreateRuntimeRetired: false,
    });
  });

  it('lets exact database markers dominate an equal-millisecond initial phase', () => {
    const store = usePresentationStore();
    store.hydrateWorkerChannel(
      workerChannel({
        order: '35',
        generation: 6,
        workerType: EWorkerType.baileys,
        status: EWorkerStatus.recreating,
        lifecycleOperationId: operationId,
        recreatePhase: EWorkerRecreatePhase.recreating,
        recreatePhaseObservedAt: '2026-08-08T03:01:00.000Z',
      })
    );
    expect(
      store.applyRealtimeEvent(
        runtimeStartedEvent({ observedAt: '2026-08-08T03:01:00.000Z' })
      )
    ).toBe(true);
    expect(
      store.applyRealtimeEvent(
        runtimeRetiredEvent({ observedAt: '2026-08-08T03:01:00.000Z' })
      )
    ).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      recreatePhase: EWorkerRecreatePhase.recreating,
      recreatePhaseObservedAt: '2026-08-08T03:01:00.000Z',
      recreateRuntimeRetired: true,
    });
  });

  it('requires the exact durable HTTP tombstone to release a same-generation reload fence', () => {
    const store = usePresentationStore();
    store.hydrateWorkerChannel(
      workerChannel({
        order: '40',
        generation: 5,
        status: EWorkerStatus.recreating,
        acknowledged: false,
        lifecycleOperationId: operationId,
        recreatePhase: EWorkerRecreatePhase.recreating,
      })
    );

    expect(
      store.hydrateWorkerChannel(
        workerChannel({
          order: '40',
          generation: 6,
          workerType: EWorkerType.baileys,
          status: EWorkerStatus.recreating,
          acknowledged: false,
          lifecycleOperationId: operationId,
          recreatePhase: EWorkerRecreatePhase.connecting,
        })
      )
    ).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      runtimeGeneration: 6,
      workerTypeId: EWorkerType.baileys,
      recreatePhase: EWorkerRecreatePhase.connecting,
    });

    expect(
      store.hydrateWorkerChannel(
        workerChannel({
          order: '41',
          generation: 6,
          workerType: EWorkerType.baileys,
          status: EWorkerStatus.online,
          lifecycleOperationId: null,
        })
      )
    ).toBe(false);
    expect(store.snapshot(workerId)?.lifecycleOperationId).toBe(operationId);

    expect(
      store.hydrateWorkerChannel(
        workerChannel({
          order: '41',
          generation: 6,
          workerType: EWorkerType.baileys,
          status: EWorkerStatus.online,
          lifecycleOperationId: null,
          completedOperationId: operationId,
          completedGeneration: 6,
          completedAt,
        })
      )
    ).toBe(true);
    expect(store.snapshot(workerId)?.lifecycleOperationId).toBeNull();

    const staleStarted = buildManagerWorkerRecreatingStatusEvent(
      {
        action: EWorkerAction.recreate,
        worker_id: workerId,
        server_id: 'server-1',
        account_id: accountId,
        worker_type_id: EWorkerType.baileys,
        lifecycle_operation_id: olderOperationId,
      },
      6
    );
    expect(store.applyRealtimeEvent(staleStarted)).toBe(false);
  });

  it('accepts an exact UUIDv4 recovery lifecycle without ordering unrelated UUIDv4 ids', () => {
    const store = usePresentationStore();
    store.hydrateWorkerChannel(
      workerChannel({
        order: '45',
        generation: 5,
        status: EWorkerStatus.recreating,
        acknowledged: false,
        lifecycleOperationId: recoveryOperationId,
        recreatePhase: EWorkerRecreatePhase.recreating,
      })
    );

    const unrelated = buildManagerWorkerRecreatingStatusEvent(
      {
        action: EWorkerAction.recreate,
        worker_id: workerId,
        server_id: 'server-1',
        account_id: accountId,
        worker_type_id: EWorkerType.baileys,
        previous_worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: unrelatedRecoveryOperationId,
      },
      5
    );
    expect(store.applyRealtimeEvent(unrelated)).toBe(false);

    const runtimeStarted = buildManagerWorkerRecreateRuntimeStartedStatusEvent(
      {
        action: EWorkerAction.recreate,
        worker_id: workerId,
        server_id: 'server-1',
        account_id: accountId,
        worker_type_id: EWorkerType.baileys,
        previous_worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: recoveryOperationId,
      },
      6,
      '2026-08-08T03:01:00.000Z'
    );
    expect(store.applyRealtimeEvent(runtimeStarted)).toBe(true);
    expect(descriptor(store.snapshot(workerId))).toMatchObject({
      color: EColor.info,
      text: 'connecting',
    });

    const completed = buildManagerWorkerRecreateTerminalStatusEvent(
      {
        action: EWorkerAction.recreate,
        worker_id: workerId,
        server_id: 'server-1',
        account_id: accountId,
        worker_type_id: EWorkerType.baileys,
        previous_worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: recoveryOperationId,
      },
      6,
      EWorkerStatus.online,
      completedAt
    );
    expect(store.applyRealtimeEvent(completed)).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      lifecycleOperationId: null,
      completedLifecycleOperationId: recoveryOperationId,
      completedLifecycleRuntimeGeneration: 6,
      completedLifecycleAt: completedAt,
    });
  });

  it('requires an exact prior tombstone before replacing one UUIDv4 HTTP lifecycle with another', () => {
    const store = usePresentationStore();
    store.hydrateWorkerChannel(
      workerChannel({
        order: '46',
        generation: 5,
        status: EWorkerStatus.recreating,
        lifecycleOperationId: recoveryOperationId,
        recreatePhase: EWorkerRecreatePhase.connecting,
      })
    );

    expect(
      store.hydrateWorkerChannel(
        workerChannel({
          order: '47',
          generation: 6,
          status: EWorkerStatus.recreating,
          lifecycleOperationId: unrelatedRecoveryOperationId,
          recreatePhase: EWorkerRecreatePhase.recreating,
        })
      )
    ).toBe(false);
    expect(store.snapshot(workerId)?.lifecycleOperationId).toBe(
      recoveryOperationId
    );

    expect(
      store.hydrateWorkerChannel(
        workerChannel({
          order: '47',
          generation: 6,
          status: EWorkerStatus.recreating,
          lifecycleOperationId: unrelatedRecoveryOperationId,
          recreatePhase: EWorkerRecreatePhase.recreating,
          completedOperationId: recoveryOperationId,
          completedGeneration: 5,
          completedAt,
        })
      )
    ).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      lifecycleOperationId: unrelatedRecoveryOperationId,
      completedLifecycleOperationId: recoveryOperationId,
      completedLifecycleRuntimeGeneration: 5,
      completedLifecycleAt: completedAt,
    });
  });

  it('establishes a missed runtime_started only from a verifiable G to G+1 UUIDv7 baseline', () => {
    const createBaselineStore = (input?: {
      completedOperationId?: string;
      completedGeneration?: number;
      completedAt?: string;
    }) => {
      setActivePinia(createPinia());
      const store = usePresentationStore();
      store.hydrateDashboardChannelStatus(dashboardChannelStatus(input));
      return store;
    };

    const acceptedStore = createBaselineStore({
      completedOperationId: olderOperationId,
      completedGeneration: 5,
      completedAt: '2026-08-08T02:59:00.000Z',
    });
    expect(acceptedStore.applyRealtimeEvent(runtimeStartedEvent())).toBe(true);
    expect(acceptedStore.snapshot(workerId)).toMatchObject({
      workerTypeId: EWorkerType.baileys,
      workerStatusId: EWorkerStatus.recreating,
      runtimeGeneration: 6,
      lifecycleOperationId: operationId,
      recreatePhase: EWorkerRecreatePhase.connecting,
    });
    expect(descriptor(acceptedStore.snapshot(workerId))).toMatchObject({
      color: EColor.info,
      text: 'connecting',
      online: false,
    });

    setActivePinia(createPinia());
    expect(
      usePresentationStore().applyRealtimeEvent(runtimeStartedEvent())
    ).toBe(false);

    expect(
      createBaselineStore().applyRealtimeEvent(
        runtimeStartedEvent({ operationId: recoveryOperationId })
      )
    ).toBe(false);
    expect(
      createBaselineStore().applyRealtimeEvent(
        runtimeStartedEvent({ generation: 5 })
      )
    ).toBe(false);
    expect(
      createBaselineStore().applyRealtimeEvent(
        runtimeStartedEvent({ generation: 4 })
      )
    ).toBe(false);
    expect(
      createBaselineStore().applyRealtimeEvent(
        runtimeStartedEvent({ previousWorkerType: EWorkerType.whatsmeow })
      )
    ).toBe(false);
    expect(
      createBaselineStore({
        completedOperationId: operationId,
        completedGeneration: 5,
        completedAt: '2026-08-08T02:59:00.000Z',
      }).applyRealtimeEvent(
        runtimeStartedEvent({ operationId: olderOperationId })
      )
    ).toBe(false);
  });

  it('accepts a self-contained terminal after missed lifecycle events only with complete ordered proof', () => {
    const createBaselineStore = (input?: {
      completedOperationId?: string;
      completedGeneration?: number;
      completedAt?: string;
    }) => {
      setActivePinia(createPinia());
      const store = usePresentationStore();
      store.hydrateDashboardChannelStatus(dashboardChannelStatus(input));
      return store;
    };

    const onlineStore = createBaselineStore({
      completedOperationId: olderOperationId,
      completedGeneration: 5,
      completedAt: '2026-08-08T02:59:00.000Z',
    });
    expect(onlineStore.applyRealtimeEvent(terminalEvent())).toBe(true);
    expect(descriptor(onlineStore.snapshot(workerId))).toMatchObject({
      color: EColor.success,
      text: 'channel_connected',
      online: true,
    });

    const disponibleStore = createBaselineStore();
    expect(
      disponibleStore.applyRealtimeEvent(
        terminalEvent({ workerStatus: EWorkerStatus.disponible })
      )
    ).toBe(true);
    expect(descriptor(disponibleStore.snapshot(workerId))).toMatchObject({
      color: EColor.warning,
      text: 'awaiting_qr_code',
      online: false,
    });

    setActivePinia(createPinia());
    expect(usePresentationStore().applyRealtimeEvent(terminalEvent())).toBe(
      false
    );
    expect(
      createBaselineStore().applyRealtimeEvent(
        terminalEvent({ operationId: recoveryOperationId })
      )
    ).toBe(false);
    expect(
      createBaselineStore().applyRealtimeEvent(terminalEvent({ generation: 5 }))
    ).toBe(false);
    expect(
      createBaselineStore().applyRealtimeEvent(
        terminalEvent({ completedAt: '2026-08-08T03:00:00.000Z' })
      )
    ).toBe(false);
    expect(
      createBaselineStore().applyRealtimeEvent(
        terminalEvent({ previousWorkerType: EWorkerType.whatsmeow })
      )
    ).toBe(false);
    expect(
      createBaselineStore({
        completedOperationId: operationId,
        completedGeneration: 5,
        completedAt: '2026-08-08T02:59:00.000Z',
      }).applyRealtimeEvent(terminalEvent({ operationId: olderOperationId }))
    ).toBe(false);

    const mismatchedSelfTombstone = terminalEvent();
    mismatchedSelfTombstone.recreate_completed_operation_id = olderOperationId;
    expect(
      createBaselineStore().applyRealtimeEvent(mismatchedSelfTombstone)
    ).toBe(false);
  });

  it('keeps effective OFFLINE lifecycle hydration and fences native events around terminal time', () => {
    const store = usePresentationStore();
    expect(
      store.hydrateWorkerChannel(
        workerChannel({
          order: '70',
          generation: 5,
          status: EWorkerStatus.offline,
          acknowledged: false,
          lifecycleOperationId: operationId,
          recreatePhase: EWorkerRecreatePhase.connecting,
        })
      )
    ).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      workerStatusId: EWorkerStatus.offline,
      lifecycleOperationId: operationId,
      recreatePhase: EWorkerRecreatePhase.connecting,
    });
    expect(descriptor(store.snapshot(workerId))).toMatchObject({
      color: EColor.error,
      text: 'offline',
      online: false,
    });

    expect(store.applyRealtimeEvent(runtimeStartedEvent())).toBe(true);
    expect(store.applyRealtimeEvent(terminalEvent())).toBe(true);
    expect(
      store.hydrateWorkerChannel(
        workerChannel({
          order: '71',
          generation: 6,
          workerType: EWorkerType.baileys,
          status: EWorkerStatus.offline,
          acknowledged: false,
          observedAt: '2026-08-08T03:04:59.000Z',
        })
      )
    ).toBe(false);
    expect(store.snapshot(workerId)?.workerStatusId).toBe(EWorkerStatus.online);
    expect(
      store.applyRealtimeEvent(
        nativeRealtimeEvent({
          order: '71',
          generation: 6,
          workerType: EWorkerType.baileys,
          observedAt: '2026-08-08T03:04:59.000Z',
          nativeChangedAt: '2026-08-08T03:04:59.000Z',
        })
      )
    ).toBe(false);
    expect(
      store.applyRealtimeEvent(
        nativeRealtimeEvent({
          order: '72',
          generation: 6,
          workerType: EWorkerType.baileys,
          observedAt: '2026-08-08T03:05:01.000Z',
          nativeChangedAt: '2026-08-08T03:05:01.000Z',
        })
      )
    ).toBe(true);
  });

  it('applies duplicate events from both subscriptions idempotently', () => {
    const store = usePresentationStore();
    store.hydrateWorkerChannel(workerChannel({ order: '50', generation: 7 }));
    const event = nativeRealtimeEvent({
      order: '51',
      generation: 7,
      acknowledged: true,
      observedAt: '2026-08-08T03:10:00.000Z',
    });
    expect(store.applyRealtimeEvent(event)).toBe(true);
    const first = store.snapshot(workerId);
    expect(store.applyRealtimeEvent(event)).toBe(true);
    expect(store.snapshot(workerId)).toEqual(first);
  });

  it('recognizes only the exact publication already applied by another Vue consumer', () => {
    const store = usePresentationStore();
    store.hydrateWorkerChannel(workerChannel({ order: '78', generation: 7 }));
    const event: IBaileysConnectionState = {
      ...nativeRealtimeEvent({
        order: '79',
        generation: 7,
        acknowledged: false,
        native: EWhatsappConnectionStatus.offline,
        observedAt: '2026-08-08T03:09:00.000Z',
        nativeChangedAt: '2026-08-08T03:09:00.000Z',
      }),
      event_type: 'status',
      worker_status_id: EWorkerStatus.disponible,
      worker_status_observed_at: '2026-08-08T03:09:00.000Z',
    };

    expect(store.applyRealtimeEvent(event)).toBe(true);
    expect(
      canonicalSnapshotIncludesPublication(store.snapshot(workerId), event)
    ).toBe(true);
    expect(
      canonicalSnapshotIncludesPublication(store.snapshot(workerId), {
        ...event,
        connection_status_order: '77',
        worker_status_observed_at: '2026-08-08T03:08:00.000Z',
      })
    ).toBe(false);
  });

  it('keeps a newer realtime worker status across stale route hydration and accepts a genuinely newer HTTP snapshot', () => {
    const store = usePresentationStore();
    store.hydrateWorkerChannel({
      ...workerChannel({
        order: '80',
        generation: 7,
        status: EWorkerStatus.online,
      }),
      updated_at: '2026-08-08T03:10:00.000Z',
      connection_status_observed_at: '2099-08-08T03:10:00.000Z',
      recreate_completed_at: '2026-08-08T03:00:00.000Z',
    });

    expect(
      store.applyRealtimeEvent({
        ...nativeRealtimeEvent({
          order: '81',
          generation: 7,
          acknowledged: false,
          native: EWhatsappConnectionStatus.offline,
          observedAt: '2026-08-08T03:11:00.000Z',
          nativeChangedAt: '2026-08-08T03:11:00.000Z',
        }),
        event_type: 'status',
        worker_status_id: EWorkerStatus.disponible,
        worker_status_observed_at: '2026-08-08T03:11:00.000Z',
        status: EBaileysConnectionStatus.disconnected,
        code: ECodeMessage.connectionClosed,
        disconnected_user: true,
      })
    ).toBe(true);
    expect(store.snapshot(workerId)?.workerStatusId).toBe(
      EWorkerStatus.disponible
    );

    expect(
      store.hydrateWorkerChannel({
        ...workerChannel({
          order: '81',
          generation: 7,
          status: EWorkerStatus.online,
        }),
        updated_at: '2026-08-08T03:10:30.000Z',
        connection_status_observed_at: '2099-08-08T03:10:30.000Z',
        recreate_completed_at: '2026-08-08T03:00:00.000Z',
      })
    ).toBe(true);
    expect(store.snapshot(workerId)?.workerStatusId).toBe(
      EWorkerStatus.disponible
    );
    expect(store.snapshot(workerId)?.workerStatusObservedAt).toBe(
      '2026-08-08T03:11:00.000Z'
    );

    expect(
      store.hydrateWorkerChannel({
        ...workerChannel({
          order: '82',
          generation: 7,
          status: EWorkerStatus.offline,
          native: EWhatsappConnectionStatus.offline,
          acknowledged: false,
          observedAt: '2026-08-08T03:12:00.000Z',
        }),
        updated_at: '2026-08-08T03:12:00.000Z',
        connection_status_observed_at: '2099-08-08T03:12:00.000Z',
        recreate_completed_at: '2026-08-08T03:00:00.000Z',
      })
    ).toBe(true);
    expect(store.snapshot(workerId)?.workerStatusId).toBe(
      EWorkerStatus.offline
    );
  });

  it('does not reuse lifecycle or native clocks as the worker-status clock', () => {
    const store = usePresentationStore();
    store.hydrateWorkerChannel({
      ...workerChannel({
        order: '89',
        generation: 7,
        status: EWorkerStatus.online,
      }),
      worker_status_observed_at: '2026-08-08T03:19:00.000Z',
      updated_at: '2026-08-08T03:19:00.000Z',
    });

    const event: IBaileysConnectionState = {
      ...nativeRealtimeEvent({
        order: '90',
        generation: 7,
        native: EWhatsappConnectionStatus.offline,
        observedAt: '2099-08-08T03:20:00.000Z',
      }),
      event_type: 'status',
      worker_status_id: EWorkerStatus.offline,
      status: EBaileysConnectionStatus.disconnected,
      // These durable clocks belong to other projections and may remain on a
      // later payload after the recreate has finished.
      recreate_completed_at: '2026-08-08T03:05:00.000Z',
    };

    expect(store.applyRealtimeEvent(event)).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      workerStatusId: EWorkerStatus.offline,
      workerStatusObservedAt: '2026-08-08T03:19:00.000Z',
    });
    expect(
      canonicalSnapshotIncludesPublication(store.snapshot(workerId), event)
    ).toBe(true);
  });

  it('keeps a sessionless runtime recreating until the terminal available event restores QR readiness', () => {
    const store = usePresentationStore();
    expect(
      store.hydrateWorkerChannel({
        ...workerChannel({
          order: '89',
          generation: 5,
          status: EWorkerStatus.disponible,
          acknowledged: false,
        }),
        number: null,
        worker_status_observed_at: '2026-08-08T03:00:00.000Z',
        connection_status: null,
        connection_status_source_id: null,
        connection_status_order: null,
        connection_status_observed_at: null,
      })
    ).toBe(true);
    expect(descriptor(store.snapshot(workerId))).toMatchObject({
      color: EColor.warning,
      text: 'awaiting_qr_code',
      online: false,
    });

    expect(store.applyRealtimeEvent(managerStartEvent())).toBe(true);
    expect(descriptor(store.snapshot(workerId))).toMatchObject({
      color: EColor.warning,
      text: 'recreating',
      online: false,
    });

    expect(store.applyRealtimeEvent(runtimeStartedEvent())).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      workerStatusId: EWorkerStatus.recreating,
      recreatePhase: EWorkerRecreatePhase.connecting,
      connectionStatus: null,
    });
    expect(descriptor(store.snapshot(workerId))).toMatchObject({
      color: EColor.warning,
      text: 'recreating',
      online: false,
    });

    expect(
      store.applyRealtimeEvent(
        terminalEvent({ workerStatus: EWorkerStatus.disponible })
      )
    ).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      workerStatusId: EWorkerStatus.disponible,
      lifecycleOperationId: null,
      recreatePhase: null,
      connectionStatus: null,
      connectionOnlineAcknowledged: false,
    });
    expect(descriptor(store.snapshot(workerId))).toMatchObject({
      color: EColor.warning,
      text: 'awaiting_qr_code',
      online: false,
    });
  });

  it('preserves a proven session identity when recreate hydration temporarily omits the number', () => {
    const store = usePresentationStore();
    expect(
      store.hydrateWorkerChannel(
        workerChannel({
          order: '90',
          generation: 5,
          workerType: EWorkerType.baileys,
          status: EWorkerStatus.online,
        })
      )
    ).toBe(true);
    expect(store.snapshot(workerId)?.sessionIdentityPresent).toBe(true);

    expect(
      store.applyRealtimeEvent(
        managerStartEvent({
          workerType: EWorkerType.baileys,
          previousWorkerType: EWorkerType.baileys,
        })
      )
    ).toBe(true);
    expect(
      store.hydrateWorkerChannel({
        ...workerChannel({
          order: '91',
          generation: 6,
          workerType: EWorkerType.baileys,
          status: EWorkerStatus.recreating,
          lifecycleOperationId: operationId,
          recreatePhase: EWorkerRecreatePhase.connecting,
          recreatePhaseObservedAt: '2026-08-08T03:01:00.000Z',
        }),
        number: null,
      })
    ).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      workerStatusId: EWorkerStatus.recreating,
      sessionIdentityPresent: true,
      recreatePhase: EWorkerRecreatePhase.connecting,
    });
    expect(descriptor(store.snapshot(workerId))).toMatchObject({
      color: EColor.info,
      text: 'connecting',
      online: false,
    });
  });

  it('does not let the logout intent (205) regress an acknowledged connected channel', () => {
    const store = usePresentationStore();
    store.hydrateWorkerChannel(
      workerChannel({ order: '90', generation: 7, acknowledged: true })
    );
    const before = store.snapshot(workerId);
    expect(descriptor(before)).toMatchObject({
      color: EColor.success,
      text: 'channel_connected',
      online: true,
    });

    expect(
      store.applyRealtimeEvent({
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: EWorkerType.wwebjs,
        status: EBaileysConnectionStatus.info,
        code: ECodeMessage.logoutInProgress,
        disconnected_user: true,
        runtime_generation: 7,
      })
    ).toBe(false);
    expect(store.snapshot(workerId)).toBe(before);
    expect(descriptor(store.snapshot(workerId))).toMatchObject({
      text: 'channel_connected',
      online: true,
    });
  });

  it('projects a strict current-runtime ONLINE event as connected in the same realtime turn', () => {
    const store = usePresentationStore();
    store.hydrateWorkerChannel({
      ...workerChannel({
        order: '100',
        generation: 7,
        status: EWorkerStatus.disponible,
        acknowledged: false,
      }),
      number: null,
      worker_status_observed_at: '2026-08-08T03:39:00.000Z',
      connection_status: null,
      connection_status_source_id: null,
      connection_status_order: null,
      connection_status_observed_at: null,
    });
    const connected: IBaileysConnectionState = {
      ...nativeRealtimeEvent({
        order: '101',
        generation: 7,
        acknowledged: true,
        observedAt: '2026-08-08T03:40:00.000Z',
        nativeChangedAt: '2026-08-08T03:40:00.000Z',
      }),
      event_type: 'status',
      worker_status_id: EWorkerStatus.online,
      worker_status_observed_at: '2026-08-08T03:40:00.000Z',
    };

    expect(store.applyRealtimeEvent(connected)).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      workerStatusId: EWorkerStatus.online,
      connectionStatus: 'online',
      connectionOnlineAcknowledged: true,
      connectionStatusOrder: '101',
      runtimeGeneration: 7,
    });
    expect(descriptor(store.snapshot(workerId))).toMatchObject({
      color: EColor.success,
      text: 'channel_connected',
      online: true,
    });
    expect(
      canonicalSnapshotIncludesPublication(store.snapshot(workerId), connected)
    ).toBe(true);
  });

  it('tombstones a removed session and auto-releases for a later cross-tab connection', () => {
    const store = usePresentationStore();
    store.hydrateWorkerChannel(workerChannel({ order: '90', generation: 7 }));

    expect(
      store.applySessionRemovalTerminal({
        worker_id: workerId,
        worker_status_id: EWorkerStatus.disponible,
        session_removed: true,
        disconnected_user: true,
        runtime_generation: 7,
        container_id: null,
        worker_status_observed_at: '2026-08-08T03:20:00.000Z',
      })
    ).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      workerStatusId: EWorkerStatus.disponible,
      workerStatusObservedAt: '2026-08-08T03:20:00.000Z',
      sessionRemovalObservedAt: '2026-08-08T03:20:00.000Z',
      connectionStatus: null,
      connectionStatusSourceId: null,
      connectionStatusOrder: null,
      connectionOnlineAcknowledged: false,
      runtimeGeneration: 7,
      lifecycleOperationId: null,
      recreatePhase: null,
    });
    expect(store.sessionRemovalGenerationByWorkerId[workerId]).toBe(7);

    expect(
      store.applyRealtimeEvent(
        nativeRealtimeEvent({
          order: '91',
          generation: 7,
          acknowledged: true,
          observedAt: '2026-08-08T03:19:59.000Z',
        })
      )
    ).toBe(false);
    expect(
      store.hydrateWorkerChannel(workerChannel({ order: '92', generation: 7 }))
    ).toBe(false);

    expect(
      store.hydrateWorkerChannel({
        ...workerChannel({ order: '93', generation: 7 }),
        updated_at: '2026-08-08T03:19:59.000Z',
        connection_status_observed_at: '2026-08-08T03:19:59.000Z',
      })
    ).toBe(false);
    expect(
      store.applyRealtimeEvent(
        nativeRealtimeEvent({
          order: '95',
          generation: 7,
          acknowledged: true,
          observedAt: '2026-08-08T03:22:00.000Z',
        })
      )
    ).toBe(true);
    expect(store.sessionRemovalGenerationByWorkerId[workerId]).toBeUndefined();
    expect(store.snapshot(workerId)?.sessionRemovalObservedAt).toBeNull();

    expect(
      store.applySessionRemovalTerminal({
        worker_id: workerId,
        worker_status_id: EWorkerStatus.disponible,
        session_removed: true,
        disconnected_user: true,
        runtime_generation: 7,
        container_id: null,
        worker_status_observed_at: '2026-08-08T03:20:00.000Z',
      })
    ).toBe(false);
  });

  it('accepts a terminal session-removal publication without a native envelope', () => {
    const store = usePresentationStore();
    store.hydrateWorkerChannel(workerChannel({ order: '96', generation: 7 }));
    const terminal: IBaileysConnectionState = {
      event_type: 'status',
      worker_id: workerId,
      account_id: accountId,
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.disponible,
      status: EBaileysConnectionStatus.disconnected,
      code: ECodeMessage.loggedOut,
      session_removed: true,
      disconnected_user: true,
      runtime_generation: 7,
      worker_status_observed_at: '2026-08-08T03:30:00.000Z',
    };

    expect(store.applyRealtimeEvent(terminal)).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      workerStatusId: EWorkerStatus.disponible,
      workerStatusObservedAt: '2026-08-08T03:30:00.000Z',
      sessionRemovalObservedAt: '2026-08-08T03:30:00.000Z',
      connectionStatus: null,
      connectionStatusSourceId: null,
      connectionStatusOrder: null,
      connectionOnlineAcknowledged: false,
      lifecycleOperationId: null,
    });
    expect(
      canonicalSnapshotIncludesPublication(store.snapshot(workerId), terminal)
    ).toBe(true);
    expect(descriptor(store.snapshot(workerId))).toMatchObject({
      color: EColor.warning,
      text: 'awaiting_qr_code',
      online: false,
    });
  });

  it('replaces stale OFFLINE telemetry with durable QR readiness when the manager accepts a new attempt', () => {
    const store = usePresentationStore();
    store.hydrateWorkerChannel({
      ...workerChannel({ order: '96', generation: 7 }),
      status: { id: EWorkerStatus.offline, name: 'offline' },
      worker_status_observed_at: '2026-08-08T03:30:00.000Z',
    });
    const pairingReady: IBaileysConnectionState = {
      event_type: 'status',
      worker_id: workerId,
      account_id: accountId,
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.disponible,
      worker_status_observed_at: '2026-08-08T03:31:00.000Z',
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      connection_attempt_id: '00000000-0000-4000-8000-000000000040',
      qr_pending: true,
      runtime_generation: 7,
    };

    expect(store.applyRealtimeEvent(pairingReady)).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      workerStatusId: EWorkerStatus.disponible,
      sessionIdentityPresent: false,
      workerStatusObservedAt: '2026-08-08T03:31:00.000Z',
      sessionRemovalObservedAt: null,
      connectionStatus: null,
      connectionOnlineAcknowledged: false,
      runtimeGeneration: 7,
    });
    expect(descriptor(store.snapshot(workerId))).toMatchObject({
      color: EColor.warning,
      text: 'awaiting_qr_code',
      online: false,
    });
  });

  it('lets a durable HTTP disconnect tombstone dominate stale native ONLINE history', () => {
    const store = usePresentationStore();
    store.hydrateWorkerChannel({
      ...workerChannel({ order: '99', generation: 7 }),
      worker_status_observed_at: '2026-08-08T03:39:00.000Z',
      connection_status_observed_at: '2026-08-08T03:39:00.000Z',
    });

    expect(
      store.hydrateWorkerChannel({
        ...workerChannel({
          order: '100',
          generation: 7,
          status: EWorkerStatus.disponible,
          acknowledged: false,
        }),
        number: null,
        connection_date: null,
        worker_status_observed_at: '2026-08-08T03:40:01.000Z',
        connection_disconnected_at: '2026-08-08T03:40:00.000Z',
        connection_status: null,
        connection_status_source_id: null,
        connection_status_order: null,
      })
    ).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      workerStatusId: EWorkerStatus.disponible,
      workerStatusObservedAt: '2026-08-08T03:40:01.000Z',
      sessionRemovalObservedAt: '2026-08-08T03:40:00.000Z',
      connectionStatus: null,
      connectionStatusSourceId: null,
      connectionStatusOrder: null,
      connectionOnlineAcknowledged: false,
      lifecycleOperationId: null,
      completedLifecycleOperationId: null,
    });
  });

  it('clears a validated native projection when the dashboard baseline carries the durable disconnect tombstone', () => {
    const store = usePresentationStore();
    store.hydrateWorkerChannel({
      ...workerChannel({ order: '100', generation: 7 }),
      worker_status_observed_at: '2026-08-08T03:49:00.000Z',
      connection_status_observed_at: '2026-08-08T03:49:00.000Z',
    });

    expect(
      store.hydrateDashboardChannelStatus({
        ...dashboardChannelStatus({
          generation: 7,
          status: EWorkerStatus.disponible,
          observedAt: '2026-08-08T03:50:00.000Z',
        }),
        worker_status_observed_at: '2026-08-08T03:50:01.000Z',
        connection_disconnected_at: '2026-08-08T03:50:00.000Z',
        connection_status_source_id: null,
        connection_status_order: null,
      })
    ).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      workerStatusId: EWorkerStatus.disponible,
      workerStatusObservedAt: '2026-08-08T03:50:01.000Z',
      sessionRemovalObservedAt: '2026-08-08T03:50:00.000Z',
      connectionStatus: null,
      connectionStatusOrder: null,
      connectionOnlineAcknowledged: false,
    });
  });

  it('enriches an envelope-less dashboard cursor from the authoritative worker snapshot on F5', () => {
    const store = usePresentationStore();
    const baseline = dashboardChannelStatus({
      generation: 5,
      workerType: EWorkerType.baileys,
      status: EWorkerStatus.online,
      observedAt: '2026-08-08T03:00:00.000Z',
    });
    const worker = workerChannel({
      order: '10',
      generation: 5,
      workerType: EWorkerType.baileys,
      status: EWorkerStatus.online,
      acknowledged: true,
      observedAt: '2026-08-08T03:00:00.000Z',
    });

    expect(store.hydrateDashboardChannelStatus(baseline)).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      connectionStatus: null,
      connectionStatusOrder: '10',
      connectionOnlineAcknowledged: false,
    });
    expect(store.hydrateWorkerChannel(worker)).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      connectionStatus: 'online',
      connectionStatusOrder: '10',
      connectionOnlineAcknowledged: true,
    });
    expect(descriptor(store.snapshot(workerId))).toMatchObject({
      text: 'channel_connected',
      online: true,
    });
  });

  it('does not let a later envelope-less dashboard hydration downgrade an ONLINE ACK', () => {
    const store = usePresentationStore();
    const worker = workerChannel({
      order: '10',
      generation: 5,
      workerType: EWorkerType.baileys,
      status: EWorkerStatus.online,
      acknowledged: true,
      observedAt: '2026-08-08T03:00:00.000Z',
    });
    const dashboard = dashboardChannelStatus({
      generation: 5,
      workerType: EWorkerType.baileys,
      status: EWorkerStatus.online,
      observedAt: '2026-08-08T03:00:00.000Z',
    });

    expect(store.hydrateWorkerChannel(worker)).toBe(true);
    expect(store.hydrateDashboardChannelStatus(dashboard)).toBe(true);
    expect(store.snapshot(workerId)).toMatchObject({
      connectionStatus: 'online',
      connectionStatusOrder: '10',
      connectionOnlineAcknowledged: true,
    });
    expect(descriptor(store.snapshot(workerId))).toMatchObject({
      text: 'channel_connected',
      online: true,
    });
  });
});
