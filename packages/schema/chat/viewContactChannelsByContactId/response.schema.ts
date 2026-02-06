import { Static, Type } from '@sinclair/typebox';

export const viewChatContactChannelsByContactIdResponseSchema = Type.Array(
  Type.String({ format: 'uuid' })
);

export type ViewChatContactChannelsByContactIdResponse = Static<
  typeof viewChatContactChannelsByContactIdResponseSchema
>;
