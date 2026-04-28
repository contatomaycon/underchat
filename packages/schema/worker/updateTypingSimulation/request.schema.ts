import { Static, Type } from '@sinclair/typebox';

export const updateTypingSimulationParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export const updateTypingSimulationRequestSchema = Type.Object({
  enabled: Type.Boolean(),
  speed: Type.Integer({ minimum: 0, maximum: 100 }),
});

export type UpdateTypingSimulationParams = Static<
  typeof updateTypingSimulationParamsSchema
>;
export type UpdateTypingSimulationRequest = Static<
  typeof updateTypingSimulationRequestSchema
>;
