import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { Static, Type } from '@sinclair/typebox';
import { EReleaseType } from '@core/common/enums/EReleaseType';

export const listReleaseRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  search: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  type: Type.Optional(Type.Union([Type.Enum(EReleaseType), Type.Null()])),
});

export type ListReleaseRequest = Static<typeof listReleaseRequestSchema>;
