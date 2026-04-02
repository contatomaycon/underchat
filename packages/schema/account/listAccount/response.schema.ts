import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';

const planSchema = Type.Object({
  plan_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  recurring_payment: Type.Boolean(),
  billing_period: Type.Union([
    Type.Literal('monthly'),
    Type.Literal('annual'),
    Type.Null(),
  ]),
});

const accountStatusSchema = Type.Object({
  account_status_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

export const listAccountResponseSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  account_status: Type.Union([accountStatusSchema, Type.Null()]),
  account_statuses: Type.Optional(Type.Array(accountStatusSchema)),
  plan: Type.Union([planSchema, Type.Null()]),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const listAccountFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listAccountResponseSchema),
});

export type ListAccountResponse = Static<typeof listAccountResponseSchema>;
export type ListAccountFinalResponse = Static<
  typeof listAccountFinalResponseSchema
>;
