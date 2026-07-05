import { Static, Type } from '@sinclair/typebox';

export const workerSecureConnectionParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export const workerSecureConnectionTokenParamsSchema = Type.Object({
  worker_id: Type.String(),
  token: Type.String(),
});

export const workerSecureConnectionHelperParamsSchema = Type.Object({
  token: Type.String(),
});

export const workerAuthenticatorDownloadParamsSchema = Type.Object({
  platform: Type.Union([Type.Literal('linux'), Type.Literal('windows')]),
});

export const workerSecureConnectionHelperStatusBodySchema = Type.Object({
  status: Type.String(),
  helper_version: Type.Optional(Type.String()),
  helper_platform: Type.Optional(Type.String()),
  message: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
});

export const workerSecureConnectionHelperSessionBodySchema = Type.Object({
  format_version: Type.String(),
  source: Type.Literal('whatsapp_web'),
  target_provider: Type.Union([
    Type.Literal('auto'),
    Type.Literal('baileys'),
    Type.Literal('wwebjs'),
    Type.Literal('whatsmeow'),
  ]),
  created_at: Type.String(),
  web_version: Type.Optional(Type.String()),
  account_hint: Type.Optional(Type.String()),
  checksum: Type.Optional(Type.String()),
  payload_ref: Type.Optional(Type.String()),
  payload: Type.Optional(Type.Unknown()),
});

export type WorkerSecureConnectionParams = Static<
  typeof workerSecureConnectionParamsSchema
>;

export type WorkerSecureConnectionTokenParams = Static<
  typeof workerSecureConnectionTokenParamsSchema
>;

export type WorkerSecureConnectionHelperParams = Static<
  typeof workerSecureConnectionHelperParamsSchema
>;

export type WorkerAuthenticatorDownloadParams = Static<
  typeof workerAuthenticatorDownloadParamsSchema
>;

export type WorkerSecureConnectionHelperStatusBody = Static<
  typeof workerSecureConnectionHelperStatusBodySchema
>;

export type WorkerSecureConnectionHelperSessionBody = Static<
  typeof workerSecureConnectionHelperSessionBodySchema
>;
