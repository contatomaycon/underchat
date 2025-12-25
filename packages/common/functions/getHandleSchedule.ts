import { ScheduleHandle, ScheduleNotFoundError } from '@temporalio/client';
import { delay } from './delay';

function isDeadlineExceededError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'cause' in err) {
    const cause = err.cause;
    if (cause && typeof cause === 'object' && 'code' in cause) {
      return cause.code === 4;
    }
  }

  return false;
}

export async function getHandleSchedule(
  handleWorkflow: ScheduleHandle,
  maxRetries = 3
): Promise<boolean> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await handleWorkflow.describe();

      return true;
    } catch (err) {
      if (err instanceof ScheduleNotFoundError) {
        return false;
      }

      const isDeadlineError = isDeadlineExceededError(err);

      if (isDeadlineError && attempt < maxRetries - 1) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 5000);
        await delay(backoffMs);
        continue;
      }

      if (attempt === maxRetries - 1) {
        console.error('Error getting schedule handle after retries:', err);
      }

      return false;
    }
  }

  return false;
}
