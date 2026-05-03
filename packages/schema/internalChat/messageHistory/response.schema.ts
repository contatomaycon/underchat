import { Static, Type } from '@sinclair/typebox';

export const messageHistoryItemSchema = Type.Object({
  type: Type.String(),
  message: Type.Union([Type.String(), Type.Null()]),
  date: Type.String(),
  kind: Type.String({
    enum: ['current', 'deleted_snapshot', 'original', 'previous_version'],
  }),
  is_current: Type.Boolean(),
  is_deleted_snapshot: Type.Boolean(),
});

export const messageHistoryDataSchema = Type.Object({
  results: Type.Array(messageHistoryItemSchema),
});

export const messageHistoryResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ const: true }),
  message: Type.String(),
  data: messageHistoryDataSchema,
});

export type MessageHistoryResponse = Static<
  typeof messageHistoryResponseSchema
>;
