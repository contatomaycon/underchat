import { singleton, inject } from 'tsyringe';
import { CreateServerResponse } from '@core/schema/server/createServer/response.schema';
import { SshService } from '@core/services/ssh.service';
import { ServerService } from '@core/services/server.service';
import { EServerStatus } from '@core/common/enums/EServerStatus';
import { ConnectConfig } from 'ssh2';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { isDistroVersionAllowed } from '@core/common/functions/isDistroVersionAllowed';
import { IDistroInfo } from '@core/common/interfaces/IDistroInfo';
import { FastifyInstance } from 'fastify';
import { IViewServerWebById } from '@core/common/interfaces/IViewServerWebById';
import { Kafka, Consumer } from 'kafkajs';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';

@singleton()
export class BalanceCreatorConsume {
  private consumer: Consumer | null = null;

  constructor(
    @inject('Kafka') private readonly kafka: Kafka,
    private readonly sshService: SshService,
    private readonly serverService: ServerService,
    private readonly passwordEncryptorService: PasswordEncryptorService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {}

  async execute(server: FastifyInstance): Promise<void> {
    if (this.consumer) {
      return;
    }

    const topic = this.kafkaServiceQueueService.createServer();
    this.consumer = this.createConsumer();

    await this.consumer.connect();
    await this.consumer.subscribe({ topic, fromBeginning: false });

    await this.consumer.run({
      autoCommit: false,
      eachBatchAutoResolve: false,
      partitionsConsumedConcurrently: 1,
      eachBatch: async ({
        batch,
        resolveOffset,
        heartbeat,
        commitOffsetsIfNecessary,
        uncommittedOffsets,
        isRunning,
        isStale,
      }) => {
        for (const message of batch.messages) {
          if (!isRunning() || isStale()) break;

          const data = this.parseMessage(message.value);
          if (!data) {
            server.log.warn('Skipping message without value or invalid JSON');
            resolveOffset(message.offset);

            await commitOffsetsIfNecessary(uncommittedOffsets());
            await heartbeat();

            continue;
          }

          const hb = setInterval(() => {
            heartbeat().catch(() => {});
          }, 2000);

          try {
            await this.handleCreateServerMessage(server, data);
          } finally {
            clearInterval(hb);
          }

          resolveOffset(message.offset);
          await commitOffsetsIfNecessary(uncommittedOffsets());
          await heartbeat();
        }
      },
    });
  }

  public async close(): Promise<void> {
    if (!this.consumer) {
      return;
    }

    try {
      await this.consumer.stop();
    } finally {
      await this.consumer.disconnect();
      this.consumer = null;
    }
  }

  private createConsumer(): Consumer {
    const consumer = this.kafka.consumer({
      groupId: 'group-underchat-balance-creator',
      retry: { retries: 8, initialRetryTime: 300 },
      allowAutoTopicCreation: true,
      sessionTimeout: 90000,
      rebalanceTimeout: 180000,
      heartbeatInterval: 3000,
      metadataMaxAge: 30000,
    });

    return consumer;
  }

  private async handleCreateServerMessage(
    server: FastifyInstance,
    data: CreateServerResponse
  ): Promise<void> {
    let serverId: string | null = null;

    try {
      serverId = data.server_id ?? null;

      if (!serverId) {
        throw new Error('Server ID is not defined in the message');
      }

      const { getDistroAndVersion, sshConfig, webView } =
        await this.validate(serverId);

      await this.serverService.updateServerStatusById(
        serverId,
        EServerStatus.installing
      );

      const installCommands = await this.sshService.getInstallCommands(
        getDistroAndVersion,
        webView
      );
      const logs = await this.sshService.runCommands(
        serverId,
        sshConfig,
        installCommands
      );

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

      await this.serverService.deleteLogInstallServer(serverId);
      await this.serverService.updateLogInstallServerBulk(logs);

      const installed = await this.isInstalled(
        serverId,
        getDistroAndVersion,
        sshConfig,
        webView
      );
      const finalStatus = installed
        ? EServerStatus.online
        : EServerStatus.error;

      await this.serverService.updateServerStatusById(serverId, finalStatus);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);

      if (msg === 'Server is not in new status') {
        server.log.info(`Skipping server ${serverId ?? 'unknown'}: ${msg}`);
        return;
      }

      server.log.warn(`Skipping server ${serverId ?? 'unknown'}: ${msg}`);

      if (serverId) {
        try {
          const view = await this.serverService.viewServerSshById(serverId);
          if (view?.server_status_id === EServerStatus.installing) {
            await this.serverService.updateServerStatusById(
              serverId,
              EServerStatus.error
            );
          }
        } catch {}
      }
    }
  }

  private async validate(serverId: string): Promise<{
    getDistroAndVersion: IDistroInfo;
    sshConfig: ConnectConfig;
    webView: IViewServerWebById;
  }> {
    const [sshView, webView] = await Promise.all([
      this.serverService.viewServerSshById(serverId),
      this.serverService.viewServerWebById(serverId),
    ]);

    if (!sshView) {
      throw new Error('SSH configuration not found');
    }

    if (!webView) {
      throw new Error('Web configuration not found');
    }

    if (sshView.server_status_id !== EServerStatus.new) {
      throw new Error('Server is not in new status');
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

    return { getDistroAndVersion: distro, sshConfig, webView };
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
      await this.delay(1000);

      const result = await this.sshService.runCommands(
        serverId,
        sshConfig,
        commands
      );

      if (result.length > 0) {
        await this.serverService.updateLogInstallServerBulk(result);
      }

      const lastOutput = result[result.length - 1]?.output?.trim();
      const status = Number(lastOutput ?? 0);

      if (status === 200) {
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
      await this.delay(1000);

      const result = await this.sshService.runCommands(
        serverId,
        sshConfig,
        getImagesCommands
      );

      if (result.length > 0) {
        await this.serverService.updateLogInstallServerBulk(result);
      }

      const lastOutput = result[result.length - 1]?.output?.trim();
      const status = Boolean(lastOutput ?? false);

      if (status) {
        return true;
      }
    }

    return false;
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

  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));

    return;
  }
}
