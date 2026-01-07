import { Static, Type } from '@sinclair/typebox';

export const editSectorParamsRequestSchema = Type.Object({
  sector_id: Type.String({ format: 'uuid' }),
});

export type EditSectorParamsRequest = Static<
  typeof editSectorParamsRequestSchema
>;

export const editSectorParamsBodySchema = Type.Object({
  sector_status_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' })])
  ),
  name: Type.Optional(Type.Union([Type.String()])),
  color: Type.Optional(Type.Union([Type.String()])),
});

export type EditSectorParamsBody = Static<typeof editSectorParamsBodySchema>;
