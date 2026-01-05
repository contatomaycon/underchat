import { Static, Type } from '@sinclair/typebox';

export const viewChatContactsBatchRequestSchema = Type.Object({
  contact_ids: Type.Array(Type.String({ format: 'uuid' }), {
    minItems: 1,
    maxItems: 100,
  }),
});

export type ViewChatContactsBatchRequest = Static<
  typeof viewChatContactsBatchRequestSchema
>;
