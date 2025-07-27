import { injectable } from 'tsyringe';
import Docker from 'dockerode';
import { TFunction } from 'i18next';
import { EWorkerImage } from '@core/common/enums/EWorkerImage';
import { WorkerCreatorRepository } from '@core/repositories/worker/WorkerCreator.repository';
import { ICreateWorker } from '@core/common/interfaces/ICreateWorker';
import { WorkerBalancerServerViewerRepository } from '@core/repositories/worker/WorkerBalancerServerViewer.repository';
import { WorkerTotalViewerRepository } from '@core/repositories/worker/WorkerTotalViewer.repository';
import { WorkerListerRepository } from '@core/repositories/worker/WorkerLister.repository';
import { ListWorkerRequest } from '@core/schema/worker/listWorker/request.schema';
import { ListWorkerResponse } from '@core/schema/worker/listWorker/response.schema';
import { IViewWorkerBalancerServer } from '@core/common/interfaces/IViewWorkerBalancerServer';

@injectable()
export class WorkerService {
  private readonly docker: Docker;

  constructor(
    private readonly workerCreatorRepository: WorkerCreatorRepository,
    private readonly workerBalancerServerViewerRepository: WorkerBalancerServerViewerRepository,
    private readonly workerTotalViewerRepository: WorkerTotalViewerRepository,
    private readonly workerListerRepository: WorkerListerRepository
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

    const createVolume = await this.docker.createVolume({
      Name: containerName,
    });

    if (!createVolume.Status) {
      throw new Error(t('worker_volume_creation_failed'));
    }

    const container = await this.docker.createContainer({
      Image: imageName,
      name: containerName,
      HostConfig: {
        Binds: [`${containerName}:/app/data`],
        NetworkMode: 'underchat',
      },
      Volumes: {
        '/app/data': {},
      },
    });

    await container.start();

    return container.id;
  }

  public async createWorker(input: ICreateWorker): Promise<string | null> {
    return this.workerCreatorRepository.createWorker(input);
  }

  public async viewWorkerBalancerServer(
    accountId: string
  ): Promise<IViewWorkerBalancerServer | null> {
    return this.workerBalancerServerViewerRepository.viewWorkerBalancerServer(
      accountId
    );
  }

  public async totalWorkerByAccountId(accountId: string): Promise<number> {
    return this.workerTotalViewerRepository.totalWorkerByAccountId(accountId);
  }

  listWorker = async (
    accountId: string,
    perPage: number,
    currentPage: number,
    query: ListWorkerRequest
  ): Promise<[ListWorkerResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.workerListerRepository.listWorker(
        accountId,
        perPage,
        currentPage,
        query
      ),
      this.workerListerRepository.listWorkerTotal(accountId, query),
    ]);

    return [result, total];
  };
}
