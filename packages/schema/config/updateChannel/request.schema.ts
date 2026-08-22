import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerConnectionStrategy } from '@core/common/enums/EWorkerConnectionStrategy';
import { Static, Type } from '@sinclair/typebox';

export const updateChannelParamsSchema = Type.Object({
  channel_id: Type.String({ format: 'uuid' }),
});

export const updateChannelBodySchema = Type.Object({
  name: Type.String(),
  worker_type: Type.Optional(Type.String({ enum: Object.values(EWorkerType) })),
  server_id: Type.Optional(Type.String({ format: 'uuid' })),
  connection_strategy: Type.Optional(
    Type.String({ enum: Object.values(EWorkerConnectionStrategy) })
  ),
});

export type UpdateChannelParams = Static<typeof updateChannelParamsSchema>;
export type UpdateChannelBody = Static<typeof updateChannelBodySchema>;
export type UpdateChannelRequest = UpdateChannelParams & UpdateChannelBody;
