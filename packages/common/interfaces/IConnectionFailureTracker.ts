export interface IConnectionFailureTracker {
  failureCount: number;
  lastCheckTimestamp: number;
}
