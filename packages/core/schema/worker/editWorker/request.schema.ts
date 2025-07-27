import { Static, Type } from '@sinclair/typebox';

export const editWorkerRequestSchema = Type.Object({
  worker_id: Type.String(),
  name: Type.String(),
});

export type EditWorkerRequest = Static<typeof editWorkerRequestSchema>;
