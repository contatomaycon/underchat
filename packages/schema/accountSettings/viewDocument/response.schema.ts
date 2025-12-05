import { Static, Type } from '@sinclair/typebox';

export const viewDocumentResponseSchema = Type.Object({
  document: Type.Union([Type.String(), Type.Null()]),
});

export type ViewDocumentResponse = Static<typeof viewDocumentResponseSchema>;
