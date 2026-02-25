import { Static, Type } from '@sinclair/typebox';

export const createRandomMessageItemResponseSchema = Type.Object({
  random_message_item_id: Type.String({ format: 'uuid' }),
});

export type CreateRandomMessageItemResponse = Static<
  typeof createRandomMessageItemResponseSchema
>;
