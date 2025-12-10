import { Static, Type } from '@sinclair/typebox';

export const listLabelTemplateAllResponseSchema = Type.Object({
  label_template_id: Type.String({ format: 'uuid' }),
  label: Type.String(),
  color: Type.String(),
});

export type ListLabelTemplateAllResponse = Static<
  typeof listLabelTemplateAllResponseSchema
>;
