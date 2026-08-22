import { Static, Type } from '@sinclair/typebox';
import {
  whatsappConnectionStatusSchema,
  whatsappConnectionStatusOrderSchema,
  whatsappConnectionStatusSourceIdSchema,
} from '@core/schema/common/whatsappConnectionStatus.schema';

const workerExternalConnectionStatusSchema = Type.Object({
  id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
});

const workerExternalConnectionTypeSchema = Type.Object({
  id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
});

export const workerExternalConnectionViewResponseSchema = Type.Object({
  worker_id: Type.String(),
  account_id: Type.String(),
  name: Type.String(),
  number: Type.Union([Type.String(), Type.Null()]),
  status: Type.Union([workerExternalConnectionStatusSchema, Type.Null()]),
  type: Type.Union([workerExternalConnectionTypeSchema, Type.Null()]),
  expires_at: Type.String(),
  centrifugo_url: Type.String(),
  centrifugo_connection_token: Type.String(),
  centrifugo_subscription_token: Type.String(),
  centrifugo_channel: Type.String(),
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
});

export type WorkerExternalConnectionViewResponse = Static<
  typeof workerExternalConnectionViewResponseSchema
>;
