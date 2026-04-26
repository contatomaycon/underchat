import { Static, Type } from '@sinclair/typebox';

export const workerExternalConnectionLinkRequestSchema = Type.Object({
  worker_id: Type.String(),
});

export type WorkerExternalConnectionLinkRequest = Static<
  typeof workerExternalConnectionLinkRequestSchema
>;
