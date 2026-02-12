import { injectable, inject } from 'tsyringe';
import { PasswordEncryptorService } from './passwordEncryptor.service';
import { CreateServerRequest } from '@core/schema/server/createServer/request.schema';
import { ICreateServer } from '@core/common/interfaces/ICreateServer';
import { EServerStatus } from '@core/common/enums/EServerStatus';
import { ICreateServerSsh } from '@core/common/interfaces/ICreateServerSsh';
import { ServerSshViewerExistsRepository } from '@core/repositories/server/ServerSshViewerExists.repository';
import { ServerSshViewerRepository } from '@core/repositories/server/ServerSshViewer.repository';
import { ServerStatusUpdaterRepository } from '@core/repositories/server/ServerStatusUpdater.repository';
import { ServerDeleterRepository } from '@core/repositories/server/ServerDeleter.repository';
import { ServerSshDeleterRepository } from '@core/repositories/server/ServerSshDeleter.repository';
import { ServerViewerExistsRepository } from '@core/repositories/server/ServerViewerExists.repository';
import { EditServerRequest } from '@core/schema/server/editServer/request.schema';
import { IUpdateServerSshById } from '@core/common/interfaces/IUpdateServerSshById';
import { IUpdateServerById } from '@core/common/interfaces/IUpdateServerById';
import { ServerUpdaterRepository } from '@core/repositories/server/ServerUpdater.repository';
import { TFunction } from 'i18next';
import { ServerSshViewerNotIdByIpExistsRepository } from '@core/repositories/server/ServerSshViewerNotIdByIpExists.repository';
import { ServerViewerRepository } from '@core/repositories/server/ServerViewer.repository';
import { ViewServerResponse } from '@core/schema/server/viewServer/response.schema';
import { ServerListerRepository } from '@core/repositories/server/ServerLister.repository';
import { ServerBalanceMonitorViewerRepository } from '@core/repositories/server/ServerBalanceMonitorViewer.repository';
import { IBalanceMonitorServer } from '@core/common/interfaces/IBalanceMonitorServer';
import { ListServerResponse } from '@core/schema/server/listServer/response.schema';
import { ListServerRequest } from '@core/schema/server/listServer/request.schema';
import { CentrifugoService } from './centrifugo.service';
import { IStatusServerCentrifugo } from '@core/common/interfaces/IStatusServerCentrifugo';
import { serverInstallMappings } from '@core/mappings/serverInstall.mappings';
import { ElasticDatabaseService } from './elasticDatabase.service';
import { IServerSshCentrifugo } from '@core/common/interfaces/IServerSshCentrifugo';
import { v7 as uuidv7 } from 'uuid';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { ICreateServerWeb } from '@core/common/interfaces/ICreateServerWeb';
import { ServerCreatorRepository } from '@core/repositories/server/ServerCreator.repository';
import { IUpdateServerWebById } from '@core/common/interfaces/IUpdateServerWebById';
import { EServerWebProtocol } from '@core/common/enums/EServerWebProtocol';
import { ServerWebDeleterRepository } from '@core/repositories/server/ServerWebDeleter.repository';
import { ServerWebViewerRepository } from '@core/repositories/server/ServerWebViewer.repository';
import { ServerSshListerRepository } from '@core/repositories/server/ServerSshLister.repository';
import { IListerServerSsh } from '@core/common/interfaces/IListerServerSsh';
import { currentTime } from '@core/common/functions/currentTime';
import { statusServerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';

@injectable()
export class ServerService {
  constructor(
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(ServerSshViewerExistsRepository)
    private readonly serverSshViewerExistsRepository: ServerSshViewerExistsRepository,
    @inject(ServerSshViewerRepository)
    private readonly serverSshViewerRepository: ServerSshViewerRepository,
    @inject(ServerStatusUpdaterRepository)
    private readonly serverStatusUpdaterRepository: ServerStatusUpdaterRepository,
    @inject(ServerDeleterRepository)
    private readonly serverDeleterRepository: ServerDeleterRepository,
    @inject(ServerSshDeleterRepository)
    private readonly serverSshDeleterRepository: ServerSshDeleterRepository,
    @inject(ServerViewerExistsRepository)
    private readonly serverViewerExistsRepository: ServerViewerExistsRepository,
    @inject(ServerUpdaterRepository)
    private readonly serverUpdaterRepository: ServerUpdaterRepository,
    @inject(ServerSshViewerNotIdByIpExistsRepository)
    private readonly serverSshViewerNotIdByIpExistsRepository: ServerSshViewerNotIdByIpExistsRepository,
    @inject(ServerViewerRepository)
    private readonly serverViewerRepository: ServerViewerRepository,
    @inject(ServerListerRepository)
    private readonly serverListerRepository: ServerListerRepository,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(ServerCreatorRepository)
    private readonly serverCreatorRepository: ServerCreatorRepository,
    @inject(ServerWebDeleterRepository)
    private readonly serverWebDeleterRepository: ServerWebDeleterRepository,
    @inject(ServerWebViewerRepository)
    private readonly serverWebViewerRepository: ServerWebViewerRepository,
    @inject(ServerSshListerRepository)
    private readonly serverSshListerRepository: ServerSshListerRepository,
    @inject(ServerBalanceMonitorViewerRepository)
    private readonly serverBalanceMonitorViewerRepository: ServerBalanceMonitorViewerRepository
  ) {}

  createServer = async (
    t: TFunction<'translation', undefined>,
    input: CreateServerRequest
  ) => {
    const usernameEncrypted = this.passwordEncryptorService.encrypt(
      input.ssh_username
    );
    const passwordEncrypted = this.passwordEncryptorService.encrypt(
      input.ssh_password
    );

    const inputCreateServer: ICreateServer = {
      server_status_id: EServerStatus.new,
      name: input.name,
      quantity_workers: input.quantity_workers,
    };

    const inputCreateServerSsh: ICreateServerSsh = {
      ssh_ip: input.ssh_ip,
      ssh_port: input.ssh_port,
      ssh_username: usernameEncrypted,
      ssh_password: passwordEncrypted,
    };

    const inputCreateServerWeb: ICreateServerWeb = {
      web_domain: input.web_domain,
      web_port: input.web_port,
      web_protocol: input.web_protocol as EServerWebProtocol,
    };

    return this.serverCreatorRepository.createBalanceServer(
      t,
      inputCreateServer,
      inputCreateServerSsh,
      inputCreateServerWeb
    );
  };

  existsServerByIp = async (ip: string): Promise<boolean> => {
    return this.serverSshViewerExistsRepository.existsServerByIp(ip);
  };

  viewServerSshById = async (serverId: string) => {
    return this.serverSshViewerRepository.viewServerSshById(serverId);
  };

  viewServerWebById = async (serverId: string) => {
    return this.serverWebViewerRepository.viewServerWebById(serverId);
  };

  updateServerStatusById = async (
    serverId: string,
    status: EServerStatus
  ): Promise<boolean> => {
    const date = currentTime();

    const statusServerCentrifugo: IStatusServerCentrifugo = {
      server_id: serverId,
      status: status,
      last_sync: date,
    };

    await this.centrifugoService.publish(
      statusServerCentrifugoQueue(),
      statusServerCentrifugo
    );

    return this.serverStatusUpdaterRepository.updateServerStatusById(
      serverId,
      status
    );
  };

  deleteServerById = async (serverId: string): Promise<boolean> => {
    return this.serverDeleterRepository.deleteServerById(serverId);
  };

  deleteServerSshById = async (serverId: string): Promise<boolean> => {
    return this.serverSshDeleterRepository.deleteServerSshById(serverId);
  };

  deleteServerWebById = async (serverId: string): Promise<boolean> => {
    return this.serverWebDeleterRepository.deleteServerWebById(serverId);
  };

  listBalanceServers = async (): Promise<IBalanceMonitorServer[]> => {
    return this.serverBalanceMonitorViewerRepository.listEligible();
  };

  existsServerById = async (serverId: string): Promise<boolean> => {
    return this.serverViewerExistsRepository.existsServerById(serverId);
  };

  updateServerById = async (
    t: TFunction<'translation', undefined>,
    serverId: string,
    input: EditServerRequest
  ): Promise<boolean> => {
    const sshUsername = input.ssh_username
      ? this.passwordEncryptorService.encrypt(input.ssh_username)
      : null;
    const sshPassword = input.ssh_password
      ? this.passwordEncryptorService.encrypt(input.ssh_password)
      : null;

    const inputUpdateServerSsh: IUpdateServerSshById = {
      server_id: serverId,
      ssh_ip: input.ssh_ip,
      ssh_port: input.ssh_port,
      ssh_username: sshUsername,
      ssh_password: sshPassword,
    };

    const inputUpdateServer: IUpdateServerById = {
      server_id: serverId,
      name: input.name,
      quantity_workers: input.quantity_workers,
    };

    const inputUpdateServerWeb: IUpdateServerWebById = {
      server_id: serverId,
      web_domain: input.web_domain,
      web_port: input.web_port,
      web_protocol: input.web_protocol as EServerWebProtocol,
    };

    return this.serverUpdaterRepository.updateServer(
      t,
      inputUpdateServer,
      inputUpdateServerSsh,
      inputUpdateServerWeb
    );
  };

  existsServerNotIdAndByIp = async (
    serverId: string,
    ip: string
  ): Promise<boolean> => {
    return this.serverSshViewerNotIdByIpExistsRepository.existsServerNotIdAndByIp(
      serverId,
      ip
    );
  };

  viewServerById = async (
    serverId: string
  ): Promise<ViewServerResponse | null> => {
    return this.serverViewerRepository.viewServerById(serverId);
  };

  listServers = async (
    perPage: number,
    currentPage: number,
    query: ListServerRequest
  ): Promise<[ListServerResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.serverListerRepository.listServers(perPage, currentPage, query),
      this.serverListerRepository.listServersTotal(query),
    ]);

    return [result, total];
  };

  updateLogInstallServerBulk = async (
    documents: IServerSshCentrifugo[]
  ): Promise<boolean> => {
    const mappings = serverInstallMappings();
    const result = await this.elasticDatabaseService.indices(
      EElasticIndex.install_server,
      mappings
    );

    if (!result || documents.length === 0) {
      return false;
    }

    const bulkResult = await this.elasticDatabaseService.bulkCreateIdempotent(
      EElasticIndex.install_server,
      documents,
      () => uuidv7()
    );

    return bulkResult.created > 0 || bulkResult.conflicts > 0;
  };

  deleteLogInstallServer = async (serverId: string): Promise<boolean> => {
    return this.elasticDatabaseService.deleteAllByQuery(
      EElasticIndex.install_server,
      {
        term: { server_id: serverId },
      }
    );
  };

  listServerSsh = async (): Promise<IListerServerSsh[]> => {
    return this.serverSshListerRepository.listServerSsh();
  };
}
