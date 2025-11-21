import { Static, Type } from '@sinclair/typebox';

export const editLabelTemplateParamsRequestSchema = Type.Object({
  label_template_id: Type.String({ format: 'uuid' }),
});

export type EditLabelTemplateParamsRequest = Static<
  typeof editLabelTemplateParamsRequestSchema
>;

const labelStatusSchema = Type.Object({
  label_status_id: Type.String({ format: 'uuid' }),
});

export const updateLabelTemplateRequestSchema = Type.Object({
  label: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  color: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  label_status: Type.Optional(Type.Union([labelStatusSchema, Type.Null()])),
});

export type UpdateLabelTemplateRequest = Static<
  typeof updateLabelTemplateRequestSchema
>;
