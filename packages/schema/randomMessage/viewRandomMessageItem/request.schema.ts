import { Static, Type } from '@sinclair/typebox';

export const viewRandomMessageItemRequestSchema = Type.Object({
  random_message_id: Type.String({ format: 'uuid' }),
  random_message_item_id: Type.String({ format: 'uuid' }),
});

export type ViewRandomMessageItemRequest = Static<
  typeof viewRandomMessageItemRequestSchema
>;
