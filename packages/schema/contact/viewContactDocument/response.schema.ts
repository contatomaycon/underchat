import { Static, Type } from '@sinclair/typebox';

export const viewContactDocumentResponseSchema = Type.Object({
  document: Type.Union([Type.String(), Type.Null()]),
});

export type ViewContactDocumentResponse = Static<
  typeof viewContactDocumentResponseSchema
>;
