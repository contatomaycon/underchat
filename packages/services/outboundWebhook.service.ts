import { createHash, randomBytes } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import {
  OUTBOUND_WEBHOOK_EVENT_CATALOG,
  OUTBOUND_WEBHOOK_SELECTABLE_EVENT_TYPES,
  isSelectableOutboundWebhookEventType,
} from '@core/common/constants/outboundWebhookEvents';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import {
  OutboundWebhookEventService,
  buildOutboundWebhookIdempotencyKey,
} from '@core/services/outboundWebhookEvent.service';
import {
  OutboundWebhookHttpPolicyError,
  validateOutboundWebhookUrl,
} from '@core/common/functions/outboundWebhookHttp';
import {
  OutboundWebhookRepository,
  type OutboundWebhookDeliveryCursor,
  type OutboundWebhookRecord,
} from '@core/repositories/outboundWebhook/OutboundWebhook.repository';
import type {
  CreateOutboundWebhookRequest,
  UpdateOutboundWebhookRequest,
} from '@core/schema/integration/outboundWebhook/request.schema';
import type {
  OutboundWebhookDeliveryDetailResponse,
  OutboundWebhookDeliveryListResponse,
  OutboundWebhookEnqueueResponse,
  OutboundWebhookResponse,
  OutboundWebhookSecretResponse,
} from '@core/schema/integration/outboundWebhook/response.schema';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { PlanEntitlementService } from '@core/services/planEntitlement.service';
import {
  PlanEntitlementDeniedError,
  PlanEntitlementUnavailableError,
} from '@core/common/exceptions/PlanEntitlementError';

const OUTBOUND_WEBHOOK_SECRET_PREFIX = 'uc_whsec_';
const OUTBOUND_WEBHOOK_SECRET_BYTES = 32;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OutboundWebhookServiceErrorCode =
  | 'invalid_name'
  | 'invalid_url'
  | 'invalid_event_types'
  | 'invalid_channel'
  | 'channel_unavailable'
  | 'invalid_cursor'
  | 'not_found'
  | 'account_ineligible'
  | 'no_events'
  | 'unverified'
  | 'endpoint_inactive'
  | 'not_redeliverable'
  | 'concurrent_update'
  | 'endpoint_limit'
  | 'entitlement_epoch_mismatch'
  | 'integration_plan_required'
  | 'plan_entitlement_unavailable'
  | 'delivery_enqueue_failed';

export class OutboundWebhookServiceError extends Error {
  constructor(public readonly code: OutboundWebhookServiceErrorCode) {
    super(`outbound_webhook_${code}`);
    this.name = 'OutboundWebhookServiceError';
  }
}

export function generateOutboundWebhookSecret(): string {
  return `${OUTBOUND_WEBHOOK_SECRET_PREFIX}${randomBytes(
    OUTBOUND_WEBHOOK_SECRET_BYTES
  ).toString('base64url')}`;
}

export function hashOutboundWebhookSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function previewOutboundWebhookSecret(secret: string): string {
  return `${OUTBOUND_WEBHOOK_SECRET_PREFIX}...${secret.slice(-8)}`;
}

function normalizeName(value: string): string {
  const name = value.trim();
  if (name.length < 2 || name.length > 200) {
    throw new OutboundWebhookServiceError('invalid_name');
  }
  return name;
}

function normalizeUrl(value: string): string {
  try {
    const appEnvironment = process.env.APP_ENVIRONMENT?.trim().toLowerCase();
    const nodeEnvironment = process.env.NODE_ENV?.trim().toLowerCase();
    const isDevelopment = appEnvironment
      ? ['local', 'dev', 'development', 'test'].includes(appEnvironment)
      : nodeEnvironment === 'development';
    const isProduction = appEnvironment
      ? !isDevelopment
      : nodeEnvironment === 'production';
    const allowLocalhostHttp =
      !isProduction &&
      isDevelopment &&
      process.env.OUTBOUND_WEBHOOK_ALLOW_LOCALHOST_HTTP?.trim().toLowerCase() ===
        'true';

    const normalized = validateOutboundWebhookUrl({
      url: value.trim(),
      isProduction,
      allowLocalhostHttp,
    }).url.toString();
    if (normalized.length > 2048) {
      throw new OutboundWebhookServiceError('invalid_url');
    }
    return normalized;
  } catch (error) {
    if (error instanceof OutboundWebhookHttpPolicyError) {
      throw new OutboundWebhookServiceError('invalid_url');
    }
    throw new OutboundWebhookServiceError('invalid_url');
  }
}

function normalizeEventTypes(eventTypes: readonly string[]): string[] {
  if (
    eventTypes.length === 0 ||
    eventTypes.some(
      (eventType) => !isSelectableOutboundWebhookEventType(eventType)
    )
  ) {
    throw new OutboundWebhookServiceError('invalid_event_types');
  }

  const selected = new Set(eventTypes);
  return OUTBOUND_WEBHOOK_SELECTABLE_EVENT_TYPES.filter((eventType) =>
    selected.has(eventType)
  );
}

function normalizeChannelId(value: string): string {
  const channelId = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(channelId)) {
    throw new OutboundWebhookServiceError('invalid_channel');
  }
  return channelId;
}

function toResponse(record: OutboundWebhookRecord): OutboundWebhookResponse {
  return {
    outbound_webhook_id: record.outbound_webhook_id,
    channel_id: record.channel_id,
    channel: { ...record.channel },
    name: record.name,
    url: record.url,
    status: record.status,
    secret_preview: record.secret_preview,
    config_version: record.config_version,
    event_types: record.event_types,
    verified: record.verified_at !== null,
    verified_at: record.verified_at,
    consecutive_dead_deliveries: record.consecutive_dead_deliveries,
    suspended_at: record.suspended_at,
    suspension_reason: record.suspension_reason,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function encodeCursor(cursor: OutboundWebhookDeliveryCursor): string {
  return Buffer.from(
    JSON.stringify({
      created_at: cursor.createdAt,
      delivery_id: cursor.deliveryId,
    }),
    'utf8'
  ).toString('base64url');
}

function decodeCursor(
  cursor?: string
): OutboundWebhookDeliveryCursor | undefined {
  if (!cursor) return undefined;

  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8')
    ) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid');
    }

    const values = parsed as Record<string, unknown>;
    if (
      typeof values.created_at !== 'string' ||
      Number.isNaN(Date.parse(values.created_at)) ||
      typeof values.delivery_id !== 'string' ||
      !UUID_PATTERN.test(values.delivery_id)
    ) {
      throw new Error('invalid');
    }

    return {
      createdAt: new Date(values.created_at).toISOString(),
      deliveryId: values.delivery_id,
    };
  } catch {
    throw new OutboundWebhookServiceError('invalid_cursor');
  }
}

@injectable()
export class OutboundWebhookService {
  constructor(
    @inject(OutboundWebhookRepository)
    private readonly outboundWebhookRepository: OutboundWebhookRepository,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(OutboundWebhookEventService)
    private readonly outboundWebhookEventService: OutboundWebhookEventService,
    @inject(PlanEntitlementService)
    private readonly planEntitlementService: PlanEntitlementService | null = null
  ) {}

  listEvents = () => ({
    events: OUTBOUND_WEBHOOK_EVENT_CATALOG.map((event) => ({ ...event })),
  });

  list = async (accountId: string): Promise<OutboundWebhookResponse[]> => {
    const records = await this.outboundWebhookRepository.list(accountId);
    return records.map(toResponse);
  };

  view = async (
    accountId: string,
    webhookId: string
  ): Promise<OutboundWebhookResponse> => {
    const record = await this.outboundWebhookRepository.findById(
      accountId,
      webhookId
    );
    if (!record) throw new OutboundWebhookServiceError('not_found');
    return toResponse(record);
  };

  create = async (
    accountId: string,
    input: CreateOutboundWebhookRequest
  ): Promise<OutboundWebhookSecretResponse> => {
    const secret = generateOutboundWebhookSecret();
    const webhookId = uuidv7();
    const created = await this.outboundWebhookRepository.create({
      outbound_webhook_id: webhookId,
      account_id: accountId,
      channel_id: normalizeChannelId(input.channel_id),
      name: normalizeName(input.name),
      url: normalizeUrl(input.url),
      secret_hash: hashOutboundWebhookSecret(secret),
      secret_encrypted: this.passwordEncryptorService.encrypt(secret),
      secret_preview: previewOutboundWebhookSecret(secret),
      event_types: normalizeEventTypes(input.event_types),
    });
    if (created === 'invalid_channel') {
      throw new OutboundWebhookServiceError('invalid_channel');
    }
    if (created === 'endpoint_limit') {
      throw new OutboundWebhookServiceError('endpoint_limit');
    }

    const webhook = await this.view(accountId, webhookId);
    return { webhook, secret };
  };

  update = async (
    accountId: string,
    webhookId: string,
    input: UpdateOutboundWebhookRequest
  ): Promise<OutboundWebhookResponse> => {
    const updated = await this.outboundWebhookRepository.update(
      accountId,
      webhookId,
      {
        ...(input.name !== undefined
          ? { name: normalizeName(input.name) }
          : {}),
        ...(input.url !== undefined ? { url: normalizeUrl(input.url) } : {}),
        ...(input.channel_id !== undefined
          ? { channel_id: normalizeChannelId(input.channel_id) }
          : {}),
        ...(input.event_types !== undefined
          ? { event_types: normalizeEventTypes(input.event_types) }
          : {}),
      }
    );
    if (updated === 'invalid_channel') {
      throw new OutboundWebhookServiceError('invalid_channel');
    }
    if (updated === 'not_found') {
      throw new OutboundWebhookServiceError('not_found');
    }
    return this.view(accountId, webhookId);
  };

  softDelete = async (
    accountId: string,
    webhookId: string
  ): Promise<{ deleted: true }> => {
    const deleted = await this.outboundWebhookRepository.softDelete(
      accountId,
      webhookId
    );
    if (!deleted) throw new OutboundWebhookServiceError('not_found');
    return { deleted: true };
  };

  rotateSecret = async (
    accountId: string,
    webhookId: string
  ): Promise<OutboundWebhookSecretResponse> => {
    const secret = generateOutboundWebhookSecret();
    const secretPreview = previewOutboundWebhookSecret(secret);
    const rotatedVersion = await this.outboundWebhookRepository.rotateSecret(
      accountId,
      webhookId,
      {
        secret_hash: hashOutboundWebhookSecret(secret),
        secret_encrypted: this.passwordEncryptorService.encrypt(secret),
        secret_preview: secretPreview,
      }
    );
    if (rotatedVersion === null) {
      throw new OutboundWebhookServiceError('not_found');
    }
    const webhook = await this.view(accountId, webhookId);
    if (
      webhook.config_version !== rotatedVersion ||
      webhook.secret_preview !== secretPreview
    ) {
      // Another rotation won after this request committed. Never pair this
      // request's one-time secret with the newer configuration metadata.
      throw new OutboundWebhookServiceError('concurrent_update');
    }
    return { webhook, secret };
  };

  private assertEligible = async (accountId: string): Promise<void> => {
    if (this.planEntitlementService) {
      try {
        await this.planEntitlementService.assertEntitled(
          accountId,
          EPlanProduct.integration
        );
        return;
      } catch (error) {
        if (error instanceof PlanEntitlementDeniedError) {
          throw new OutboundWebhookServiceError('integration_plan_required');
        }
        if (error instanceof PlanEntitlementUnavailableError) {
          throw new OutboundWebhookServiceError('plan_entitlement_unavailable');
        }
        throw error;
      }
    }

    const eligible =
      await this.outboundWebhookRepository.isAccountEligible(accountId);
    if (!eligible) {
      throw new OutboundWebhookServiceError('account_ineligible');
    }
  };

  enqueueTest = async (
    accountId: string,
    webhookId: string,
    actorUserId: string
  ): Promise<OutboundWebhookEnqueueResponse> => {
    const webhook = await this.view(accountId, webhookId);
    await this.assertEligible(accountId);
    if (!webhook.channel.available) {
      throw new OutboundWebhookServiceError('channel_unavailable');
    }

    const requestedAt = new Date().toISOString();
    const requestNonce = uuidv7();
    let prepared: Awaited<
      ReturnType<OutboundWebhookEventService['recordReady']>
    >;
    try {
      prepared = await this.outboundWebhookEventService.recordReady({
        accountId,
        eventType: 'webhook.test',
        aggregate: { type: 'webhook', id: webhookId },
        data: {
          verification: {
            webhook_id: webhookId,
            config_version: webhook.config_version,
            requested_at: requestedAt,
          },
        },
        source: 'integration_test',
        channelIds: [webhook.channel_id],
        actor: { type: 'user', id: actorUserId },
        occurredAt: requestedAt,
        idempotencyKey: buildOutboundWebhookIdempotencyKey(
          'integration_test',
          webhookId,
          webhook.config_version,
          requestNonce
        ),
        isTest: true,
        targetWebhookId: webhookId,
        targetConfigVersion: webhook.config_version,
      });
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.message === 'outbound_webhook_target_not_found' ||
          error.message === 'outbound_webhook_event_no_target')
      ) {
        const currentWebhook = await this.outboundWebhookRepository.findById(
          accountId,
          webhookId
        );
        if (!currentWebhook) {
          throw new OutboundWebhookServiceError('not_found');
        }
        if (!currentWebhook.channel.available) {
          throw new OutboundWebhookServiceError('channel_unavailable');
        }
        const isAccountEligible =
          await this.outboundWebhookRepository.isAccountEligible(accountId);
        if (!isAccountEligible) {
          throw new OutboundWebhookServiceError('account_ineligible');
        }
        throw new OutboundWebhookServiceError('concurrent_update');
      }
      throw error;
    }

    if (prepared.state === 'discarded') {
      // Completion performs a second entitlement preflight. If a downgrade
      // won after the route guard/prepare step, expose the plan denial instead
      // of falling through to a missing-delivery 500. If access was restored
      // under another revision, the captured test event belongs to the old
      // epoch and must be reported as a conflict.
      await this.assertEligible(accountId);
      throw new OutboundWebhookServiceError('entitlement_epoch_mismatch');
    }

    const delivery = await this.outboundWebhookRepository.findDeliveryForEvent(
      accountId,
      webhookId,
      prepared.eventId
    );
    if (!delivery) {
      throw new OutboundWebhookServiceError('delivery_enqueue_failed');
    }

    return {
      outbound_webhook_event_id: prepared.eventId,
      outbound_webhook_delivery_id: delivery.outbound_webhook_delivery_id,
      status: 'pending',
    };
  };

  setActive = async (
    accountId: string,
    webhookId: string,
    active: boolean
  ): Promise<OutboundWebhookResponse> => {
    if (active) await this.assertEligible(accountId);

    const result = await this.outboundWebhookRepository.setActive(
      accountId,
      webhookId,
      active
    );
    if (result === 'not_found') {
      throw new OutboundWebhookServiceError('not_found');
    }
    if (result === 'no_events') {
      throw new OutboundWebhookServiceError('no_events');
    }
    if (result === 'unverified') {
      throw new OutboundWebhookServiceError('unverified');
    }
    if (result === 'channel_unavailable') {
      throw new OutboundWebhookServiceError('channel_unavailable');
    }

    return this.view(accountId, webhookId);
  };

  listDeliveries = async (
    accountId: string,
    webhookId: string,
    limit = 20,
    encodedCursor?: string
  ): Promise<OutboundWebhookDeliveryListResponse> => {
    await this.view(accountId, webhookId);
    const cursor = decodeCursor(encodedCursor);
    const rows = await this.outboundWebhookRepository.listDeliveries(
      accountId,
      webhookId,
      limit + 1,
      cursor
    );
    const hasNextPage = rows.length > limit;
    const items = hasNextPage ? rows.slice(0, limit) : rows;
    const last = items.at(-1);

    return {
      items,
      next_cursor:
        hasNextPage && last
          ? encodeCursor({
              createdAt: last.created_at,
              deliveryId: last.outbound_webhook_delivery_id,
            })
          : null,
    };
  };

  viewDelivery = async (
    accountId: string,
    webhookId: string,
    deliveryId: string
  ): Promise<OutboundWebhookDeliveryDetailResponse> => {
    const delivery = await this.outboundWebhookRepository.findDeliveryById(
      accountId,
      webhookId,
      deliveryId
    );
    if (!delivery) throw new OutboundWebhookServiceError('not_found');
    return delivery;
  };

  redeliver = async (
    accountId: string,
    webhookId: string,
    deliveryId: string,
    actorUserId: string
  ): Promise<OutboundWebhookEnqueueResponse> => {
    await this.assertEligible(accountId);
    const result = await this.outboundWebhookRepository.redeliver(
      accountId,
      webhookId,
      deliveryId,
      actorUserId
    );
    if (result.status === 'not_found') {
      throw new OutboundWebhookServiceError('not_found');
    }
    if (result.status === 'endpoint_inactive') {
      throw new OutboundWebhookServiceError('endpoint_inactive');
    }
    if (result.status === 'channel_unavailable') {
      throw new OutboundWebhookServiceError('channel_unavailable');
    }
    if (result.status === 'not_redeliverable') {
      throw new OutboundWebhookServiceError('not_redeliverable');
    }
    if (result.status === 'entitlement_epoch_mismatch') {
      throw new OutboundWebhookServiceError('entitlement_epoch_mismatch');
    }

    return {
      outbound_webhook_event_id: result.outbound_webhook_event_id,
      outbound_webhook_delivery_id: result.outbound_webhook_delivery_id,
      status: 'pending',
    };
  };
}
