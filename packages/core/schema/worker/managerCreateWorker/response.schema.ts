import { Static, Type } from '@sinclair/typebox';

export const managerCreateWorkerResponseSchema = Type.Object({
  worker_id: Type.String(),
});

export type ManagerCreateWorkerResponse = Static<
  typeof managerCreateWorkerResponseSchema
>;
