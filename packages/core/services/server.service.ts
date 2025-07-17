import { injectable } from 'tsyringe';
import { ServerCreatorRepository } from '@core/repositories/server/ServerCreator.repository';
import { PasswordEncryptorService } from './passwordEncryptor.service';
import { CreateServerRequest } from '@core/schema/server/createServer/request.schema';
import { ICreateServer } from '@core/common/interfaces/ICreateServer';
import { EServerStatus } from '@core/common/enums/EServerStatus';
import { ServerSshCreatorRepository } from '@core/repositories/server/ServerSshCreator.repository';
import { ICreateServerSsh } from '@core/common/interfaces/ICreateServerSsh';
import { ServerSshViewerExistsRepository } from '@core/repositories/server/ServerViewerExists.repository';

@injectable()
export class ServerService {
  constructor(
    private readonly passwordEncryptorService: PasswordEncryptorService,
    private readonly serverCreatorRepository: ServerCreatorRepository,
    private readonly serverSshViewerExistsRepository: ServerSshViewerExistsRepository,
    private readonly serverSshCreatorRepository: ServerSshCreatorRepository
  ) {}

  createServer = async (input: CreateServerRequest) => {
    const inputCreateServer: ICreateServer = {
      server_status_id: EServerStatus.new,
      name: input.name,
    };

    return this.serverCreatorRepository.createServer(inputCreateServer);
  };

  createServerSsh = async (input: CreateServerRequest, serverId: number) => {
    const usernameEncrypted = this.passwordEncryptorService.encrypt(
      input.ssh_username
    );
    const passwordEncrypted = this.passwordEncryptorService.encrypt(
      input.ssh_password
    );

    const inputCreateServerSsh: ICreateServerSsh = {
      server_id: serverId,
      ssh_ip: input.ssh_ip,
      ssh_port: input.ssh_port,
      ssh_username: usernameEncrypted,
      ssh_password: passwordEncrypted,
    };

    return this.serverSshCreatorRepository.createServerSsh(
      inputCreateServerSsh
    );
  };

  viewByIp = async (ip: string): Promise<boolean> => {
    return this.serverSshViewerExistsRepository.viewByIp(ip);
  };
}
