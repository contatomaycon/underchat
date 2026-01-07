export interface IRagContext {
  chunks: Array<{
    text: string;
    score: number;
    promptId: string;
  }>;
  combinedContext: string;
}
