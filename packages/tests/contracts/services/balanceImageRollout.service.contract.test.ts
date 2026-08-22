import 'reflect-metadata';

const mockWithLock = jest.fn();

jest.mock('@core/common/functions/withLock', () => ({
  LockAcquisitionTimeoutError: class LockAcquisitionTimeoutError extends Error {},
  withLock: (...args: unknown[]) => mockWithLock(...args),
}));
jest.mock('@core/services/passwordEncryptor.service', () => ({
  PasswordEncryptorService: class PasswordEncryptorService {},
}));
jest.mock('@core/services/serverBuildHarbor.service', () => ({
  ServerBuildHarborService: class ServerBuildHarborService {},
}));
jest.mock('@core/services/serverBuild.service', () => ({
  ServerBuildService: class ServerBuildService {},
}));
jest.mock('@core/services/server.service', () => ({
  ServerService: class ServerService {},
}));
jest.mock('@core/services/ssh.service', () => ({
  SshRunCommandsError: class SshRunCommandsError extends Error {},
  SshService: class SshService {},
}));

import { BalanceImageRolloutService } from '@core/services/balanceImageRollout.service';
import type Redis from 'ioredis';

const DESIRED_DIGEST = `sha256:${'a'.repeat(64)}`;
const DESIRED_REFERENCE = `harbor.example/underchat/balance/under-balance-api@${DESIRED_DIGEST}`;
const PREVIOUS_DIGEST = `sha256:${'b'.repeat(64)}`;
const PREVIOUS_REFERENCE = `harbor.example/underchat/balance/under-balance-api@${PREVIOUS_DIGEST}`;
const FIRST_SERVER_ID = '019e98ad-aab4-715d-aa6b-9e0e027edc24';
const SECOND_SERVER_ID = '019e98ad-aab4-715d-aa6b-9e0e027edc25';
const HARBOR_REGISTRY = 'harbor.example';
const HARBOR_NAMESPACE = 'underchat/balance';
const HARBOR_USERNAME = 'current-registry-user';
const HARBOR_PASSWORD = `current-registry-'quoted'-password`;

const activeLease = {
  assertActive: jest.fn(),
  signal: new AbortController().signal,
};

function server(serverId: string) {
  return {
    server_id: serverId,
    server_status_id: 'online',
    ssh_ip: '127.0.0.1',
    ssh_password: 'encrypted-password',
    ssh_port: 22,
    ssh_username: 'encrypted-username',
    web_domain: null,
    web_port: 3003,
    web_protocol: 'http',
  };
}

function probeOutput(
  status: 'converged' | 'drift' | 'recovery' | 'unhealthy',
  options: {
    phase?: string;
    stateTargetReference?: string;
  } = {}
) {
  const converged = status === 'converged';
  return [
    {
      output:
        `UNDERCHAT_BALANCE_PROBE_V1 status=${status} ` +
        `current_id=${'c'.repeat(64)} ` +
        `current_image_id=sha256:${(converged ? 'a' : 'c').repeat(64)} ` +
        `desired_id=sha256:${'a'.repeat(64)} ` +
        `current_matches=${converged ? '1' : '0'} ` +
        `healthy=${converged ? '1' : '0'} ` +
        'backup_id=none ' +
        `phase=${options.phase ?? (converged ? 'complete' : 'none')} ` +
        `state_target_ref=${options.stateTargetReference ?? 'none'}`,
    },
  ];
}

interface Harness {
  readonly harborResolve: jest.Mock;
  readonly redisEval: jest.Mock;
  readonly redisSet: jest.Mock;
  readonly runCommands: jest.Mock;
  readonly service: BalanceImageRolloutService;
}

function buildHarness(
  options: {
    initialInflightServerId?: string | null;
    servers?: ReturnType<typeof server>[];
  } = {}
): Harness {
  let inflightServerId: string | null = options.initialInflightServerId ?? null;
  const redisSet = jest.fn(
    async (key: string, value: string, ...args: unknown[]) => {
      if (key === 'balance:image-rollout:v1:inflight-host') {
        if (args.includes('NX') && inflightServerId) {
          return null;
        }
        inflightServerId = value;
      }
      return 'OK';
    }
  );
  const redisEval = jest.fn(
    async (
      script: string,
      _numberOfKeys: number,
      _key: string,
      expectedServerId: string
    ) => {
      if (inflightServerId !== expectedServerId) {
        return 0;
      }
      if (script.includes('PEXPIRE')) {
        return 1;
      }
      inflightServerId = null;
      return 1;
    }
  );
  const harborResolve = jest.fn(async () => ({
    digest: DESIRED_DIGEST,
    imageReference: DESIRED_REFERENCE,
  }));
  const runCommands = jest.fn();
  const service = new BalanceImageRolloutService(
    {
      eval: redisEval,
      get: jest.fn(async () => inflightServerId),
      set: redisSet,
    } as unknown as Redis,
    {
      getDefaultImages: jest.fn(async () => ({
        baileys: 'baileys',
        balance_api: 'harbor.example/underchat/balance/under-balance-api:v123',
        whatsmeow: 'whatsmeow',
        wwebjs: 'wwebjs',
      })),
    } as never,
    { resolveImmutableImageReference: harborResolve } as never,
    {
      listBalanceServers: jest.fn(
        async () =>
          options.servers ?? [server(FIRST_SERVER_ID), server(SECOND_SERVER_ID)]
      ),
    } as never,
    { runCommands } as never,
    { decrypt: jest.fn((value: string) => value) } as never
  );

  return {
    harborResolve,
    redisEval,
    redisSet,
    runCommands,
    service,
  };
}

describe('BalanceImageRolloutService contract', () => {
  const originalEnvironment = {
    approved: process.env.BALANCE_IMAGE_ROLLOUT_APPROVED_DIGEST,
    command: process.env.BALANCE_IMAGE_ROLLOUT_COMMAND_TIMEOUT_MS,
    cooldown: process.env.BALANCE_IMAGE_ROLLOUT_RETRY_COOLDOWN_MS,
    enabled: process.env.BALANCE_IMAGE_ROLLOUT_ENABLED,
    readiness: process.env.BALANCE_IMAGE_ROLLOUT_READINESS_TIMEOUT_MS,
    serverIds: process.env.BALANCE_IMAGE_ROLLOUT_SERVER_IDS,
    stability: process.env.BALANCE_IMAGE_ROLLOUT_STABILITY_WINDOW_MS,
    harborPassword: process.env.HARBOR_PASSWORD,
    harborNamespace: process.env.HARBOR_NAMESPACE,
    harborRegistry: process.env.HARBOR_REGISTRY,
    harborUsername: process.env.HARBOR_USERNAME,
  };

  beforeEach(() => {
    process.env.BALANCE_IMAGE_ROLLOUT_APPROVED_DIGEST = DESIRED_DIGEST;
    process.env.BALANCE_IMAGE_ROLLOUT_COMMAND_TIMEOUT_MS = '600000';
    process.env.BALANCE_IMAGE_ROLLOUT_RETRY_COOLDOWN_MS = '60000';
    process.env.BALANCE_IMAGE_ROLLOUT_ENABLED = 'true';
    process.env.BALANCE_IMAGE_ROLLOUT_READINESS_TIMEOUT_MS = '60000';
    process.env.BALANCE_IMAGE_ROLLOUT_SERVER_IDS = '*';
    process.env.BALANCE_IMAGE_ROLLOUT_STABILITY_WINDOW_MS = '30000';
    process.env.HARBOR_PASSWORD = HARBOR_PASSWORD;
    process.env.HARBOR_NAMESPACE = HARBOR_NAMESPACE;
    process.env.HARBOR_REGISTRY = HARBOR_REGISTRY;
    process.env.HARBOR_USERNAME = HARBOR_USERNAME;
    mockWithLock.mockImplementation(
      async (
        _redis: unknown,
        _key: string,
        handler: (lease: typeof activeLease) => Promise<unknown>
      ) => handler(activeLease)
    );
    jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    const restore = (key: string, value: string | undefined): void => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    };
    restore(
      'BALANCE_IMAGE_ROLLOUT_APPROVED_DIGEST',
      originalEnvironment.approved
    );
    restore(
      'BALANCE_IMAGE_ROLLOUT_COMMAND_TIMEOUT_MS',
      originalEnvironment.command
    );
    restore(
      'BALANCE_IMAGE_ROLLOUT_RETRY_COOLDOWN_MS',
      originalEnvironment.cooldown
    );
    restore('BALANCE_IMAGE_ROLLOUT_ENABLED', originalEnvironment.enabled);
    restore(
      'BALANCE_IMAGE_ROLLOUT_READINESS_TIMEOUT_MS',
      originalEnvironment.readiness
    );
    restore('BALANCE_IMAGE_ROLLOUT_SERVER_IDS', originalEnvironment.serverIds);
    restore(
      'BALANCE_IMAGE_ROLLOUT_STABILITY_WINDOW_MS',
      originalEnvironment.stability
    );
    restore('HARBOR_PASSWORD', originalEnvironment.harborPassword);
    restore('HARBOR_NAMESPACE', originalEnvironment.harborNamespace);
    restore('HARBOR_REGISTRY', originalEnvironment.harborRegistry);
    restore('HARBOR_USERNAME', originalEnvironment.harborUsername);
  });

  it('is inert by default when the explicit feature gate is disabled', async () => {
    process.env.BALANCE_IMAGE_ROLLOUT_ENABLED = 'false';
    const harness = buildHarness();

    await expect(harness.service.reconcile()).resolves.toBe('disabled');
    expect(mockWithLock).not.toHaveBeenCalled();
    expect(harness.runCommands).not.toHaveBeenCalled();
  });

  it('requires both an approved digest and an explicit server allowlist', async () => {
    delete process.env.BALANCE_IMAGE_ROLLOUT_APPROVED_DIGEST;
    process.env.BALANCE_IMAGE_ROLLOUT_SERVER_IDS = '';
    const harness = buildHarness();

    await expect(harness.service.reconcile()).resolves.toBe(
      'blocked_configuration'
    );
    expect(mockWithLock).not.toHaveBeenCalled();
    expect(harness.runCommands).not.toHaveBeenCalled();
  });

  it('rejects a command deadline that cannot outlive host recovery', async () => {
    process.env.BALANCE_IMAGE_ROLLOUT_COMMAND_TIMEOUT_MS = '120000';
    const harness = buildHarness();

    await expect(harness.service.reconcile()).resolves.toBe(
      'blocked_configuration'
    );
    expect(mockWithLock).not.toHaveBeenCalled();
    expect(harness.runCommands).not.toHaveBeenCalled();
    expect(harness.service.getStatus().error_code).toBe(
      'balance_rollout_command_deadline_too_short'
    );
  });

  it('refuses a default build whose resolved digest was not approved', async () => {
    const harness = buildHarness();
    harness.harborResolve.mockResolvedValueOnce({
      digest: PREVIOUS_DIGEST,
      imageReference: PREVIOUS_REFERENCE,
    });

    await expect(harness.service.reconcile()).resolves.toBe(
      'blocked_configuration'
    );
    expect(harness.runCommands).not.toHaveBeenCalled();
    expect(harness.service.getStatus().error_code).toBe(
      'balance_rollout_digest_not_approved'
    );
  });

  it('mutates at most one drifted host in a globally leased pass', async () => {
    const harness = buildHarness();
    harness.runCommands
      .mockResolvedValueOnce(probeOutput('drift'))
      .mockResolvedValueOnce(probeOutput('drift'))
      .mockResolvedValueOnce([{ output: 'rollout accepted' }])
      .mockResolvedValueOnce(probeOutput('converged'));

    await expect(harness.service.reconcile()).resolves.toBe('reconciled');

    expect(harness.runCommands).toHaveBeenCalledTimes(4);
    expect(
      harness.runCommands.mock.calls.filter((call) =>
        String(call[2][0]).includes('systemd-run')
      )
    ).toHaveLength(1);
    expect(
      harness.runCommands.mock.calls.filter(
        (call) =>
          call[0] === SECOND_SERVER_ID &&
          String(call[2][0]).includes('systemd-run')
      )
    ).toHaveLength(0);
    expect(mockWithLock).toHaveBeenCalledWith(
      expect.anything(),
      'balance:image-rollout:v1:fleet',
      expect.any(Function),
      expect.objectContaining({
        maxWaitMs: 500,
        ttlMs: 720000,
      })
    );

    const rolloutCall = harness.runCommands.mock.calls.find((call) =>
      String(call[2][0]).includes('systemd-run')
    );
    const command = String(rolloutCall?.[2][0]);
    const options = rolloutCall?.[4] as { stdin?: string };
    expect(command).not.toContain(HARBOR_USERNAME);
    expect(command).not.toContain(HARBOR_PASSWORD);
    expect(JSON.parse(options.stdin ?? '')).toEqual({
      HARBOR_REGISTRY,
      HARBOR_NAMESPACE,
      HARBOR_USERNAME,
      HARBOR_PASSWORD,
    });
    expect(options).toMatchObject({
      connectMaxAttempts: 1,
      failOnNonZero: true,
      stdin: expect.any(String),
    });
    for (const probeCall of harness.runCommands.mock.calls.filter(
      (call) => !String(call[2][0]).includes('systemd-run')
    )) {
      expect(probeCall[4]).not.toHaveProperty('stdin');
    }
  });

  it('skips converged hosts read-only and rolls the next drifted host', async () => {
    const harness = buildHarness();
    harness.runCommands
      .mockResolvedValueOnce(probeOutput('converged'))
      .mockResolvedValueOnce(probeOutput('drift'))
      .mockResolvedValueOnce([{ output: 'rollout accepted' }])
      .mockResolvedValueOnce(
        probeOutput('recovery', {
          phase: 'candidate_ready_pending_confirmation',
          stateTargetReference: DESIRED_REFERENCE,
        })
      );

    await expect(harness.service.reconcile()).resolves.toBe(
      'pending_confirmation'
    );
    expect(harness.runCommands).toHaveBeenCalledTimes(4);
    expect(harness.runCommands.mock.calls[1][0]).toBe(SECOND_SERVER_ID);
    expect(harness.runCommands.mock.calls[2][0]).toBe(SECOND_SERVER_ID);
  });

  it('fails closed without restarting an unhealthy current generation', async () => {
    const harness = buildHarness();
    harness.runCommands
      .mockResolvedValueOnce(probeOutput('unhealthy', { phase: 'complete' }))
      .mockResolvedValueOnce(probeOutput('drift'));

    await expect(harness.service.reconcile()).resolves.toBe('host_failed');

    expect(harness.runCommands).toHaveBeenCalledTimes(2);
    expect(
      harness.runCommands.mock.calls.filter((call) =>
        String(call[2][0]).includes('systemd-run')
      )
    ).toHaveLength(0);
    expect(harness.service.getStatus()).toMatchObject({
      error_code: 'balance_rollout_existing_generation_unhealthy',
      server_id: FIRST_SERVER_ID,
    });
  });

  it('refreshes an existing host barrier with one atomic compare-and-expire', async () => {
    const harness = buildHarness({
      initialInflightServerId: FIRST_SERVER_ID,
      servers: [server(FIRST_SERVER_ID)],
    });
    harness.runCommands
      .mockResolvedValueOnce(probeOutput('drift'))
      .mockResolvedValueOnce([{ output: 'rollout accepted' }])
      .mockResolvedValueOnce(
        probeOutput('recovery', {
          phase: 'candidate_ready_pending_confirmation',
          stateTargetReference: DESIRED_REFERENCE,
        })
      );

    await expect(harness.service.reconcile()).resolves.toBe(
      'pending_confirmation'
    );

    const refreshCalls = harness.redisEval.mock.calls.filter((call) =>
      String(call[0]).includes('PEXPIRE')
    );
    expect(refreshCalls).toHaveLength(2);
    for (const call of refreshCalls) {
      expect(call.slice(1)).toEqual([
        1,
        'balance:image-rollout:v1:inflight-host',
        FIRST_SERVER_ID,
        720000,
      ]);
    }
    expect(harness.redisSet).not.toHaveBeenCalledWith(
      'balance:image-rollout:v1:inflight-host',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it('does not mutate after losing ownership of the atomic host barrier', async () => {
    const harness = buildHarness({
      initialInflightServerId: FIRST_SERVER_ID,
      servers: [server(FIRST_SERVER_ID)],
    });
    harness.redisEval.mockResolvedValueOnce(0);
    harness.runCommands.mockResolvedValueOnce(probeOutput('drift'));

    await expect(harness.service.reconcile()).resolves.toBe('host_failed');

    expect(harness.runCommands).toHaveBeenCalledTimes(1);
    expect(
      harness.runCommands.mock.calls.filter((call) =>
        String(call[2][0]).includes('systemd-run')
      )
    ).toHaveLength(0);
  });

  it('does not advance to another host when atomic barrier release loses ownership', async () => {
    const harness = buildHarness({
      initialInflightServerId: FIRST_SERVER_ID,
    });
    harness.redisEval.mockResolvedValueOnce(0);
    harness.runCommands
      .mockResolvedValueOnce(probeOutput('converged'))
      .mockResolvedValueOnce(probeOutput('drift'));

    await expect(harness.service.reconcile()).resolves.toBe('host_failed');

    expect(harness.runCommands).toHaveBeenCalledTimes(2);
    expect(
      harness.runCommands.mock.calls.filter((call) =>
        String(call[2][0]).includes('systemd-run')
      )
    ).toHaveLength(0);
  });

  it('keeps an in-flight canary fenced when the allowlist changes', async () => {
    process.env.BALANCE_IMAGE_ROLLOUT_SERVER_IDS = SECOND_SERVER_ID;
    const harness = buildHarness({
      initialInflightServerId: FIRST_SERVER_ID,
    });
    harness.runCommands.mockResolvedValueOnce(probeOutput('drift'));

    await expect(harness.service.reconcile()).resolves.toBe('host_failed');

    expect(harness.runCommands).toHaveBeenCalledTimes(1);
    expect(
      harness.runCommands.mock.calls.filter((call) =>
        String(call[2][0]).includes('systemd-run')
      )
    ).toHaveLength(0);
    expect(harness.redisEval).toHaveBeenCalledWith(
      expect.stringContaining('PEXPIRE'),
      1,
      'balance:image-rollout:v1:inflight-host',
      FIRST_SERVER_ID,
      720000
    );
    expect(harness.service.getStatus().error_code).toBe(
      'balance_rollout_inflight_host_not_eligible'
    );
  });

  it('finishes a journaled prior digest before starting the newly approved one', async () => {
    const harness = buildHarness({
      servers: [server(FIRST_SERVER_ID)],
    });
    harness.harborResolve
      .mockResolvedValueOnce({
        digest: DESIRED_DIGEST,
        imageReference: DESIRED_REFERENCE,
      })
      .mockResolvedValueOnce({
        digest: PREVIOUS_DIGEST,
        imageReference: PREVIOUS_REFERENCE,
      });
    harness.runCommands
      .mockResolvedValueOnce(
        probeOutput('recovery', {
          phase: 'candidate_ready_pending_confirmation',
          stateTargetReference: PREVIOUS_REFERENCE,
        })
      )
      .mockResolvedValueOnce([{ output: 'prior rollout finalized' }])
      .mockResolvedValueOnce(probeOutput('drift', { phase: 'complete' }));

    await expect(harness.service.reconcile()).resolves.toBe(
      'pending_confirmation'
    );
    const rolloutCommand = String(harness.runCommands.mock.calls[1][2][0]);
    expect(rolloutCommand).toContain(`"${PREVIOUS_REFERENCE}"`);
    expect(harness.harborResolve).toHaveBeenLastCalledWith(
      'balance_api',
      PREVIOUS_REFERENCE
    );
  });

  it('fails closed when more than one host reports an unfinished rollout', async () => {
    const harness = buildHarness();
    harness.runCommands
      .mockResolvedValueOnce(
        probeOutput('recovery', {
          phase: 'candidate_started',
          stateTargetReference: DESIRED_REFERENCE,
        })
      )
      .mockResolvedValueOnce(
        probeOutput('recovery', {
          phase: 'rollback_started',
          stateTargetReference: DESIRED_REFERENCE,
        })
      );

    await expect(harness.service.reconcile()).resolves.toBe('host_failed');
    expect(
      harness.runCommands.mock.calls.filter((call) =>
        String(call[2][0]).includes('systemd-run')
      )
    ).toHaveLength(0);
    expect(harness.service.getStatus().error_code).toBe(
      'balance_rollout_multiple_recoveries_detected'
    );
  });

  it('fails closed without mutating when any allowed host cannot be probed', async () => {
    const harness = buildHarness();
    harness.runCommands
      .mockRejectedValueOnce(new Error('ssh unavailable'))
      .mockResolvedValueOnce(probeOutput('drift'));

    await expect(harness.service.reconcile()).resolves.toBe('host_failed');
    expect(
      harness.runCommands.mock.calls.filter((call) =>
        String(call[2][0]).includes('systemd-run')
      )
    ).toHaveLength(0);
    expect(harness.service.getStatus().error_code).toBe(
      'balance_rollout_hosts_unreachable'
    );
  });

  it('stops the pass after a host rejects the candidate and records only a safe error code', async () => {
    const harness = buildHarness();
    harness.runCommands
      .mockResolvedValueOnce(probeOutput('drift'))
      .mockResolvedValueOnce(probeOutput('drift'))
      .mockRejectedValueOnce(new Error(HARBOR_PASSWORD));

    await expect(harness.service.reconcile()).resolves.toBe('host_failed');
    expect(harness.runCommands).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(harness.service.getStatus())).not.toContain(
      HARBOR_PASSWORD
    );
    expect(
      JSON.stringify((console.info as jest.Mock).mock.calls)
    ).not.toContain(HARBOR_PASSWORD);
    for (const call of harness.runCommands.mock.calls) {
      expect(String(call[2][0])).not.toContain(HARBOR_PASSWORD);
    }
    expect(harness.service.getStatus().error_code).toBe(
      'balance_rollout_failed'
    );
    expect(harness.redisSet).toHaveBeenCalledWith(
      'balance:image-rollout:v1:inflight-host',
      FIRST_SERVER_ID,
      'PX',
      720000,
      'NX'
    );
  });
});
