import { Static, Type } from '@sinclair/typebox';

const planSchema = Type.Object({
  plan_id: Type.String({ format: 'uuid' }),
  billing_period: Type.Union([Type.Literal('monthly'), Type.Literal('annual')]),
});

const accountStatusSchema = Type.Object({
  account_status_id: Type.String({ format: 'uuid' }),
});

export const createAccountRequestSchema = Type.Object({
  name: Type.String(),
  account_status: accountStatusSchema,
  plan: Type.Optional(planSchema),
  generate_invoice: Type.Optional(Type.Boolean()),
});

export type CreateAccountRequest = Static<typeof createAccountRequestSchema>;
