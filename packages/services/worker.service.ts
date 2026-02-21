import { injectable, inject } from 'tsyringe';
import Docker from 'dockerode';
import { EWorkerImage } from '@core/common/enums/EWorkerImage';
import { WorkerCreatorRepository } from '@core/repositories/worker/WorkerCreator.repository';
import { ICreateWorker } from '@core/common/interfaces/ICreateWorker';
import { WorkerServerListerRepository } from '@core/repositories/worker/WorkerServerLister.repository';
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
import { IListWorkerServer } from '@core/common/interfaces/IListWorkerServer';
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
    @inject(WorkerCreatorRepository)
    private readonly workerCreatorRepository: WorkerCreatorRepository,
    @inject(WorkerServerListerRepository)
    private readonly workerServerListerRepository: WorkerServerListerRepository,
    @inject(WorkerServerViewerRepository)
    private readonly workerServerViewerRepository: WorkerServerViewerRepository,
    @inject(WorkerTotalViewerRepository)
    private readonly workerTotalViewerRepository: WorkerTotalViewerRepository,
    @inject(WorkerListerRepository)
    private readonly workerListerRepository: WorkerListerRepository,
    @inject(WorkerUpdaterRepository)
    private readonly workerUpdaterRepository: WorkerUpdaterRepository,
    @inject(WorkerViewerRepository)
    private readonly workerViewerRepository: WorkerViewerRepository,
    @inject(WorkerNameAndContainerIdViewerRepository)
    private readonly workerNameAndContainerIdViewerRepository: WorkerNameAndContainerIdViewerRepository,
    @inject(WorkerViewerExistsRepository)
    private readonly workerViewerExistsRepository: WorkerViewerExistsRepository,
    @inject(WorkerBalancerViewerRepository)
    private readonly workerBalancerViewerRepository: WorkerBalancerViewerRepository,
    @inject(WorkerDeleterRepository)
    private readonly workerDeleterRepository: WorkerDeleterRepository,
    @inject(WorkerPhoneConnectionDateViewerRepository)
    private readonly workerPhoneConnectionDateViewerRepository: WorkerPhoneConnectionDateViewerRepository,
    @inject(WorkerPhoneStatusConnectionDateUpdaterRepository)
    private readonly workerPhoneStatusConnectionDateUpdaterRepository: WorkerPhoneStatusConnectionDateUpdaterRepository,
    @inject(WorkerPhoneConnectionViewerRepository)
    private readonly workerPhoneConnectionViewerRepository: WorkerPhoneConnectionViewerRepository,
    @inject(WorkerPhoneConnectionUpdaterRepository)
    private readonly workerPhoneConnectionUpdaterRepository: WorkerPhoneConnectionUpdaterRepository,
    @inject(WorkerPhoneConnectionCreatorRepository)
    private readonly workerPhoneConnectionCreatorRepository: WorkerPhoneConnectionCreatorRepository,
    @inject(WorkerTypeViewerRepository)
    private readonly workerTypeViewerRepository: WorkerTypeViewerRepository,
    @inject(WorkerBaileysActivitiesListerRepository)
    private readonly workerBaileysActivitiesListerRepository: WorkerBaileysActivitiesListerRepository,
    @inject(WorkerNewStatusListerRepository)
    private readonly workerNewStatusListerRepository: WorkerNewStatusListerRepository,
    @inject(WorkerStatusUpdaterRepository)
    private readonly workerStatusUpdaterRepository: WorkerStatusUpdaterRepository,
    @inject(WorkerNameAndIdViewerRepository)
    private readonly workerNameAndIdViewerRepository: WorkerNameAndIdViewerRepository,
    @inject(WorkerConfigFieldsViewerRepository)
    private readonly workerConfigFieldsViewerRepository: WorkerConfigFieldsViewerRepository,
    @inject(WorkerAllListerRepository)
    private readonly workerAllListerRepository: WorkerAllListerRepository,
    @inject(WorkerMonitorViewerRepository)
    private readonly workerMonitorViewerRepository: WorkerMonitorViewerRepository,
    @inject(WorkerUpdatedAtUpdaterRepository)
    private readonly workerUpdatedAtUpdaterRepository: WorkerUpdatedAtUpdaterRepository,
    @inject(WorkerLastConnectionCheckUpdaterRepository)
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
    isCreateVolume: boolean = true,
    grpcHost?: string,
    grpcPort?: number,
    proxy?: {
      host: string;
      port: number;
      username?: string | null;
      password?: string | null;
    }
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

    const env = [`WORKER_ID=${workerId}`, `ACCOUNT_ID=${accountId}`];
    if (grpcHost !== undefined && grpcPort !== undefined) {
      env.push(
        `BALANCER_GRPC_HOST=${grpcHost}`,
        `BALANCER_GRPC_PORT=${grpcPort}`
      );
    }

    if (proxy?.host && Number.isFinite(proxy.port)) {
      env.push(`PROXY_HOST=${proxy.host}`, `PROXY_PORT=${proxy.port}`);
      if (proxy.username) {
        env.push(`PROXY_USERNAME=${proxy.username}`);
      }
      if (proxy.password) {
        env.push(`PROXY_PASSWORD=${proxy.password}`);
      }
    }

    const container = await this.docker.createContainer({
      Image: imageName,
      name: workerId,
      HostConfig: {
        Binds: [`${workerId}:/app/data`],
        NetworkMode: 'underchat',
        RestartPolicy: {
          Name: 'unless-stopped',
        },
      },
      Volumes: {
        '/app/data': {},
      },
      Env: env,
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

  public async listWorkerServers(): Promise<IListWorkerServer[]> {
    return this.workerServerListerRepository.listWorkerServers();
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
