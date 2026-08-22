import { Static, Type } from '@sinclair/typebox';
import { EWorkerConnectionStrategy } from '@core/common/enums/EWorkerConnectionStrategy';

export const recreateChannelRequestSchema = Type.Object({
  channel_id: Type.String({ format: 'uuid' }),
});

export const recreateChannelBodySchema = Type.Object({
  connection_strategy: Type.Optional(
    Type.Enum(EWorkerConnectionStrategy, {
      default: EWorkerConnectionStrategy.migrate,
    })
  ),
});

export type RecreateChannelRequest = Static<
  typeof recreateChannelRequestSchema
>;

export type RecreateChannelBody = Static<typeof recreateChannelBodySchema>;
