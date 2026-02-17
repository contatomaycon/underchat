import { EWorkerType } from '@core/common/enums/EWorkerType';
import { Static, Type } from '@sinclair/typebox';

export const editWorkerParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export const editWorkerBodySchema = Type.Object({
  name: Type.String(),
  worker_type: Type.Optional(Type.String({ enum: Object.values(EWorkerType) })),
});

export type EditWorkerParams = Static<typeof editWorkerParamsSchema>;
export type EditWorkerBody = Static<typeof editWorkerBodySchema>;

export type EditWorkerRequest = EditWorkerParams & EditWorkerBody;
