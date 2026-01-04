import { Static, Type } from '@sinclair/typebox';

export const viewChatContactDocumentParamsSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
});

export type ViewChatContactDocumentParams = Static<
  typeof viewChatContactDocumentParamsSchema
>;
