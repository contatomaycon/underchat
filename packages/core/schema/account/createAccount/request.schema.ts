import { Static, Type } from '@sinclair/typebox';

const planSchema = Type.Object({
  plan_id: Type.String({ format: 'uuid' }),
});

const accountStatusSchema = Type.Object({
  account_status_id: Type.String({ format: 'uuid' }),
});

export const createAccountRequestSchema = Type.Object({
  name: Type.String(),
  account_status: accountStatusSchema,
  plan: planSchema,
});

export type CreateAccountRequest = Static<typeof createAccountRequestSchema>;
