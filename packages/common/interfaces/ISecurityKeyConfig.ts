export type TSecurityKeyScope = 'chatbot' | 'schedule' | 'quick_message';

export interface ISecurityKeyConfig {
  enabled: boolean;
  chatbot: boolean;
  schedule: boolean;
  quick_message: boolean;
}
