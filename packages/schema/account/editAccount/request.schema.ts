import { Static, Type } from '@sinclair/typebox';

export const editAccountParamsRequestSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
});

export type EditAccountParamsRequest = Static<
  typeof editAccountParamsRequestSchema
>;

const accountStatusSchema = Type.Object({
  account_status_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
});

export const updateAccountRequestSchema = Type.Object({
  name: Type.Union([Type.String(), Type.Null()]),
  account_status: Type.Optional(Type.Union([accountStatusSchema, Type.Null()])),
});

export type UpdateAccountRequest = Static<typeof updateAccountRequestSchema>;
