import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IListWorkerActivities } from '@core/common/interfaces/IListWorkerActivities';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { ServerService } from '@core/services/server.service';
import { SshService } from '@core/services/ssh.service';
import { WorkerService } from '@core/services/worker.service';
import { PublishResult } from 'centrifuge';
import { ConnectConfig } from 'ssh2';
import { container } from 'tsyringe';

export interface IBaileysActivity {
  listWorkerBaileysActivities(): Promise<IListWorkerActivities[]>;
  execute(input: IListWorkerActivities): Promise<void>;
}

export async function listWorkerBaileysActivities(): Promise<
  IListWorkerActivities[]
> {
  const workerService = container.resolve(WorkerService);

  return workerService.listWorkerBaileysActivities();
}

export async function viewServerSshById(
  serverId: string
): Promise<ConnectConfig> {
  const serverService = container.resolve(ServerService);
  const passwordEncryptorService = container.resolve(PasswordEncryptorService);

  const sshView = await serverService.viewServerSshById(serverId);

  if (!sshView) {
    throw new Error('SSH configuration not found');
  }

  const sshConfig: ConnectConfig = {
    host: sshView.ssh_ip,
    port: sshView.ssh_port,
    username: passwordEncryptorService.decrypt(sshView.ssh_username),
    password: passwordEncryptorService.decrypt(sshView.ssh_password),
  };

  return sshConfig;
}

export async function validateSsh(sshConfig: ConnectConfig): Promise<boolean> {
  const sshService = container.resolve(SshService);

  return sshService.testSSHConnection(sshConfig);
}

export async function isHelm(
  sshConfig: ConnectConfig,
  serverId: string,
  workerId: string,
  attempts = 20
): Promise<boolean> {
  const sshService = container.resolve(SshService);

  const commands = [
    `bash -c "docker exec ${workerId} sh -c 'curl -s -o /dev/null -w \"%{http_code}\" http://127.0.0.1:3005/v1/health/check'"`,
  ];

  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, 1000));

    const result = await sshService.runCommands(
      serverId,
      sshConfig,
      commands,
      false
    );

    const lastOutput = result[result.length - 1]?.output?.trim();
    const status = Number(lastOutput ?? 0);

    if (status === 200) {
      return true;
    }
  }

  return false;
}

export async function isHelmConnection(
  sshConfig: ConnectConfig,
  serverId: string,
  workerId: string,
  attempts = 20
): Promise<boolean> {
  const sshService = container.resolve(SshService);

  const commands = [
    `bash -c "docker exec ${workerId} sh -c 'curl -s -o /dev/null -w \"%{http_code}\" http://127.0.0.1:3005/v1/connection/health/check'"`,
  ];

  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, 1000));

    const result = await sshService.runCommands(
      serverId,
      sshConfig,
      commands,
      false
    );

    const lastOutput = result[result.length - 1]?.output?.trim();
    const status = Number(lastOutput ?? 0);

    if (status === 200) {
      return true;
    }
  }

  return false;
}

export async function notifyWorker(
  input: IListWorkerActivities,
  workerStatusId: EWorkerStatus
): Promise<PublishResult> {
  const centrifugoService = container.resolve(CentrifugoService);

  const topic = `worker.${input.account_id}`;

  const data: IWorkerPayload = {
    action: EWorkerAction.notify,
    worker_id: input.worker_id,
    server_id: input.server_id,
    account_id: input.account_id,
    is_administrator: false,
    worker_status_id: workerStatusId,
  };

  return centrifugoService.publish(topic, data);
}

export async function updateStatusWorker(
  isHelmCheck: boolean,
  isHelmConnectionCheck: boolean,
  input: IListWorkerActivities
): Promise<void> {
  const workerService = container.resolve(WorkerService);

  if (
    isHelmCheck &&
    isHelmConnectionCheck &&
    input.worker_status_id !== EWorkerStatus.online &&
    input.worker_status_id !== EWorkerStatus.disponible
  ) {
    const status =
      input.number && input.connection_date
        ? EWorkerStatus.online
        : EWorkerStatus.disponible;

    await workerService.updateStatusWorker(input.worker_id, status);

    await notifyWorker(input, status);

    return;
  }

  if (
    isHelmCheck &&
    !isHelmConnectionCheck &&
    input.worker_status_id !== EWorkerStatus.offline
  ) {
    await workerService.updateStatusWorker(
      input.worker_id,
      EWorkerStatus.offline
    );

    await notifyWorker(input, EWorkerStatus.offline);

    return;
  }

  if (!isHelmCheck && input.worker_status_id !== EWorkerStatus.error) {
    await workerService.updateStatusWorker(
      input.worker_id,
      EWorkerStatus.error
    );

    await notifyWorker(input, EWorkerStatus.error);

    return;
  }
}

export async function execute(input: IListWorkerActivities): Promise<void> {
  const sshConfig = await viewServerSshById(input.server_id);

  const isValid = await validateSsh(sshConfig);
  if (!isValid) {
    throw new Error('Invalid SSH configuration');
  }

  const isHelmCheck = await isHelm(sshConfig, input.server_id, input.worker_id);

  let isHelmConnectionCheck = true;
  if (
    isHelmCheck &&
    (input.worker_status_id === EWorkerStatus.online ||
      input.worker_status_id === EWorkerStatus.offline)
  ) {
    isHelmConnectionCheck = await isHelmConnection(
      sshConfig,
      input.server_id,
      input.worker_id
    );
  }

  await updateStatusWorker(isHelmCheck, isHelmConnectionCheck, input);
}
