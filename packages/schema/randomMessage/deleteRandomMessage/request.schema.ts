import { Static, Type } from '@sinclair/typebox';

export const deleteRandomMessageRequestSchema = Type.Object({
  random_message_id: Type.String({ format: 'uuid' }),
});

export type DeleteRandomMessageRequest = Static<
  typeof deleteRandomMessageRequestSchema
>;
