export type IOpenAIHeaders = Record<string, string> & {
  Authorization: string;
  'OpenAI-Beta': string;
  'Content-Type': string;
};
