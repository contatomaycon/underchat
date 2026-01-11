import { Static, Type } from '@sinclair/typebox';
import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { EChatStatus } from '@core/common/enums/EChatStatus';

export const searchChatsQuerySchema = Type.Object({
  ...pagingRequestSchema.properties,
  search: Type.String(),
  filter_status: Type.Optional(
    Type.Union([Type.String({ enum: Object.values(EChatStatus) }), Type.Null()])
  ),
  filter_label_template_id: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  filter_worker_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  filter_user_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  filter_sector_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  filter_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  filter_phone: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  filter_protocol: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  filter_date_start: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  filter_date_end: Type.Optional(Type.Union([Type.String(), Type.Null()])),
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
});

export type SearchChatsQuery = Static<typeof searchChatsQuerySchema>;
