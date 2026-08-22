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
import { EProxyProtocol } from '@core/common/enums/EProxyProtocol';
import { ServerWebDeleterRepository } from '@core/repositories/server/ServerWebDeleter.repository';
import { ServerWebViewerRepository } from '@core/repositories/server/ServerWebViewer.repository';
import { ServerSshListerRepository } from '@core/repositories/server/ServerSshLister.repository';
import { IListerServerSsh } from '@core/common/interfaces/IListerServerSsh';
import { currentTime } from '@core/common/functions/currentTime';
import {
  statusServerCentrifugoQueue,
  serverSshCentrifugoQueue,
} from '@core/common/functions/centrifugoQueue';

@injectable()
export class ServerService {
  private installLogIndexPromise: Promise<boolean> | null = null;

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

  private normalizeProxyProtocol(protocol?: string | null): EProxyProtocol {
    if (!protocol) {
      return EProxyProtocol.http;
    }

    if (Object.values(EProxyProtocol).includes(protocol as EProxyProtocol)) {
      return protocol as EProxyProtocol;
    }

    return EProxyProtocol.http;
  }

  createServer = async (
    t: TFunction<'translation', undefined>,
    input: CreateServerRequest
  ) => {
    const proxyEnabled = input.proxy_enabled ?? false;
    const usernameEncrypted = this.passwordEncryptorService.encrypt(
      input.ssh_username
    );
    const passwordEncrypted = this.passwordEncryptorService.encrypt(
      input.ssh_password
    );
    const proxyUsernameEncrypted =
      proxyEnabled && input.proxy_username?.trim()
        ? this.passwordEncryptorService.encrypt(input.proxy_username.trim())
        : null;
    const proxyPasswordEncrypted =
      proxyEnabled && input.proxy_password?.trim()
        ? this.passwordEncryptorService.encrypt(input.proxy_password.trim())
        : null;

    const inputCreateServer: ICreateServer = {
      server_status_id: EServerStatus.new,
      name: input.name,
      quantity_workers: input.quantity_workers,
      proxy_enabled: proxyEnabled,
      proxy_protocol: this.normalizeProxyProtocol(input.proxy_protocol),
      proxy_host: proxyEnabled ? (input.proxy_host ?? null) : null,
      proxy_port: proxyEnabled ? (input.proxy_port ?? null) : null,
      proxy_username: proxyUsernameEncrypted,
      proxy_password: proxyPasswordEncrypted,
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
    status: EServerStatus,
    expectedStatuses?: readonly EServerStatus[]
  ): Promise<boolean> => {
    const date = currentTime();

    const statusServerCentrifugo: IStatusServerCentrifugo = {
      server_id: serverId,
      status: status,
      last_sync: date,
    };

    const updated =
      await this.serverStatusUpdaterRepository.updateServerStatusById(
        serverId,
        status,
        expectedStatuses,
        date
      );

    if (!updated) {
      return false;
    }

    await this.centrifugoService
      .publish(statusServerCentrifugoQueue(), statusServerCentrifugo)
      .catch(() => undefined);

    return true;
  };

  viewServerStatusByIdAuthoritative = async (
    serverId: string
  ): Promise<EServerStatus | null> => {
    return this.serverStatusUpdaterRepository.viewServerStatusById(serverId);
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
    const proxyEnabled = input.proxy_enabled ?? false;
    const sshUsername = input.ssh_username
      ? this.passwordEncryptorService.encrypt(input.ssh_username)
      : null;
    const sshPassword = input.ssh_password
      ? this.passwordEncryptorService.encrypt(input.ssh_password)
      : null;
    const proxyUsername =
      proxyEnabled && input.proxy_username?.trim()
        ? this.passwordEncryptorService.encrypt(input.proxy_username.trim())
        : null;
    const proxyPassword =
      proxyEnabled && input.proxy_password?.trim()
        ? this.passwordEncryptorService.encrypt(input.proxy_password.trim())
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
      proxy_enabled: proxyEnabled,
      proxy_protocol: this.normalizeProxyProtocol(input.proxy_protocol),
      proxy_host: proxyEnabled ? (input.proxy_host ?? null) : null,
      proxy_port: proxyEnabled ? (input.proxy_port ?? null) : null,
      proxy_username: proxyUsername,
      proxy_password: proxyPassword,
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
    const result = await this.serverViewerRepository.viewServerById(serverId);

    if (!result) {
      return null;
    }

    if (!result.proxy?.protocol) {
      result.proxy.protocol = EProxyProtocol.http;
    }

    return result;
  };

  viewServerProxyById = async (serverId: string) => {
    const server =
      await this.serverSshViewerRepository.viewServerSshById(serverId);

    if (!server) {
      return null;
    }

    return {
      enabled: server.proxy_enabled,
      protocol: this.normalizeProxyProtocol(server.proxy_protocol),
      host: server.proxy_host,
      port: server.proxy_port,
      username: server.proxy_username
        ? this.passwordEncryptorService.decrypt(server.proxy_username)
        : null,
      password: server.proxy_password
        ? this.passwordEncryptorService.decrypt(server.proxy_password)
        : null,
    };
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
    if (!this.installLogIndexPromise) {
      this.installLogIndexPromise = this.elasticDatabaseService.indices(
        EElasticIndex.install_server,
        serverInstallMappings()
      );
    }

    let result: boolean;

    try {
      result = await this.installLogIndexPromise;
    } catch (error) {
      // A transient Elasticsearch failure must not poison every later flush.
      // Resetting the shared promise lets the next live batch retry the index.
      this.installLogIndexPromise = null;
      throw error;
    }

    if (!result || documents.length === 0) {
      if (!result) {
        this.installLogIndexPromise = null;
      }
      return false;
    }

    const documentsWithIds = documents.map((document) => ({
      ...document,
      event_id: document.event_id ?? uuidv7(),
    }));

    const bulkResult = await this.elasticDatabaseService.bulkCreateIdempotent(
      EElasticIndex.install_server,
      documentsWithIds,
      (document) => document.event_id
    );

    return bulkResult.created > 0 || bulkResult.conflicts > 0;
  };

  recordLogInstallServerBulk = async (
    documents: IServerSshCentrifugo[]
  ): Promise<IServerSshCentrifugo[]> => {
    const documentsWithIds = documents.map((document) => ({
      ...document,
      event_id: document.event_id ?? uuidv7(),
    }));
    let persistenceError: unknown;

    try {
      await this.updateLogInstallServerBulk(documentsWithIds);
    } catch (error) {
      persistenceError = error;
    }

    await Promise.allSettled(
      documentsWithIds.map((document) =>
        this.centrifugoService.publish(serverSshCentrifugoQueue(), document)
      )
    );

    if (persistenceError) {
      throw persistenceError;
    }

    return documentsWithIds;
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
