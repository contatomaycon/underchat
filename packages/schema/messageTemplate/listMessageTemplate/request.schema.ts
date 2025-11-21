import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { sortRequestSchema } from '@core/schema/common/sortRequestSchema';
import { Static, Type } from '@sinclair/typebox';

export const listMessageTemplateRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  sort_by: Type.Optional(Type.Array(sortRequestSchema)),
  command: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  message_status: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ListMessageTemplateRequest = Static<
  typeof listMessageTemplateRequestSchema
>;
