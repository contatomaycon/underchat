import { Static, Type } from '@sinclair/typebox';

export const workerExternalConnectionLinkResponseSchema = Type.Object({
  token: Type.String(),
  url: Type.String(),
  expires_at: Type.String(),
});

export type WorkerExternalConnectionLinkResponse = Static<
  typeof workerExternalConnectionLinkResponseSchema
>;
