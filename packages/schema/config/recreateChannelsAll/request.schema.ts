import { Static, Type } from '@sinclair/typebox';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';

export const recreateChannelsAllRequestSchema = Type.Object({
  status: Type.Optional(
    Type.Union([
      Type.String({ enum: Object.values(EWorkerStatus) }),
      Type.Null(),
    ])
  ),
});

export type RecreateChannelsAllRequest = Static<
  typeof recreateChannelsAllRequestSchema
>;
