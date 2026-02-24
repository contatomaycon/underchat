import { pagingSchema } from '@core/schema/common/pagingResponseSchema';
import { listChatsResultSchema } from '@core/schema/chat/listChats/response.schema';
import { Static, Type } from '@sinclair/typebox';

export const listKanbanColumnSchema = Type.Object({
  results: Type.Array(listChatsResultSchema),
  pagings: pagingSchema,
  has_more: Type.Boolean(),
});

export const listKanbanResponseSchema = Type.Object({
  chatbot: listKanbanColumnSchema,
  queue: listKanbanColumnSchema,
  in_chat: listKanbanColumnSchema,
  closed: listKanbanColumnSchema,
});

export type ListKanbanColumn = Static<typeof listKanbanColumnSchema>;
export type ListKanbanResponse = Static<typeof listKanbanResponseSchema>;
