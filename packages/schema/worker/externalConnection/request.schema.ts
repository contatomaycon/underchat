import { Static, Type } from '@sinclair/typebox';

export const workerExternalConnectionRequestSchema = Type.Object({
  token: Type.String({ minLength: 1 }),
});

export type WorkerExternalConnectionRequest = Static<
  typeof workerExternalConnectionRequestSchema
>;
