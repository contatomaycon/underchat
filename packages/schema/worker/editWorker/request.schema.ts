import { EWorkerType } from '@core/common/enums/EWorkerType';
import { Static, Type } from '@sinclair/typebox';

export const editWorkerParamsSchema = Type.Object({
  worker_id: Type.String(),
  name: Type.String(),
});

export const editWorkerBodySchema = Type.Object({
  worker_type: Type.Optional(Type.String({ enum: Object.values(EWorkerType) })),
  server_id: Type.Optional(Type.String({ format: 'uuid' })),
});

export type EditWorkerParams = Static<typeof editWorkerParamsSchema>;
export type EditWorkerBody = Static<typeof editWorkerBodySchema>;

export type EditWorkerRequest = EditWorkerParams & EditWorkerBody;
