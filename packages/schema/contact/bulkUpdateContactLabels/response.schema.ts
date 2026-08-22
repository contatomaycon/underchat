import { Static, Type } from '@sinclair/typebox';

export const bulkUpdateContactLabelsResponseSchema = Type.Object({
  processed_count: Type.Number(),
  changed_count: Type.Number(),
  failed_count: Type.Number(),
});

export type BulkUpdateContactLabelsResponse = Static<
  typeof bulkUpdateContactLabelsResponseSchema
>;
