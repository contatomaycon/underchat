export type IOpenAIHeaders = Record<string, string> & {
  Authorization: string;
  'Content-Type': string;
  'OpenAI-Beta'?: string;
};
