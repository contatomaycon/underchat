import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';

const sectorAccountSchema = Type.Object({
  id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
});

const sectorStatusSchema = Type.Object({
  id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
});

export const listSectorResponseSchema = Type.Object({
  sector_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  account: Type.Optional(Type.Union([sectorAccountSchema, Type.Null()])),
  sector_status: Type.Optional(Type.Union([sectorStatusSchema, Type.Null()])),
  color: Type.String(),
  created_at: Type.String(),
});

export const listSectorFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listSectorResponseSchema),
});

export type ListSectorResponse = Static<typeof listSectorResponseSchema>;
export type ListSectorFinalResponse = Static<
  typeof listSectorFinalResponseSchema
>;
