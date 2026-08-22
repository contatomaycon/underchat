import type { ApiRequestVariable } from '@/components/chatbot/api-request/types';

type Translate = (key: string) => string;

const UNDERCHAT_VARIABLES = [
  ['sector', 'chatbot_variable_sector_description'],
  ['user', 'chatbot_variable_user_description'],
  ['greeting', 'chatbot_variable_greeting_description'],
  ['name', 'chatbot_variable_name_description'],
  ['protocol', 'chatbot_variable_protocol_description'],
  ['date', 'chatbot_variable_date_description'],
  ['time', 'chatbot_variable_time_description'],
  ['account_name', 'chatbot_variable_account_name_description'],
  ['phone', 'chatbot_variable_phone_description'],
  ['channel_name', 'chatbot_variable_channel_name_description'],
] as const;

export const createUnderchatVariableCatalog = (
  translate: Translate
): ApiRequestVariable[] =>
  UNDERCHAT_VARIABLES.map(([name, descriptionKey]) => ({
    tag: `{{ ${name} }}`,
    label: `{{ ${name} }}`,
    description: translate(descriptionKey),
    type: 'string',
  }));
