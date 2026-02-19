import { Static, Type } from '@sinclair/typebox';
import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { sortRequestSchema } from '@core/schema/common/sortRequestSchema';

export const listReportConversationHistoryRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  sort_by: Type.Optional(Type.Array(sortRequestSchema)),
  search_by: Type.Optional(
    Type.Union([
      Type.Literal('date'),
      Type.Literal('operator'),
      Type.Literal('queue'),
      Type.Literal('protocol'),
      Type.Literal('client'),
      Type.Literal('phone'),
      Type.Literal('label'),
    ])
  ),
  start_date: Type.Optional(
    Type.Union([Type.String({ format: 'date-time' }), Type.Null()])
  ),
  end_date: Type.Optional(
    Type.Union([Type.String({ format: 'date-time' }), Type.Null()])
  ),
  operator_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  queue_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  protocol: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  client_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  phone: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  label_template_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
});

export type ListReportConversationHistoryRequest = Static<
  typeof listReportConversationHistoryRequestSchema
>;
