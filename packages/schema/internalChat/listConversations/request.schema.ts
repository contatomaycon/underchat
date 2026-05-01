import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { EInternalChatConversationType } from '@core/common/enums/internalChat/EInternalChatConversationType';
import { Static, Type } from '@sinclair/typebox';

export const listConversationsQuerySchema = Type.Object({
  ...pagingRequestSchema.properties,
  search: Type.Optional(Type.String()),
  type: Type.Optional(
    Type.String({ enum: Object.values(EInternalChatConversationType) })
  ),
});

export type ListConversationsQuery = Static<
  typeof listConversationsQuerySchema
>;
