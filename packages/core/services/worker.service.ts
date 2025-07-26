import { injectable } from 'tsyringe';
import Docker from 'dockerode';
import { TFunction } from 'i18next';
import { EWorkerImage } from '@core/common/enums/EWorkerImage';
import { WorkerCreatorRepository } from '@core/repositories/worker/WorkerCreator.repository';
import { ICreateWorker } from '@core/common/interfaces/ICreateWorker';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';

@injectable()
export class WorkerService {
  private docker: Docker;

  constructor(
    private readonly workerCreatorRepository: WorkerCreatorRepository
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

  public async createWorker(
    t: TFunction<'translation', undefined>,
    workerType: EWorkerType,
    serverId: number,
    accountId: number,
    containerName: string,
    containerId: string
  ): Promise<number | null> {
    const workerData: ICreateWorker = {
      worker_status_id: EWorkerStatus.online,
      worker_type_id: workerType,
      server_id: serverId,
      account_id: accountId,
      name: containerName,
      container_id: containerId,
    };

    return this.workerCreatorRepository.createWorker(workerData);
  }
}
