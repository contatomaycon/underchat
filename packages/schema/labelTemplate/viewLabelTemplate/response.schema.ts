import { Static, Type } from '@sinclair/typebox';

const labelStatusSchema = Type.Object({
  label_status_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

const accountSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

export const viewLabelTemplateResponseSchema = Type.Object({
  label_template_id: Type.String({ format: 'uuid' }),
  account: accountSchema,
  label_status: Type.Union([labelStatusSchema, Type.Null()]),
  label: Type.String(),
  color: Type.String(),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ViewLabelTemplateResponse = Static<
  typeof viewLabelTemplateResponseSchema
>;
