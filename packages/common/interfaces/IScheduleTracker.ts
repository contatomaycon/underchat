export interface IScheduleTracker {
  scheduleId: string;
  totalMessages: number;
  completedMessages: Set<string>;
  failedMessages: Set<string>;
  ignoredMessages: Set<string>;
  lastUpdateTime: number;
  timeoutTimer: NodeJS.Timeout | null;
}
