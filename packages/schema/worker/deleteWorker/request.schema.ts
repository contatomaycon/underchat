import { Static, Type } from '@sinclair/typebox';

export const deleteWorkerRequestSchema = Type.Object({
  worker_id: Type.String(),
});

export type DeleteWorkerRequest = Static<typeof deleteWorkerRequestSchema>;
