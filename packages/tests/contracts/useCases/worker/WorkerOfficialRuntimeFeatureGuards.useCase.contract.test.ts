import 'reflect-metadata';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { UpdateTypingSimulationUseCase } from '@core/useCases/worker/UpdateTypingSimulation.useCase';
import { UpdateSecurityKeyUseCase } from '@core/useCases/worker/UpdateSecurityKey.useCase';
import { WorkerProfileStatusListerUseCase } from '@core/useCases/worker/WorkerProfileStatusLister.useCase';
import { WorkerProfileStatusUpdaterUseCase } from '@core/useCases/worker/WorkerProfileStatusUpdater.useCase';

const t = ((key: string) => key) as never;

const buildOfficialWorkerService = () => ({
  viewWorker: jest.fn(async () => ({
    type: { id: EWorkerType.whatsapp },
  })),
});

describe('Official WhatsApp runtime feature guards', () => {
  it('rejects typing simulation updates for official channels', async () => {
    const workerConfigService = {
      updateTypingSimulation: jest.fn(),
    };
    const workerService = buildOfficialWorkerService();
    const useCase = new UpdateTypingSimulationUseCase(
      workerConfigService as never,
      workerService as never
    );

    await expect(
      useCase.execute(t, 'account-1', 'worker-1', {
        enabled: true,
        speed: 50,
      })
    ).rejects.toThrow('whatsapp_official_runtime_action_not_supported');
    expect(workerConfigService.updateTypingSimulation).not.toHaveBeenCalled();
  });

  it('rejects security key updates for official channels', async () => {
    const workerConfigService = {
      updateSecurityKey: jest.fn(),
    };
    const workerService = buildOfficialWorkerService();
    const useCase = new UpdateSecurityKeyUseCase(
      workerConfigService as never,
      workerService as never
    );

    await expect(
      useCase.execute(t, 'account-1', 'worker-1', {
        enabled: true,
        chatbot: true,
        schedule: true,
        quick_message: true,
      })
    ).rejects.toThrow('whatsapp_official_runtime_action_not_supported');
    expect(workerConfigService.updateSecurityKey).not.toHaveBeenCalled();
  });

  it('rejects profile status listing for official channels', async () => {
    const workerProfileStatusService = {
      listProfileStatus: jest.fn(),
    };
    const workerService = buildOfficialWorkerService();
    const useCase = new WorkerProfileStatusListerUseCase(
      workerProfileStatusService as never,
      workerService as never
    );

    await expect(useCase.execute(t, 'account-1', 'worker-1')).rejects.toThrow(
      'whatsapp_official_runtime_action_not_supported'
    );
    expect(workerProfileStatusService.listProfileStatus).not.toHaveBeenCalled();
  });

  it('rejects profile status updates for official channels', async () => {
    const workerProfileStatusService = {
      updateIsPermanent: jest.fn(),
    };
    const workerService = buildOfficialWorkerService();
    const workerProfileStatusViewerRepository = {
      viewWorkerProfileStatusById: jest.fn(async () => ({
        worker_id: 'worker-1',
      })),
    };
    const useCase = new WorkerProfileStatusUpdaterUseCase(
      workerProfileStatusService as never,
      workerService as never,
      workerProfileStatusViewerRepository as never
    );

    await expect(
      useCase.execute(t, 'status-1', 'account-1', {
        is_permanent: true,
      })
    ).rejects.toThrow('whatsapp_official_runtime_action_not_supported');
    expect(workerProfileStatusService.updateIsPermanent).not.toHaveBeenCalled();
  });
});
