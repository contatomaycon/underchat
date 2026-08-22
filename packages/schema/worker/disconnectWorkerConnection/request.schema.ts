import { Static, Type } from '@sinclair/typebox';

export const disconnectWorkerConnectionRequestSchema = Type.Object({
  worker_id: Type.String({ format: 'uuid' }),
});

export type DisconnectWorkerConnectionRequest = Static<
  typeof disconnectWorkerConnectionRequestSchema
>;
