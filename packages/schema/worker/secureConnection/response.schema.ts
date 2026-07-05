import { Type, Static } from '@sinclair/typebox';

const secureConnectionStatusSchema = Type.Union([
  Type.Literal('created'),
  Type.Literal('helper_opened'),
  Type.Literal('wa_authenticated'),
  Type.Literal('wa_syncing'),
  Type.Literal('wa_ready'),
  Type.Literal('uploading'),
  Type.Literal('session_received'),
  Type.Literal('importing'),
  Type.Literal('validating_worker'),
  Type.Literal('connected'),
  Type.Literal('connected_confirmed'),
  Type.Literal('failed'),
  Type.Literal('expired'),
  Type.Literal('cancelled'),
]);

export const workerSecureConnectionSessionResponseSchema = Type.Object({
  token: Type.Optional(Type.String()),
  token_hash: Type.String(),
  deep_link: Type.Optional(Type.String()),
  status: secureConnectionStatusSchema,
  worker_id: Type.String(),
  worker_type_id: Type.Optional(Type.String()),
  connection_attempt_id: Type.String(),
  runtime_generation: Type.Optional(Type.Number()),
  expires_at: Type.String(),
  helper_download_url: Type.Optional(Type.String()),
  message: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
  phone: Type.Optional(Type.String()),
});

export type WorkerSecureConnectionSessionResponse = Static<
  typeof workerSecureConnectionSessionResponseSchema
>;
