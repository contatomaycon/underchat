import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { Static, Type } from '@sinclair/typebox';

export const listAccountPaymentsParamsSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
});

export const listAccountPaymentsRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
});

export type ListAccountPaymentsParams = Static<
  typeof listAccountPaymentsParamsSchema
>;

export type ListAccountPaymentsRequest = Static<
  typeof listAccountPaymentsRequestSchema
>;
