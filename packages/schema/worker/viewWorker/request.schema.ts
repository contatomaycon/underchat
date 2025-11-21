import { Static, Type } from '@sinclair/typebox';

export const viewWorkerRequestSchema = Type.Object({
  worker_id: Type.String(),
});

export type ViewWorkerRequest = Static<typeof viewWorkerRequestSchema>;
