import { Static, Type } from '@sinclair/typebox';
import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';

export const protocolWithTypeSchema = Type.Object({
  protocol: Type.String(),
  type: Type.Union([Type.Literal('T'), Type.Literal('U'), Type.Literal('A')]),
});

export const reportConversationHistoryResultSchema = Type.Object({
  date: Type.String(),
  protocol: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  protocols: Type.Optional(Type.Array(Type.String())),
  protocolsWithType: Type.Optional(Type.Array(protocolWithTypeSchema)),
  client: Type.String(),
  phone: Type.String(),
  cpf_cnpj: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  operator: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  operator_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  queue: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  channel: Type.String(),
  chat_id: Type.String(),
  photo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  pdf_status: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const listReportConversationHistoryFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(reportConversationHistoryResultSchema),
});

export type ReportConversationHistoryResult = Static<
  typeof reportConversationHistoryResultSchema
>;
export type ListReportConversationHistoryFinalResponse = Static<
  typeof listReportConversationHistoryFinalResponseSchema
>;
