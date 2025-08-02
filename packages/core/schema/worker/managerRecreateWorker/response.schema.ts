import { Static, Type } from '@sinclair/typebox';

export const managerRecreateWorkerResponseSchema = Type.Object({
  worker_id: Type.String(),
});

export type ManagerRecreateWorkerResponse = Static<
  typeof managerRecreateWorkerResponseSchema
>;
