import { Static, Type } from '@sinclair/typebox';

export const resetWorkerConnectionRequestSchema = Type.Object({
  worker_id: Type.String(),
});

export type ResetWorkerConnectionRequest = Static<
  typeof resetWorkerConnectionRequestSchema
>;
