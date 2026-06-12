import { singleton, inject } from 'tsyringe';
import { CreateServerResponse } from '@core/schema/server/createServer/response.schema';
import {
  SshService,
  SshRunCommandsCancelledError,
  SshRunCommandsError,
} from '@core/services/ssh.service';
import { ServerService } from '@core/services/server.service';
import { EServerStatus } from '@core/common/enums/EServerStatus';
import { ConnectConfig } from 'ssh2';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { isDistroVersionAllowed } from '@core/common/functions/isDistroVersionAllowed';
import { IDistroInfo } from '@core/common/interfaces/IDistroInfo';
import { FastifyInstance } from 'fastify';
import { IViewServerWebById } from '@core/common/interfaces/IViewServerWebById';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { delay } from '@core/common/functions/delay';
import { getErrorMessage } from '@core/common/functions/toError';
import { ServerBuildService } from '@core/services/serverBuild.service';
import { IServerBuildDefaultImages } from '@core/common/interfaces/IServerBuildDefaultImages';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';

class MissingDefaultBuildImagesError extends Error {
  constructor() {
    super('Default build images not found');
    this.name = 'MissingDefaultBuildImagesError';
  }
}

@singleton()
export class BalanceCreatorConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<CreateServerResponse> | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(SshService)
    private readonly sshService: SshService,
    @inject(ServerService)
    private readonly serverService: ServerService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(ServerBuildService)
    private readonly serverBuildService: ServerBuildService
  ) {}

  async execute(server: FastifyInstance): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.createServer();
    this.runner = new KafkaConsumerRunner<CreateServerResponse>({
      kafka: this.kafka,
      topic,
      groupId: 'group-underchat-balance-creator',
      parse: (message) => this.parseMessage(message.value),
      resolveEntityKey: (data) => data.server_id ?? 'unknown-server',
      handle: (data) => this.processMessageWithRetry(server, data),
      onInvalidMessage: () => {
        server.log.warn('Skipping message without value or invalid JSON');
      },
      logger: console,
    });

    await this.runner.start(() => {
      this.isRunning = true;
    });
    this.consumer = this.runner.consumer;
  }

  public async close(): Promise<void> {
    this.isRunning = false;
    if (this.runner) {
      await this.runner.close();
      this.runner = null;
    }
    this.consumer = null;
  }

  private async processMessageWithRetry(
    server: FastifyInstance,
    data: CreateServerResponse
  ): Promise<void> {
    const maxAttempts = 5;
    const delayMs = 10_000;
    const maxMissingDefaultWaitAttempts = 60;
    let missingDefaultWaitAttempts = 0;
    const serverId = data.server_id ?? null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (serverId && (await this.isServerCanceled(serverId))) {
        server.log.warn(
          `Skipping server ${serverId}: installation already canceled`
        );
        return;
      }

      try {
        await this.handleCreateServerMessage(server, data);
        return;
      } catch (err) {
        if (err instanceof SshRunCommandsCancelledError) {
          server.log.warn(
            `Skipping server ${data.server_id ?? 'unknown'}: installation canceled`
          );
          return;
        }

        if (err instanceof SshRunCommandsError) {
          server.log.warn(
            `Skipping server ${data.server_id ?? 'unknown'}: ${getErrorMessage(err)}`
          );
          if (serverId) {
            await this.serverService.updateServerStatusById(
              serverId,
              EServerStatus.error
            );
          }

          return;
        }

        if (err instanceof MissingDefaultBuildImagesError) {
          const hasActiveBuildJob =
            await this.serverBuildService.hasActiveBuildJob();

          if (
            hasActiveBuildJob &&
            missingDefaultWaitAttempts < maxMissingDefaultWaitAttempts
          ) {
            missingDefaultWaitAttempts += 1;

            server.log.warn(
              `Default build images not found for server ${data.server_id ?? 'unknown'} while a build job is active (${missingDefaultWaitAttempts}/${maxMissingDefaultWaitAttempts}). Retrying in ${delayMs / 1000}s`
            );

            await delay(delayMs);
            attempt -= 1;
            continue;
          }

          server.log.warn(
            `Skipping server ${data.server_id ?? 'unknown'}: ${getErrorMessage(err)}`
          );
          if (serverId) {
            await this.serverService.updateServerStatusById(
              serverId,
              EServerStatus.error
            );
          }

          return;
        }

        if (serverId && (await this.isServerCanceled(serverId))) {
          server.log.warn(
            `Skipping server ${serverId}: installation canceled during retry flow`
          );
          return;
        }

        if (attempt < maxAttempts) {
          server.log.warn(
            `Server ${data.server_id ?? 'unknown'} installation attempt ${attempt} failed, retrying in ${delayMs / 1000}s`
          );
          await delay(delayMs);
          continue;
        }

        server.log.warn(
          `Skipping server ${data.server_id ?? 'unknown'}: ${getErrorMessage(err)}`
        );
        if (serverId) {
          await this.serverService.updateServerStatusById(
            serverId,
            EServerStatus.error
          );
        }
      }
    }
  }

  private async handleCreateServerMessage(
    server: FastifyInstance,
    data: CreateServerResponse
  ): Promise<void> {
    let serverId: string | null = null;

    try {
      serverId = data.server_id ?? null;
      if (!serverId) throw new Error('Server ID is not defined in the message');

      const { getDistroAndVersion, sshConfig, webView, defaultImages } =
        await this.validate(serverId);

      const [, installCommands] = await Promise.all([
        this.serverService.updateServerStatusById(
          serverId,
          EServerStatus.installing
        ),
        this.sshService.getInstallCommands(
          getDistroAndVersion,
          webView,
          defaultImages
        ),
      ]);

      const logs = await this.sshService.runCommands(
        serverId,
        sshConfig,
        installCommands,
        true,
        {
          failOnNonZero: true,
          cancellationKey: serverId,
        }
      );

      if (logs.length === 0) {
        await this.serverService.updateServerStatusById(
          serverId,
          EServerStatus.error
        );

        throw new Error('Docker installation logs are empty');
      }

      const built = await this.imageIsBuilt(
        serverId,
        getDistroAndVersion,
        sshConfig
      );

      if (!built) {
        await this.serverService.updateServerStatusById(
          serverId,
          EServerStatus.error
        );

        throw new Error('Docker image is not built');
      }

      await Promise.all([
        this.serverService.deleteLogInstallServer(serverId),
        this.serverService.updateLogInstallServerBulk(logs),
      ]);

      const installed = await this.isInstalled(
        serverId,
        getDistroAndVersion,
        sshConfig,
        webView
      );

      if (await this.isServerCanceled(serverId)) {
        return;
      }

      const finalStatus = installed
        ? EServerStatus.online
        : EServerStatus.error;

      await this.serverService.updateServerStatusById(serverId, finalStatus);
    } catch (err: unknown) {
      if (
        err instanceof SshRunCommandsError ||
        err instanceof SshRunCommandsCancelledError
      ) {
        if (err.partialResults.length > 0) {
          await this.serverService.updateLogInstallServerBulk(
            err.partialResults
          );
        }
      }

      throw err;
    }
  }

  private async validate(serverId: string): Promise<{
    getDistroAndVersion: IDistroInfo;
    sshConfig: ConnectConfig;
    webView: IViewServerWebById;
    defaultImages: IServerBuildDefaultImages;
  }> {
    const [sshView, webView, defaultImages] = await Promise.all([
      this.serverService.viewServerSshById(serverId),
      this.serverService.viewServerWebById(serverId),
      this.serverBuildService.getDefaultImages(),
    ]);

    if (!sshView) {
      throw new Error('SSH configuration not found');
    }

    if (!webView) {
      throw new Error('Web configuration not found');
    }

    if (!defaultImages) {
      throw new MissingDefaultBuildImagesError();
    }

    const isNewOrInstalling =
      sshView.server_status_id === EServerStatus.new ||
      sshView.server_status_id === EServerStatus.installing;

    if (!isNewOrInstalling) {
      throw new Error('Server is not in new or installing status');
    }

    const sshConfig: ConnectConfig = {
      host: sshView.ssh_ip,
      port: sshView.ssh_port,
      username: this.passwordEncryptorService.decrypt(sshView.ssh_username),
      password: this.passwordEncryptorService.decrypt(sshView.ssh_password),
    };

    const connected = await this.sshService.testSSHConnection(sshConfig);
    if (!connected) {
      throw new Error('SSH connection failed');
    }

    const distro = await this.sshService.getDistroAndVersion(sshConfig);
    if (!distro) {
      throw new Error('Failed to retrieve distribution and version');
    }

    if (!isDistroVersionAllowed(distro)) {
      throw new Error('Distribution and version not allowed');
    }

    return { getDistroAndVersion: distro, sshConfig, webView, defaultImages };
  }

  private async isInstalled(
    serverId: string,
    getDistroAndVersion: IDistroInfo,
    sshConfig: ConnectConfig,
    webView: IViewServerWebById,
    attempts = 20
  ): Promise<boolean> {
    if (!sshConfig.host) {
      throw new Error('SSH host is not defined');
    }

    const commands = this.sshService.getStatusCommands(
      getDistroAndVersion,
      sshConfig.host,
      webView.web_port
    );

    for (let i = 0; i < attempts; i++) {
      if (await this.isServerCanceled(serverId)) {
        throw new SshRunCommandsCancelledError(
          serverId,
          'installation_status_check',
          []
        );
      }

      await delay(1000);

      const result = await this.sshService.runCommands(
        serverId,
        sshConfig,
        commands,
        true,
        {
          cancellationKey: serverId,
        }
      );

      if (result.length > 0) {
        await this.serverService.updateLogInstallServerBulk(result);
      }

      const lastOutput = (result.at(-1)?.output ?? '')
        .replaceAll('\r', '')
        .trim();
      const status = /^(200|true|1)$/i.test(lastOutput);

      if (status) {
        return true;
      }
    }

    return false;
  }

  private async imageIsBuilt(
    serverId: string,
    getDistroAndVersion: IDistroInfo,
    sshConfig: ConnectConfig,
    attempts = 20
  ): Promise<boolean> {
    const getImagesCommands =
      this.sshService.getImagesCommands(getDistroAndVersion);

    for (let i = 0; i < attempts; i++) {
      if (await this.isServerCanceled(serverId)) {
        throw new SshRunCommandsCancelledError(
          serverId,
          'installation_image_check',
          []
        );
      }

      await delay(1000);

      const result = await this.sshService.runCommands(
        serverId,
        sshConfig,
        getImagesCommands,
        true,
        {
          cancellationKey: serverId,
        }
      );

      if (result.length > 0) {
        await this.serverService.updateLogInstallServerBulk(result);
      }

      const lastOutput = (result.at(-1)?.output ?? '')
        .replaceAll('\r', '')
        .trim();
      const status = /^(true|1)$/i.test(lastOutput);

      if (status) {
        return true;
      }
    }

    return false;
  }

  private async isServerCanceled(serverId: string): Promise<boolean> {
    const sshView = await this.serverService.viewServerSshById(serverId);

    if (!sshView) {
      return false;
    }

    return sshView.server_status_id === EServerStatus.canceled;
  }

  private parseMessage(value: Buffer | null): CreateServerResponse | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as CreateServerResponse;
      return parsed ?? null;
    } catch {
      return null;
    }
  }
}
