import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { ERandomMessageStatus } from '@core/common/enums/ERandomMessageStatus';
import { Static, Type } from '@sinclair/typebox';

export const listRandomMessageItemResponseSchema = Type.Object({
  random_message_item_id: Type.String({ format: 'uuid' }),
  random_message_id: Type.String({ format: 'uuid' }),
  message: Type.String(),
  status: Type.Union([
    Type.Literal(ERandomMessageStatus.active),
    Type.Literal(ERandomMessageStatus.inactive),
  ]),
  type: Type.String(),
  attachment_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const listRandomMessageItemFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listRandomMessageItemResponseSchema),
});

export type ListRandomMessageItemResponse = Static<
  typeof listRandomMessageItemResponseSchema
>;
export type ListRandomMessageItemFinalResponse = Static<
  typeof listRandomMessageItemFinalResponseSchema
>;
