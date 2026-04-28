import { Static, Type } from '@sinclair/typebox';

export const viewTypingSimulationParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export type ViewTypingSimulationParams = Static<
  typeof viewTypingSimulationParamsSchema
>;
