import { Static, Type } from '@sinclair/typebox';

export const BULK_CHAT_CATEGORIES = [
  'all',
  'in_chat',
  'queue',
  'my_chats',
  'chatbot',
  'scheduled',
] as const;

export const BULK_CHAT_ACTIONS = ['transfer', 'close'] as const;
export const BULK_CHAT_SELECTION_MODES = ['selected', 'filtered'] as const;

export const bulkActionChatRequestSchema = Type.Object({
  action: Type.String({ enum: BULK_CHAT_ACTIONS }),
  selection_mode: Type.String({ enum: BULK_CHAT_SELECTION_MODES }),
  chat_ids: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
  category: Type.Optional(Type.String({ enum: BULK_CHAT_CATEGORIES })),
  search: Type.Optional(Type.String()),
  has_applied_advanced_filters: Type.Optional(Type.Boolean()),
  filter_label_template_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  filter_worker_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  filter_user_id: Type.Optional(
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
  filter_unread_conversations: Type.Optional(Type.Boolean()),
  sort_field: Type.Optional(
    Type.Union([
      Type.String({
        enum: [
          'summary.last_message',
          'account.name',
          'worker.name',
          'name',
          'phone',
          'status',
          'date',
          'user.name',
          'sector.name',
          'started_at',
          'closed_at',
        ],
      }),
      Type.Null(),
    ])
  ),
  sort_order: Type.Optional(
    Type.Union([Type.String({ enum: ['asc', 'desc'] }), Type.Null()])
  ),
  transfer_payload: Type.Optional(
    Type.Object({
      worker_id: Type.Optional(Type.String({ format: 'uuid' })),
      user_id: Type.Optional(Type.String({ format: 'uuid' })),
      sector_id: Type.Optional(Type.String({ format: 'uuid' })),
      annotation: Type.Optional(Type.String({ maxLength: 5000 })),
      keep_in_chat: Type.Optional(Type.Boolean({ default: false })),
      send_message_on_transfer: Type.Optional(Type.Boolean()),
    })
  ),
  close_payload: Type.Optional(
    Type.Object({
      send_message_on_finish_attendance: Type.Optional(Type.Boolean()),
    })
  ),
});

export type BulkActionChatRequest = Static<typeof bulkActionChatRequestSchema>;
