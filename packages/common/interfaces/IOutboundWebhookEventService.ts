import type { OutboundWebhookEventType } from '@core/common/constants/outboundWebhookEvents';
import type {
  OutboundWebhookActor,
  OutboundWebhookAggregate,
  OutboundWebhookEnvelope,
  OutboundWebhookJsonValue,
} from '@core/common/functions/outboundWebhookPayload';

export const OUTBOUND_WEBHOOK_EVENT_SERVICE_TOKEN =
  'OutboundWebhookEventService';

export interface PrepareOutboundWebhookEventInput {
  eventId?: string;
  accountId: string;
  eventType: OutboundWebhookEventType;
  aggregate: OutboundWebhookAggregate;
  data: Record<string, OutboundWebhookJsonValue>;
  previous?: Record<string, OutboundWebhookJsonValue> | null;
  source: string;
  channelIds: readonly string[];
  actor?: OutboundWebhookActor | null;
  occurredAt?: Date | string;
  idempotencyKey: string;
  isTest?: boolean;
  targetWebhookId?: string;
  targetConfigVersion?: number;
}

export interface PreparedOutboundWebhookEvent {
  eventId: string;
  envelope: OutboundWebhookEnvelope;
  created: boolean;
  state: 'preparing' | 'ready' | 'discarded' | 'cancelled' | 'quarantined';
}

export interface CompleteOutboundWebhookEventInput {
  eventId: string;
  accountId: string;
  envelope: OutboundWebhookEnvelope;
  targetWebhookId?: string;
}

export interface OutboundWebhookEventServicePort {
  prepareBestEffort(
    input: PrepareOutboundWebhookEventInput
  ): Promise<PreparedOutboundWebhookEvent | null>;
  completeBestEffort(
    input: CompleteOutboundWebhookEventInput
  ): Promise<boolean>;
}
