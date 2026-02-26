export type ChatbotWorkingHoursWeekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export interface IChatbotWorkingHoursRule {
  weekday: ChatbotWorkingHoursWeekday;
  start_time: string;
  end_time: string;
  chatbot_id: string;
}

export interface IChatbotWorkingHoursConfig {
  enabled: boolean;
  timezone: string;
  rules: IChatbotWorkingHoursRule[];
}
