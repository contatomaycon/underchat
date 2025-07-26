import { Static, Type } from '@sinclair/typebox';

export const createWorkerResponseSchema = Type.Object({
  worker_id: Type.String(),
});

export type CreateWorkerResponse = Static<typeof createWorkerResponseSchema>;
