import { Static, Type } from '@sinclair/typebox';

export const unblockWorkerRequestSchema = Type.Object({
  worker_id: Type.String({ format: 'uuid' }),
});

export type UnblockWorkerRequest = Static<typeof unblockWorkerRequestSchema>;
