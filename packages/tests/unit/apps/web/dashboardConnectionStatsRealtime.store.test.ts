import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { createPinia, setActivePinia } from 'pinia';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import {
  compareWhatsappConnectionStatusOrders,
  mergeWhatsappOrderedChannelHttpSnapshot,
  normalizeWhatsappConnectionStatusOrder,
  shouldApplyWhatsappConnectionStatusOrder,
} from '@core/common/functions/whatsappConnectionStatus';

const axiosGet = jest.fn();

interface DashboardStoreForTest {
  stats: {
    users: { total: number; allowed: number; sparkline_data: number[] };
    channels: {
      total: number;
      connected: number;
      allowed: number;
      sparkline_data: number[];
    };
    contacts: {
      total: number;
      allowed: number;
      growth: number;
      sparkline_data: number[];
    };
  } | null;
  channelEffectiveOnlineById: Record<string, boolean>;
  channelConnectionStatusOrderById: Record<string, string>;
  offlineChannels: Array<Record<string, any>>;
  channelEffectiveOnlineReady: boolean;
  getDashboardStats: () => Promise<unknown>;
  getDashboardOfflineChannels: (force?: boolean) => Promise<unknown>;
  getDashboardChannelsStatus: () => Promise<unknown>;
  applyDashboardChannelEffectiveStatus: (
    channelId: string,
    statusId: string,
    connectionStatusOrder?: string
  ) => void;
  applyOfflineChannelStatusEvent: (input: Record<string, any>) => void;
}

const loadDashboardStore = (): (() => DashboardStoreForTest) => {
  const filename = resolve(
    process.cwd(),
    'apps/web/src/@webcore/stores/dashboard.ts'
  );
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
  const moduleRequire = (moduleId: string): unknown => {
    if (moduleId === 'pinia') return require('pinia');
    if (moduleId === '@/plugins/i18n') {
      return { getI18n: () => ({ global: { t: (key: string) => key } }) };
    }
    if (moduleId === '@webcore/axios') {
      return { __esModule: true, default: { get: axiosGet } };
    }
    if (moduleId === 'axios') {
      return { AxiosError: class AxiosError extends Error {} };
    }
    if (moduleId === '@core/common/enums/EColor') {
      return { EColor: { success: 'success', error: 'error' } };
    }
    if (moduleId === '@core/common/enums/EWorkerStatus') {
      return { EWorkerStatus };
    }
    if (moduleId === '@core/common/functions/whatsappConnectionStatus') {
      return {
        compareWhatsappConnectionStatusOrders,
        mergeWhatsappOrderedChannelHttpSnapshot,
        normalizeWhatsappConnectionStatusOrder,
        shouldApplyWhatsappConnectionStatusOrder,
      };
    }
    throw new Error(`Unexpected dashboard store dependency: ${moduleId}`);
  };
  const evaluate = new Function('require', 'module', 'exports', transpiled) as (
    requireModule: (moduleId: string) => unknown,
    module: typeof loaded,
    exports: Record<string, unknown>
  ) => void;
  evaluate(moduleRequire, loaded, loaded.exports);
  return loaded.exports.useDashboardStore as () => DashboardStoreForTest;
};

const useDashboardStore = loadDashboardStore();

const statsResponse = (connected: number) => ({
  users: { total: 1, allowed: 2, sparkline_data: [] },
  channels: { total: 3, connected, allowed: 4, sparkline_data: [] },
  contacts: { total: 5, allowed: 6, growth: 0, sparkline_data: [] },
});

describe('dashboard connected channels realtime card', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    axiosGet.mockReset();
  });

  it('updates the card only when a channel changes effective ONLINE state', () => {
    const store = useDashboardStore();
    store.stats = statsResponse(1);
    store.channelEffectiveOnlineById = { online: true, offline: false };
    store.channelEffectiveOnlineReady = true;

    store.applyDashboardChannelEffectiveStatus('offline', EWorkerStatus.online);
    expect(store.stats?.channels.connected).toBe(2);

    store.applyDashboardChannelEffectiveStatus('offline', EWorkerStatus.online);
    expect(store.stats?.channels.connected).toBe(2);

    store.applyDashboardChannelEffectiveStatus('online', EWorkerStatus.offline);
    expect(store.stats?.channels.connected).toBe(1);
  });

  it('does not let a slower stats HTTP response overwrite newer effective state', async () => {
    const store = useDashboardStore();
    store.channelEffectiveOnlineById = { one: true, two: false };
    store.channelEffectiveOnlineReady = true;
    axiosGet.mockResolvedValueOnce({
      data: { status: true, data: statsResponse(99) },
    });

    await store.getDashboardStats();

    expect(store.stats?.channels.connected).toBe(1);
  });

  it('does not let a delayed HTTP channel snapshot regress a newer realtime cursor', async () => {
    const store = useDashboardStore();
    let resolveRequest: ((value: unknown) => void) | undefined;
    axiosGet.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );

    const request = store.getDashboardChannelsStatus();
    store.applyDashboardChannelEffectiveStatus(
      'worker-1',
      EWorkerStatus.online,
      '20'
    );
    resolveRequest?.({
      data: {
        status: true,
        data: [
          {
            id: 'worker-1',
            name: 'Support',
            status: { id: EWorkerStatus.offline, name: 'offline' },
            connection_status_order: '19',
          },
        ],
      },
    });
    await request;

    expect(store.channelEffectiveOnlineById['worker-1']).toBe(true);
    expect(store.channelConnectionStatusOrderById['worker-1']).toBe('20');
  });

  it('lets a durable disconnect tombstone replace a newer native cursor', async () => {
    const store = useDashboardStore();
    store.channelEffectiveOnlineById = { 'worker-1': true };
    store.channelConnectionStatusOrderById = { 'worker-1': '20' };
    axiosGet.mockResolvedValueOnce({
      data: {
        status: true,
        data: [
          {
            id: 'worker-1',
            name: 'Support',
            status: { id: EWorkerStatus.disponible, name: 'disponible' },
            worker_type_id: 'baileys',
            worker_status_observed_at: '2026-08-09T10:02:01.000Z',
            connection_disconnected_at: '2026-08-09T10:02:00.000Z',
            connection_status_order: null,
            runtime_generation: 3,
          },
        ],
      },
    });

    await store.getDashboardChannelsStatus();

    expect(store.channelEffectiveOnlineById['worker-1']).toBe(false);
    expect(store.channelConnectionStatusOrderById['worker-1']).toBeUndefined();
  });

  it('lets the offline HTTP disconnect tombstone clear stale native fields', async () => {
    const store = useDashboardStore();
    store.offlineChannels = [
      {
        id: 'worker-1',
        name: 'Support',
        worker_type_id: 'baileys',
        status: { id: EWorkerStatus.offline, name: 'offline' },
        connection_status: 'offline',
        connection_status_source_id: '11111111-1111-4111-8111-111111111111',
        connection_status_order: '20',
        connection_online_acknowledged: false,
        runtime_generation: 3,
      },
    ];
    store.channelConnectionStatusOrderById = { 'worker-1': '20' };
    axiosGet.mockResolvedValueOnce({
      data: {
        status: true,
        data: [
          {
            id: 'worker-1',
            name: 'Support',
            worker_type_id: 'baileys',
            status: { id: EWorkerStatus.disponible, name: 'disponible' },
            worker_status_observed_at: '2026-08-09T10:02:01.000Z',
            connection_disconnected_at: '2026-08-09T10:02:00.000Z',
            connection_status: null,
            connection_status_source_id: null,
            connection_status_order: null,
            connection_online_acknowledged: false,
            runtime_generation: 3,
          },
        ],
      },
    });

    await store.getDashboardOfflineChannels(true);

    expect(store.offlineChannels[0]).toMatchObject({
      status: { id: EWorkerStatus.disponible },
      connection_status: null,
      connection_status_source_id: null,
      connection_status_order: null,
      connection_online_acknowledged: false,
    });
    expect(store.channelConnectionStatusOrderById['worker-1']).toBeUndefined();
  });

  it('treats explicit null as a native projection tombstone', () => {
    const store = useDashboardStore();
    store.offlineChannels = [
      {
        id: 'worker-1',
        name: 'Support',
        worker_type_id: 'baileys',
        status: { id: EWorkerStatus.offline, name: 'offline' },
        connection_status: 'connecting',
        connection_status_source_id: '11111111-1111-4111-8111-111111111111',
        connection_status_sequence: 8,
        connection_status_changed_at: '2026-08-09T10:00:00.000Z',
        connection_status_order: '20',
        connection_online_acknowledged: false,
        runtime_generation: 3,
      },
    ];
    store.channelConnectionStatusOrderById = { 'worker-1': '20' };

    store.applyOfflineChannelStatusEvent({
      channelId: 'worker-1',
      channelName: 'Support',
      workerTypeId: 'baileys',
      statusId: EWorkerStatus.disponible,
      statusName: 'awaiting_qr_code',
      connectionStatus: null,
      connectionStatusSourceId: null,
      connectionStatusSequence: null,
      connectionStatusChangedAt: null,
      connectionStatusOrder: null,
      connectionOnlineAcknowledged: false,
      runtimeGeneration: 4,
    });

    expect(store.offlineChannels[0]).toMatchObject({
      status: { id: EWorkerStatus.disponible },
      connection_status: null,
      connection_status_source_id: null,
      connection_status_sequence: null,
      connection_status_changed_at: null,
      connection_status_order: null,
      connection_online_acknowledged: false,
      runtime_generation: 4,
    });
    expect(store.channelConnectionStatusOrderById['worker-1']).toBeUndefined();
  });
});
