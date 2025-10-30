import { Static, Type } from '@sinclair/typebox';

const roleAccountSchema = Type.Object({
  id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
});

const sectorStatusSchema = Type.Object({
  id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
});

export const viewSectorResponseSchema = Type.Object({
  sector_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  color: Type.String(),
  account: Type.Optional(Type.Union([roleAccountSchema, Type.Null()])),
  sector_status: Type.Optional(Type.Union([sectorStatusSchema, Type.Null()])),
  created_at: Type.String({ format: 'date-time' }),
});

export type ViewSectorResponse = Static<typeof viewSectorResponseSchema>;
