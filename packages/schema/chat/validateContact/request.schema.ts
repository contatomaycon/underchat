import { Static, Type } from '@sinclair/typebox';

export const validateChatContactRequestSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
});

export type ValidateChatContactRequest = Static<
  typeof validateChatContactRequestSchema
>;
