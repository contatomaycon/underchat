import { Static, Type } from '@sinclair/typebox';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';

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
  session_storage: Type.Optional(
    Type.Union([Type.Enum(EWorkerSessionStorage), Type.Null()])
  ),
  account: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  number: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type RecreateChannelsAllRequest = Static<
  typeof recreateChannelsAllRequestSchema
>;
