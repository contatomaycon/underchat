import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { sortRequestSchema } from '@core/schema/common/sortRequestSchema';
import { Static, Type } from '@sinclair/typebox';

export const listLabelTemplateRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  sort_by: Type.Optional(Type.Array(sortRequestSchema)),
  label: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  label_status: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ListLabelTemplateRequest = Static<
  typeof listLabelTemplateRequestSchema
>;
