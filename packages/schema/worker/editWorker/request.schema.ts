import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerConnectionStrategy } from '@core/common/enums/EWorkerConnectionStrategy';
import { Static, Type } from '@sinclair/typebox';

export const editWorkerParamsSchema = Type.Object({
  worker_id: Type.String(),
  name: Type.String(),
});

export const editWorkerBodySchema = Type.Object({
  worker_type: Type.Optional(Type.String({ enum: Object.values(EWorkerType) })),
  server_id: Type.Optional(Type.String({ format: 'uuid' })),
  connection_strategy: Type.Optional(
    Type.String({ enum: Object.values(EWorkerConnectionStrategy) })
  ),
});

export type EditWorkerParams = Static<typeof editWorkerParamsSchema>;
export type EditWorkerBody = Static<typeof editWorkerBodySchema>;

export type EditWorkerRequest = EditWorkerParams & EditWorkerBody;
