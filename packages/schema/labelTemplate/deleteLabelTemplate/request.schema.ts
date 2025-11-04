import { Static, Type } from '@sinclair/typebox';

export const deleteLabelTemplateRequestSchema = Type.Object({
  label_template_id: Type.String({ format: 'uuid' }),
});

export type DeleteLabelTemplateRequest = Static<
  typeof deleteLabelTemplateRequestSchema
>;
