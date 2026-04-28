import { Static, Type } from '@sinclair/typebox';

export const viewTypingSimulationResponseSchema = Type.Object({
  enabled: Type.Boolean(),
  speed: Type.Integer({ minimum: 0, maximum: 100 }),
});

export type ViewTypingSimulationResponse = Static<
  typeof viewTypingSimulationResponseSchema
>;
