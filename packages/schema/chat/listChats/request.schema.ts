import { EChatStatus } from '@core/common/enums/EChatStatus';
import { Static, Type } from '@sinclair/typebox';
import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';

export const listChatsQuerySchema = Type.Object({
  ...pagingRequestSchema.properties,
  status: Type.String({ enum: Object.values(EChatStatus) }),
  filter_label_template_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  sort_order: Type.Optional(Type.String()),
});

export type ListChatsQuery = Static<typeof listChatsQuerySchema>;
