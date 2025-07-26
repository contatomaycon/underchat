import { EWorkerType } from '@core/common/enums/EWorkerType';
import { Static, Type } from '@sinclair/typebox';

export const createWorkerRequestSchema = Type.Object({
  account_id: Type.Number(),
  worker_type: Type.Number({ enum: Object.values(EWorkerType) }),
});

export type CreateWorkerRequest = Static<typeof createWorkerRequestSchema>;
