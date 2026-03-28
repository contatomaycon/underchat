import { Static, Type } from '@sinclair/typebox';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';

export const recreateChannelsAllRequestSchema = Type.Object({
  status: Type.Optional(
    Type.Union([
      Type.String({ enum: Object.values(EWorkerStatus) }),
      Type.Null(),
    ])
  ),
  type: Type.Optional(
    Type.Union([Type.String({ enum: Object.values(EWorkerType) }), Type.Null()])
  ),
  account: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  number: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type RecreateChannelsAllRequest = Static<
  typeof recreateChannelsAllRequestSchema
>;
