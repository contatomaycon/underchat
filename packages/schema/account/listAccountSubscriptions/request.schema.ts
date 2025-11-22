import { Static, Type } from '@sinclair/typebox';

export const listAccountSubscriptionsParamsRequestSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
});

export type ListAccountSubscriptionsParamsRequest = Static<
  typeof listAccountSubscriptionsParamsRequestSchema
>;
