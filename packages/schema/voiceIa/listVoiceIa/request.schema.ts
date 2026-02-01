import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { sortRequestSchema } from '@core/schema/common/sortRequestSchema';
import { Static, Type } from '@sinclair/typebox';
import { EVoiceIaStatus } from '@core/common/enums/EVoiceIaStatus';

export const listVoiceIaRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  sort_by: Type.Optional(Type.Array(sortRequestSchema)),
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Optional(
    Type.Union([
      Type.Literal(EVoiceIaStatus.active),
      Type.Literal(EVoiceIaStatus.inactive),
      Type.Null(),
    ])
  ),
});

export type ListVoiceIaRequest = Static<typeof listVoiceIaRequestSchema>;
