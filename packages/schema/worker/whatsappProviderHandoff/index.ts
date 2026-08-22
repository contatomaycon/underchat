import { TSchema, Type } from '@sinclair/typebox';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import {
  resolveWhatsappProviderHandoffBodySchema,
  resolveWhatsappProviderHandoffParamsSchema,
  viewWhatsappProviderHandoffEvidenceQuerySchema,
  viewWhatsappProviderHandoffParamsSchema,
} from './request.schema';

const headers = Type.Object({
  'Accept-Language': Type.Optional(
    Type.String({
      enum: Object.values(ELanguage),
      default: ELanguage.pt,
    })
  ),
});

const providerSchema = Type.Union([
  Type.Literal('baileys'),
  Type.Literal('wwebjs'),
  Type.Literal('whatsmeow'),
]);

const handoffSchema = Type.Object({
  worker_id: Type.String({ format: 'uuid' }),
  handoff_id: Type.String({ format: 'uuid' }),
  lifecycle_operation_id: Type.Union([
    Type.String({ format: 'uuid' }),
    Type.Null(),
  ]),
  handoff_lifecycle_operation_id: Type.Union([
    Type.String({ format: 'uuid' }),
    Type.Null(),
  ]),
  state: Type.String(),
  source_provider: providerSchema,
  target_provider: providerSchema,
  source_revision_id: Type.String(),
  target_revision_id: Type.Union([Type.String(), Type.Null()]),
  error_code: Type.Union([Type.String(), Type.Null()]),
  recovery_state: Type.String(),
  recovery_operation_id: Type.Union([
    Type.String({ format: 'uuid' }),
    Type.Null(),
  ]),
  recovery_error_code: Type.Union([Type.String(), Type.Null()]),
  source_revision_preserved: Type.Boolean(),
  source_runtime_restored: Type.Boolean(),
  resolution_required: Type.Boolean(),
  can_return: Type.Boolean(),
  can_discard: Type.Boolean(),
  resolution_action: Type.Union([
    Type.Literal('return'),
    Type.Literal('discard'),
    Type.Null(),
  ]),
  resolution_state: Type.Union([
    Type.Literal('running'),
    Type.Literal('completed'),
    Type.Null(),
  ]),
  resolution_operation_id: Type.Union([
    Type.String({ format: 'uuid' }),
    Type.Null(),
  ]),
  resolution_status: Type.Union([
    Type.Literal('in_progress'),
    Type.Literal('completed'),
    Type.Literal('restoring_source'),
    Type.Literal('awaiting_decision'),
    Type.Literal('rollback_blocked'),
  ]),
  created_at: Type.String(),
  updated_at: Type.String(),
});

const responseEnvelope = <T extends TSchema>(data: T) =>
  Type.Object({
    id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    status: Type.Boolean(),
    message: Type.String(),
    data: Type.Optional(data),
  });

const viewResponse = responseEnvelope(Type.Union([handoffSchema, Type.Null()]));
const evidenceResponse = responseEnvelope(
  Type.Object({
    after_order: Type.Union([Type.String(), Type.Null()]),
    observed_through_order: Type.Union([Type.String(), Type.Null()]),
    first_window_order: Type.Union([Type.String(), Type.Null()]),
    last_window_order: Type.Union([Type.String(), Type.Null()]),
    window_event_count: Type.Integer({ minimum: 0 }),
    operation_event_count: Type.Integer({ minimum: 0 }),
    trace_event_count: Type.Integer({ minimum: 0 }),
    correlated_event_count: Type.Integer({ minimum: 0 }),
    pending_event_count: Type.Integer({ minimum: 0 }),
    dead_letter_event_count: Type.Integer({ minimum: 0 }),
    qr_event_count: Type.Integer({ minimum: 0 }),
    pairing_event_count: Type.Integer({ minimum: 0 }),
    passkey_event_count: Type.Integer({ minimum: 0 }),
    interactive_login_event_count: Type.Integer({ minimum: 0 }),
    interactive_login_detected: Type.Boolean(),
    window_limit: Type.Integer({ minimum: 1 }),
    window_truncated: Type.Boolean(),
  })
);
const resolutionResponse = responseEnvelope(
  Type.Object({
    action: Type.Union([Type.Literal('return'), Type.Literal('discard')]),
    status: Type.Union([
      Type.Literal('queued'),
      Type.Literal('completed'),
      Type.Literal('blocked'),
    ]),
    reason: Type.String(),
    handoff: Type.Union([handoffSchema, Type.Null()]),
    operation_id: Type.Optional(Type.String({ format: 'uuid' })),
  })
);

const errorResponse = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean(),
  message: Type.String(),
  data: Type.Optional(Type.Unknown()),
});

const base = {
  tags: [ETagSwagger.worker],
  produces: ['application/json'],
  security: [{ authenticateJwt: [] }],
  headers,
};

export const viewWhatsappProviderHandoffSchema = {
  ...base,
  description: 'Consulta o handoff mais recente e a seguranca do rollback',
  params: viewWhatsappProviderHandoffParamsSchema,
  response: {
    200: viewResponse,
    401: errorResponse,
    403: errorResponse,
  },
};

export const viewWhatsappProviderHandoffEvidenceSchema = {
  ...base,
  description:
    'Consulta evidencia sanitizada do outbox durante um handoff de provider',
  params: viewWhatsappProviderHandoffParamsSchema,
  querystring: viewWhatsappProviderHandoffEvidenceQuerySchema,
  response: {
    200: evidenceResponse,
    401: errorResponse,
    403: errorResponse,
  },
};

export const resolveWhatsappProviderHandoffSchema = {
  ...base,
  description: 'Retorna a origem ou descarta uma sessao apos falha do handoff',
  params: resolveWhatsappProviderHandoffParamsSchema,
  body: resolveWhatsappProviderHandoffBodySchema,
  response: {
    200: resolutionResponse,
    202: resolutionResponse,
    404: errorResponse,
    409: resolutionResponse,
    401: errorResponse,
    403: errorResponse,
  },
};
