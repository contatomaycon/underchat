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
import { WorkerUpdaterRepository } from '@core/repositories/worker/WorkerUpdater.repository';
import { WorkerViewerRepository } from '@core/repositories/worker/WorkerViewer.repository';
import { ViewWorkerResponse } from '@core/schema/worker/viewWorker/response.schema';
import { WorkerNameAndIdViewerRepository } from '@core/repositories/worker/WorkerNameAndIdViewer.repository';
import { IViewWorkerNameAndId } from '@core/common/interfaces/IViewWorkerNameAndId';

@injectable()
export class WorkerService {
  private readonly docker: Docker;

  constructor(
    private readonly workerCreatorRepository: WorkerCreatorRepository,
    private readonly workerBalancerServerViewerRepository: WorkerBalancerServerViewerRepository,
    private readonly workerTotalViewerRepository: WorkerTotalViewerRepository,
    private readonly workerListerRepository: WorkerListerRepository,
    private readonly workerUpdaterRepository: WorkerUpdaterRepository,
    private readonly workerViewerRepository: WorkerViewerRepository,
    private readonly workerNameAndIdViewerRepository: WorkerNameAndIdViewerRepository
  ) {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  public async existsContainerWorkerById(
    containerName: string
  ): Promise<boolean> {
    try {
      const container = this.docker.getContainer(containerName);
      await container.inspect();

      return true;
    } catch {
      return false;
    }
  }

  public async removeContainerWorkerById(
    containerName: string,
    t: TFunction<'translation', undefined>
  ): Promise<boolean> {
    try {
      const container = this.docker.getContainer(containerName);
      await container.remove({ force: true });

      return true;
    } catch {
      throw new Error(t('worker_removal_failed'));
    }
  }

  public async removeVolumeWorkerById(
    containerName: string,
    t: TFunction<'translation', undefined>
  ): Promise<boolean> {
    try {
      const volume = this.docker.getVolume(containerName);
      await volume.remove();

      return true;
    } catch {
      throw new Error(t('worker_volume_removal_failed'));
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

    await this.docker.createVolume({
      Name: containerName,
    });

    const getVolume = await this.docker.getVolume(containerName).inspect();

    if (!getVolume) {
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

  public async removeContainerWorker(
    containerName: string,
    t: TFunction<'translation', undefined>
  ): Promise<boolean> {
    const removeContainerWorkerById = await this.removeContainerWorkerById(
      containerName,
      t
    );

    if (!removeContainerWorkerById) {
      throw new Error(t('worker_removal_failed'));
    }

    const removeVolumeWorkerById = await this.removeVolumeWorkerById(
      containerName,
      t
    );

    if (!removeVolumeWorkerById) {
      throw new Error(t('worker_volume_removal_failed'));
    }

    return true;
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
    isAdministrator: boolean,
    perPage: number,
    currentPage: number,
    query: ListWorkerRequest
  ): Promise<[ListWorkerResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.workerListerRepository.listWorker(
        accountId,
        isAdministrator,
        perPage,
        currentPage,
        query
      ),
      this.workerListerRepository.listWorkerTotal(
        accountId,
        isAdministrator,
        query
      ),
    ]);

    return [result, total];
  };

  updateWorkerById = async (
    workerId: string,
    name: string
  ): Promise<boolean> => {
    return this.workerUpdaterRepository.updateWorkerById(workerId, name);
  };

  viewWorker = async (
    accountId: string,
    isAdministrator: boolean,
    workerId: string
  ): Promise<ViewWorkerResponse | null> => {
    return this.workerViewerRepository.viewWorker(
      accountId,
      isAdministrator,
      workerId
    );
  };

  viewWorkerNameAndId = async (
    accountId: string,
    workerId: string
  ): Promise<IViewWorkerNameAndId | null> => {
    return this.workerNameAndIdViewerRepository.viewWorkerNameAndId(
      accountId,
      workerId
    );
  };
}
