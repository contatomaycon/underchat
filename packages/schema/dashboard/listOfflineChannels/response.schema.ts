import { Static, Type } from '@sinclair/typebox';
import { EWorkerRecreatePhase } from '@core/common/enums/EWorkerRecreatePhase';
import {
  whatsappConnectionStatusOrderSchema,
  whatsappConnectionStatusObservedAtSchema,
  whatsappConnectionStatusSourceIdSchema,
} from '@core/schema/common/whatsappConnectionStatus.schema';

const workerStatusSchema = Type.Object({
  id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
});

export const listOfflineChannelsResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  worker_type_id: Type.String(),
  session_identity_present: Type.Boolean(),
  status: Type.Union([workerStatusSchema, Type.Null()]),
  connection_status: Type.Optional(
    Type.Union([
      Type.Literal('connecting'),
      Type.Literal('qr'),
      Type.Literal('online'),
      Type.Literal('offline'),
      Type.Literal('reconnect_required'),
      Type.Literal('error'),
      Type.Null(),
    ])
  ),
  connection_status_source_id: Type.Optional(
    Type.Union([whatsappConnectionStatusSourceIdSchema, Type.Null()])
  ),
  connection_status_sequence: Type.Optional(
    Type.Union([
      Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      Type.Null(),
    ])
  ),
  connection_status_changed_at: Type.Optional(
    Type.Union([Type.String({ maxLength: 64 }), Type.Null()])
  ),
  connection_status_order: Type.Optional(
    Type.Union([whatsappConnectionStatusOrderSchema, Type.Null()])
  ),
  connection_online_acknowledged: Type.Optional(Type.Boolean()),
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
  connection_status_observed_at: Type.Optional(
    whatsappConnectionStatusObservedAtSchema
  ),
  connection_disconnected_at: Type.Optional(
    Type.Union([whatsappConnectionStatusObservedAtSchema, Type.Null()])
  ),
  worker_status_observed_at: Type.Optional(
    whatsappConnectionStatusObservedAtSchema
  ),
});

export const listOfflineChannelsFinalResponseSchema = Type.Array(
  listOfflineChannelsResponseSchema
);

export type ListOfflineChannelsResponse = Static<
  typeof listOfflineChannelsResponseSchema
>;
export type ListOfflineChannelsFinalResponse = Static<
  typeof listOfflineChannelsFinalResponseSchema
>;
