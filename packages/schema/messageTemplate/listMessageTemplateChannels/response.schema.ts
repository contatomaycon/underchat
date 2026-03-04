import { Static, Type } from '@sinclair/typebox';

export const messageTemplateChannelResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  number: Type.Union([Type.String(), Type.Null()]),
});

export const listMessageTemplateChannelsResponseSchema = Type.Array(
  messageTemplateChannelResponseSchema
);

export type MessageTemplateChannelResponse = Static<
  typeof messageTemplateChannelResponseSchema
>;

export type ListMessageTemplateChannelsResponse = Static<
  typeof listMessageTemplateChannelsResponseSchema
>;
