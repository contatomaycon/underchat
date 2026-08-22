import { Static, Type } from '@sinclair/typebox';

const availableSectorSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  color: Type.Union([Type.String(), Type.Null()]),
});

export const viewOperatorReplyPendingRedistributionResponseSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    time_minutes: Type.Integer({ minimum: 1 }),
    sector_ids: Type.Array(Type.String({ format: 'uuid' })),
    available_sectors: Type.Array(availableSectorSchema),
  }
);

export type ViewOperatorReplyPendingRedistributionResponse = Static<
  typeof viewOperatorReplyPendingRedistributionResponseSchema
>;
