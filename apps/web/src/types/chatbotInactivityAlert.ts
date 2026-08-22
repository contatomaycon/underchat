export type ChatbotInactivityStatus = 'active' | 'inactive';
export type ChatbotInactivityAction = 'redirect' | 'finish';
export type ChatbotInactivityRedirectType = 'user' | 'sector' | 'chatbot';

export interface ChatbotInactivityOption {
  value: string;
  title: string;
  photo?: string | null;
  color?: string | null;
  status?: unknown;
}

export interface ChatbotInactivityTargetOption extends ChatbotInactivityOption {
  type: 'input' | 'output';
}
