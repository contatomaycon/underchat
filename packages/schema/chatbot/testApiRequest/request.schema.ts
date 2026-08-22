import { Static, Type } from '@sinclair/typebox';
import { apiRequestConfigSchema } from '@core/schema/chatbot/chatbotFlow.schema';

export const testApiRequestRequestSchema = Type.Object({
  chatbot_id: Type.String({ minLength: 1 }),
  node_id: Type.String({ minLength: 1 }),
  configuration: apiRequestConfigSchema,
  sample_variables: Type.Optional(Type.Record(Type.String(), Type.Any())),
  upstream_contracts: Type.Optional(Type.Record(Type.String(), Type.Any())),
  confirm_side_effects: Type.Boolean(),
});

export type TestApiRequestRequest = Static<typeof testApiRequestRequestSchema>;
