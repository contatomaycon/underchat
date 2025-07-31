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
import { WorkerViewerExistsRepository } from '@core/repositories/worker/WorkerViewerExists.repository';
import { WorkerBalancerViewerRepository } from '@core/repositories/worker/WorkerBalancerViewer.repository';
import { WorkerDeleterRepository } from '@core/repositories/worker/WorkerDeleter.repository';
import { WorkerPhoneConnectionDateViewerRepository } from '@core/repositories/worker/WorkerPhoneConnectionDateViewer.repository';
import { IViewWorkerPhoneConnectionDate } from '@core/common/interfaces/IViewWorkerPhoneConnectionDate';
import { WorkerPhoneStatusConnectionDateUpdaterRepository } from '@core/repositories/worker/WorkerPhoneStatusConnectionDateUpdater.repository';
import { IUpdateWorkerPhoneStatusConnectionDate } from '@core/common/interfaces/IUpdateWorkerPhoneStatusConnectionDate';

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
    private readonly workerNameAndIdViewerRepository: WorkerNameAndIdViewerRepository,
    private readonly workerViewerExistsRepository: WorkerViewerExistsRepository,
    private readonly workerBalancerViewerRepository: WorkerBalancerViewerRepository,
    private readonly workerDeleterRepository: WorkerDeleterRepository,
    private readonly workerPhoneConnectionDateViewerRepository: WorkerPhoneConnectionDateViewerRepository,
    private readonly workerPhoneStatusConnectionDateUpdaterRepository: WorkerPhoneStatusConnectionDateUpdaterRepository
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
  ): Promise<boolean> {
    try {
      const container = this.docker.getContainer(workerId);
      await container.remove({ force: true });

      return true;
    } catch {
      throw new Error(t('worker_removal_failed'));
    }
  }

  public async removeVolumeWorkerById(
    workerId: string,
    t: TFunction<'translation', undefined>
  ): Promise<boolean> {
    try {
      const volume = this.docker.getVolume(workerId);
      await volume.remove();

      return true;
    } catch {
      throw new Error(t('worker_volume_removal_failed'));
    }
  }

  public async createContainerWorker(
    t: TFunction<'translation', undefined>,
    imageName: EWorkerImage,
    workerId: string
  ): Promise<string> {
    const existsContainerById = await this.existsContainerWorkerById(workerId);

    if (existsContainerById) {
      await this.removeContainerWorkerById(workerId, t);
    }

    await this.docker.createVolume({
      Name: workerId,
    });

    const getVolume = await this.docker.getVolume(workerId).inspect();

    if (!getVolume) {
      throw new Error(t('worker_volume_creation_failed'));
    }

    const container = await this.docker.createContainer({
      Image: imageName,
      name: workerId,
      HostConfig: {
        Binds: [`${workerId}:/app/data`],
        NetworkMode: 'underchat',
      },
      Volumes: {
        '/app/data': {},
      },
      Env: [`WORKER_ID=${workerId}`],
    });

    await container.start();

    return container.id;
  }

  public async existsImage(imageName: string): Promise<boolean> {
    try {
      const image = this.docker.getImage(imageName);

      await image.inspect();

      return true;
    } catch {
      return false;
    }
  }

  public async removeContainerWorker(
    workerId: string,
    t: TFunction<'translation', undefined>
  ): Promise<boolean> {
    const removeContainerWorkerById = await this.removeContainerWorkerById(
      workerId,
      t
    );

    if (!removeContainerWorkerById) {
      throw new Error(t('worker_removal_failed'));
    }

    const removeVolumeWorkerById = await this.removeVolumeWorkerById(
      workerId,
      t
    );

    if (!removeVolumeWorkerById) {
      throw new Error(t('worker_volume_removal_failed'));
    }

    return true;
  }

  public async createWorker(input: ICreateWorker): Promise<boolean> {
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
    isAdministrator: boolean,
    accountId: string,
    workerId: string,
    name: string
  ): Promise<boolean> => {
    return this.workerUpdaterRepository.updateWorkerById(
      isAdministrator,
      accountId,
      workerId,
      name
    );
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
    isAdministrator: boolean,
    accountId: string,
    workerId: string
  ): Promise<IViewWorkerNameAndId | null> => {
    return this.workerNameAndIdViewerRepository.viewWorkerNameAndId(
      isAdministrator,
      accountId,
      workerId
    );
  };

  existsWorkerById = async (
    isAdministrator: boolean,
    accountId: string,
    workerId: string
  ): Promise<boolean> => {
    return this.workerViewerExistsRepository.existsWorkerById(
      isAdministrator,
      accountId,
      workerId
    );
  };

  viewWorkerBalancer = async (
    accountId: string,
    isAdministrator: boolean,
    workerId: string
  ): Promise<IViewWorkerBalancerServer | null> => {
    return this.workerBalancerViewerRepository.viewWorkerBalancer(
      accountId,
      isAdministrator,
      workerId
    );
  };

  deleteWorkerById = async (
    isAdministrator: boolean,
    accountId: string,
    workerId: string
  ): Promise<boolean> => {
    return this.workerDeleterRepository.deleteWorkerById(
      isAdministrator,
      accountId,
      workerId
    );
  };

  viewWorkerPhoneConnectionDate = async (
    workerId: string
  ): Promise<IViewWorkerPhoneConnectionDate | null> => {
    return this.workerPhoneConnectionDateViewerRepository.viewWorkerPhoneConnectionDate(
      workerId
    );
  };

  updateWorkerPhoneStatusConnectionDate = async (
    input: IUpdateWorkerPhoneStatusConnectionDate
  ): Promise<boolean> => {
    return this.workerPhoneStatusConnectionDateUpdaterRepository.updateWorkerPhoneStatusConnectionDate(
      input
    );
  };
}
