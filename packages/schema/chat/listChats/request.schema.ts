import { EChatStatus } from '@core/common/enums/EChatStatus';
import { Static, Type } from '@sinclair/typebox';
import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';

export const listChatsQuerySchema = Type.Object({
  ...pagingRequestSchema.properties,
  status: Type.String({ enum: Object.values(EChatStatus) }),
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
});

export type ListChatsQuery = Static<typeof listChatsQuerySchema>;
