import { ScheduleHandle, ScheduleNotFoundError } from '@temporalio/client';

export async function getHandleSchedule(
  handleWorkflow: ScheduleHandle
): Promise<boolean> {
  try {
    await handleWorkflow.describe();

    return true;
  } catch (err) {
    if (err instanceof ScheduleNotFoundError) {
      return false;
    }

    console.error('Error getting schedule handle:', err);

    return false;
  }
}
