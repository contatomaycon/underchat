import { Static, Type } from '@sinclair/typebox';

export const viewUserDocumentResponseSchema = Type.Object({
  document: Type.Union([Type.String(), Type.Null()]),
});

export type ViewUserDocumentResponse = Static<
  typeof viewUserDocumentResponseSchema
>;

