import { Static, Type } from '@sinclair/typebox';

export const deleteRandomMessageItemRequestSchema = Type.Object({
  random_message_id: Type.String({ format: 'uuid' }),
  random_message_item_id: Type.String({ format: 'uuid' }),
});

export type DeleteRandomMessageItemRequest = Static<
  typeof deleteRandomMessageItemRequestSchema
>;
