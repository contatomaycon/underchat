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
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { delay } from '@core/common/functions/delay';
import { createConsumer } from '@core/common/functions/createConsumer';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { getErrorMessage } from '@core/common/functions/toError';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';

@singleton()
export class BalanceCreatorConsume {
  private consumer: KafkaConsumer | null = null;
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
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) throw new Error('Consumer not initialized');

    return this.consumer;
  }

  async execute(server: FastifyInstance): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.createServer();

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaServiceQueueService.getNumPartitions(),
      this.kafkaServiceQueueService.getReplicationFactor()
    );

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-balance-creator'
    );

    this.consumer.on('data', async (message) => {
      const data = this.parseMessage(message.value);

      if (!data) {
        server.log.warn('Skipping message without value or invalid JSON');
        await this.commitNext(topic, message.partition, message.offset);
        return;
      }

      const heartbeat = async () => {
        this.consumer?.commit();
      };

      const stop = startHeartbeat(heartbeat);
      try {
        await this.processMessageWithRetry(server, data);
      } finally {
        stop();
      }

      await this.commitNext(topic, message.partition, message.offset);
    });

    this.consumer.on('event.error', (err) => {
      handleConsumerError(err, topic);
    });

    const consumer = this.consumer;
    if (!consumer) {
      throw new Error('Consumer not initialized');
    }

    connectConsumer(consumer, topic, () => {
      this.isRunning = true;
    });
  }

  public async close(): Promise<void> {
    if (!this.consumer) return;

    try {
      this.isRunning = false;
      await new Promise<void>((resolve) => {
        const consumer = this.consumer;
        if (!consumer) {
          resolve();
          return;
        }
        consumer.unsubscribe();
        consumer.disconnect(resolve);
      });
    } finally {
      this.consumer = null;
    }
  }

  private async commitNext(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    await commitOffset(this.consumerOrThrow, topic, partition, offset);
  }

  private async processMessageWithRetry(
    server: FastifyInstance,
    data: CreateServerResponse
  ): Promise<void> {
    const maxAttempts = 5;
    const delayMs = 10_000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.handleCreateServerMessage(server, data);
        return;
      } catch (err) {
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
        const serverId = data.server_id ?? null;
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

      const { getDistroAndVersion, sshConfig, webView } =
        await this.validate(serverId);

      const [, installCommands] = await Promise.all([
        this.serverService.updateServerStatusById(
          serverId,
          EServerStatus.installing
        ),
        this.sshService.getInstallCommands(getDistroAndVersion, webView),
      ]);

      const logs = await this.sshService.runCommands(
        serverId,
        sshConfig,
        installCommands
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

      const finalStatus = installed
        ? EServerStatus.online
        : EServerStatus.error;

      await this.serverService.updateServerStatusById(serverId, finalStatus);
    } catch (err: unknown) {
      throw err;
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
      await delay(1000);

      const result = await this.sshService.runCommands(
        serverId,
        sshConfig,
        commands
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
      await delay(1000);

      const result = await this.sshService.runCommands(
        serverId,
        sshConfig,
        getImagesCommands
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
