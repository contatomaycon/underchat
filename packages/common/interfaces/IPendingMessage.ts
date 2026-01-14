export interface IPendingMessage {
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutHandle: NodeJS.Timeout;
}
