import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { Static, Type } from '@sinclair/typebox';

export const statusConnectionWorkerRequestSchema = Type.Object({
  worker_id: Type.String(),
  status: Type.String({ enum: Object.values(EWorkerStatus) }),
});

export type StatusConnectionWorkerRequest = Static<
  typeof statusConnectionWorkerRequestSchema
>;
