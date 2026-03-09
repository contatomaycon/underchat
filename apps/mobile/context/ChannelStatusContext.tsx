import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { getOfflineChannels, type OfflineChannel } from '../api/dashboardApi';
import { getChannels, getUser } from '../storage/authStorage';
import {
  initializeChannelStatusSocket,
  cleanupChannelStatusSocket,
  addChannelStatusListener,
  type ChannelStatusPayload,
} from '../socket/channelStatusSocket';

const WORKER_STATUS_ONLINE = '019a930d-c6f6-766d-9c84-30af6ecc33b2';
const POLLING_INTERVAL_MS = 60_000;

type ChannelStatusContextValue = {
  offlineChannels: OfflineChannel[];
  allChannelStatuses: Array<{
    id: string;
    name: string;
    isOnline: boolean;
    status: OfflineChannel['status'];
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
  '019a930d-c6f6-766d-9c84-3696c2cd5ed8': 'Offline',
  '019a930d-c6f6-766d-9c84-3904383fe742': 'Disponível',
  '019a930d-c6f6-766d-9c84-3f0abf55560d': 'Novo',
  '019a930d-c6f6-766d-9c84-437433031776': 'Excluindo',
  '019a930d-c6f6-766d-9c84-46093814d8e0': 'Recriando',
  '019a930d-c6f6-766d-9c84-48cb970a9f21': 'Erro',
  '019a930d-c6f6-766d-9c84-4dc1777f8f69': 'Deletado',
  '019a930d-c6f6-766d-9c84-5056ccf66633': 'Divergente',
  '019a930d-c6f6-766d-9c84-52e87789979b': 'Criando',
  '019bcd18-ce66-77a2-9d7c-e48159c253da': 'Parado',
};

function getStatusName(statusId: string | undefined): string | null {
  if (!statusId) return null;
  return STATUS_NAMES[statusId] ?? null;
}

export function ChannelStatusProvider({ children }: { children: ReactNode }) {
  const [offlineChannelsRaw, setOfflineChannelsRaw] = useState<
    OfflineChannel[]
  >([]);
  const [userChannelIds, setUserChannelIds] = useState<Set<string>>(new Set());
  const [userChannelNames, setUserChannelNames] = useState<Map<string, string>>(
    new Map()
  );
  const [isLoading, setIsLoading] = useState(false);
  const mountedRef = useRef(true);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const channelIdsRef = useRef<Set<string>>(new Set());

  const refreshUserChannels = useCallback(async () => {
    const channels = await getChannels();
    const ids = new Set(channels.map((ch) => ch.id));
    const names = new Map(channels.map((ch) => [ch.id, ch.name]));
    setUserChannelIds(ids);
    setUserChannelNames(names);
    channelIdsRef.current = ids;
    return ids;
  }, []);

  const fetchOfflineChannels = useCallback(async () => {
    try {
      const data = await getOfflineChannels();
      if (mountedRef.current) {
        setOfflineChannelsRaw(data);
      }
    } catch {}
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    await refreshUserChannels();
    await fetchOfflineChannels();
    if (mountedRef.current) {
      setIsLoading(false);
    }
  }, [refreshUserChannels, fetchOfflineChannels]);

  const offlineChannels =
    userChannelIds.size === 0
      ? offlineChannelsRaw
      : offlineChannelsRaw.filter((ch) => userChannelIds.has(ch.id));

  const allChannelStatuses = useMemo(() => {
    if (userChannelNames.size > 0) {
      return Array.from(userChannelNames.entries()).map(([id, name]) => {
        const offlineCh = offlineChannelsRaw.find((ch) => ch.id === id);
        return {
          id,
          name,
          isOnline: !offlineCh,
          status: offlineCh?.status ?? null,
        };
      });
    }

    return offlineChannelsRaw.map((ch) => ({
      id: ch.id,
      name: ch.name,
      isOnline: false,
      status: ch.status,
    }));
  }, [userChannelNames, offlineChannelsRaw]);

  useEffect(() => {
    mountedRef.current = true;
    let removeListener: (() => void) | null = null;

    const bootstrap = async () => {
      setIsLoading(true);

      await refreshUserChannels();
      await fetchOfflineChannels();

      const user = await getUser();
      const accountId =
        user && typeof user === 'object'
          ? (user as { account_id?: string }).account_id
          : null;

      if (accountId && mountedRef.current) {
        await initializeChannelStatusSocket(accountId).catch(() => {});

        removeListener = addChannelStatusListener(
          (payload: ChannelStatusPayload) => {
            if (!mountedRef.current) return;

            const currentIds = channelIdsRef.current;
            if (currentIds.size > 0 && !currentIds.has(payload.worker_id)) {
              return;
            }

            if (payload.worker_status_id === WORKER_STATUS_ONLINE) {
              setOfflineChannelsRaw((prev) =>
                prev.filter((ch) => ch.id !== payload.worker_id)
              );
              return;
            }

            const statusId = payload.worker_status_id ?? null;
            const statusName = getStatusName(payload.worker_status_id);

            setOfflineChannelsRaw((prev) => {
              const existing = prev.find((ch) => ch.id === payload.worker_id);
              if (existing) {
                return prev.map((ch) =>
                  ch.id === payload.worker_id
                    ? {
                        ...ch,
                        status:
                          statusId && statusName
                            ? { id: statusId, name: statusName }
                            : null,
                      }
                    : ch
                );
              }
              void fetchOfflineChannels();
              return prev;
            });
          }
        );
      }

      if (mountedRef.current) {
        setIsLoading(false);
      }

      pollingRef.current = setInterval(async () => {
        if (!mountedRef.current) return;
        await refreshUserChannels();
        await fetchOfflineChannels();
      }, POLLING_INTERVAL_MS);
    };

    bootstrap().catch(() => {
      if (mountedRef.current) setIsLoading(false);
    });

    return () => {
      mountedRef.current = false;
      removeListener?.();
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      cleanupChannelStatusSocket().catch(() => {});
    };
  }, []);

  return (
    <ChannelStatusContext.Provider
      value={{ offlineChannels, allChannelStatuses, isLoading, refresh }}
    >
      {children}
    </ChannelStatusContext.Provider>
  );
}
