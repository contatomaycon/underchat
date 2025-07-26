import { injectable } from 'tsyringe';
import Docker from 'dockerode';
import { TFunction } from 'i18next';
import { EWorkerImage } from '@core/common/enums/EWorkerImage';
import { WorkerCreatorRepository } from '@core/repositories/worker/WorkerCreator.repository';
import { ICreateWorker } from '@core/common/interfaces/ICreateWorker';
import { WorkerBalancerServerViewerRepository } from '@core/repositories/worker/WorkerBalancerServerViewer.repository';
import { WorkerTotalViewerRepository } from '@core/repositories/worker/WorkerTotalViewer.repository';

@injectable()
export class WorkerService {
  private docker: Docker;

  constructor(
    private readonly workerCreatorRepository: WorkerCreatorRepository,
    private readonly workerBalancerServerViewerRepository: WorkerBalancerServerViewerRepository,
    private readonly workerTotalViewerRepository: WorkerTotalViewerRepository
  ) {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  public async existsContainerWorkerById(workerId: string): Promise<boolean> {
    try {
      const container = this.docker.getContainer(workerId);
      await container.inspect();

      return true;
    } catch {
      return false;
    }
  }

  public async removeContainerWorkerById(
    workerId: string,
    t: TFunction<'translation', undefined>
  ): Promise<void> {
    try {
      const container = this.docker.getContainer(workerId);

      await container.remove({ force: true });
    } catch {
      throw new Error(t('worker_removal_failed'));
    }
  }

  public async createContainerWorker(
    t: TFunction<'translation', undefined>,
    imageName: EWorkerImage,
    containerName: string
  ): Promise<string> {
    const existsContainerById =
      await this.existsContainerWorkerById(containerName);

    if (existsContainerById) {
      await this.removeContainerWorkerById(containerName, t);
    }

    const container = await this.docker.createContainer({
      Image: imageName,
      name: containerName,
    });

    await container.start();

    return container.id;
  }

  public async createWorker(input: ICreateWorker): Promise<number | null> {
    return this.workerCreatorRepository.createWorker(input);
  }

  public async viewWorkerBalancerServerId(): Promise<number | null> {
    return this.workerBalancerServerViewerRepository.viewWorkerBalancerServerId();
  }

  public async totalWorkerByAccountId(accountId: number): Promise<number> {
    return this.workerTotalViewerRepository.totalWorkerByAccountId(accountId);
  }
}
