import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { Static, Type } from '@sinclair/typebox';

export const listMessagesParamsSchema = Type.Object({
  conversation_id: Type.String({ format: 'uuid' }),
});
export const listMessagesQuerySchema = Type.Object({
  ...pagingRequestSchema.properties,
});
export const listMessagesBodySchema = Type.Object({});

export type ListMessagesParams = Static<typeof listMessagesParamsSchema>;
export type ListMessagesQuery = Static<typeof listMessagesQuerySchema>;
