import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { Static, Type } from '@sinclair/typebox';

export const listSentNotificationsRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
});

export type ListSentNotificationsRequest = Static<
  typeof listSentNotificationsRequestSchema
>;
