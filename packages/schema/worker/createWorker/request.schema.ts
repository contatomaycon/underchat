import { EWorkerType } from '@core/common/enums/EWorkerType';
import { Static, Type } from '@sinclair/typebox';

export const createWorkerRequestSchema = Type.Object({
  worker_type: Type.String({ enum: Object.values(EWorkerType) }),
  name: Type.String(),
});

export type CreateWorkerRequest = Static<typeof createWorkerRequestSchema>;
