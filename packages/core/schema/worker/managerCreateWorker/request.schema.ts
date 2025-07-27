import { EWorkerType } from '@core/common/enums/EWorkerType';
import { Static, Type } from '@sinclair/typebox';

export const managerCreateWorkerRequestSchema = Type.Object({
  worker_type: Type.String({ enum: Object.values(EWorkerType) }),
  name: Type.String(),
});

export type ManagerCreateWorkerRequest = Static<
  typeof managerCreateWorkerRequestSchema
>;
