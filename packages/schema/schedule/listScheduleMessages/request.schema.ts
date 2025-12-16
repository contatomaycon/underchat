import { Static, Type } from '@sinclair/typebox';
import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';

export const listScheduleMessagesRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  schedule_id: Type.String({ format: 'uuid' }),
});

export type ListScheduleMessagesRequest = Static<
  typeof listScheduleMessagesRequestSchema
>;
