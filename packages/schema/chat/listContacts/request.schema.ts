import { Static, Type } from '@sinclair/typebox';
import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';

export const listChatContactsRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  search: Type.Optional(Type.String()),
  filter_label_template_id: Type.Optional(Type.String({ format: 'uuid' })),
  filter_phone_ddi: Type.Optional(Type.String()),
  filter_phone: Type.Optional(Type.String()),
  filter_name: Type.Optional(Type.String()),
  filter_last_name: Type.Optional(Type.String()),
  filter_nickname: Type.Optional(Type.String()),
  filter_email: Type.Optional(Type.String()),
  filter_birthday: Type.Optional(Type.String()),
  filter_document: Type.Optional(Type.String()),
  filter_user_id: Type.Optional(Type.String({ format: 'uuid' })),
  filter_channel_id: Type.Optional(Type.String({ format: 'uuid' })),
  filter_is_valided: Type.Optional(Type.Boolean()),
  sort_field: Type.Optional(Type.String()),
  sort_order: Type.Optional(Type.String()),
});

export type ListChatContactsRequest = Static<
  typeof listChatContactsRequestSchema
>;
