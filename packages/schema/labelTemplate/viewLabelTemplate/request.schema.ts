import { Static, Type } from '@sinclair/typebox';

export const viewLabelTemplateRequestSchema = Type.Object({
  label_template_id: Type.String({ format: 'uuid' }),
});

export type ViewLabelTemplateRequest = Static<
  typeof viewLabelTemplateRequestSchema
>;
