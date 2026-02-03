import { Static, Type } from '@sinclair/typebox';

export const bulkDeleteContactResponseSchema = Type.Object({
  deleted_count: Type.Number({
    description: 'Número de contatos excluídos com sucesso',
  }),
  failed_count: Type.Number({
    description: 'Número de contatos que falharam ao excluir',
  }),
});

export type BulkDeleteContactResponse = Static<
  typeof bulkDeleteContactResponseSchema
>;
