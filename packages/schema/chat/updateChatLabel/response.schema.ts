import { Static, Type } from '@sinclair/typebox';

export const updateChatLabelResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export type UpdateChatLabelResponse = Static<
  typeof updateChatLabelResponseSchema
>;
