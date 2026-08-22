import { Static, Type } from '@sinclair/typebox';

export const bulkUpdateContactLabelsRequestSchema = Type.Object({
  contact_ids: Type.Array(Type.String({ format: 'uuid' }), { minItems: 1 }),
  label_template_ids: Type.Array(Type.String({ format: 'uuid' }), {
    minItems: 1,
  }),
  operation: Type.Union([Type.Literal('add'), Type.Literal('remove')]),
});

export type BulkUpdateContactLabelsRequest = Static<
  typeof bulkUpdateContactLabelsRequestSchema
>;
