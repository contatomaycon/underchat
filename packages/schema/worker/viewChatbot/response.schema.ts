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
  start_time: Type.String(),
  end_time: Type.String(),
  chatbot_id: Type.String(),
});

export const viewChatbotResponseSchema = Type.Object({
  chatbot_id: Type.Union([Type.String(), Type.Null()]),
  output_chatbot_id: Type.Union([Type.String(), Type.Null()]),
  chatbot_working_hours_enabled: Type.Boolean(),
  chatbot_working_hours_timezone: Type.String(),
  chatbot_working_hours_rules: Type.Array(chatbotWorkingHoursRuleSchema),
  enabled: Type.Boolean(),
});

export type ViewChatbotResponse = Static<typeof viewChatbotResponseSchema>;
