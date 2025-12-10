import { Static, Type } from '@sinclair/typebox';

export const deleteChatContactPhotoRequestSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
});

export type DeleteChatContactPhotoRequest = Static<
  typeof deleteChatContactPhotoRequestSchema
>;
