import { Static, Type } from '@sinclair/typebox';

export const listContactLabelTemplatesResponseSchema = Type.Object({
  label_template_id: Type.String({ format: 'uuid' }),
  label: Type.String(),
  color: Type.String(),
});

export type ListContactLabelTemplatesResponse = Static<
  typeof listContactLabelTemplatesResponseSchema
>;
