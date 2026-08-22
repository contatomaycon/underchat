export type OutboundWebhookStatus = 'active' | 'inactive' | 'suspended';

export type OutboundWebhookDeliveryStatus =
  'pending' | 'leased' | 'retrying' | 'succeeded' | 'dead' | 'suppressed';

export interface OutboundWebhookChannel {
  id: string;
  name: string;
  number: string | null;
  available: boolean;
}

export interface OutboundWebhook {
  id: string;
  name: string;
  endpointUrl: string;
  channelId: string;
  channel: OutboundWebhookChannel;
  status: OutboundWebhookStatus;
  isActive: boolean;
  isVerified: boolean;
  eventTypes: readonly string[];
  secretPreview: string | null;
  configVersion: number;
  consecutiveDeadDeliveries: number;
  lastTestedAt: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface OutboundWebhookEventDefinition {
  type: string;
  group: string;
  labelKey: string;
  descriptionKey: string;
  description: string | null;
  selectable: boolean;
  fallback: boolean;
}

export interface OutboundWebhookEventGroup {
  key: string;
  labelKey: string;
  label: string | null;
  events: readonly OutboundWebhookEventDefinition[];
}

export interface OutboundWebhookSecretReveal {
  webhookId: string;
  secret: string;
}

export interface OutboundWebhookInput {
  name: string;
  endpointUrl: string;
  channelId: string;
  eventTypes: string[];
}

export interface OutboundWebhookTestResult {
  webhookId: string;
  deliveryId: string | null;
  status: 'pending' | 'succeeded' | 'failed';
  success: boolean;
  verified: boolean;
  statusCode: number | null;
  durationMs: number | null;
  testedAt: string | null;
  message: string | null;
}

export interface OutboundWebhookDelivery {
  id: string;
  webhookId: string;
  eventId: string | null;
  eventType: string;
  isTest: boolean;
  configVersion: number;
  status: OutboundWebhookDeliveryStatus;
  attempts: number;
  responseStatus: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  deliveredAt: string | null;
  nextRetryAt: string | null;
  deadAt: string | null;
  suppressedAt: string | null;
  lastError: string | null;
  redeliveryOfDeliveryId: string | null;
}

export interface OutboundWebhookDeliveryAttempt {
  id: string;
  attemptNumber: number;
  startedAt: string | null;
  finishedAt: string | null;
  outcome: string | null;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  responseBody: unknown;
  durationMs: number | null;
  retryAfterMs: number | null;
}

export interface OutboundWebhookDeliveryDetail extends OutboundWebhookDelivery {
  requestBody: unknown;
  responseBody: unknown;
  attemptHistory: readonly OutboundWebhookDeliveryAttempt[];
}

export type OutboundWebhookAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'rotate-secret'
  | 'test'
  | 'activate'
  | 'deactivate'
  | 'load-deliveries'
  | 'load-delivery'
  | 'redeliver'
  | null;
