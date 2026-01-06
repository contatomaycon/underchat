import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { sortRequestSchema } from '@core/schema/common/sortRequestSchema';
import { Static, Type } from '@sinclair/typebox';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';

export const listAiAgentRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  sort_by: Type.Optional(Type.Array(sortRequestSchema)),
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Optional(
    Type.Union([
      Type.Literal(EAiAgentStatus.active),
      Type.Literal(EAiAgentStatus.inactive),
      Type.Null(),
    ])
  ),
});

export type ListAiAgentRequest = Static<typeof listAiAgentRequestSchema>;
