import { Static, Type } from '@sinclair/typebox';

export const chatboxChatTagResponseSchema = Type.Object({
  label_template_id: Type.String({ format: 'uuid' }),
  label: Type.String(),
  color: Type.String(),
});

export type ChatboxChatTagResponse = Static<
  typeof chatboxChatTagResponseSchema
>;
