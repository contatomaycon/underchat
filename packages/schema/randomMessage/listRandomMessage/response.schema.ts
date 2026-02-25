import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { ERandomMessageStatus } from '@core/common/enums/ERandomMessageStatus';
import { Static, Type } from '@sinclair/typebox';

export const listRandomMessageResponseSchema = Type.Object({
  random_message_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  status: Type.Union([
    Type.Literal(ERandomMessageStatus.active),
    Type.Literal(ERandomMessageStatus.inactive),
  ]),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const listRandomMessageFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listRandomMessageResponseSchema),
});

export type ListRandomMessageResponse = Static<
  typeof listRandomMessageResponseSchema
>;
export type ListRandomMessageFinalResponse = Static<
  typeof listRandomMessageFinalResponseSchema
>;
