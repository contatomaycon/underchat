import { Static, Type } from '@sinclair/typebox';

export const listQuickMessageTemplatesRequestSchema = Type.Object({
  command: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ListQuickMessageTemplatesRequest = Static<
  typeof listQuickMessageTemplatesRequestSchema
>;
