import { Static, Type } from '@sinclair/typebox';

const chatbotWorkingHoursWeekdaySchema = Type.Union([
  Type.Literal('monday'),
  Type.Literal('tuesday'),
  Type.Literal('wednesday'),
  Type.Literal('thursday'),
  Type.Literal('friday'),
  Type.Literal('saturday'),
  Type.Literal('sunday'),
]);

const chatbotWorkingHoursRuleSchema = Type.Object({
  weekday: chatbotWorkingHoursWeekdaySchema,
  start_time: Type.String({ pattern: '^([01]\\d|2[0-3]):([0-5]\\d)$' }),
  end_time: Type.String({ pattern: '^([01]\\d|2[0-3]):([0-5]\\d)$' }),
  chatbot_id: Type.String({ format: 'uuid' }),
});

export const updateChatbotParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export const updateChatbotRequestSchema = Type.Object({
  chatbot_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  output_chatbot_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  chatbot_working_hours_enabled: Type.Optional(Type.Boolean()),
  chatbot_working_hours_timezone: Type.Optional(Type.String()),
  chatbot_working_hours_rules: Type.Optional(
    Type.Array(chatbotWorkingHoursRuleSchema)
  ),
  enabled: Type.Optional(Type.Boolean()),
});

export type UpdateChatbotParams = Static<typeof updateChatbotParamsSchema>;
export type UpdateChatbotRequest = Static<typeof updateChatbotRequestSchema>;
