import type { FastifyBaseLogger } from 'fastify';
import { workerErrorDiagnostics } from '@core/common/functions/workerErrorDiagnostics';
import type { RedisLeaderElectionSnapshot } from './redisLeaderElection';
import {
  workerCommandNatsHealthProbe,
  type WorkerCommandNatsContract,
  type WorkerCommandNatsHealthProbe,
} from './workerCommandNatsHealthProbe';

export const WORKER_COMMAND_PLANE_COMPONENTS = [
  'deferred_relay',
  'queued_reconciler',
  'deadline_reconciler',
  'message_recovery_drainer',
] as const;

export type WorkerCommandPlaneComponent =
  (typeof WORKER_COMMAND_PLANE_COMPONENTS)[number];

export type WorkerCommandPlaneLeadership =
  'electing' | 'leader' | 'standby' | 'stopped';

export type WorkerCommandPlaneNatsState =
  'not_applicable' | 'standby' | 'checking' | 'ready' | 'failed';

export interface WorkerCommandPlaneFailureSnapshot {
  error_name: string;
  error_code: string;
  observed_at: string;
}

export interface WorkerCommandPlaneNatsSnapshot {
  required: boolean;
  state: WorkerCommandPlaneNatsState;
  connected: boolean | null;
  contract_valid: boolean | null;
  contracts: WorkerCommandNatsContract[];
  checked_at: string | null;
  last_error: WorkerCommandPlaneFailureSnapshot | null;
}

export interface WorkerCommandPlaneComponentSnapshot {
  name: WorkerCommandPlaneComponent;
  required: true;
  leadership: WorkerCommandPlaneLeadership;
  leader: boolean;
  election_healthy: boolean;
  running: boolean;
  ready: boolean;
  blocking: boolean;
  state: 'electing' | 'standby' | 'starting' | 'ready' | 'failed' | 'stopped';
  last_transition_at: string;
  last_error: WorkerCommandPlaneFailureSnapshot | null;
  failure_count: number;
  nats: WorkerCommandPlaneNatsSnapshot;
}

export interface WorkerCommandPlaneReadinessSnapshot {
  schema_version: 1;
  ready: boolean;
  role: 'leader' | 'standby' | 'mixed' | 'electing';
  required_components: number;
  leader_components: number;
  standby_components: number;
  blocking_components: WorkerCommandPlaneComponent[];
  observed_at: string;
  components: WorkerCommandPlaneComponentSnapshot[];
}

interface MutableNatsState {
  state: WorkerCommandPlaneNatsState;
  connected: boolean | null;
  contractValid: boolean | null;
  contracts: WorkerCommandNatsContract[];
  checkedAt: string | null;
  lastError: WorkerCommandPlaneFailureSnapshot | null;
}

interface MutableComponentState {
  leadership: WorkerCommandPlaneLeadership;
  electionHealthy: boolean;
  running: boolean;
  runtimeHealthy: boolean;
  lastTransitionAt: string;
  lastError: WorkerCommandPlaneFailureSnapshot | null;
  failureCount: number;
  nats: MutableNatsState;
}

const REQUIRED_NATS_CONTRACTS: Readonly<
  Record<WorkerCommandPlaneComponent, readonly WorkerCommandNatsContract[]>
> = Object.freeze({
  deferred_relay: ['commands', 'deferred', 'failures'],
  queued_reconciler: ['commands', 'epoch'],
  deadline_reconciler: ['failures'],
  message_recovery_drainer: [],
});

function failureSnapshot(error: unknown): WorkerCommandPlaneFailureSnapshot {
  return {
    ...workerErrorDiagnostics(error),
    observed_at: new Date().toISOString(),
  };
}

function initialState(
  component: WorkerCommandPlaneComponent
): MutableComponentState {
  const now = new Date().toISOString();
  const contracts = [...REQUIRED_NATS_CONTRACTS[component]];
  return {
    leadership: 'electing',
    electionHealthy: true,
    running: false,
    runtimeHealthy: false,
    lastTransitionAt: now,
    lastError: null,
    failureCount: 0,
    nats: {
      state: contracts.length === 0 ? 'not_applicable' : 'standby',
      connected: contracts.length === 0 ? null : false,
      contractValid: contracts.length === 0 ? null : false,
      contracts,
      checkedAt: null,
      lastError: null,
    },
  };
}

function mapLeadership(
  role: RedisLeaderElectionSnapshot['role']
): WorkerCommandPlaneLeadership {
  if (role === 'leader') return 'leader';
  if (role === 'standby') return 'standby';
  if (role === 'stopped' || role === 'idle') return 'stopped';
  return 'electing';
}

/**
 * Process-local authority for manager command-plane readiness. It intentionally
 * stores no command identity or payload and performs no I/O from snapshot().
 */
export class WorkerCommandPlaneReadinessRegistry {
  private readonly states = new Map<
    WorkerCommandPlaneComponent,
    MutableComponentState
  >();

  constructor() {
    this.reset();
  }

  public observeElection(
    component: WorkerCommandPlaneComponent,
    election: RedisLeaderElectionSnapshot
  ): void {
    const state = this.state(component);
    const leadership = mapLeadership(election.role);
    if (state.leadership !== leadership) {
      state.leadership = leadership;
      state.lastTransitionAt = new Date().toISOString();
    }
    state.electionHealthy = election.healthy;
    if (leadership !== 'leader') {
      state.running = false;
      if (state.nats.contracts.length > 0) {
        state.nats.state = 'standby';
        state.nats.connected = null;
        state.nats.contractValid = null;
      }
    }
  }

  public markStarting(component: WorkerCommandPlaneComponent): void {
    const state = this.state(component);
    state.running = false;
    state.runtimeHealthy = false;
    state.lastTransitionAt = new Date().toISOString();
  }

  public markRunning(
    component: WorkerCommandPlaneComponent,
    running: boolean
  ): void {
    const state = this.state(component);
    if (state.running !== running) {
      state.running = running;
      state.lastTransitionAt = new Date().toISOString();
    }
  }

  public recordFailure(
    component: WorkerCommandPlaneComponent,
    error: unknown
  ): void {
    const state = this.state(component);
    state.runtimeHealthy = false;
    state.lastError = failureSnapshot(error);
    state.failureCount += 1;
  }

  /** Clears the recoverable runtime failure latch after one complete cycle. */
  public recordSuccess(component: WorkerCommandPlaneComponent): void {
    const state = this.state(component);
    state.runtimeHealthy = true;
    state.lastError = null;
  }

  public markNatsChecking(component: WorkerCommandPlaneComponent): void {
    const nats = this.state(component).nats;
    if (nats.contracts.length === 0 || nats.state === 'ready') return;
    nats.state = 'checking';
    nats.connected = null;
    nats.contractValid = null;
  }

  public markNatsReady(
    component: WorkerCommandPlaneComponent,
    checkedAt: string
  ): void {
    const state = this.state(component);
    const nats = state.nats;
    if (state.lastError?.observed_at === nats.lastError?.observed_at) {
      state.lastError = null;
    }
    nats.state = 'ready';
    nats.connected = true;
    nats.contractValid = true;
    nats.checkedAt = checkedAt;
    nats.lastError = null;
  }

  public markNatsFailed(
    component: WorkerCommandPlaneComponent,
    error: unknown
  ): void {
    const state = this.state(component);
    const failure = failureSnapshot(error);
    state.nats.state = 'failed';
    state.nats.connected = false;
    state.nats.contractValid = false;
    state.nats.checkedAt = failure.observed_at;
    state.nats.lastError = failure;
    state.lastError = failure;
    state.failureCount += 1;
  }

  public snapshot(): WorkerCommandPlaneReadinessSnapshot {
    const components = WORKER_COMMAND_PLANE_COMPONENTS.map((component) =>
      this.componentSnapshot(component)
    );
    const blockingComponents = components
      .filter((component) => component.blocking)
      .map((component) => component.name);
    const leaderComponents = components.filter(
      (component) => component.leader
    ).length;
    const standbyComponents = components.filter(
      (component) => component.leadership === 'standby'
    ).length;
    const electingComponents = components.filter(
      (component) => component.leadership === 'electing'
    ).length;
    const role =
      electingComponents === components.length
        ? 'electing'
        : leaderComponents === components.length
          ? 'leader'
          : leaderComponents === 0
            ? 'standby'
            : 'mixed';
    return {
      schema_version: 1,
      ready: blockingComponents.length === 0,
      role,
      required_components: components.length,
      leader_components: leaderComponents,
      standby_components: standbyComponents,
      blocking_components: blockingComponents,
      observed_at: new Date().toISOString(),
      components,
    };
  }

  /** Test-only reset; production constructs and retains one singleton. */
  public reset(): void {
    this.states.clear();
    for (const component of WORKER_COMMAND_PLANE_COMPONENTS) {
      this.states.set(component, initialState(component));
    }
  }

  private componentSnapshot(
    component: WorkerCommandPlaneComponent
  ): WorkerCommandPlaneComponentSnapshot {
    const current = this.state(component);
    const leader = current.leadership === 'leader';
    const natsReady =
      current.nats.contracts.length === 0 || current.nats.state === 'ready';
    const ready = leader
      ? current.electionHealthy &&
        current.running &&
        current.runtimeHealthy &&
        natsReady
      : current.leadership === 'standby' && current.electionHealthy;
    const blocking = !ready;
    const state = this.componentState(current, ready);
    return {
      name: component,
      required: true,
      leadership: current.leadership,
      leader,
      election_healthy: current.electionHealthy,
      running: current.running,
      ready,
      blocking,
      state,
      last_transition_at: current.lastTransitionAt,
      last_error: current.lastError,
      failure_count: current.failureCount,
      nats: {
        required: current.nats.contracts.length > 0,
        state: current.nats.state,
        connected: current.nats.connected,
        contract_valid: current.nats.contractValid,
        contracts: [...current.nats.contracts],
        checked_at: current.nats.checkedAt,
        last_error: current.nats.lastError,
      },
    };
  }

  private componentState(
    state: MutableComponentState,
    ready: boolean
  ): WorkerCommandPlaneComponentSnapshot['state'] {
    if (state.leadership === 'electing') return 'electing';
    if (state.leadership === 'standby') return 'standby';
    if (state.leadership === 'stopped') return 'stopped';
    if (ready) return 'ready';
    if (
      !state.electionHealthy ||
      state.nats.state === 'failed' ||
      state.lastError !== null
    ) {
      return 'failed';
    }
    return 'starting';
  }

  private state(component: WorkerCommandPlaneComponent): MutableComponentState {
    const state = this.states.get(component);
    if (!state) throw new Error('worker_command_plane_component_unknown');
    return state;
  }
}

export interface WorkerCommandNatsMonitor {
  start(): void;
  stop(): void;
}

export function createWorkerCommandNatsMonitor(input: {
  component: WorkerCommandPlaneComponent;
  contracts: readonly WorkerCommandNatsContract[];
  logger: FastifyBaseLogger;
  intervalMs?: number;
  registry?: WorkerCommandPlaneReadinessRegistry;
  probe?: WorkerCommandNatsHealthProbe;
}): WorkerCommandNatsMonitor {
  const registry = input.registry ?? workerCommandPlaneReadinessRegistry;
  const probe = input.probe ?? workerCommandNatsHealthProbe;
  const intervalMs = input.intervalMs ?? 15_000;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running: Promise<void> | null = null;
  let active = false;

  const check = (): void => {
    if (!active || running) return;
    registry.markNatsChecking(input.component);
    running = probe
      .check(input.contracts)
      .then((result) => {
        if (active) registry.markNatsReady(input.component, result.checked_at);
      })
      .catch((error: unknown) => {
        if (!active) return;
        registry.markNatsFailed(input.component, error);
        input.logger.error(
          {
            err: error,
            component: input.component,
            type: 'worker_command_nats_health_probe_failed',
          },
          'Worker command NATS contract probe failed'
        );
      })
      .finally(() => {
        running = null;
      });
  };

  return {
    start: (): void => {
      if (active) return;
      active = true;
      check();
      timer = setInterval(check, intervalMs);
      timer.unref?.();
    },
    stop: (): void => {
      active = false;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

export const workerCommandPlaneReadinessRegistry =
  new WorkerCommandPlaneReadinessRegistry();
