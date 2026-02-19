import { EWorkerType } from '@core/common/enums/EWorkerType';
import { Static, Type } from '@sinclair/typebox';

export const createWorkerRequestSchema = Type.Object({
  worker_type: Type.Optional(Type.String({ enum: Object.values(EWorkerType) })),
  name: Type.String(),
  server_id: Type.Optional(Type.String()),
});

export type CreateWorkerRequest = Static<typeof createWorkerRequestSchema>;
