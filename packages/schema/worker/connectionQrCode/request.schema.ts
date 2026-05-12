import { Static, Type } from '@sinclair/typebox';

export const workerConnectionQrCodeRequestSchema = Type.Object({
  worker_id: Type.String(),
});

export type WorkerConnectionQrCodeRequest = Static<
  typeof workerConnectionQrCodeRequestSchema
>;
