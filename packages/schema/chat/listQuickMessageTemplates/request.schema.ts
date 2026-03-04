import { Static, Type } from '@sinclair/typebox';

export const listQuickMessageTemplatesRequestSchema = Type.Object({
  command: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  channel_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
});

export type ListQuickMessageTemplatesRequest = Static<
  typeof listQuickMessageTemplatesRequestSchema
>;
