import { Static, Type } from '@sinclair/typebox';

export const viewChatContactByPhoneResponseSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
});

export type ViewChatContactByPhoneResponse = Static<
  typeof viewChatContactByPhoneResponseSchema
>;
