import { EWorkflowExecutionStatus } from '@core/common/enums/EWorkflowExecutionStatus';
import {
  Workflow,
  WorkflowFailedError,
  WorkflowHandle,
  WorkflowNotFoundError,
} from '@temporalio/client';

export async function getHandleWorkflow(
  handleWorkflow: WorkflowHandle<Workflow>
): Promise<EWorkflowExecutionStatus | null> {
  try {
    const describe = await handleWorkflow.describe();

    return describe.status.code as unknown as EWorkflowExecutionStatus;
  } catch (error) {
    if (error instanceof WorkflowNotFoundError) {
      return null;
    }

    if (error instanceof WorkflowFailedError) {
      return null;
    }

    return null;
  }
}
