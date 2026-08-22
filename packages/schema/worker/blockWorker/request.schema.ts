import { Static, Type } from '@sinclair/typebox';

export const blockWorkerRequestSchema = Type.Object({
  worker_id: Type.String({ format: 'uuid' }),
});

export type BlockWorkerRequest = Static<typeof blockWorkerRequestSchema>;
