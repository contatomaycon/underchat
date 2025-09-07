import { Static, Type } from '@sinclair/typebox';

const planSchema = Type.Object({
  plan_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  price: Type.Number(),
  price_old: Type.Number(),
});

const accountStatusSchema = Type.Object({
  account_status_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

export const viewAccountResponseSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  account_status: Type.Union([accountStatusSchema, Type.Null()]),
  plan: Type.Union([planSchema, Type.Null()]),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ViewAccountResponse = Static<typeof viewAccountResponseSchema>;
