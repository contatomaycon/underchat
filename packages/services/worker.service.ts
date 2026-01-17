import { injectable, inject } from 'tsyringe';
import Docker from 'dockerode';
import { EWorkerImage } from '@core/common/enums/EWorkerImage';
import { WorkerCreatorRepository } from '@core/repositories/worker/WorkerCreator.repository';
import { ICreateWorker } from '@core/common/interfaces/ICreateWorker';
import { WorkerServerViewerRepository } from '@core/repositories/worker/WorkerServerViewer.repository';
import { WorkerTotalViewerRepository } from '@core/repositories/worker/WorkerTotalViewer.repository';
import { WorkerListerRepository } from '@core/repositories/worker/WorkerLister.repository';
import { ListWorkerRequest } from '@core/schema/worker/listWorker/request.schema';
import { ListWorkerResponse } from '@core/schema/worker/listWorker/response.schema';
import { WorkerUpdaterRepository } from '@core/repositories/worker/WorkerUpdater.repository';
import { WorkerViewerRepository } from '@core/repositories/worker/WorkerViewer.repository';
import { ViewWorkerResponse } from '@core/schema/worker/viewWorker/response.schema';
import { WorkerNameAndContainerIdViewerRepository } from '@core/repositories/worker/WorkerNameAndContainerIdViewer.repository';
import { WorkerViewerExistsRepository } from '@core/repositories/worker/WorkerViewerExists.repository';
import { WorkerBalancerViewerRepository } from '@core/repositories/worker/WorkerBalancerViewer.repository';
import { WorkerDeleterRepository } from '@core/repositories/worker/WorkerDeleter.repository';
import { WorkerPhoneConnectionDateViewerRepository } from '@core/repositories/worker/WorkerPhoneConnectionDateViewer.repository';
import { IViewWorkerPhoneConnectionDate } from '@core/common/interfaces/IViewWorkerPhoneConnectionDate';
import { WorkerPhoneStatusConnectionDateUpdaterRepository } from '@core/repositories/worker/WorkerPhoneStatusConnectionDateUpdater.repository';
import { IUpdateWorkerPhoneStatusConnectionDate } from '@core/common/interfaces/IUpdateWorkerPhoneStatusConnectionDate';
import { WorkerPhoneConnectionViewerRepository } from '@core/repositories/worker/WorkerPhoneConnectionViewer.repository';
import { IViewWorkerPhoneConnection } from '@core/common/interfaces/IViewWorkerPhoneConnection';
import { WorkerPhoneConnectionUpdaterRepository } from '@core/repositories/worker/WorkerPhoneConnectionUpdater.repository';
import { IUpdateWorkerPhoneConnection } from '@core/common/interfaces/IUpdateWorkerPhoneConnection';
import { WorkerPhoneConnectionCreatorRepository } from '@core/repositories/worker/WorkerPhoneConnectionCreator.repository';
import { ICreateWorkerPhoneConnection } from '@core/common/interfaces/ICreateWorkerPhoneConnection';
import { WorkerTypeViewerRepository } from '@core/repositories/worker/WorkerTypeViewer.repository';
import { IViewWorkerType } from '@core/common/interfaces/IViewWorkerType';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';
import { IViewWorkerServer } from '@core/common/interfaces/IViewWorkerServer';
import { WorkerBaileysActivitiesListerRepository } from '@core/repositories/worker/WorkerBaileysActivitiesLister.repository';
import { IListWorkerActivities } from '@core/common/interfaces/IListWorkerActivities';
import { WorkerStatusUpdaterRepository } from '@core/repositories/worker/WorkerStatusUpdater.repository';
import { WorkerNewStatusListerRepository } from '@core/repositories/worker/WorkerNewStatusLister.repository';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IViewWorkerNameAndContainerId } from '@core/common/interfaces/IViewWorkerNameAndContainerId';
import { WorkerNameAndIdViewerRepository } from '@core/repositories/worker/WorkerNameAndIdViewer.repository';
import { IViewWorkerNameAndId } from '@core/common/interfaces/IViewWorkerNameAndId';
import { WorkerConfigFieldsViewerRepository } from '@core/repositories/worker/WorkerConfigFieldsViewer.repository';
import { IWorkerConfigFields } from '@core/common/interfaces/IWorkerConfigFields';
import { WorkerAllListerRepository } from '@core/repositories/worker/WorkerAllLister.repository';
import { WorkerMonitorViewerRepository } from '@core/repositories/worker/WorkerMonitorViewer.repository';
import { IWorkerMonitor } from '@core/common/interfaces/IWorkerMonitor';
import { TransferWorker } from '@core/schema/chat/listTransferOptions/response.schema';
import { WorkerUpdatedAtUpdaterRepository } from '@core/repositories/worker/WorkerUpdatedAtUpdater.repository';
import { WorkerLastConnectionCheckUpdaterRepository } from '@core/repositories/worker/WorkerLastConnectionCheckUpdater.repository';
import Redis from 'ioredis';

@injectable()
export class WorkerService {
  private readonly docker: Docker;

  constructor(
    private readonly workerCreatorRepository: WorkerCreatorRepository,
    private readonly workerServerViewerRepository: WorkerServerViewerRepository,
    private readonly workerTotalViewerRepository: WorkerTotalViewerRepository,
    private readonly workerListerRepository: WorkerListerRepository,
    private readonly workerUpdaterRepository: WorkerUpdaterRepository,
    private readonly workerViewerRepository: WorkerViewerRepository,
    private readonly workerNameAndContainerIdViewerRepository: WorkerNameAndContainerIdViewerRepository,
    private readonly workerViewerExistsRepository: WorkerViewerExistsRepository,
    private readonly workerBalancerViewerRepository: WorkerBalancerViewerRepository,
    private readonly workerDeleterRepository: WorkerDeleterRepository,
    private readonly workerPhoneConnectionDateViewerRepository: WorkerPhoneConnectionDateViewerRepository,
    private readonly workerPhoneStatusConnectionDateUpdaterRepository: WorkerPhoneStatusConnectionDateUpdaterRepository,
    private readonly workerPhoneConnectionViewerRepository: WorkerPhoneConnectionViewerRepository,
    private readonly workerPhoneConnectionUpdaterRepository: WorkerPhoneConnectionUpdaterRepository,
    private readonly workerPhoneConnectionCreatorRepository: WorkerPhoneConnectionCreatorRepository,
    private readonly workerTypeViewerRepository: WorkerTypeViewerRepository,
    private readonly workerBaileysActivitiesListerRepository: WorkerBaileysActivitiesListerRepository,
    private readonly workerNewStatusListerRepository: WorkerNewStatusListerRepository,
    private readonly workerStatusUpdaterRepository: WorkerStatusUpdaterRepository,
    private readonly workerNameAndIdViewerRepository: WorkerNameAndIdViewerRepository,
    private readonly workerConfigFieldsViewerRepository: WorkerConfigFieldsViewerRepository,
    private readonly workerAllListerRepository: WorkerAllListerRepository,
    private readonly workerMonitorViewerRepository: WorkerMonitorViewerRepository,
    private readonly workerUpdatedAtUpdaterRepository: WorkerUpdatedAtUpdaterRepository,
    private readonly workerLastConnectionCheckUpdaterRepository: WorkerLastConnectionCheckUpdaterRepository,
    @inject('Redis') private readonly redis: Redis
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

  public async removeContainerWorkerById(workerId: string): Promise<boolean> {
    try {
      const container = this.docker.getContainer(workerId);
      await container.remove({ force: true });

      return true;
    } catch {
      throw new Error('The worker removal failed');
    }
  }

  public async removeVolumeWorkerById(workerId: string): Promise<boolean> {
    try {
      const volume = this.docker.getVolume(workerId);
      await volume.remove();

      return true;
    } catch {
      throw new Error('The worker volume removal failed');
    }
  }

  public async existsVolumeWorkerById(workerId: string): Promise<boolean> {
    try {
      const volume = this.docker.getVolume(workerId);
      await volume.inspect();

      return true;
    } catch {
      return false;
    }
  }

  public async checkVolumeAndCreate(
    workerId: string,
    isCreateVolume: boolean
  ): Promise<void> {
    const getVolume = await this.existsVolumeWorkerById(workerId);

    if (!getVolume || isCreateVolume) {
      await this.docker.createVolume({
        Name: workerId,
      });
    }
  }

  public async createContainerWorker(
    imageName: EWorkerImage,
    workerId: string,
    accountId: string,
    isCreateVolume: boolean = true
  ): Promise<string> {
    const existsContainerById = await this.existsContainerWorkerById(workerId);
    if (existsContainerById) {
      await this.removeContainerWorkerById(workerId);
    }

    await this.checkVolumeAndCreate(workerId, isCreateVolume);

    const getVolume = await this.existsVolumeWorkerById(workerId);
    if (!getVolume) {
      throw new Error('Volume creation failed');
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
      Env: [`WORKER_ID=${workerId}`, `ACCOUNT_ID=${accountId}`],
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
    isRemoveVolume: boolean = true
  ): Promise<boolean> {
    const existsContainerById = await this.existsContainerWorkerById(workerId);

    if (existsContainerById) {
      const removeContainerWorkerById =
        await this.removeContainerWorkerById(workerId);

      if (!removeContainerWorkerById) {
        throw new Error('The worker removal failed');
      }
    }

    if (isRemoveVolume) {
      const removeVolumeWorkerById =
        await this.removeVolumeWorkerById(workerId);

      if (!removeVolumeWorkerById) {
        throw new Error('The worker volume removal failed');
      }
    }

    return true;
  }

  public async createWorker(input: ICreateWorker): Promise<boolean> {
    return this.workerCreatorRepository.createWorker(input);
  }

  public async viewWorkerServer(
    accountId: string
  ): Promise<IViewWorkerServer | null> {
    return this.workerServerViewerRepository.viewWorkerServer(accountId);
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

  updateWorkerById = async (
    accountId: string,
    input: IUpdateWorker
  ): Promise<boolean> => {
    return this.workerUpdaterRepository.updateWorkerById(accountId, input);
  };

  viewWorker = async (
    accountId: string,
    workerId: string
  ): Promise<ViewWorkerResponse | null> => {
    return this.workerViewerRepository.viewWorker(accountId, workerId);
  };

  viewWorkerNameAndContainerId = async (
    accountId: string,
    workerId: string
  ): Promise<IViewWorkerNameAndContainerId | null> => {
    return this.workerNameAndContainerIdViewerRepository.viewWorkerNameAndContainerId(
      accountId,
      workerId
    );
  };

  existsWorkerById = async (
    accountId: string,
    workerId: string
  ): Promise<boolean> => {
    return this.workerViewerExistsRepository.existsWorkerById(
      accountId,
      workerId
    );
  };

  viewWorkerBalancer = async (
    accountId: string,
    workerId: string
  ): Promise<IViewWorkerServer | null> => {
    return this.workerBalancerViewerRepository.viewWorkerBalancer(
      accountId,
      workerId
    );
  };

  deleteWorkerById = async (
    accountId: string,
    workerId: string
  ): Promise<boolean> => {
    return this.workerDeleterRepository.deleteWorkerById(accountId, workerId);
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

  viewWorkerPhoneConnection = async (
    number: string
  ): Promise<IViewWorkerPhoneConnection | null> => {
    return this.workerPhoneConnectionViewerRepository.viewWorkerPhoneConnection(
      number
    );
  };

  totalWorkerPhoneConnection = async (number: string): Promise<number> => {
    return this.workerPhoneConnectionViewerRepository.totalWorkerPhoneConnection(
      number
    );
  };

  updateWorkerPhoneConnection = async (
    input: IUpdateWorkerPhoneConnection
  ): Promise<boolean> => {
    return this.workerPhoneConnectionUpdaterRepository.updateWorkerPhoneConnection(
      input
    );
  };

  createWorkerPhoneConnection = async (
    input: ICreateWorkerPhoneConnection
  ): Promise<boolean> => {
    return this.workerPhoneConnectionCreatorRepository.createWorkerPhoneConnection(
      input
    );
  };

  viewWorkerType = async (
    accountId: string,
    workerId: string
  ): Promise<IViewWorkerType | null> => {
    return this.workerTypeViewerRepository.viewWorkerType(accountId, workerId);
  };

  listWorkerBaileysActivities = async (): Promise<IListWorkerActivities[]> => {
    return this.workerBaileysActivitiesListerRepository.listWorkerBaileysActivities();
  };

  listWorkerNewStatus = async (): Promise<IListWorkerActivities[]> => {
    return this.workerNewStatusListerRepository.listWorkerNewStatus();
  };

  updateStatusWorker = async (
    workerId: string,
    workerStatusId: EWorkerStatus
  ): Promise<boolean> => {
    return this.workerStatusUpdaterRepository.updateStatusWorker(
      workerId,
      workerStatusId
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

  viewWorkerConfigFieldsByWorkerId = async (
    workerId: string
  ): Promise<IWorkerConfigFields | null> => {
    const cacheKey = `worker:${workerId}:config_fields`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as IWorkerConfigFields;
      } catch {
        await this.redis.del(cacheKey);
      }
    }

    const result =
      await this.workerConfigFieldsViewerRepository.viewWorkerConfigFieldsByWorkerId(
        workerId
      );

    if (result) {
      await this.redis.set(cacheKey, JSON.stringify(result), 'EX', 60 * 60 * 8);
    }

    return result;
  };

  listAllWorkers = async (accountId: string): Promise<TransferWorker[]> => {
    return this.workerAllListerRepository.listAllWorkers(accountId);
  };

  listWorkersForMonitor = async (): Promise<IWorkerMonitor[]> => {
    return this.workerMonitorViewerRepository.listWorkers();
  };

  viewWorkerForMonitor = async (
    workerId: string
  ): Promise<IWorkerMonitor | null> => {
    return this.workerMonitorViewerRepository.viewWorker(workerId);
  };

  updateWorkerUpdatedAt = async (workerId: string): Promise<boolean> => {
    return this.workerUpdatedAtUpdaterRepository.updateUpdatedAt(workerId);
  };

  updateWorkerLastConnectionCheckAt = async (
    workerId: string
  ): Promise<boolean> => {
    return this.workerLastConnectionCheckUpdaterRepository.updateLastConnectionCheckAt(
      workerId
    );
  };
}
