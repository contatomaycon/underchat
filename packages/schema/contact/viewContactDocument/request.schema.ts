import { Static, Type } from '@sinclair/typebox';

export const viewContactDocumentParamsSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
});

export type ViewContactDocumentParams = Static<
  typeof viewContactDocumentParamsSchema
>;
