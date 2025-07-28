import { Static, Type } from '@sinclair/typebox';

export const managerDeleteWorkerRequestSchema = Type.Object({
  worker_id: Type.String(),
});

export type ManagerDeleteWorkerRequest = Static<
  typeof managerDeleteWorkerRequestSchema
>;
