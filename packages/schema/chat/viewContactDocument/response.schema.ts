import { Static, Type } from '@sinclair/typebox';

export const viewChatContactDocumentResponseSchema = Type.Object({
  document: Type.String(),
});

export type ViewChatContactDocumentResponse = Static<
  typeof viewChatContactDocumentResponseSchema
>;
