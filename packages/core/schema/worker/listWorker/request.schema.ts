import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { sortRequestSchema } from '@core/schema/common/sortRequestSchema';
import { Static, Type } from '@sinclair/typebox';

export const listWorkerRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  sort_by: Type.Optional(Type.Array(sortRequestSchema)),
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Optional(
    Type.Union([
      Type.String({ enum: Object.values(EWorkerStatus) }),
      Type.Null(),
    ])
  ),
  type: Type.Optional(
    Type.Union([Type.String({ enum: Object.values(EWorkerType) }), Type.Null()])
  ),
  server: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  account: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ListWorkerRequest = Static<typeof listWorkerRequestSchema>;
