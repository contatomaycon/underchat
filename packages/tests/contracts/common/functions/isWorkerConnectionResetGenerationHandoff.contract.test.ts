import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { isWorkerConnectionResetGenerationHandoff } from '@core/common/functions/isWorkerConnectionResetGenerationHandoff';

describe('isWorkerConnectionResetGenerationHandoff', () => {
  const recreatedAvailablePayload = {
    status: EBaileysConnectionStatus.connecting,
    code: ECodeMessage.awaitConnection,
    worker_status_id: EWorkerStatus.disponible,
    runtime_generation: 2,
  };

  it('accepts the new runtime final state after an old runtime logout', () => {
    expect(
      isWorkerConnectionResetGenerationHandoff(recreatedAvailablePayload, {
        currentCode: ECodeMessage.logoutInProgress,
        currentRuntimeGeneration: 1,
      })
    ).toBe(true);
  });

  it('accepts the new runtime final state while a reset is in progress', () => {
    expect(
      isWorkerConnectionResetGenerationHandoff(recreatedAvailablePayload, {
        currentRuntimeGeneration: 1,
        isResetting: true,
      })
    ).toBe(true);
  });

  it.each([
    {
      description: 'the event is not a reset completion',
      payload: {
        ...recreatedAvailablePayload,
        worker_status_id: EWorkerStatus.recreating,
      },
      context: {
        currentCode: ECodeMessage.logoutInProgress,
        currentRuntimeGeneration: 1,
      },
    },
    {
      description: 'the event does not carry the recreation final state',
      payload: {
        ...recreatedAvailablePayload,
        code: ECodeMessage.connectionClosed,
      },
      context: {
        currentCode: ECodeMessage.logoutInProgress,
        currentRuntimeGeneration: 1,
      },
    },
    {
      description: 'the generation does not advance',
      payload: recreatedAvailablePayload,
      context: {
        currentCode: ECodeMessage.logoutInProgress,
        currentRuntimeGeneration: 2,
      },
    },
    {
      description: 'the modal is not resetting or logging out',
      payload: recreatedAvailablePayload,
      context: { currentRuntimeGeneration: 1 },
    },
  ])('keeps the generation fence when $description', ({ payload, context }) => {
    expect(isWorkerConnectionResetGenerationHandoff(payload, context)).toBe(
      false
    );
  });
});
