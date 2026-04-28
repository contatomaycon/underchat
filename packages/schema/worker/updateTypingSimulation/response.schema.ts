import { Static, Type } from '@sinclair/typebox';

export const updateTypingSimulationResponseSchema = Type.Object({
  enabled: Type.Boolean(),
  speed: Type.Integer({ minimum: 0, maximum: 100 }),
});

export type UpdateTypingSimulationResponse = Static<
  typeof updateTypingSimulationResponseSchema
>;
