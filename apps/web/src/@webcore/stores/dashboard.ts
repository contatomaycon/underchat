import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import axios from '@webcore/axios';
import { AxiosError } from 'axios';
import { GetDashboardStatsResponse } from '@core/schema/dashboard/getDashboardStats/response.schema';
import { GetDashboardConversationsResponse } from '@core/schema/dashboard/getDashboardConversations/response.schema';
import { GetDashboardAdditionalResponse } from '@core/schema/dashboard/getDashboardAdditional/response.schema';
import {
  ListOfflineChannelsFinalResponse,
  ListOfflineChannelsResponse,
} from '@core/schema/dashboard/listOfflineChannels/response.schema';
import { ListChannelsStatusFinalResponse } from '@core/schema/dashboard/listChannelsStatus/response.schema';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import {
  compareWhatsappConnectionStatusOrders,
  mergeWhatsappOrderedChannelHttpSnapshot,
  normalizeWhatsappConnectionStatusOrder,
  shouldApplyWhatsappConnectionStatusOrder,
  type WhatsappConnectionPublicStatus,
} from '@core/common/functions/whatsappConnectionStatus';

const DASHBOARD_OFFLINE_CHANNELS_CACHE_TTL_MS = 3000;

let dashboardOfflineChannelsRequestInFlight: Promise<ListOfflineChannelsFinalResponse | null> | null =
  null;
let dashboardOfflineChannelsLastFetchedAt = 0;
let dashboardOfflineChannelsHasFetched = false;
let dashboardChannelsStatusRequestInFlight: Promise<ListChannelsStatusFinalResponse | null> | null =
  null;

interface ApplyOfflineChannelStatusEventInput {
  channelId: string;
  channelName?: string | null;
  workerTypeId?: string | null;
  statusId?: string | null;
  statusName?: string | null;
  workerStatusObservedAt?: string | null;
  connectionStatus?: WhatsappConnectionPublicStatus | null;
  connectionStatusSourceId?: string | null;
  connectionStatusSequence?: number | null;
  connectionStatusChangedAt?: string | null;
  connectionStatusOrder?: string | null;
  connectionOnlineAcknowledged?: boolean;
  runtimeGeneration?: number | null;
  sessionIdentityPresent?: boolean;
}

const shouldRemoveFromOfflineChannels = (
  statusId: string | null | undefined,
  connectionStatus: WhatsappConnectionPublicStatus | null | undefined,
  connectionOnlineAcknowledged: boolean | undefined
): boolean => {
  return (
    statusId === EWorkerStatus.delete ||
    statusId === EWorkerStatus.deleting ||
    (!statusId && !connectionStatus) ||
    (statusId === EWorkerStatus.online &&
      (!connectionStatus ||
        (connectionStatus === 'online' &&
          connectionOnlineAcknowledged === true)))
  );
};

const normalizeOfflineChannels = (
  channels: ListOfflineChannelsFinalResponse
): ListOfflineChannelsFinalResponse => {
  const byId = new Map<string, ListOfflineChannelsResponse>();

  for (const channel of channels) {
    byId.set(channel.id, channel);
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
};

export const useDashboardStore = defineStore('dashboard', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loadingStats: false,
    loadingConversations: false,
    loadingAdditional: false,
    loadingOfflineChannels: false,
    stats: null as GetDashboardStatsResponse | null,
    conversations: null as GetDashboardConversationsResponse | null,
    additional: null as GetDashboardAdditionalResponse | null,
    offlineChannels: [] as ListOfflineChannelsFinalResponse,
    channelEffectiveOnlineById: {} as Record<string, boolean>,
    channelConnectionStatusOrderById: {} as Record<string, string>,
    channelWorkerTypeById: {} as Record<string, string>,
    channelRuntimeGenerationById: {} as Record<string, number>,
    channelSessionIdentityPresentById: {} as Record<string, boolean>,
    channelEffectiveOnlineReady: false,
  }),
  actions: {
    showSnackbar(message: string, color: EColor) {
      this.snackbar.message = message;
      this.snackbar.color = color;
      this.snackbar.status = true;
    },
    hideSnackbar() {
      this.snackbar.status = false;
    },
    async getDashboardStats(): Promise<GetDashboardStatsResponse | null> {
      try {
        this.loadingStats = true;

        const response =
          await axios.get<IApiResponse<GetDashboardStatsResponse>>(
            '/dashboard/stats'
          );

        if (response.data.status && response.data.data) {
          const data = response.data.data;
          this.stats = {
            ...data,
            channels: {
              ...data.channels,
              connected: this.channelEffectiveOnlineReady
                ? this.countEffectiveOnlineChannels()
                : data.channels.connected,
            },
          };
          return this.stats;
        }

        return null;
      } catch (error) {
        if (error instanceof AxiosError) {
          const message =
            error.response?.data?.message ||
            this.i18n.global.t('dashboard_stats_error');
          this.showSnackbar(message, EColor.error);
        }

        return null;
      } finally {
        this.loadingStats = false;
      }
    },
    async getDashboardConversations(): Promise<GetDashboardConversationsResponse | null> {
      try {
        this.loadingConversations = true;

        const response = await axios.get<
          IApiResponse<GetDashboardConversationsResponse>
        >('/dashboard/conversations');

        if (response.data.status && response.data.data) {
          this.conversations = response.data.data;
          return response.data.data;
        }

        return null;
      } catch (error) {
        if (error instanceof AxiosError) {
          const message =
            error.response?.data?.message ||
            this.i18n.global.t('dashboard_conversations_error');
          this.showSnackbar(message, EColor.error);
        }

        return null;
      } finally {
        this.loadingConversations = false;
      }
    },
    async getDashboardAdditional(): Promise<GetDashboardAdditionalResponse | null> {
      try {
        this.loadingAdditional = true;

        const response = await axios.get<
          IApiResponse<GetDashboardAdditionalResponse>
        >('/dashboard/additional');

        if (response.data.status && response.data.data) {
          this.additional = response.data.data;
          return response.data.data;
        }

        return null;
      } catch (error) {
        if (error instanceof AxiosError) {
          const message =
            error.response?.data?.message ||
            this.i18n.global.t('dashboard_additional_error');
          this.showSnackbar(message, EColor.error);
        }

        return null;
      } finally {
        this.loadingAdditional = false;
      }
    },
    async getDashboardOfflineChannels(
      force = false
    ): Promise<ListOfflineChannelsFinalResponse | null> {
      if (
        !force &&
        dashboardOfflineChannelsHasFetched &&
        Date.now() - dashboardOfflineChannelsLastFetchedAt <
          DASHBOARD_OFFLINE_CHANNELS_CACHE_TTL_MS
      ) {
        return this.offlineChannels;
      }

      if (dashboardOfflineChannelsRequestInFlight) {
        return dashboardOfflineChannelsRequestInFlight;
      }

      dashboardOfflineChannelsRequestInFlight = (async () => {
        const baselineOrders = new Map(
          Object.entries(this.channelConnectionStatusOrderById)
        );
        const baselineWorkerTypeIds = new Map(
          this.offlineChannels.map((channel) => [
            channel.id,
            channel.worker_type_id,
          ])
        );
        try {
          this.loadingOfflineChannels = true;

          const response = await axios.get<
            IApiResponse<ListOfflineChannelsFinalResponse>
          >('/dashboard/offline-channels');

          if (response.data.status && response.data.data) {
            const disconnectedWorkerIds = new Set(
              response.data.data
                .filter((channel) =>
                  Boolean(channel.connection_disconnected_at)
                )
                .map((channel) => channel.id)
            );
            const currentIds = new Set(
              this.offlineChannels.map((channel) => channel.id)
            );
            const candidates = response.data.data.filter(
              (channel) =>
                disconnectedWorkerIds.has(channel.id) ||
                currentIds.has(channel.id) ||
                shouldApplyWhatsappConnectionStatusOrder(
                  this.channelConnectionStatusOrderById[channel.id],
                  channel.connection_status_order
                )
            );
            this.offlineChannels = normalizeOfflineChannels(
              mergeWhatsappOrderedChannelHttpSnapshot(
                this.offlineChannels.filter(
                  (channel) => !disconnectedWorkerIds.has(channel.id)
                ),
                candidates,
                baselineOrders,
                { baselineWorkerTypeIds }
              )
            );
            for (const channel of this.offlineChannels) {
              if (channel.worker_type_id) {
                this.channelWorkerTypeById[channel.id] = channel.worker_type_id;
              }
              if (channel.runtime_generation) {
                this.channelRuntimeGenerationById[channel.id] =
                  channel.runtime_generation;
              }
              const order = normalizeWhatsappConnectionStatusOrder(
                channel.connection_status_order
              );
              if (channel.connection_disconnected_at) {
                delete this.channelConnectionStatusOrderById[channel.id];
              } else if (order) {
                this.channelConnectionStatusOrderById[channel.id] = order;
              }
            }
            dashboardOfflineChannelsHasFetched = true;
            dashboardOfflineChannelsLastFetchedAt = Date.now();
            return this.offlineChannels;
          }

          return null;
        } catch (error) {
          if (error instanceof AxiosError) {
            const message =
              error.response?.data?.message ||
              this.i18n.global.t('dashboard_offline_channels_error');
            this.showSnackbar(message, EColor.error);
          }

          return null;
        } finally {
          this.loadingOfflineChannels = false;
          dashboardOfflineChannelsRequestInFlight = null;
        }
      })();

      return dashboardOfflineChannelsRequestInFlight;
    },
    async getDashboardChannelsStatus(): Promise<ListChannelsStatusFinalResponse | null> {
      if (dashboardChannelsStatusRequestInFlight) {
        return dashboardChannelsStatusRequestInFlight;
      }

      dashboardChannelsStatusRequestInFlight = (async () => {
        const baselineOrders = new Map(
          Object.entries(this.channelConnectionStatusOrderById)
        );
        try {
          const response = await axios.get<
            IApiResponse<ListChannelsStatusFinalResponse>
          >('/chat/channels-status');
          if (!response.data.status || !response.data.data) {
            return null;
          }

          const current: ListChannelsStatusFinalResponse = Object.entries(
            this.channelEffectiveOnlineById
          ).map(([id, online]) => ({
            id,
            name: '',
            status: {
              id: online ? EWorkerStatus.online : EWorkerStatus.offline,
              name: online ? 'online' : 'offline',
            },
            worker_type_id: this.channelWorkerTypeById[id] ?? '',
            session_identity_present:
              this.channelSessionIdentityPresentById[id] ?? online,
            connection_status_order:
              this.channelConnectionStatusOrderById[id] ?? null,
            runtime_generation: this.channelRuntimeGenerationById[id] ?? null,
          }));
          const currentIds = new Set(current.map((channel) => channel.id));
          const disconnectedWorkerIds = new Set(
            response.data.data
              .filter((channel) => Boolean(channel.connection_disconnected_at))
              .map((channel) => channel.id)
          );
          const candidates = response.data.data.filter(
            (channel) =>
              disconnectedWorkerIds.has(channel.id) ||
              currentIds.has(channel.id) ||
              shouldApplyWhatsappConnectionStatusOrder(
                this.channelConnectionStatusOrderById[channel.id],
                channel.connection_status_order
              )
          );
          const merged = mergeWhatsappOrderedChannelHttpSnapshot(
            current.filter((channel) => !disconnectedWorkerIds.has(channel.id)),
            candidates,
            baselineOrders
          );
          const effectiveOnlineAtMerge = {
            ...this.channelEffectiveOnlineById,
          };
          this.channelEffectiveOnlineById = Object.fromEntries(
            merged.map((channel) => {
              const currentOrder = normalizeWhatsappConnectionStatusOrder(
                this.channelConnectionStatusOrderById[channel.id]
              );
              const baselineOrder = baselineOrders.get(channel.id);
              const realtimeAdvancedDuringRequest = Boolean(
                !disconnectedWorkerIds.has(channel.id) &&
                currentOrder &&
                (!baselineOrder ||
                  compareWhatsappConnectionStatusOrders(
                    currentOrder,
                    baselineOrder
                  ) > 0)
              );
              return [
                channel.id,
                realtimeAdvancedDuringRequest
                  ? (effectiveOnlineAtMerge[channel.id] ??
                    channel.status?.id === EWorkerStatus.online)
                  : channel.status?.id === EWorkerStatus.online,
              ];
            })
          );
          for (const channel of merged) {
            if (channel.worker_type_id) {
              this.channelWorkerTypeById[channel.id] = channel.worker_type_id;
            }
            if (channel.runtime_generation) {
              this.channelRuntimeGenerationById[channel.id] =
                channel.runtime_generation;
            }
            this.channelSessionIdentityPresentById[channel.id] =
              channel.session_identity_present;
            const order = normalizeWhatsappConnectionStatusOrder(
              channel.connection_status_order
            );
            if (channel.connection_disconnected_at) {
              delete this.channelConnectionStatusOrderById[channel.id];
            } else if (order) {
              this.channelConnectionStatusOrderById[channel.id] = order;
            }
          }
          this.channelEffectiveOnlineReady = true;
          this.synchronizeConnectedChannelsStat();
          return response.data.data;
        } catch {
          return null;
        } finally {
          dashboardChannelsStatusRequestInFlight = null;
        }
      })();

      return dashboardChannelsStatusRequestInFlight;
    },
    countEffectiveOnlineChannels(): number {
      return Object.values(this.channelEffectiveOnlineById).filter(Boolean)
        .length;
    },
    synchronizeConnectedChannelsStat() {
      if (!this.stats || !this.channelEffectiveOnlineReady) return;
      this.stats.channels.connected = this.countEffectiveOnlineChannels();
    },
    applyDashboardChannelEffectiveStatus(
      channelId: string,
      statusId: string | null | undefined,
      connectionStatusOrder?: string | null
    ) {
      if (!channelId || !statusId) return;
      if (connectionStatusOrder !== undefined) {
        const candidateOrder = normalizeWhatsappConnectionStatusOrder(
          connectionStatusOrder
        );
        if (!candidateOrder) return;
        const currentOrder = this.channelConnectionStatusOrderById[channelId];
        if (
          currentOrder &&
          compareWhatsappConnectionStatusOrders(candidateOrder, currentOrder) <
            0
        ) {
          return;
        }
        this.channelConnectionStatusOrderById = {
          ...this.channelConnectionStatusOrderById,
          [channelId]: candidateOrder,
        };
      }
      const nextOnline = statusId === EWorkerStatus.online;
      if (this.channelEffectiveOnlineById[channelId] === nextOnline) return;
      this.channelEffectiveOnlineById = {
        ...this.channelEffectiveOnlineById,
        [channelId]: nextOnline,
      };
      if (!this.channelEffectiveOnlineReady) {
        void this.getDashboardChannelsStatus();
        return;
      }
      this.synchronizeConnectedChannelsStat();
    },
    removeDashboardChannelEffectiveStatus(channelId: string) {
      if (!(channelId in this.channelEffectiveOnlineById)) return;
      const next = { ...this.channelEffectiveOnlineById };
      delete next[channelId];
      this.channelEffectiveOnlineById = next;
      if (!this.channelEffectiveOnlineReady) {
        void this.getDashboardChannelsStatus();
        return;
      }
      this.synchronizeConnectedChannelsStat();
    },
    applyOfflineChannelStatusEvent(input: ApplyOfflineChannelStatusEventInput) {
      const existing = this.offlineChannels.find(
        (ch) => ch.id === input.channelId
      );
      const hasOwn = <K extends keyof ApplyOfflineChannelStatusEventInput>(
        key: K
      ): boolean => Object.prototype.hasOwnProperty.call(input, key);
      const clearsNativeProjection =
        hasOwn('connectionStatus') &&
        input.connectionStatus === null &&
        hasOwn('connectionStatusSourceId') &&
        input.connectionStatusSourceId === null &&
        hasOwn('connectionStatusOrder') &&
        input.connectionStatusOrder === null;
      if (input.workerTypeId) {
        this.channelWorkerTypeById[input.channelId] = input.workerTypeId;
      }
      if (input.runtimeGeneration) {
        this.channelRuntimeGenerationById[input.channelId] =
          input.runtimeGeneration;
      }
      if (input.sessionIdentityPresent !== undefined) {
        this.channelSessionIdentityPresentById[input.channelId] =
          input.sessionIdentityPresent;
      }
      if (clearsNativeProjection) {
        const nextOrders = { ...this.channelConnectionStatusOrderById };
        delete nextOrders[input.channelId];
        this.channelConnectionStatusOrderById = nextOrders;
      } else if (
        input.connectionStatusOrder !== undefined ||
        input.connectionStatusSourceId !== undefined
      ) {
        const candidateOrder = normalizeWhatsappConnectionStatusOrder(
          input.connectionStatusOrder
        );
        if (!candidateOrder) return;
        const currentOrder =
          this.channelConnectionStatusOrderById[input.channelId] ??
          normalizeWhatsappConnectionStatusOrder(
            existing?.connection_status_order
          );
        if (
          currentOrder &&
          compareWhatsappConnectionStatusOrders(candidateOrder, currentOrder) <
            0
        ) {
          return;
        }
        this.channelConnectionStatusOrderById = {
          ...this.channelConnectionStatusOrderById,
          [input.channelId]: candidateOrder,
        };
      }

      if (
        shouldRemoveFromOfflineChannels(
          input.statusId,
          input.connectionStatus,
          input.connectionOnlineAcknowledged
        )
      ) {
        this.removeOfflineChannel(input.channelId);
        return;
      }

      const channelName = input.channelName?.trim() || existing?.name;

      if (!channelName) {
        return;
      }

      const nextChannel: ListOfflineChannelsResponse = {
        id: input.channelId,
        name: channelName,
        worker_type_id: input.workerTypeId ?? existing?.worker_type_id ?? '',
        status: input.statusId
          ? { id: input.statusId, name: input.statusName ?? null }
          : null,
        session_identity_present:
          input.sessionIdentityPresent ??
          existing?.session_identity_present ??
          this.channelSessionIdentityPresentById[input.channelId] ??
          input.statusId === EWorkerStatus.online,
        worker_status_observed_at: hasOwn('workerStatusObservedAt')
          ? (input.workerStatusObservedAt ?? undefined)
          : existing?.worker_status_observed_at,
        connection_status: hasOwn('connectionStatus')
          ? (input.connectionStatus ?? null)
          : (existing?.connection_status ?? null),
        connection_status_source_id: hasOwn('connectionStatusSourceId')
          ? (input.connectionStatusSourceId ?? null)
          : (existing?.connection_status_source_id ?? null),
        connection_status_sequence: hasOwn('connectionStatusSequence')
          ? (input.connectionStatusSequence ?? null)
          : (existing?.connection_status_sequence ?? null),
        connection_status_changed_at: hasOwn('connectionStatusChangedAt')
          ? (input.connectionStatusChangedAt ?? null)
          : (existing?.connection_status_changed_at ?? null),
        connection_status_order: hasOwn('connectionStatusOrder')
          ? (input.connectionStatusOrder ?? null)
          : (existing?.connection_status_order ?? null),
        connection_online_acknowledged:
          input.connectionOnlineAcknowledged ??
          existing?.connection_online_acknowledged ??
          false,
        runtime_generation:
          input.runtimeGeneration ?? existing?.runtime_generation ?? null,
      };

      this.offlineChannels = normalizeOfflineChannels([
        ...this.offlineChannels.filter((ch) => ch.id !== input.channelId),
        nextChannel,
      ]);
    },
    updateOfflineChannelStatus(
      channelId: string,
      statusId: string | null,
      statusName: string | null,
      channelName?: string | null
    ) {
      this.applyOfflineChannelStatusEvent({
        channelId,
        channelName,
        statusId,
        statusName,
      });
    },
    removeOfflineChannel(channelId: string) {
      this.offlineChannels = this.offlineChannels.filter(
        (ch) => ch.id !== channelId
      );
    },
  },
});
