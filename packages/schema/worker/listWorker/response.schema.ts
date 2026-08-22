import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerRecreatePhase } from '@core/common/enums/EWorkerRecreatePhase';
import {
  whatsappConnectionStatusSchema,
  whatsappConnectionStatusObservedAtSchema,
  whatsappConnectionStatusOrderSchema,
  whatsappConnectionStatusSourceIdSchema,
} from '@core/schema/common/whatsappConnectionStatus.schema';

const workerStatusSchema = Type.Object({
  id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
});

const workerTypeSchema = Type.Object({
  id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
});

const workerServerSchema = Type.Object({
  id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
});

const workerAccountSchema = Type.Object({
  id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
});

const whatsappProviderHandoffRecoverySchema = Type.Object({
  handoff_id: Type.String({ format: 'uuid' }),
  lifecycle_operation_id: Type.String({ format: 'uuid' }),
  source_provider: Type.Union([
    Type.Literal('baileys'),
    Type.Literal('wwebjs'),
    Type.Literal('whatsmeow'),
  ]),
  target_provider: Type.Union([
    Type.Literal('baileys'),
    Type.Literal('wwebjs'),
    Type.Literal('whatsmeow'),
  ]),
});

export const listWorkerResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  session_storage: Type.Enum(EWorkerSessionStorage),
  number: Type.Union([Type.String(), Type.Null()]),
  status: Type.Union([workerStatusSchema, Type.Null()]),
  type: Type.Union([workerTypeSchema, Type.Null()]),
  server: Type.Optional(Type.Union([workerServerSchema, Type.Null()])),
  account: Type.Optional(Type.Union([workerAccountSchema, Type.Null()])),
  connection_date: Type.Union([Type.String(), Type.Null()]),
  last_connection_check_at: Type.Union([Type.String(), Type.Null()]),
  recreate_available_at: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.Union([Type.String(), Type.Null()]),
  updated_at: Type.Union([Type.String(), Type.Null()]),
  official_template_manager_url: Type.Optional(Type.String()),
  worker_status_observed_at: Type.Optional(
    whatsappConnectionStatusObservedAtSchema
  ),
  connection_status: Type.Optional(
    Type.Union([whatsappConnectionStatusSchema, Type.Null()])
  ),
  connection_status_source_id: Type.Optional(
    Type.Union([whatsappConnectionStatusSourceIdSchema, Type.Null()])
  ),
  connection_status_order: Type.Optional(
    Type.Union([whatsappConnectionStatusOrderSchema, Type.Null()])
  ),
  connection_online_acknowledged: Type.Optional(Type.Boolean()),
  connection_status_observed_at: Type.Optional(
    whatsappConnectionStatusObservedAtSchema
  ),
  connection_disconnected_at: Type.Optional(
    Type.Union([whatsappConnectionStatusObservedAtSchema, Type.Null()])
  ),
  runtime_generation: Type.Optional(
    Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])
  ),
  lifecycle_operation_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  recreate_phase: Type.Optional(Type.Enum(EWorkerRecreatePhase)),
  recreate_phase_observed_at: Type.Optional(
    whatsappConnectionStatusObservedAtSchema
  ),
  recreate_runtime_retired: Type.Optional(Type.Boolean()),
  recreate_completed_operation_id: Type.Optional(
    Type.String({ format: 'uuid' })
  ),
  recreate_completed_runtime_generation: Type.Optional(
    Type.Integer({ minimum: 1 })
  ),
  recreate_completed_at: Type.Optional(
    whatsappConnectionStatusObservedAtSchema
  ),
  provider_handoff_recovery: Type.Optional(
    Type.Union([whatsappProviderHandoffRecoverySchema, Type.Null()])
  ),
});

export const listWorkerFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listWorkerResponseSchema),
});

export type ListWorkerResponse = Static<typeof listWorkerResponseSchema>;
export type ListWorkerFinalResponse = Static<
  typeof listWorkerFinalResponseSchema
>;
