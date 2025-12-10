import { Static, Type } from '@sinclair/typebox';

export const recreateWorkerRequestSchema = Type.Object({
  worker_id: Type.String(),
});

export type RecreateWorkerRequest = Static<typeof recreateWorkerRequestSchema>;
