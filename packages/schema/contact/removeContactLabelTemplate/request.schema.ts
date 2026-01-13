import { Static, Type } from '@sinclair/typebox';

export const removeContactLabelTemplateRequestSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
  label_template_id: Type.String({ format: 'uuid' }),
});

export type RemoveContactLabelTemplateRequest = Static<
  typeof removeContactLabelTemplateRequestSchema
>;
