import { Static, Type } from '@sinclair/typebox';

export const viewUserDocumentRequestSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
});

export type ViewUserDocumentRequest = Static<
  typeof viewUserDocumentRequestSchema
>;

