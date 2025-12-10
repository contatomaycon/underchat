import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';

const labelStatusSchema = Type.Object({
  label_status_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

const accountSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

export const listLabelTemplateResponseSchema = Type.Object({
  label_template_id: Type.String({ format: 'uuid' }),
  account: accountSchema,
  label_status: Type.Union([labelStatusSchema, Type.Null()]),
  label: Type.String(),
  color: Type.String(),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const listLabelTemplateFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listLabelTemplateResponseSchema),
});

export type ListLabelTemplateResponse = Static<
  typeof listLabelTemplateResponseSchema
>;
export type ListLabelTemplateFinalResponse = Static<
  typeof listLabelTemplateFinalResponseSchema
>;
