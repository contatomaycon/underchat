import { Static, Type } from '@sinclair/typebox';

export const managerRecreateWorkerRequestSchema = Type.Object({
  worker_id: Type.String(),
});

export type ManagerRecreateWorkerRequest = Static<
  typeof managerRecreateWorkerRequestSchema
>;
