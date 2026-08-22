import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  getOfflineChannels,
  getAllChannelsStatus,
  type OfflineChannel,
  type ChannelWithStatus,
} from '../api/dashboardApi';
import { getChannels, getUser } from '../storage/authStorage';
import {
  initializeChannelStatusSocket,
  cleanupChannelStatusSocket,
  addChannelStatusListener,
  addChannelStatusConnectionListener,
  addChannelStatusRecoveryListener,
  type ChannelStatusPayload,
} from '../socket/channelStatusSocket';
import {
  projectMobileChannelStatusEvent,
  type MobileChannelStatusProjection,
} from '../../../packages/common/functions/mobileChannelStatusProjection';
import {
  compareWhatsappConnectionStatusOrders,
  mergeWhatsappOrderedChannelHttpSnapshot,
  normalizeWhatsappConnectionStatusOrder,
  normalizeWhatsappRuntimeGeneration,
  shouldApplyWhatsappConnectionStatusOrder,
} from '../../../packages/common/functions/whatsappConnectionStatus';
import { pt } from '../locales/pt';
import { EWorkerStatus } from '../../../packages/common/enums/EWorkerStatus';

const POLLING_INTERVAL_MS = 60_000;
const BOOTSTRAP_RETRY_BASE_DELAY_MS = 1_000;
const BOOTSTRAP_RETRY_MAX_DELAY_MS = 15_000;

type ChannelStatusContextValue = {
  offlineChannels: OfflineChannel[];
  allChannelStatuses: Array<{
    id: string;
    name: string;
    isOnline: boolean;
    status: OfflineChannel['status'];
    connectionStatus?: OfflineChannel['connection_status'];
  }>;
  isLoading: boolean;
  refresh: () => Promise<void>;
};

const ChannelStatusContext = createContext<ChannelStatusContextValue>({
  offlineChannels: [],
  allChannelStatuses: [],
  isLoading: false,
  refresh: async () => {},
});

export function useChannelStatus(): ChannelStatusContextValue {
  return useContext(ChannelStatusContext);
}

const STATUS_NAMES: Record<string, string> = {
  [EWorkerStatus.online]: pt.channel_online,
  [EWorkerStatus.offline]: 'Offline',
  [EWorkerStatus.disponible]: pt.channel_awaiting_qr,
  [EWorkerStatus.new]: 'Novo',
  [EWorkerStatus.deleting]: 'Excluindo',
  [EWorkerStatus.recreating]: 'Recriando',
  [EWorkerStatus.error]: 'Erro',
  [EWorkerStatus.delete]: 'Exclusão pendente',
  [EWorkerStatus.mismatched]: 'Divergente',
  [EWorkerStatus.creating]: 'Criando',
  [EWorkerStatus.stopped]: 'Parado',
  [EWorkerStatus.blocked]: 'Bloqueado pelo plano',
};

function getStatusName(statusId: string | undefined): string | null {
  if (!statusId) return null;
  return STATUS_NAMES[statusId] ?? null;
}

export function ChannelStatusProvider({
  children,
  enabled = true,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const [offlineChannelsRaw, setOfflineChannelsRaw] = useState<
    OfflineChannel[]
  >([]);
  const [allChannelsRaw, setAllChannelsRaw] = useState<ChannelWithStatus[]>([]);
  const [userChannelIds, setUserChannelIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const mountedRef = useRef(true);
  const lifecycleGenerationRef = useRef(0);
  const activeAccountIdRef = useRef<string | null>(null);
  const channelIdsRef = useRef<Set<string>>(new Set());
  const channelNameByIdRef = useRef<Map<string, string>>(new Map());
  const channelStatusByIdRef = useRef<Map<string, string>>(new Map());
  const channelWorkerTypeByIdRef = useRef<Map<string, string>>(new Map());
  const channelRuntimeGenerationByIdRef = useRef<Map<string, number>>(
    new Map()
  );
  const nativeStatusOrderByIdRef = useRef<Map<string, string>>(new Map());
  // Worker ids are immutable and never reused. Keep a session-local terminal
  // tombstone so an HTTP request that started before a realtime delete cannot
  // resurrect the channel after its response arrives.
  const deletedChannelIdsRef = useRef<Set<string>>(new Set());

  const cacheHttpChannelProjection = useCallback(
    (channel: OfflineChannel | ChannelWithStatus) => {
      if (deletedChannelIdsRef.current.has(channel.id)) {
        return;
      }

      const currentOrder = normalizeWhatsappConnectionStatusOrder(
        nativeStatusOrderByIdRef.current.get(channel.id)
      );
      const candidateOrder = normalizeWhatsappConnectionStatusOrder(
        channel.connection_status_order
      );
      if (
        !shouldApplyWhatsappConnectionStatusOrder(
          currentOrder,
          channel.connection_status_order
        ) ||
        (currentOrder &&
          candidateOrder &&
          compareWhatsappConnectionStatusOrders(
            candidateOrder,
            currentOrder
          ) === 0)
      ) {
        return;
      }

      channelNameByIdRef.current.set(channel.id, channel.name);
      if (channel.worker_type_id) {
        channelWorkerTypeByIdRef.current.set(
          channel.id,
          channel.worker_type_id
        );
      }
      const runtimeGeneration = normalizeWhatsappRuntimeGeneration(
        channel.runtime_generation
      );
      if (runtimeGeneration) {
        channelRuntimeGenerationByIdRef.current.set(
          channel.id,
          runtimeGeneration
        );
      }
      if (channel.status?.id) {
        channelStatusByIdRef.current.set(channel.id, channel.status.id);
      }
      if (candidateOrder) {
        nativeStatusOrderByIdRef.current.set(channel.id, candidateOrder);
      }
    },
    []
  );

  const refreshUserChannels = useCallback(async (guard?: () => boolean) => {
    const generation = lifecycleGenerationRef.current;
    const canCommit =
      guard ??
      (() =>
        mountedRef.current && generation === lifecycleGenerationRef.current);
    const channels = await getChannels();
    const ids = new Set(
      channels
        .filter((channel) => !deletedChannelIdsRef.current.has(channel.id))
        .map((channel) => channel.id)
    );
    if (canCommit()) {
      setUserChannelIds(ids);
      channelIdsRef.current = ids;
    }
    return ids;
  }, []);

  const fetchOfflineChannels = useCallback(
    async (guard?: () => boolean) => {
      const generation = lifecycleGenerationRef.current;
      const canCommit =
        guard ??
        (() =>
          mountedRef.current && generation === lifecycleGenerationRef.current);
      const baselineOrders = new Map(nativeStatusOrderByIdRef.current);
      const baselineWorkerTypeIds = new Map(channelWorkerTypeByIdRef.current);
      try {
        const data = (await getOfflineChannels()).filter(
          (channel) => !deletedChannelIdsRef.current.has(channel.id)
        );
        if (canCommit()) {
          for (const channel of data) {
            cacheHttpChannelProjection(channel);
          }
          setOfflineChannelsRaw((previous) => {
            const currentIds = new Set(previous.map((channel) => channel.id));
            const candidates = data.filter(
              (channel) =>
                currentIds.has(channel.id) ||
                shouldApplyWhatsappConnectionStatusOrder(
                  nativeStatusOrderByIdRef.current.get(channel.id),
                  channel.connection_status_order
                )
            );
            return mergeWhatsappOrderedChannelHttpSnapshot(
              previous,
              candidates,
              baselineOrders,
              { baselineWorkerTypeIds }
            );
          });
        }
      } catch {}
    },
    [cacheHttpChannelProjection]
  );

  const fetchAllChannels = useCallback(
    async (guard?: () => boolean) => {
      const generation = lifecycleGenerationRef.current;
      const canCommit =
        guard ??
        (() =>
          mountedRef.current && generation === lifecycleGenerationRef.current);
      const baselineOrders = new Map(nativeStatusOrderByIdRef.current);
      const baselineWorkerTypeIds = new Map(channelWorkerTypeByIdRef.current);
      try {
        const data = (await getAllChannelsStatus()).filter(
          (channel) => !deletedChannelIdsRef.current.has(channel.id)
        );
        if (canCommit()) {
          for (const channel of data) {
            cacheHttpChannelProjection(channel);
          }
          setAllChannelsRaw((previous) => {
            const currentIds = new Set(previous.map((channel) => channel.id));
            const candidates = data.filter(
              (channel) =>
                currentIds.has(channel.id) ||
                shouldApplyWhatsappConnectionStatusOrder(
                  nativeStatusOrderByIdRef.current.get(channel.id),
                  channel.connection_status_order
                )
            );
            return mergeWhatsappOrderedChannelHttpSnapshot(
              previous,
              candidates,
              baselineOrders,
              { baselineWorkerTypeIds }
            );
          });
        }
      } catch {}
    },
    [cacheHttpChannelProjection]
  );

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const generation = lifecycleGenerationRef.current;
    const accountId = activeAccountIdRef.current;
    const canCommit = () =>
      mountedRef.current &&
      generation === lifecycleGenerationRef.current &&
      activeAccountIdRef.current === accountId;
    if (!canCommit()) return;
    setIsLoading(true);
    await refreshUserChannels(canCommit);
    if (!canCommit()) return;
    await Promise.all([
      fetchOfflineChannels(canCommit),
      fetchAllChannels(canCommit),
    ]);
    if (canCommit()) {
      setIsLoading(false);
    }
  }, [enabled, refreshUserChannels, fetchOfflineChannels, fetchAllChannels]);

  const offlineChannels =
    userChannelIds.size === 0
      ? offlineChannelsRaw
      : offlineChannelsRaw.filter((ch) => userChannelIds.has(ch.id));

  const allChannelStatuses = allChannelsRaw
    .filter((ch) => userChannelIds.size === 0 || userChannelIds.has(ch.id))
    .map((ch) => ({
      id: ch.id,
      name: ch.name,
      isOnline: ch.status?.id === EWorkerStatus.online,
      status: ch.status,
      connectionStatus: ch.connection_status,
    }));

  const applyRealtimeStatus = useCallback(
    (payload: ChannelStatusPayload) => {
      if (deletedChannelIdsRef.current.has(payload.worker_id)) {
        return;
      }

      const currentIds = channelIdsRef.current;
      if (currentIds.size > 0 && !currentIds.has(payload.worker_id)) {
        return;
      }

      const projection: MobileChannelStatusProjection =
        projectMobileChannelStatusEvent({
          payload,
          currentStatusId:
            channelStatusByIdRef.current.get(payload.worker_id) ?? null,
          currentOrder: nativeStatusOrderByIdRef.current.get(payload.worker_id),
          currentWorkerTypeId: channelWorkerTypeByIdRef.current.get(
            payload.worker_id
          ),
          currentRuntimeGeneration: channelRuntimeGenerationByIdRef.current.get(
            payload.worker_id
          ),
        });
      if (projection.kind === 'ignored') return;
      if (projection.nextOrder) {
        nativeStatusOrderByIdRef.current.set(
          payload.worker_id,
          projection.nextOrder
        );
      }

      if (projection.kind === 'removed') {
        deletedChannelIdsRef.current.add(payload.worker_id);
        const nextChannelIds = new Set(channelIdsRef.current);
        nextChannelIds.delete(payload.worker_id);
        channelIdsRef.current = nextChannelIds;
        setUserChannelIds((previous) => {
          if (!previous.has(payload.worker_id)) return previous;
          const next = new Set(previous);
          next.delete(payload.worker_id);
          return next;
        });
        channelNameByIdRef.current.delete(payload.worker_id);
        channelStatusByIdRef.current.delete(payload.worker_id);
        channelWorkerTypeByIdRef.current.delete(payload.worker_id);
        channelRuntimeGenerationByIdRef.current.delete(payload.worker_id);
        nativeStatusOrderByIdRef.current.delete(payload.worker_id);
        setAllChannelsRaw((previous) =>
          previous.filter((channel) => channel.id !== payload.worker_id)
        );
        setOfflineChannelsRaw((previous) =>
          previous.filter((channel) => channel.id !== payload.worker_id)
        );
        return;
      }

      channelStatusByIdRef.current.set(payload.worker_id, projection.statusId);
      const effectiveWorkerTypeId =
        payload.worker_type_id ??
        channelWorkerTypeByIdRef.current.get(payload.worker_id);
      if (effectiveWorkerTypeId) {
        channelWorkerTypeByIdRef.current.set(
          payload.worker_id,
          effectiveWorkerTypeId
        );
      }
      const runtimeGeneration = normalizeWhatsappRuntimeGeneration(
        payload.runtime_generation
      );
      const connectionStatusSourceId =
        typeof payload.connection_status_source_id === 'string'
          ? payload.connection_status_source_id
          : null;
      if (runtimeGeneration) {
        channelRuntimeGenerationByIdRef.current.set(
          payload.worker_id,
          runtimeGeneration
        );
      }
      const status = {
        id: projection.statusId,
        name: getStatusName(projection.statusId),
      };
      const channelName =
        payload.worker_name?.trim() ||
        channelNameByIdRef.current.get(payload.worker_id);
      if (channelName) {
        channelNameByIdRef.current.set(payload.worker_id, channelName);
        setAllChannelsRaw((previous) => {
          const exists = previous.some(
            (channel) => channel.id === payload.worker_id
          );
          if (!exists) {
            return [
              ...previous,
              {
                id: payload.worker_id,
                name: channelName,
                worker_type_id: effectiveWorkerTypeId,
                status,
                connection_status: projection.publicStatus ?? null,
                connection_status_source_id: connectionStatusSourceId,
                connection_status_order: projection.nextOrder ?? null,
                connection_online_acknowledged:
                  payload.connection_online_acknowledged === true,
                runtime_generation: runtimeGeneration ?? null,
              },
            ];
          }
          return previous.map((channel) =>
            channel.id === payload.worker_id
              ? {
                  ...channel,
                  name: channelName,
                  worker_type_id:
                    effectiveWorkerTypeId ?? channel.worker_type_id,
                  status,
                  connection_status:
                    projection.publicStatus ?? channel.connection_status,
                  connection_status_source_id:
                    connectionStatusSourceId ??
                    channel.connection_status_source_id,
                  connection_status_order:
                    projection.nextOrder ?? channel.connection_status_order,
                  connection_online_acknowledged:
                    payload.connection_online_acknowledged === true,
                  runtime_generation:
                    runtimeGeneration ?? channel.runtime_generation ?? null,
                }
              : channel
          );
        });
      }

      if (projection.isOnline) {
        setOfflineChannelsRaw((previous) =>
          previous.filter((channel) => channel.id !== payload.worker_id)
        );
        return;
      }
      if (!channelName) {
        void Promise.all([fetchOfflineChannels(), fetchAllChannels()]);
        return;
      }
      setOfflineChannelsRaw((previous) => {
        const existing = previous.find(
          (channel) => channel.id === payload.worker_id
        );
        const next: OfflineChannel = {
          ...(existing ?? { id: payload.worker_id }),
          id: payload.worker_id,
          name: channelName,
          worker_type_id: effectiveWorkerTypeId ?? existing?.worker_type_id,
          status,
          connection_status:
            projection.publicStatus ?? existing?.connection_status ?? null,
          connection_status_source_id:
            connectionStatusSourceId ??
            existing?.connection_status_source_id ??
            null,
          connection_status_order:
            projection.nextOrder ?? existing?.connection_status_order ?? null,
          connection_online_acknowledged:
            payload.connection_online_acknowledged === true,
          runtime_generation:
            runtimeGeneration ?? existing?.runtime_generation ?? null,
        };
        return existing
          ? previous.map((channel) =>
              channel.id === payload.worker_id ? next : channel
            )
          : [...previous, next];
      });
    },
    [fetchAllChannels, fetchOfflineChannels]
  );

  useEffect(() => {
    const generation = ++lifecycleGenerationRef.current;
    let disposed = false;
    let accountId: string | null = null;
    let pollingTimer: ReturnType<typeof setInterval> | null = null;
    let bootstrapRetryTimer: ReturnType<typeof setTimeout> | null = null;
    let bootstrapRetryAttempt = 0;
    const isCurrent = () =>
      !disposed &&
      mountedRef.current &&
      lifecycleGenerationRef.current === generation &&
      (accountId === null || activeAccountIdRef.current === accountId);

    if (!enabled) {
      mountedRef.current = false;
      activeAccountIdRef.current = null;
      setOfflineChannelsRaw([]);
      setAllChannelsRaw([]);
      setUserChannelIds(new Set());
      setIsLoading(false);
      cleanupChannelStatusSocket().catch(() => {});
      channelNameByIdRef.current.clear();
      channelStatusByIdRef.current.clear();
      channelWorkerTypeByIdRef.current.clear();
      channelRuntimeGenerationByIdRef.current.clear();
      nativeStatusOrderByIdRef.current.clear();
      deletedChannelIdsRef.current.clear();
      return () => {
        disposed = true;
        if (lifecycleGenerationRef.current === generation) {
          lifecycleGenerationRef.current += 1;
        }
      };
    }

    mountedRef.current = true;
    let removeListener: (() => void) | null = null;
    let removeRecoveryListener: (() => void) | null = null;
    let removeConnectionListener: (() => void) | null = null;
    let initialSnapshotReady = false;
    let wasDisconnected = false;
    const bufferedStatusEvents: ChannelStatusPayload[] = [];

    const bootstrap = async () => {
      if (!isCurrent()) return;
      setIsLoading(true);
      await refreshUserChannels(isCurrent);
      if (!isCurrent()) return;

      const user = await getUser();
      if (!isCurrent()) return;
      const rawAccountId =
        user && typeof user === 'object'
          ? (user as { account_id?: string }).account_id
          : null;
      const nextAccountId = rawAccountId?.trim() || null;
      if (!nextAccountId) {
        if (isCurrent()) setIsLoading(false);
        return;
      }
      if (accountId && accountId !== nextAccountId) {
        bufferedStatusEvents.length = 0;
        initialSnapshotReady = false;
        deletedChannelIdsRef.current.clear();
      }
      accountId = nextAccountId;
      activeAccountIdRef.current = accountId;

      if (!removeListener) {
        removeListener = addChannelStatusListener(
          (payload: ChannelStatusPayload) => {
            if (!isCurrent() || payload.account_id !== accountId) return;
            if (!initialSnapshotReady) {
              bufferedStatusEvents.push(payload);
              return;
            }
            applyRealtimeStatus(payload);
          }
        );
      }
      if (!removeRecoveryListener) {
        removeRecoveryListener = addChannelStatusRecoveryListener(() => {
          if (isCurrent()) void refresh();
        });
      }
      if (!removeConnectionListener) {
        removeConnectionListener = addChannelStatusConnectionListener(
          (connected) => {
            if (!isCurrent()) return;
            if (!connected) {
              wasDisconnected = true;
              return;
            }
            if (wasDisconnected && initialSnapshotReady) {
              wasDisconnected = false;
              void refresh();
            }
          }
        );
      }

      // `initialize` resolves only after a real Subscribed acknowledgement.
      // Until then events are buffered and no HTTP truth is requested.
      await initializeChannelStatusSocket(accountId);
      if (!isCurrent()) return;

      await Promise.all([
        fetchOfflineChannels(isCurrent),
        fetchAllChannels(isCurrent),
      ]);
      if (!isCurrent()) return;
      initialSnapshotReady = true;
      for (const payload of bufferedStatusEvents.splice(0)) {
        if (!isCurrent()) return;
        applyRealtimeStatus(payload);
      }

      setIsLoading(false);
      bootstrapRetryAttempt = 0;
      if (!isCurrent()) return;
      pollingTimer = setInterval(async () => {
        if (!isCurrent()) return;
        await refreshUserChannels(isCurrent);
        if (!isCurrent()) return;
        await Promise.all([
          fetchOfflineChannels(isCurrent),
          fetchAllChannels(isCurrent),
        ]);
      }, POLLING_INTERVAL_MS);
    };

    const runBootstrap = (): void => {
      void bootstrap().catch(() => {
        if (!isCurrent()) return;
        setIsLoading(false);
        const delay = Math.min(
          BOOTSTRAP_RETRY_BASE_DELAY_MS * 2 ** bootstrapRetryAttempt,
          BOOTSTRAP_RETRY_MAX_DELAY_MS
        );
        bootstrapRetryAttempt = Math.min(bootstrapRetryAttempt + 1, 10);
        bootstrapRetryTimer = setTimeout(() => {
          bootstrapRetryTimer = null;
          if (isCurrent()) runBootstrap();
        }, delay);
      });
    };

    runBootstrap();

    return () => {
      disposed = true;
      if (lifecycleGenerationRef.current === generation) {
        lifecycleGenerationRef.current += 1;
        mountedRef.current = false;
        activeAccountIdRef.current = null;
      }
      removeListener?.();
      removeRecoveryListener?.();
      removeConnectionListener?.();
      if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = null;
      }
      if (bootstrapRetryTimer) {
        clearTimeout(bootstrapRetryTimer);
        bootstrapRetryTimer = null;
      }
      cleanupChannelStatusSocket().catch(() => {});
    };
  }, [
    applyRealtimeStatus,
    enabled,
    fetchAllChannels,
    fetchOfflineChannels,
    refresh,
    refreshUserChannels,
  ]);

  return (
    <ChannelStatusContext.Provider
      value={{ offlineChannels, allChannelStatuses, isLoading, refresh }}
    >
      {children}
    </ChannelStatusContext.Provider>
  );
}
