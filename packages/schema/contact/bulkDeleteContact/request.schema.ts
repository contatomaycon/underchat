import { Static, Type } from '@sinclair/typebox';

export const bulkDeleteContactRequestSchema = Type.Object({
  contact_ids: Type.Array(Type.String({ format: 'uuid' }), {
    minItems: 1,
    description: 'Lista de IDs dos contatos a serem excluídos',
  }),
});

export type BulkDeleteContactRequest = Static<
  typeof bulkDeleteContactRequestSchema
>;
