import { computed, readonly, shallowRef } from 'vue';
import type { AxiosError } from 'axios';
import { useI18n } from 'vue-i18n';
import type { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { parseSerializedJson } from '@core/common/functions/jsonDisplay';
import axios from '@webcore/axios';
import type {
  OutboundWebhook,
  OutboundWebhookAction,
  OutboundWebhookChannel,
  OutboundWebhookDelivery,
  OutboundWebhookDeliveryAttempt,
  OutboundWebhookDeliveryDetail,
  OutboundWebhookDeliveryStatus,
  OutboundWebhookEventDefinition,
  OutboundWebhookEventGroup,
  OutboundWebhookInput,
  OutboundWebhookSecretReveal,
  OutboundWebhookTestResult,
} from '@/types/outboundWebhooks';

type RawRecord = Record<string, unknown>;

const BASE_PATH = '/integration/outbound-webhooks';
const REDACTED_VALUE = '[redacted]';
const SENSITIVE_FIELD_PATTERN =
  /authorization|cookie|keyapi|password|secret|signature|token/i;

const EVENT_TYPES_BY_GROUP = {
  chat: [
    'chat.created',
    'chat.queued',
    'chat.attended',
    'chat.joined',
    'chat.left',
    'chat.transferred',
    'chat.closed',
    'chat.reopened',
    'chat.status.changed',
    'chat.assignment.changed',
    'chat.labels.changed',
    'chat.protocol.updated',
    'chat.satisfaction.updated',
    'chat.updated',
    'chat.automation.started',
    'chat.automation.finished',
  ],
  message: [
    'message.received',
    'message.sent',
    'message.annotation.created',
    'message.system.created',
    'message.edited',
    'message.deleted',
    'message.reaction.updated',
    'message.pin.updated',
    'message.disappearing.updated',
    'message.media.updated',
    'message.transcription.updated',
    'message.updated',
  ],
  delivery: [
    'message.delivery.queued',
    'message.delivery.sent',
    'message.delivery.delivered',
    'message.delivery.read',
    'message.delivery.failed',
  ],
  contact: ['contact.created', 'contact.updated', 'contact.deleted'],
  control: ['webhook.test'],
} as const;

const FALLBACK_EVENT_TYPES = new Set([
  'chat.status.changed',
  'message.updated',
]);

const GROUP_LABEL_KEYS: Record<string, string> = {
  chat: 'outbound_webhook_event_group_chat',
  message: 'outbound_webhook_event_group_message',
  delivery: 'outbound_webhook_event_group_delivery',
  message_delivery: 'outbound_webhook_event_group_delivery',
  contact: 'outbound_webhook_event_group_contact',
  control: 'outbound_webhook_event_group_control',
};

const EVENT_GROUP_ORDER = ['chat', 'message', 'delivery', 'contact', 'control'];

const isRecord = (value: unknown): value is RawRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' &&
        value.trim() &&
        Number.isFinite(Number(value))
      ? Number(value)
      : null;

const asBoolean = (value: unknown): boolean | null =>
  typeof value === 'boolean'
    ? value
    : value === 1 || value === 'true'
      ? true
      : value === 0 || value === 'false'
        ? false
        : null;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

const rawRecord = (value: unknown): RawRecord => (isRecord(value) ? value : {});

const nestedRecord = (
  value: unknown,
  aliases: readonly string[]
): RawRecord => {
  const record = rawRecord(value);
  for (const key of aliases) {
    if (isRecord(record[key])) return record[key];
  }
  return record;
};

const apiPayload = (value: unknown, fallbackMessage: string): unknown => {
  if (!isRecord(value)) return value;
  if (value.status === false || value.success === false) {
    throw new Error(asString(value.message) ?? fallbackMessage);
  }
  if ('data' in value && value.data !== undefined && value.data !== null) {
    return value.data;
  }
  return value;
};

const recordItems = (
  value: unknown,
  aliases: readonly string[]
): RawRecord[] => {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];

  for (const key of aliases) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate.filter(isRecord);
  }
  return [];
};

const eventDescriptionKey = (type: string): string =>
  `outbound_webhook_event_${type.replaceAll('.', '_')}_description`;

const fallbackEventGroups = (): OutboundWebhookEventGroup[] =>
  Object.entries(EVENT_TYPES_BY_GROUP).map(([group, eventTypes]) => ({
    key: group,
    labelKey: GROUP_LABEL_KEYS[group],
    label: null,
    events: eventTypes.map((type) => ({
      type,
      group,
      labelKey: type,
      descriptionKey: eventDescriptionKey(type),
      description: null,
      selectable: type !== 'webhook.test',
      fallback: FALLBACK_EVENT_TYPES.has(type),
    })),
  }));

const normalizeGroup = (category: string, type: string): string => {
  if (category === 'message_delivery') return 'delivery';
  if (category === 'chat_lifecycle' || category === 'chat_changes')
    return 'chat';
  if (category === 'messages') return 'message';
  if (category === 'contacts') return 'contact';
  if (category && GROUP_LABEL_KEYS[category]) return category;
  if (category) return category;
  if (type.startsWith('message.delivery.')) return 'delivery';
  if (type.startsWith('message.')) return 'message';
  if (type.startsWith('chat.')) return 'chat';
  if (type.startsWith('contact.')) return 'contact';
  return 'control';
};

const normalizeCatalog = (payload: unknown): OutboundWebhookEventGroup[] => {
  const groups = new Map<string, OutboundWebhookEventGroup>();

  recordItems(payload, ['events', 'items', 'catalog']).forEach((rawEvent) => {
    const type = asString(rawEvent.type);
    if (!type) return;

    const category =
      asString(rawEvent.category) ?? asString(rawEvent.group) ?? '';
    const group = normalizeGroup(category, type);
    const event: OutboundWebhookEventDefinition = {
      type,
      group,
      labelKey: type,
      descriptionKey: eventDescriptionKey(type),
      description:
        asString(rawEvent.description) ?? asString(rawEvent.name) ?? null,
      selectable:
        (asBoolean(rawEvent.selectable) ?? type !== 'webhook.test') &&
        type !== 'webhook.test',
      fallback: FALLBACK_EVENT_TYPES.has(type),
    };

    const existing = groups.get(group);
    if (existing) {
      groups.set(group, {
        ...existing,
        events: [...existing.events, event],
      });
      return;
    }

    groups.set(group, {
      key: group,
      labelKey: GROUP_LABEL_KEYS[group] ?? 'outbound_webhook_event_group_other',
      label: null,
      events: [event],
    });
  });

  return [...groups.values()].sort((first, second) => {
    const firstIndex = EVENT_GROUP_ORDER.indexOf(first.key);
    const secondIndex = EVENT_GROUP_ORDER.indexOf(second.key);
    return (
      (firstIndex === -1 ? EVENT_GROUP_ORDER.length : firstIndex) -
      (secondIndex === -1 ? EVENT_GROUP_ORDER.length : secondIndex)
    );
  });
};

const normalizeChannel = (
  raw: RawRecord,
  channelId: string
): OutboundWebhookChannel => {
  const channelRecord = nestedRecord(raw, ['channel', 'worker']);
  const id =
    asString(channelRecord.id) ??
    asString(channelRecord.channel_id) ??
    asString(channelRecord.worker_id) ??
    channelId;

  return {
    id,
    name: asString(channelRecord.name) ?? '',
    number: asString(channelRecord.number),
    available:
      asBoolean(channelRecord.available) ??
      asBoolean(channelRecord.is_available) ??
      Boolean(id),
  };
};

const normalizeAvailableChannel = (
  raw: RawRecord
): OutboundWebhookChannel | null => {
  const channelId =
    asString(raw.id) ??
    asString(raw.channel_id) ??
    asString(raw.worker_id) ??
    '';
  if (!channelId) return null;

  const channel = normalizeChannel(raw, channelId);
  if (!channel.name) return null;
  return { ...channel, available: true };
};

const normalizeWebhook = (raw: RawRecord): OutboundWebhook => {
  const statusValue = asString(raw.status);
  const activeValue =
    asBoolean(raw.active) ??
    asBoolean(raw.is_active) ??
    statusValue === 'active';
  const status =
    statusValue === 'suspended'
      ? 'suspended'
      : activeValue
        ? 'active'
        : 'inactive';
  const isActive = status === 'active';
  const channelId =
    asString(raw.channel_id) ??
    asString(raw.worker_id) ??
    asString(rawRecord(raw.channel).id) ??
    asString(rawRecord(raw.channel).channel_id) ??
    '';

  return {
    id:
      asString(raw.outbound_webhook_id) ??
      asString(raw.webhook_id) ??
      asString(raw.id) ??
      '',
    name: asString(raw.name) ?? '',
    endpointUrl: asString(raw.url) ?? asString(raw.endpoint_url) ?? '',
    channelId,
    channel: normalizeChannel(raw, channelId),
    status,
    isActive,
    isVerified: Boolean(
      asBoolean(raw.current_version_verified) ?? asBoolean(raw.verified)
    ),
    eventTypes: asStringArray(raw.event_types ?? raw.events),
    secretPreview: asString(raw.secret_preview),
    configVersion: asNumber(raw.config_version) ?? 1,
    consecutiveDeadDeliveries: asNumber(raw.consecutive_dead_deliveries) ?? 0,
    lastTestedAt:
      asString(raw.last_tested_at) ?? asString(raw.verified_at) ?? null,
    suspendedAt: asString(raw.suspended_at),
    suspensionReason: asString(raw.suspension_reason),
    createdAt: asString(raw.created_at),
    updatedAt: asString(raw.updated_at),
  };
};

const normalizeDeliveryStatus = (
  value: unknown
): OutboundWebhookDeliveryStatus => {
  if (
    value === 'pending' ||
    value === 'leased' ||
    value === 'retrying' ||
    value === 'succeeded' ||
    value === 'dead' ||
    value === 'suppressed'
  ) {
    return value;
  }
  if (value === 'success' || value === 'delivered') return 'succeeded';
  if (value === 'failed' || value === 'dead_letter') return 'dead';
  return 'pending';
};

const normalizeDelivery = (raw: RawRecord): OutboundWebhookDelivery => ({
  id:
    asString(raw.outbound_webhook_delivery_id) ??
    asString(raw.delivery_id) ??
    asString(raw.id) ??
    '',
  webhookId:
    asString(raw.outbound_webhook_id) ?? asString(raw.webhook_id) ?? '',
  eventId: asString(raw.outbound_webhook_event_id) ?? asString(raw.event_id),
  eventType: asString(raw.event_type) ?? asString(raw.type) ?? 'unknown',
  isTest: Boolean(asBoolean(raw.is_test)),
  configVersion: asNumber(raw.config_version) ?? 1,
  status: normalizeDeliveryStatus(raw.status),
  attempts:
    asNumber(raw.attempts_count) ??
    asNumber(raw.attempt_count) ??
    asNumber(raw.attempts) ??
    0,
  responseStatus:
    asNumber(raw.response_status) ?? asNumber(raw.status_code) ?? null,
  createdAt: asString(raw.created_at),
  updatedAt: asString(raw.updated_at),
  deliveredAt: asString(raw.delivered_at) ?? asString(raw.succeeded_at) ?? null,
  nextRetryAt: asString(raw.next_attempt_at) ?? asString(raw.next_retry_at),
  deadAt: asString(raw.dead_at),
  suppressedAt: asString(raw.suppressed_at),
  lastError: asString(raw.last_error) ?? asString(raw.error_message) ?? null,
  redeliveryOfDeliveryId: asString(raw.redelivery_of_delivery_id),
});

const sanitizeValue = (
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0
): unknown => {
  if (depth > 8) return '[truncated]';
  if (typeof value === 'string') {
    return value
      .replace(/uc_whsec_[A-Za-z0-9_-]+/gu, REDACTED_VALUE)
      .replace(/v1=[a-f\d]{64}/giu, REDACTED_VALUE)
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, `Bearer ${REDACTED_VALUE}`);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen, depth + 1));
  }
  if (!isRecord(value)) return value;
  if (seen.has(value)) return '[circular]';

  seen.add(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_FIELD_PATTERN.test(key)
        ? REDACTED_VALUE
        : sanitizeValue(item, seen, depth + 1),
    ])
  );
};

const normalizeAttempt = (raw: RawRecord): OutboundWebhookDeliveryAttempt => ({
  id:
    asString(raw.outbound_webhook_delivery_attempt_id) ??
    asString(raw.attempt_id) ??
    asString(raw.id) ??
    '',
  attemptNumber: asNumber(raw.attempt_number) ?? 0,
  startedAt: asString(raw.started_at),
  finishedAt: asString(raw.finished_at),
  outcome: asString(raw.outcome),
  httpStatus: asNumber(raw.http_status) ?? asNumber(raw.status_code),
  errorCode: asString(raw.error_code),
  errorMessage: asString(raw.error_message),
  responseBody: sanitizeValue(parseSerializedJson(raw.response_body ?? null)),
  durationMs: asNumber(raw.duration_ms),
  retryAfterMs: asNumber(raw.retry_after_ms),
});

const normalizeDeliveryDetail = (
  raw: RawRecord
): OutboundWebhookDeliveryDetail => {
  const attempts = Array.isArray(raw.attempts)
    ? raw.attempts.filter(isRecord).map(normalizeAttempt)
    : [];
  const lastAttempt = attempts.at(-1) ?? null;

  return {
    ...normalizeDelivery(raw),
    requestBody: sanitizeValue(
      parseSerializedJson(raw.request_body ?? raw.payload)
    ),
    responseStatus:
      asNumber(raw.response_status) ??
      asNumber(raw.status_code) ??
      lastAttempt?.httpStatus ??
      null,
    responseBody: sanitizeValue(
      parseSerializedJson(
        raw.response_body ?? lastAttempt?.responseBody ?? null
      )
    ),
    attemptHistory: attempts,
  };
};

export function useOutboundWebhooks() {
  const { t, te } = useI18n();
  const webhooks = shallowRef<OutboundWebhook[]>([]);
  const eventGroups = shallowRef<OutboundWebhookEventGroup[]>(
    fallbackEventGroups()
  );
  const availableChannels = shallowRef<OutboundWebhookChannel[]>([]);
  const deliveries = shallowRef<OutboundWebhookDelivery[]>([]);
  const selectedDelivery = shallowRef<OutboundWebhookDeliveryDetail | null>(
    null
  );
  const deliveryNextCursor = shallowRef<string | null>(null);
  const secretReveal = shallowRef<OutboundWebhookSecretReveal | null>(null);
  const lastTestResult = shallowRef<OutboundWebhookTestResult | null>(null);
  const isLoading = shallowRef(false);
  const isLoadingChannels = shallowRef(false);
  const hasLoadedChannels = shallowRef(false);
  const channelsError = shallowRef<string | null>(null);
  const activeAction = shallowRef<OutboundWebhookAction>(null);
  const error = shallowRef<string | null>(null);
  const success = shallowRef<string | null>(null);

  const isMutating = computed(() => activeAction.value !== null);

  const translatedMessage = (message: string): string =>
    te(message) ? t(message) : message;

  const getErrorMessage = (caught: unknown, fallbackKey: string): string => {
    const axiosError = caught as AxiosError<Partial<IApiResponse<unknown>>>;
    const responseMessage = axiosError.response?.data?.message;
    if (responseMessage) return translatedMessage(responseMessage);
    if (caught instanceof Error && caught.message) {
      return translatedMessage(caught.message);
    }
    return t(fallbackKey);
  };

  const unwrapResponse = (response: unknown, fallbackKey: string): unknown =>
    apiPayload(response, t(fallbackKey));

  const clearFeedback = () => {
    error.value = null;
    success.value = null;
  };

  const replaceWebhook = (webhook: OutboundWebhook) => {
    const existingIndex = webhooks.value.findIndex(
      (item) => item.id === webhook.id
    );
    webhooks.value =
      existingIndex === -1
        ? [webhook, ...webhooks.value]
        : webhooks.value.map((item) =>
            item.id === webhook.id ? webhook : item
          );
  };

  const loadEvents = async (): Promise<boolean> => {
    try {
      const response = await axios.get<IApiResponse<unknown>>(
        `${BASE_PATH}/events`
      );
      const payload = unwrapResponse(
        response.data,
        'outbound_webhook_events_load_error'
      );
      eventGroups.value = normalizeCatalog(payload);
      return true;
    } catch (caught) {
      eventGroups.value = fallbackEventGroups();
      error.value = getErrorMessage(
        caught,
        'outbound_webhook_events_load_error'
      );
      return false;
    }
  };

  const loadWebhooks = async (): Promise<boolean> => {
    isLoading.value = true;
    error.value = null;
    try {
      const response = await axios.get<IApiResponse<unknown>>(BASE_PATH);
      const payload = unwrapResponse(
        response.data,
        'outbound_webhook_list_error'
      );
      webhooks.value = recordItems(payload, ['items', 'webhooks', 'results'])
        .map(normalizeWebhook)
        .filter((webhook) => webhook.id);
      return true;
    } catch (caught) {
      error.value = getErrorMessage(caught, 'outbound_webhook_list_error');
      return false;
    } finally {
      isLoading.value = false;
    }
  };

  const loadAvailableChannels = async (): Promise<boolean> => {
    isLoadingChannels.value = true;
    channelsError.value = null;
    try {
      const response = await axios.get<IApiResponse<unknown>>(
        '/integration/available-channels'
      );
      const payload = unwrapResponse(
        response.data,
        'outbound_webhook_channel_load_error'
      );
      const uniqueChannels = new Map<string, OutboundWebhookChannel>();
      recordItems(payload, ['channels', 'items', 'results'])
        .map(normalizeAvailableChannel)
        .filter((channel): channel is OutboundWebhookChannel =>
          Boolean(channel)
        )
        .forEach((channel) => uniqueChannels.set(channel.id, channel));
      availableChannels.value = [...uniqueChannels.values()];
      hasLoadedChannels.value = true;
      return true;
    } catch (caught) {
      channelsError.value = getErrorMessage(
        caught,
        'outbound_webhook_channel_load_error'
      );
      return false;
    } finally {
      isLoadingChannels.value = false;
    }
  };

  const loadAll = async (): Promise<void> => {
    await Promise.all([loadWebhooks(), loadEvents()]);
  };

  const loadWebhook = async (
    webhookId: string
  ): Promise<OutboundWebhook | null> => {
    try {
      const response = await axios.get<IApiResponse<RawRecord>>(
        `${BASE_PATH}/${webhookId}`
      );
      const webhook = normalizeWebhook(
        nestedRecord(
          unwrapResponse(response.data, 'outbound_webhook_view_error'),
          ['webhook', 'outbound_webhook']
        )
      );
      replaceWebhook(webhook);
      return webhook;
    } catch (caught) {
      error.value = getErrorMessage(caught, 'outbound_webhook_view_error');
      return null;
    }
  };

  const createWebhook = async (
    input: OutboundWebhookInput
  ): Promise<OutboundWebhook | null> => {
    activeAction.value = 'create';
    clearFeedback();
    try {
      const response = await axios.post<IApiResponse<unknown>>(BASE_PATH, {
        name: input.name,
        url: input.endpointUrl,
        channel_id: input.channelId,
        event_types: input.eventTypes,
      });
      const payload = unwrapResponse(
        response.data,
        'outbound_webhook_create_error'
      );
      const payloadRecord = rawRecord(payload);
      const webhook = normalizeWebhook(
        nestedRecord(payloadRecord, ['webhook', 'outbound_webhook'])
      );
      const secret =
        asString(payloadRecord.secret) ??
        asString(payloadRecord.signing_secret);
      if (!webhook.id || !secret) {
        throw new Error(t('outbound_webhook_secret_missing_error'));
      }
      replaceWebhook(webhook);
      secretReveal.value = { webhookId: webhook.id, secret };
      lastTestResult.value = null;
      success.value = t('outbound_webhook_create_success');
      return webhook;
    } catch (caught) {
      error.value = getErrorMessage(caught, 'outbound_webhook_create_error');
      return null;
    } finally {
      activeAction.value = null;
    }
  };

  const updateWebhook = async (
    webhookId: string,
    input: OutboundWebhookInput
  ): Promise<OutboundWebhook | null> => {
    activeAction.value = 'update';
    clearFeedback();
    try {
      const response = await axios.patch<IApiResponse<RawRecord>>(
        `${BASE_PATH}/${webhookId}`,
        {
          name: input.name,
          url: input.endpointUrl,
          channel_id: input.channelId,
          event_types: input.eventTypes,
        }
      );
      const webhook = normalizeWebhook(
        nestedRecord(
          unwrapResponse(response.data, 'outbound_webhook_update_error'),
          ['webhook', 'outbound_webhook']
        )
      );
      replaceWebhook(webhook);
      lastTestResult.value = null;
      success.value = t('outbound_webhook_update_success');
      return webhook;
    } catch (caught) {
      error.value = getErrorMessage(caught, 'outbound_webhook_update_error');
      return null;
    } finally {
      activeAction.value = null;
    }
  };

  const deleteWebhook = async (webhookId: string): Promise<boolean> => {
    activeAction.value = 'delete';
    clearFeedback();
    try {
      const response = await axios.delete<IApiResponse<unknown>>(
        `${BASE_PATH}/${webhookId}`
      );
      unwrapResponse(response.data, 'outbound_webhook_delete_error');
      webhooks.value = webhooks.value.filter((item) => item.id !== webhookId);
      if (secretReveal.value?.webhookId === webhookId)
        secretReveal.value = null;
      success.value = t('outbound_webhook_delete_success');
      return true;
    } catch (caught) {
      error.value = getErrorMessage(caught, 'outbound_webhook_delete_error');
      return false;
    } finally {
      activeAction.value = null;
    }
  };

  const rotateSecret = async (
    webhookId: string
  ): Promise<OutboundWebhook | null> => {
    activeAction.value = 'rotate-secret';
    clearFeedback();
    try {
      const response = await axios.post<IApiResponse<unknown>>(
        `${BASE_PATH}/${webhookId}/secret/rotate`
      );
      const payload = unwrapResponse(
        response.data,
        'outbound_webhook_rotate_error'
      );
      const payloadRecord = rawRecord(payload);
      const webhook = normalizeWebhook(
        nestedRecord(payloadRecord, ['webhook', 'outbound_webhook'])
      );
      const secret =
        asString(payloadRecord.secret) ??
        asString(payloadRecord.signing_secret);
      if (!webhook.id || !secret) {
        throw new Error(t('outbound_webhook_secret_missing_error'));
      }
      replaceWebhook(webhook);
      secretReveal.value = { webhookId, secret };
      lastTestResult.value = null;
      success.value = t('outbound_webhook_rotate_success');
      return webhook;
    } catch (caught) {
      error.value = getErrorMessage(caught, 'outbound_webhook_rotate_error');
      return null;
    } finally {
      activeAction.value = null;
    }
  };

  const pollSignedTest = async (
    webhookId: string,
    deliveryId: string
  ): Promise<void> => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, Math.min(1_000 + attempt * 250, 2_500));
      });
      try {
        const response = await axios.get<IApiResponse<RawRecord>>(
          `${BASE_PATH}/${webhookId}/deliveries/${deliveryId}`
        );
        const detail = normalizeDeliveryDetail(
          nestedRecord(
            unwrapResponse(
              response.data,
              'outbound_webhook_delivery_view_error'
            ),
            ['delivery']
          )
        );
        if (
          detail.status === 'pending' ||
          detail.status === 'leased' ||
          detail.status === 'retrying'
        )
          continue;

        const webhook = await loadWebhook(webhookId);
        lastTestResult.value = {
          webhookId,
          deliveryId,
          status: detail.status === 'succeeded' ? 'succeeded' : 'failed',
          success: detail.status === 'succeeded',
          verified: Boolean(webhook?.isVerified),
          statusCode: detail.responseStatus,
          durationMs: null,
          testedAt: detail.deliveredAt ?? detail.createdAt,
          message: detail.lastError,
        };
        return;
      } catch {
        // The delivery may not be queryable immediately after it is queued.
      }
    }
  };

  const sendSignedTest = async (webhookId: string): Promise<boolean> => {
    activeAction.value = 'test';
    clearFeedback();
    lastTestResult.value = null;
    try {
      const response = await axios.post<IApiResponse<unknown>>(
        `${BASE_PATH}/${webhookId}/test`
      );
      const payload = unwrapResponse(
        response.data,
        'outbound_webhook_test_error'
      );
      const payloadRecord = rawRecord(payload);
      const deliveryId =
        asString(payloadRecord.outbound_webhook_delivery_id) ??
        asString(payloadRecord.delivery_id) ??
        asString(payloadRecord.id);
      if (!deliveryId) {
        throw new Error(t('outbound_webhook_test_error'));
      }
      lastTestResult.value = {
        webhookId,
        deliveryId,
        status: 'pending',
        success: false,
        verified: false,
        statusCode: null,
        durationMs: null,
        testedAt: null,
        message: null,
      };
      success.value = t('outbound_webhook_test_queued');
      await pollSignedTest(webhookId, deliveryId);
      return true;
    } catch (caught) {
      error.value = getErrorMessage(caught, 'outbound_webhook_test_error');
      return false;
    } finally {
      activeAction.value = null;
    }
  };

  const setActive = async (
    webhookId: string,
    active: boolean
  ): Promise<OutboundWebhook | null> => {
    activeAction.value = active ? 'activate' : 'deactivate';
    clearFeedback();
    try {
      const response = await axios.patch<IApiResponse<RawRecord>>(
        `${BASE_PATH}/${webhookId}/activate`,
        { active }
      );
      const webhook = normalizeWebhook(
        nestedRecord(
          unwrapResponse(response.data, 'outbound_webhook_status_error'),
          ['webhook', 'outbound_webhook']
        )
      );
      replaceWebhook(webhook);
      success.value = t(
        active
          ? 'outbound_webhook_activate_success'
          : 'outbound_webhook_deactivate_success'
      );
      return webhook;
    } catch (caught) {
      error.value = getErrorMessage(caught, 'outbound_webhook_status_error');
      return null;
    } finally {
      activeAction.value = null;
    }
  };

  const loadDeliveries = async (
    webhookId: string,
    cursor: string | null = null
  ): Promise<boolean> => {
    activeAction.value = 'load-deliveries';
    error.value = null;
    try {
      const response = await axios.get<IApiResponse<unknown>>(
        `${BASE_PATH}/${webhookId}/deliveries`,
        { params: { limit: 20, cursor: cursor || undefined } }
      );
      const payload = unwrapResponse(
        response.data,
        'outbound_webhook_deliveries_load_error'
      );
      const payloadRecord = rawRecord(payload);
      const normalized = recordItems(payload, [
        'items',
        'deliveries',
        'results',
      ])
        .map(normalizeDelivery)
        .filter((delivery) => delivery.id);
      deliveries.value = cursor
        ? [...deliveries.value, ...normalized]
        : normalized;
      deliveryNextCursor.value =
        asString(payloadRecord.next_cursor) ??
        asString(payloadRecord.nextCursor);
      return true;
    } catch (caught) {
      error.value = getErrorMessage(
        caught,
        'outbound_webhook_deliveries_load_error'
      );
      return false;
    } finally {
      activeAction.value = null;
    }
  };

  const loadDelivery = async (
    webhookId: string,
    deliveryId: string
  ): Promise<boolean> => {
    activeAction.value = 'load-delivery';
    error.value = null;
    selectedDelivery.value = null;
    try {
      const response = await axios.get<IApiResponse<RawRecord>>(
        `${BASE_PATH}/${webhookId}/deliveries/${deliveryId}`
      );
      selectedDelivery.value = normalizeDeliveryDetail(
        nestedRecord(
          unwrapResponse(response.data, 'outbound_webhook_delivery_view_error'),
          ['delivery']
        )
      );
      return true;
    } catch (caught) {
      error.value = getErrorMessage(
        caught,
        'outbound_webhook_delivery_view_error'
      );
      return false;
    } finally {
      activeAction.value = null;
    }
  };

  const redeliver = async (
    webhookId: string,
    deliveryId: string
  ): Promise<boolean> => {
    activeAction.value = 'redeliver';
    clearFeedback();
    try {
      const response = await axios.post<IApiResponse<unknown>>(
        `${BASE_PATH}/${webhookId}/deliveries/${deliveryId}/redeliver`
      );
      const payload = rawRecord(
        unwrapResponse(response.data, 'outbound_webhook_redelivery_error')
      );
      const queuedDeliveryId =
        asString(payload.outbound_webhook_delivery_id) ??
        asString(payload.delivery_id);
      if (!queuedDeliveryId) {
        throw new Error(t('outbound_webhook_redelivery_error'));
      }
      success.value = t('outbound_webhook_redelivery_success');
      return true;
    } catch (caught) {
      error.value = getErrorMessage(
        caught,
        'outbound_webhook_redelivery_error'
      );
      return false;
    } finally {
      activeAction.value = null;
    }
  };

  const clearSecretReveal = () => {
    secretReveal.value = null;
  };

  const clearDeliveryState = () => {
    deliveries.value = [];
    selectedDelivery.value = null;
    deliveryNextCursor.value = null;
  };

  return {
    webhooks: readonly(webhooks),
    eventGroups: readonly(eventGroups),
    availableChannels: readonly(availableChannels),
    deliveries: readonly(deliveries),
    selectedDelivery: readonly(selectedDelivery),
    deliveryNextCursor: readonly(deliveryNextCursor),
    secretReveal: readonly(secretReveal),
    lastTestResult: readonly(lastTestResult),
    isLoading: readonly(isLoading),
    isLoadingChannels: readonly(isLoadingChannels),
    hasLoadedChannels: readonly(hasLoadedChannels),
    channelsError: readonly(channelsError),
    activeAction: readonly(activeAction),
    isMutating,
    error: readonly(error),
    success: readonly(success),
    loadAll,
    loadEvents,
    loadWebhooks,
    loadWebhook,
    loadAvailableChannels,
    createWebhook,
    updateWebhook,
    deleteWebhook,
    rotateSecret,
    sendSignedTest,
    setActive,
    loadDeliveries,
    loadDelivery,
    redeliver,
    clearFeedback,
    clearSecretReveal,
    clearDeliveryState,
  };
}
