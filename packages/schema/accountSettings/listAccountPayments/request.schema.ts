import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { Static, Type } from '@sinclair/typebox';

export const listAccountPaymentsRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
});

export type ListAccountPaymentsRequest = Static<
  typeof listAccountPaymentsRequestSchema
>;
