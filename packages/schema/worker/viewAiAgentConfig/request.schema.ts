import { Static, Type } from '@sinclair/typebox';

export const viewAiAgentConfigParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export type ViewAiAgentConfigParams = Static<
  typeof viewAiAgentConfigParamsSchema
>;
