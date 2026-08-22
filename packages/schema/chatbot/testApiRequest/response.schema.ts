import { Static, Type } from '@sinclair/typebox';
import {
  apiRequestTestEvidenceSchema,
  apiResponseContractFieldSchema,
} from '@core/schema/chatbot/chatbotFlow.schema';

export const testApiRequestResponseSchema = Type.Object({
  ok: Type.Boolean(),
  statusCode: Type.Integer({ minimum: 0, maximum: 599 }),
  durationMs: Type.Number({ minimum: 0 }),
  headers: Type.Record(Type.String(), Type.String()),
  bodyType: Type.String(),
  preview: Type.Any(),
  contract: Type.Array(apiResponseContractFieldSchema),
  evidence: apiRequestTestEvidenceSchema,
});

export type TestApiRequestResponse = Static<
  typeof testApiRequestResponseSchema
>;
