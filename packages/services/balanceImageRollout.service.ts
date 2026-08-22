import { EServerBuildType } from '@core/common/enums/EServerBuildType';
import {
  getBalanceImageProbeCommand,
  getReconcileBalanceContainerCommand,
} from '@core/common/functions/getReconcileBalanceContainerCommand';
import {
  ILockLeaseContext,
  LockAcquisitionTimeoutError,
  withLock,
} from '@core/common/functions/withLock';
import { IBalanceMonitorServer } from '@core/common/interfaces/IBalanceMonitorServer';
import { buildEnvironment } from '@core/config/environments';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { ServerBuildHarborService } from '@core/services/serverBuildHarbor.service';
import { ServerBuildService } from '@core/services/serverBuild.service';
import { ServerService } from '@core/services/server.service';
import { SshRunCommandsError, SshService } from '@core/services/ssh.service';
import Redis from 'ioredis';
import { inject, singleton } from 'tsyringe';

const GLOBAL_ROLLOUT_LOCK_KEY = 'balance:image-rollout:v1:fleet';
const INFLIGHT_ROLLOUT_KEY = 'balance:image-rollout:v1:inflight-host';
const STATUS_TTL_SECONDS = 7 * 24 * 60 * 60;
const PROBE_TIMEOUT_MS = 30_000;
const RELEASE_INFLIGHT_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;
const REFRESH_INFLIGHT_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

type BalanceImageProbeStatus = 'converged' | 'drift' | 'recovery' | 'unhealthy';

interface IBalanceImageProbe {
  readonly backupId: string | null;
  readonly currentContentId: string | null;
  readonly currentId: string | null;
  readonly healthy: boolean;
  readonly phase: string;
  readonly stateTargetReference: string | null;
  readonly status: BalanceImageProbeStatus;
}

export type BalanceImageRolloutOutcome =
  | 'blocked_configuration'
  | 'converged'
  | 'disabled'
  | 'host_failed'
  | 'locked'
  | 'no_eligible_servers'
  | 'pending_confirmation'
  | 'reconciled';

export interface IBalanceImageRolloutStatus {
  readonly desired_digest: string | null;
  readonly error_code: string | null;
  readonly host_phase: string | null;
  readonly outcome: BalanceImageRolloutOutcome;
  readonly server_id: string | null;
  readonly updated_at: string;
}

const PROBE_PATTERN =
  /UNDERCHAT_BALANCE_PROBE_V1 status=(converged|drift|recovery|unhealthy) current_id=(\S+) current_image_id=(\S+) desired_id=(\S+) current_matches=(0|1) healthy=(0|1) backup_id=(\S+) phase=(\S+) state_target_ref=(\S+)/u;

function optionalProbeValue(value: string): string | null {
  return value === 'none' || value === 'invalid' ? null : value;
}

function safeRolloutErrorCode(error: unknown): string {
  if (error instanceof SshRunCommandsError) {
    const causeName =
      error.causeError instanceof Error ? error.causeError.name : '';
    if (causeName === 'SshCommandTimeoutError') {
      return 'balance_rollout_ssh_timeout';
    }
    if (causeName === 'SshCommandExecutionError') {
      return 'balance_rollout_host_rejected';
    }
    return 'balance_rollout_ssh_failed';
  }

  if (error instanceof LockAcquisitionTimeoutError) {
    return 'balance_rollout_global_lock_busy';
  }

  return 'balance_rollout_failed';
}

@singleton()
export class BalanceImageRolloutService {
  private status: IBalanceImageRolloutStatus = {
    desired_digest: null,
    error_code: null,
    host_phase: null,
    outcome: 'disabled',
    server_id: null,
    updated_at: new Date(0).toISOString(),
  };

  constructor(
    @inject('Redis')
    private readonly redis: Redis,
    @inject(ServerBuildService)
    private readonly serverBuildService: ServerBuildService,
    @inject(ServerBuildHarborService)
    private readonly serverBuildHarborService: ServerBuildHarborService,
    @inject(ServerService)
    private readonly serverService: ServerService,
    @inject(SshService)
    private readonly sshService: SshService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService
  ) {}

  public getStatus(): IBalanceImageRolloutStatus {
    return this.status;
  }

  public reconcile = async (): Promise<BalanceImageRolloutOutcome> => {
    if (!buildEnvironment.balanceImageRolloutEnabled) {
      return this.updateStatus({
        desired_digest: null,
        error_code: null,
        host_phase: null,
        outcome: 'disabled',
        server_id: null,
      });
    }

    const approvedDigest = buildEnvironment.balanceImageRolloutApprovedDigest;
    const allowedServerIds = buildEnvironment.balanceImageRolloutServerIds;
    if (!approvedDigest || allowedServerIds.length === 0) {
      return this.updateStatus({
        desired_digest: approvedDigest,
        error_code: 'balance_rollout_approval_incomplete',
        host_phase: null,
        outcome: 'blocked_configuration',
        server_id: null,
      });
    }

    const readinessTimeoutMs =
      buildEnvironment.balanceImageRolloutReadinessTimeoutMs;
    const commandTimeoutMs =
      buildEnvironment.balanceImageRolloutCommandTimeoutMs;
    if (commandTimeoutMs < readinessTimeoutMs + 8 * 60 * 1000) {
      return this.updateStatus({
        desired_digest: approvedDigest,
        error_code: 'balance_rollout_command_deadline_too_short',
        host_phase: null,
        outcome: 'blocked_configuration',
        server_id: null,
      });
    }

    try {
      return await withLock(
        this.redis,
        GLOBAL_ROLLOUT_LOCK_KEY,
        (leaseContext) =>
          this.reconcileFleet(leaseContext, approvedDigest, allowedServerIds),
        {
          ttlMs: commandTimeoutMs + 2 * 60 * 1000,
          retryMs: 100,
          maxWaitMs: 500,
        }
      );
    } catch (error) {
      const errorCode = safeRolloutErrorCode(error);
      return this.updateStatus({
        desired_digest: approvedDigest,
        error_code: errorCode,
        host_phase: null,
        outcome:
          error instanceof LockAcquisitionTimeoutError
            ? 'locked'
            : 'host_failed',
        server_id: null,
      });
    }
  };

  private async reconcileFleet(
    leaseContext: ILockLeaseContext,
    approvedDigest: string,
    allowedServerIds: readonly string[]
  ): Promise<BalanceImageRolloutOutcome> {
    leaseContext.assertActive();
    const defaultImages = await this.serverBuildService.getDefaultImages();
    if (!defaultImages) {
      return this.persistStatus(leaseContext, {
        desired_digest: approvedDigest,
        error_code: 'balance_rollout_default_images_missing',
        host_phase: null,
        outcome: 'blocked_configuration',
        server_id: null,
      });
    }

    const desired =
      await this.serverBuildHarborService.resolveImmutableImageReference(
        EServerBuildType.balance_api,
        defaultImages.balance_api
      );
    if (desired.digest !== approvedDigest) {
      return this.persistStatus(leaseContext, {
        desired_digest: desired.digest,
        error_code: 'balance_rollout_digest_not_approved',
        host_phase: null,
        outcome: 'blocked_configuration',
        server_id: null,
      });
    }

    leaseContext.assertActive();
    const allServers = await this.serverService.listBalanceServers();
    const allowAll = allowedServerIds.includes('*');
    const allowed = new Set(allowedServerIds);
    const servers = allServers
      .filter((server) => allowAll || allowed.has(server.server_id))
      .sort((left, right) => left.server_id.localeCompare(right.server_id));
    if (servers.length === 0) {
      return this.persistStatus(leaseContext, {
        desired_digest: desired.digest,
        error_code: null,
        host_phase: null,
        outcome: 'no_eligible_servers',
        server_id: null,
      });
    }

    const probedServers: Array<{
      probe: IBalanceImageProbe;
      server: IBalanceMonitorServer;
    }> = [];
    let probeFailures = 0;
    for (const server of servers) {
      leaseContext.assertActive();
      if (!server.web_port) {
        probeFailures += 1;
        await this.persistHostStatus(leaseContext, server.server_id, {
          desired_digest: desired.digest,
          error_code: 'balance_rollout_web_port_missing',
          host_phase: null,
          outcome: 'host_failed',
          server_id: server.server_id,
        });
        continue;
      }

      let probe: IBalanceImageProbe;
      try {
        probe = await this.probeServer(
          leaseContext,
          server,
          desired.imageReference
        );
      } catch (error) {
        probeFailures += 1;
        await this.persistHostStatus(leaseContext, server.server_id, {
          desired_digest: desired.digest,
          error_code: safeRolloutErrorCode(error),
          host_phase: null,
          outcome: 'host_failed',
          server_id: server.server_id,
        });
        continue;
      }

      probedServers.push({ probe, server });
      await this.persistHostStatus(leaseContext, server.server_id, {
        desired_digest: desired.digest,
        error_code:
          probe.status === 'unhealthy'
            ? 'balance_rollout_existing_generation_unhealthy'
            : null,
        host_phase: probe.phase,
        outcome:
          probe.status === 'converged'
            ? 'converged'
            : probe.status === 'unhealthy'
              ? 'host_failed'
              : 'pending_confirmation',
        server_id: server.server_id,
      });
    }

    /*
     * An unreachable host is an unknown physical state. Fail closed before
     * mutating any other host: the disconnected machine may still be running
     * the detached systemd rollout after an SSH/control-plane failure.
     */
    if (probeFailures > 0) {
      return this.persistStatus(leaseContext, {
        desired_digest: desired.digest,
        error_code: 'balance_rollout_hosts_unreachable',
        host_phase: null,
        outcome: 'host_failed',
        server_id: null,
      });
    }

    const recoveries = probedServers.filter(
      ({ probe }) => probe.status === 'recovery'
    );
    if (recoveries.length > 1) {
      return this.persistStatus(leaseContext, {
        desired_digest: desired.digest,
        error_code: 'balance_rollout_multiple_recoveries_detected',
        host_phase: null,
        outcome: 'host_failed',
        server_id: null,
      });
    }

    const unhealthy = probedServers.find(
      ({ probe }) => probe.status === 'unhealthy'
    );
    if (unhealthy) {
      return this.persistStatus(leaseContext, {
        desired_digest: desired.digest,
        error_code: 'balance_rollout_existing_generation_unhealthy',
        host_phase: unhealthy.probe.phase,
        outcome: 'host_failed',
        server_id: unhealthy.server.server_id,
      });
    }

    let inflightServerId = await this.readInflightServer(leaseContext);
    let candidate: (typeof probedServers)[number] | null = null;
    if (inflightServerId) {
      const inflight = probedServers.find(
        ({ server }) => server.server_id === inflightServerId
      );
      if (!inflight) {
        /*
         * An allowlist change must not silently let the durable barrier expire
         * while its host can still own an unfinished rollout. Keep the fleet
         * frozen until the operator restores that canary to the allowlist (or
         * explicitly disables the rollout long enough to intervene).
         */
        await this.refreshInflightServer(leaseContext, inflightServerId);
        return this.persistStatus(leaseContext, {
          desired_digest: desired.digest,
          error_code: 'balance_rollout_inflight_host_not_eligible',
          host_phase: null,
          outcome: 'host_failed',
          server_id: inflightServerId,
        });
      }
      if (inflight.probe.status === 'converged') {
        await this.releaseInflightServer(leaseContext, inflightServerId);
        inflightServerId = null;
      } else {
        candidate = inflight;
      }
    }
    candidate ??=
      recoveries[0] ??
      probedServers.find(({ probe }) => probe.status !== 'converged') ??
      null;
    if (!candidate) {
      return this.persistStatus(leaseContext, {
        desired_digest: desired.digest,
        error_code: null,
        host_phase: null,
        outcome: 'converged',
        server_id: null,
      });
    }

    const { probe, server } = candidate;
    if (inflightServerId && inflightServerId !== server.server_id) {
      return this.persistStatus(leaseContext, {
        desired_digest: desired.digest,
        error_code: 'balance_rollout_inflight_host_mismatch',
        host_phase: probe.phase,
        outcome: 'host_failed',
        server_id: server.server_id,
      });
    }
    if (!(await this.claimInflightServer(leaseContext, server.server_id))) {
      return this.persistStatus(leaseContext, {
        desired_digest: desired.digest,
        error_code: 'balance_rollout_inflight_barrier_busy',
        host_phase: probe.phase,
        outcome: 'locked',
        server_id: server.server_id,
      });
    }

    let rolloutReference = desired.imageReference;
    if (probe.status === 'recovery' && probe.stateTargetReference) {
      const recovery =
        await this.serverBuildHarborService.resolveImmutableImageReference(
          EServerBuildType.balance_api,
          probe.stateTargetReference
        );
      rolloutReference = recovery.imageReference;
    }

    try {
      await this.rolloutServer(leaseContext, server, rolloutReference);
      leaseContext.assertActive();
      const postProbe = await this.probeServer(
        leaseContext,
        server,
        desired.imageReference
      );
      const pending =
        postProbe.status !== 'converged' ||
        rolloutReference !== desired.imageReference;
      const outcome: BalanceImageRolloutOutcome = pending
        ? 'pending_confirmation'
        : 'reconciled';
      if (!pending) {
        await this.releaseInflightServer(leaseContext, server.server_id);
      } else {
        await this.refreshInflightServer(leaseContext, server.server_id);
      }
      await this.persistHostStatus(leaseContext, server.server_id, {
        desired_digest: desired.digest,
        error_code: null,
        host_phase: postProbe.phase,
        outcome,
        server_id: server.server_id,
      });
      return this.persistStatus(leaseContext, {
        desired_digest: desired.digest,
        error_code: null,
        host_phase: postProbe.phase,
        outcome,
        server_id: server.server_id,
      });
    } catch (error) {
      const errorCode = safeRolloutErrorCode(error);
      /*
       * Keep the durable barrier after every ambiguous transport/host failure.
       * The detached host unit is bounded; the next pass must inspect/recover
       * this same host before any other server can be selected.
       */
      await this.refreshInflightServer(leaseContext, server.server_id);
      await this.persistHostStatus(leaseContext, server.server_id, {
        desired_digest: desired.digest,
        error_code: errorCode,
        host_phase: probe.phase,
        outcome: 'host_failed',
        server_id: server.server_id,
      });
      return this.persistStatus(leaseContext, {
        desired_digest: desired.digest,
        error_code: errorCode,
        host_phase: probe.phase,
        outcome: 'host_failed',
        server_id: server.server_id,
      });
    }
  }

  private buildSshConfig(server: IBalanceMonitorServer) {
    return {
      host: server.ssh_ip,
      password: this.passwordEncryptorService.decrypt(server.ssh_password),
      port: server.ssh_port,
      readyTimeout: PROBE_TIMEOUT_MS,
      username: this.passwordEncryptorService.decrypt(server.ssh_username),
    };
  }

  private async probeServer(
    leaseContext: ILockLeaseContext,
    server: IBalanceMonitorServer,
    imageReference: string
  ): Promise<IBalanceImageProbe> {
    const webPort = server.web_port;
    if (!webPort) {
      throw new Error('balance_rollout_web_port_missing');
    }

    const results = await this.sshService.runCommands(
      server.server_id,
      this.buildSshConfig(server),
      [
        getBalanceImageProbeCommand({
          imageReference,
          serverId: server.server_id,
          webPort,
        }),
      ],
      false,
      {
        commandTimeoutMs: PROBE_TIMEOUT_MS,
        connectMaxAttempts: 1,
        failOnNonZero: true,
        signal: leaseContext.signal,
      }
    );
    leaseContext.assertActive();
    const output = results.map((result) => result.output).join('');
    const match = output.match(PROBE_PATTERN);
    if (!match) {
      throw new Error('balance_rollout_invalid_probe');
    }

    return {
      backupId: optionalProbeValue(match[7]),
      currentContentId: optionalProbeValue(match[3]),
      currentId: optionalProbeValue(match[2]),
      healthy: match[6] === '1',
      phase: match[8],
      stateTargetReference: optionalProbeValue(match[9]),
      status: match[1] as BalanceImageProbeStatus,
    };
  }

  private async rolloutServer(
    leaseContext: ILockLeaseContext,
    server: IBalanceMonitorServer,
    imageReference: string
  ): Promise<void> {
    const webPort = server.web_port;
    if (!webPort) {
      throw new Error('balance_rollout_web_port_missing');
    }

    leaseContext.assertActive();
    const runtimeEnvironmentPayload = JSON.stringify({
      HARBOR_REGISTRY: buildEnvironment.harborRegistry,
      HARBOR_NAMESPACE: buildEnvironment.harborNamespace,
      HARBOR_USERNAME: buildEnvironment.harborUsername,
      HARBOR_PASSWORD: buildEnvironment.harborPassword,
    });
    await this.sshService.runCommands(
      server.server_id,
      this.buildSshConfig(server),
      [
        getReconcileBalanceContainerCommand({
          imageReference,
          readinessTimeoutMs:
            buildEnvironment.balanceImageRolloutReadinessTimeoutMs,
          retryCooldownMs: buildEnvironment.balanceImageRolloutRetryCooldownMs,
          serverId: server.server_id,
          stabilityWindowMs:
            buildEnvironment.balanceImageRolloutStabilityWindowMs,
          webPort,
        }),
      ],
      false,
      {
        cancellationKey: `balance-image-rollout:${server.server_id}`,
        commandTimeoutMs: buildEnvironment.balanceImageRolloutCommandTimeoutMs,
        connectMaxAttempts: 1,
        failOnNonZero: true,
        signal: leaseContext.signal,
        stdin: runtimeEnvironmentPayload,
      }
    );
    leaseContext.assertActive();
  }

  private inflightTtlMs(): number {
    return buildEnvironment.balanceImageRolloutCommandTimeoutMs + 2 * 60 * 1000;
  }

  private async readInflightServer(
    leaseContext: ILockLeaseContext
  ): Promise<string | null> {
    leaseContext.assertActive();
    const serverId = await this.redis.get(INFLIGHT_ROLLOUT_KEY);
    leaseContext.assertActive();
    return serverId?.trim() || null;
  }

  private async claimInflightServer(
    leaseContext: ILockLeaseContext,
    serverId: string
  ): Promise<boolean> {
    const current = await this.readInflightServer(leaseContext);
    if (current === serverId) {
      await this.refreshInflightServer(leaseContext, serverId);
      return true;
    }
    if (current) {
      return false;
    }

    leaseContext.assertActive();
    const claimed = await this.redis.set(
      INFLIGHT_ROLLOUT_KEY,
      serverId,
      'PX',
      this.inflightTtlMs(),
      'NX'
    );
    leaseContext.assertActive();
    return claimed === 'OK';
  }

  private async refreshInflightServer(
    leaseContext: ILockLeaseContext,
    serverId: string
  ): Promise<void> {
    leaseContext.assertActive();
    const refreshed = await this.redis.eval(
      REFRESH_INFLIGHT_SCRIPT,
      1,
      INFLIGHT_ROLLOUT_KEY,
      serverId,
      this.inflightTtlMs()
    );
    leaseContext.assertActive();
    if (Number(refreshed) !== 1) {
      throw new Error('balance_rollout_inflight_barrier_lost');
    }
  }

  private async releaseInflightServer(
    leaseContext: ILockLeaseContext,
    serverId: string
  ): Promise<void> {
    leaseContext.assertActive();
    const released = await this.redis.eval(
      RELEASE_INFLIGHT_SCRIPT,
      1,
      INFLIGHT_ROLLOUT_KEY,
      serverId
    );
    leaseContext.assertActive();
    if (Number(released) !== 1) {
      throw new Error('balance_rollout_inflight_barrier_lost');
    }
  }

  private async persistStatus(
    leaseContext: ILockLeaseContext,
    input: Omit<IBalanceImageRolloutStatus, 'updated_at'>
  ): Promise<BalanceImageRolloutOutcome> {
    const status = this.createStatus(input);
    leaseContext.assertActive();
    await this.redis.set(
      'balance:image-rollout:v1:status',
      JSON.stringify(status),
      'EX',
      STATUS_TTL_SECONDS
    );
    leaseContext.assertActive();
    this.status = status;
    this.logStatus(status);
    return status.outcome;
  }

  private async persistHostStatus(
    leaseContext: ILockLeaseContext,
    serverId: string,
    input: Omit<IBalanceImageRolloutStatus, 'updated_at'>
  ): Promise<void> {
    const status = this.createStatus(input);
    leaseContext.assertActive();
    await this.redis.set(
      `balance:image-rollout:v1:host:${serverId}`,
      JSON.stringify(status),
      'EX',
      STATUS_TTL_SECONDS
    );
    leaseContext.assertActive();
  }

  private updateStatus(
    input: Omit<IBalanceImageRolloutStatus, 'updated_at'>
  ): BalanceImageRolloutOutcome {
    const status = this.createStatus(input);
    this.status = status;
    this.logStatus(status);
    return status.outcome;
  }

  private createStatus(
    input: Omit<IBalanceImageRolloutStatus, 'updated_at'>
  ): IBalanceImageRolloutStatus {
    return {
      ...input,
      updated_at: new Date().toISOString(),
    };
  }

  private logStatus(status: IBalanceImageRolloutStatus): void {
    console.info(
      JSON.stringify({
        event: 'balance_image_rollout',
        ...status,
      })
    );
  }
}
