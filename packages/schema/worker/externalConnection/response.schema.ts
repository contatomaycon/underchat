import { Static, Type } from '@sinclair/typebox';

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
});

export type WorkerExternalConnectionViewResponse = Static<
  typeof workerExternalConnectionViewResponseSchema
>;
