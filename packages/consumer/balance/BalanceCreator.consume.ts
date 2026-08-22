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
import type {
  ServerInstallStageId,
  ServerInstallStageStatus,
  ServerInstallStatus,
} from '@core/common/interfaces/IServerInstallEvent';
import type { IServerSshCentrifugo } from '@core/common/interfaces/IServerSshCentrifugo';
import { v7 as uuidv7 } from 'uuid';

class MissingDefaultBuildImagesError extends Error {
  constructor() {
    super('Default build images not found');
    this.name = 'MissingDefaultBuildImagesError';
  }
}

class ServerInstallationAlreadySettledError extends Error {
  constructor(readonly status: EServerStatus) {
    super(`Server installation is already settled with status ${status}`);
    this.name = 'ServerInstallationAlreadySettledError';
  }
}

class ServerInstallationPreflightTimeoutError extends Error {
  constructor(
    readonly serverId: string,
    readonly timeoutMs: number
  ) {
    super(`Server installation preflight timed out after ${timeoutMs}ms`);
    this.name = 'ServerInstallationPreflightTimeoutError';
  }
}

const SERVER_INSTALL_PREFLIGHT_TIMEOUT_MS = (() => {
  const configured = Number(process.env.SERVER_INSTALL_PREFLIGHT_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : 120_000;
})();

const SERVER_INSTALL_COMMAND_TIMEOUT_MS = (() => {
  const configured = Number(process.env.SERVER_INSTALL_COMMAND_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : 45 * 60_000;
})();

class ServerInstallEventRecorder {
  private readonly pending: IServerSshCentrifugo[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private writeChain = Promise.resolve();

  constructor(
    private readonly serverService: ServerService,
    private readonly logger: FastifyInstance['log'],
    private readonly serverId: string,
    private readonly installationId: string
  ) {}

  append(event: IServerSshCentrifugo): void {
    this.pending.push({
      ...event,
      event_id: event.event_id ?? uuidv7(),
      installation_id: this.installationId,
    });

    if (this.pending.length >= 25) {
      void this.flush();
      return;
    }

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush();
      }, 200);
      this.flushTimer.unref?.();
    }
  }

  async recordStage(
    stage: ServerInstallStageId,
    status: Extract<ServerInstallStageStatus, 'running' | 'complete' | 'error'>
  ): Promise<void> {
    this.append({
      server_id: this.serverId,
      command: 'Installation stage',
      output: `Installation stage ${stage} ${status}`,
      date: new Date(),
      install_event_type: 'stage',
      install_stage: stage,
      install_stage_status: status,
    });
    await this.flush();
  }

  async recordLifecycle(status: ServerInstallStatus): Promise<void> {
    this.append({
      server_id: this.serverId,
      command: 'Installation lifecycle',
      output: `Installation ${status}`,
      date: new Date(),
      install_event_type: 'lifecycle',
      install_status: status,
    });
    await this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const batch = this.pending.splice(0, this.pending.length);
    if (batch.length > 0) {
      this.writeChain = this.writeChain
        .then(async () => {
          await this.serverService.recordLogInstallServerBulk(batch);
        })
        .catch((error: unknown) => {
          this.logger.warn(
            { error, serverId: this.serverId },
            'Failed to persist installation console events'
          );
        });
    }

    await this.writeChain;
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
      preserveEntityOrder: true,
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
        if (err instanceof ServerInstallationAlreadySettledError) {
          server.log.warn(
            `Skipping server ${data.server_id ?? 'unknown'}: ${err.message}`
          );
          return;
        }

        if (err instanceof SshRunCommandsCancelledError) {
          server.log.warn(
            `Skipping server ${data.server_id ?? 'unknown'}: installation canceled`
          );
          return;
        }

        if (err instanceof ServerInstallationPreflightTimeoutError) {
          server.log.warn(
            `Skipping server ${data.server_id ?? 'unknown'}: ${getErrorMessage(err)}`
          );
          if (serverId) {
            await this.serverService.updateServerStatusById(
              serverId,
              EServerStatus.error,
              [EServerStatus.installing, EServerStatus.new]
            );
          }

          return;
        }

        if (err instanceof SshRunCommandsError) {
          server.log.warn(
            `Skipping server ${data.server_id ?? 'unknown'}: ${getErrorMessage(err)}`
          );
          if (serverId) {
            await this.serverService.updateServerStatusById(
              serverId,
              EServerStatus.error,
              [EServerStatus.installing, EServerStatus.new]
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
              EServerStatus.error,
              [EServerStatus.installing, EServerStatus.new]
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
            EServerStatus.error,
            [EServerStatus.installing, EServerStatus.new]
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
    let recorder: ServerInstallEventRecorder | null = null;

    try {
      serverId = data.server_id ?? null;
      if (!serverId) throw new Error('Server ID is not defined in the message');
      const installationId = data.installation_id ?? uuidv7();
      recorder = new ServerInstallEventRecorder(
        this.serverService,
        server.log,
        serverId,
        installationId
      );

      const initialStatus = await this.getServerStatus(serverId);
      if (initialStatus === null) {
        throw new Error('SSH configuration not found');
      }
      if (
        initialStatus !== EServerStatus.new &&
        initialStatus !== EServerStatus.installing
      ) {
        throw new ServerInstallationAlreadySettledError(initialStatus);
      }

      if (initialStatus === EServerStatus.new) {
        await this.serverService.deleteLogInstallServer(serverId);
      }

      const statusUpdated = await this.serverService.updateServerStatusById(
        serverId,
        EServerStatus.installing,
        [initialStatus]
      );
      if (!statusUpdated) {
        const currentStatus = await this.getServerStatus(serverId);
        throw new ServerInstallationAlreadySettledError(
          currentStatus ?? initialStatus
        );
      }

      await recorder.recordLifecycle('running');
      await recorder.recordStage('queued', 'running');

      const { getDistroAndVersion, sshConfig, webView, defaultImages } =
        await this.validate(serverId);

      await recorder.recordStage('queued', 'complete');

      if (
        initialStatus === EServerStatus.installing &&
        data.force_install !== true &&
        (await this.isInstalled(
          serverId,
          getDistroAndVersion,
          sshConfig,
          webView,
          defaultImages,
          1,
          recorder
        ))
      ) {
        const statusUpdated = await this.serverService.updateServerStatusById(
          serverId,
          EServerStatus.online,
          [EServerStatus.installing]
        );
        if (statusUpdated) {
          await recorder.recordStage('health', 'complete');
          await recorder.recordLifecycle('complete');
        }
        return;
      }

      const installCommands = await this.sshService.getInstallCommands(
        getDistroAndVersion,
        webView,
        defaultImages
      );

      const logs = await this.runInstallCommands(
        serverId,
        sshConfig,
        installCommands,
        recorder
      );

      if (logs.length === 0) {
        await this.serverService.updateServerStatusById(
          serverId,
          EServerStatus.error,
          [EServerStatus.installing]
        );
        await recorder.recordLifecycle('error');

        throw new Error('Docker installation logs are empty');
      }

      await recorder.recordStage('health', 'running');

      const built = await this.imageIsBuilt(
        serverId,
        getDistroAndVersion,
        sshConfig,
        20,
        recorder
      );

      if (!built) {
        await this.serverService.updateServerStatusById(
          serverId,
          EServerStatus.error,
          [EServerStatus.installing]
        );
        await recorder.recordStage('health', 'error');
        await recorder.recordLifecycle('error');

        throw new Error('Docker image is not built');
      }

      const installed = await this.isInstalled(
        serverId,
        getDistroAndVersion,
        sshConfig,
        webView,
        defaultImages,
        20,
        recorder
      );

      if (await this.isServerCanceled(serverId)) {
        await recorder.recordLifecycle('canceled');
        return;
      }

      const finalStatus = installed
        ? EServerStatus.online
        : EServerStatus.error;

      const finalStatusUpdated =
        await this.serverService.updateServerStatusById(serverId, finalStatus, [
          EServerStatus.installing,
        ]);

      if (!finalStatusUpdated) {
        if (await this.isServerCanceled(serverId)) {
          await recorder.recordLifecycle('canceled');
        }
        return;
      }

      if (installed) {
        await recorder.recordStage('health', 'complete');
        await recorder.recordLifecycle('complete');
      } else {
        await recorder.recordStage('health', 'error');
        await recorder.recordLifecycle('error');
      }
    } catch (err: unknown) {
      await recorder?.flush();

      if (
        err instanceof SshRunCommandsError ||
        err instanceof SshRunCommandsCancelledError ||
        err instanceof ServerInstallationPreflightTimeoutError
      ) {
        if (err instanceof SshRunCommandsCancelledError) {
          await recorder?.recordLifecycle('canceled');
        } else {
          if (err instanceof ServerInstallationPreflightTimeoutError) {
            await recorder?.recordStage('queued', 'error');
          }
          await recorder?.recordLifecycle('error');
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
    const preflight = Promise.all([
      this.serverService.viewServerSshById(serverId),
      this.serverService.viewServerWebById(serverId),
      this.serverBuildService.getDefaultImages(),
      this.serverService.viewServerStatusByIdAuthoritative(serverId),
    ]);
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(
          new ServerInstallationPreflightTimeoutError(
            serverId,
            SERVER_INSTALL_PREFLIGHT_TIMEOUT_MS
          )
        );
      }, SERVER_INSTALL_PREFLIGHT_TIMEOUT_MS);
      timeout.unref?.();
    });
    const [sshView, webView, defaultImages, currentStatus] = await Promise.race(
      [preflight, timedOut]
    ).finally(() => {
      if (timeout) clearTimeout(timeout);
    });

    if (!sshView) {
      throw new Error('SSH configuration not found');
    }

    if (!webView) {
      throw new Error('Web configuration not found');
    }

    if (!defaultImages) {
      throw new MissingDefaultBuildImagesError();
    }

    if (currentStatus === null) {
      throw new Error('Server status not found');
    }

    if (currentStatus !== EServerStatus.installing) {
      throw new ServerInstallationAlreadySettledError(currentStatus);
    }

    const sshConfig: ConnectConfig = {
      host: sshView.ssh_ip,
      port: sshView.ssh_port,
      username: this.passwordEncryptorService.decrypt(sshView.ssh_username),
      password: this.passwordEncryptorService.decrypt(sshView.ssh_password),
    };

    const sshPreflight = (async () => {
      const connected = await this.sshService.testSSHConnection(sshConfig);
      if (!connected) {
        throw new Error('SSH connection failed');
      }

      return this.sshService.getDistroAndVersion(sshConfig);
    })();
    timeout = null;
    const sshTimedOut = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(
          new ServerInstallationPreflightTimeoutError(
            serverId,
            SERVER_INSTALL_PREFLIGHT_TIMEOUT_MS
          )
        );
      }, SERVER_INSTALL_PREFLIGHT_TIMEOUT_MS);
      timeout.unref?.();
    });
    const distro = await Promise.race([sshPreflight, sshTimedOut]).finally(
      () => {
        if (timeout) clearTimeout(timeout);
      }
    );
    if (!distro) {
      throw new Error('Failed to retrieve distribution and version');
    }

    if (!isDistroVersionAllowed(distro)) {
      throw new Error('Distribution and version not allowed');
    }

    return {
      getDistroAndVersion: distro,
      sshConfig,
      webView,
      defaultImages,
    };
  }

  private async getServerStatus(
    serverId: string
  ): Promise<EServerStatus | null> {
    return this.serverService.viewServerStatusByIdAuthoritative(serverId);
  }

  private async runInstallCommands(
    serverId: string,
    sshConfig: ConnectConfig,
    commands: string[],
    recorder: ServerInstallEventRecorder
  ): Promise<IServerSshCentrifugo[]> {
    const controller = new AbortController();
    let isCheckingCancellation = false;
    const cancellationMonitor = setInterval(() => {
      if (isCheckingCancellation || controller.signal.aborted) return;

      isCheckingCancellation = true;
      void this.isServerCanceled(serverId)
        .then((isCanceled) => {
          if (isCanceled) controller.abort();
        })
        .finally(() => {
          isCheckingCancellation = false;
        });
    }, 1_000);
    cancellationMonitor.unref?.();

    try {
      return await this.sshService.runCommands(
        serverId,
        sshConfig,
        commands,
        false,
        {
          failOnNonZero: true,
          cancellationKey: serverId,
          signal: controller.signal,
          commandTimeoutMs: SERVER_INSTALL_COMMAND_TIMEOUT_MS,
          onOutput: (event) => recorder.append(event),
        }
      );
    } finally {
      clearInterval(cancellationMonitor);
      await recorder.flush();
    }
  }

  private async isInstalled(
    serverId: string,
    getDistroAndVersion: IDistroInfo,
    sshConfig: ConnectConfig,
    webView: IViewServerWebById,
    defaultImages: IServerBuildDefaultImages,
    attempts = 20,
    recorder?: ServerInstallEventRecorder
  ): Promise<boolean> {
    if (!sshConfig.host) {
      throw new Error('SSH host is not defined');
    }

    const commands = this.sshService.getStatusCommands(
      getDistroAndVersion,
      sshConfig.host,
      webView.web_port,
      defaultImages
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
        !recorder,
        {
          cancellationKey: serverId,
          onOutput: recorder
            ? (event) => {
                recorder.append(event);
              }
            : undefined,
        }
      );
      await recorder?.flush();

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

  private async imageIsBuilt(
    serverId: string,
    getDistroAndVersion: IDistroInfo,
    sshConfig: ConnectConfig,
    attempts = 20,
    recorder?: ServerInstallEventRecorder
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
        !recorder,
        {
          cancellationKey: serverId,
          onOutput: recorder
            ? (event) => {
                recorder.append(event);
              }
            : undefined,
        }
      );
      await recorder?.flush();

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
    const status =
      await this.serverService.viewServerStatusByIdAuthoritative(serverId);
    return status === EServerStatus.canceled;
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
