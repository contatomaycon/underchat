import { Static, Type } from '@sinclair/typebox';

const KANBAN_PER_PAGE_DEFAULT = 50;

export const listKanbanQuerySchema = Type.Object({
  chatbot_page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  queue_page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  in_chat_page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  closed_page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  per_page: Type.Optional(
    Type.Number({ minimum: 1, maximum: 200, default: KANBAN_PER_PAGE_DEFAULT })
  ),
  filter_label_template_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  filter_worker_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  filter_sector_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  filter_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  filter_phone: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  filter_protocol: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  filter_date_start: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  filter_date_end: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ListKanbanQuery = Static<typeof listKanbanQuerySchema>;
