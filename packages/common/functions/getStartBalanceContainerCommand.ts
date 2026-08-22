import { createHash } from 'node:crypto';
import {
  buildServerInstallStageMarker,
  type ServerInstallStageId,
} from '@core/common/interfaces/IServerInstallEvent';

interface IGetStartBalanceContainerCommandParams {
  serverId: string;
  webPort: number;
}

const BALANCE_ROLLOUT_UNIT = 'underchat-balance-rollout-v1.service';
const BALANCE_ROLLOUT_STATE_DIR = '/var/lib/underchat/balance-rollout';
const BALANCE_ROLLOUT_STATE_FILE =
  '/var/lib/underchat/balance-rollout/state.env';
const BALANCE_ROLLBACK_CONTAINER_NAME = 'under-balance-api-rollback';

function resolveLegacyInstallStage(
  command: string,
  currentStage: ServerInstallStageId
): ServerInstallStageId {
  const normalized = command.toLowerCase();

  if (normalized.includes('under-worker-baileys')) {
    return 'worker_baileys';
  }

  if (normalized.includes('under-worker-wwebjs')) {
    return 'worker_wwebjs';
  }

  if (
    normalized.includes('under-worker-whatsmeow') ||
    normalized.includes('worker-whatsmeow')
  ) {
    return 'worker_meow';
  }

  if (normalized.includes('under-balance-api')) {
    return 'balance';
  }

  if (
    normalized.includes('docker login') ||
    normalized.includes('harbor') ||
    normalized.includes('docker pull image')
  ) {
    return 'images';
  }

  if (
    normalized.includes('docker') ||
    normalized.includes('containerd') ||
    normalized.includes('/var/run/docker.sock')
  ) {
    return 'docker';
  }

  if (
    normalized.includes('apt') ||
    normalized.includes('dpkg') ||
    normalized.includes('package') ||
    normalized.includes('nvm') ||
    normalized.includes('node') ||
    normalized.includes('system preparation')
  ) {
    return 'packages';
  }

  return currentStage;
}

function stageMarkerCommand(
  stage: ServerInstallStageId,
  status: 'running' | 'complete'
): string {
  const marker = buildServerInstallStageMarker(stage, status);
  return `printf '%s\\n' '${marker}'`;
}

function instrumentLegacyInstallCommands(
  commands: readonly string[]
): string[] {
  const instrumented: string[] = [];
  let currentStage: ServerInstallStageId = 'packages';
  let hasStartedStage = false;

  for (const command of commands) {
    const nextStage = resolveLegacyInstallStage(command, currentStage);

    if (!hasStartedStage || nextStage !== currentStage) {
      if (hasStartedStage) {
        instrumented.push(stageMarkerCommand(currentStage, 'complete'));
      }

      currentStage = nextStage;
      instrumented.push(stageMarkerCommand(currentStage, 'running'));
      hasStartedStage = true;
    }

    instrumented.push(command);
  }

  if (hasStartedStage) {
    instrumented.push(stageMarkerCommand(currentStage, 'complete'));
  }

  return instrumented;
}

/**
 * Defines the fail-closed local Docker verification used after installers have
 * installed and started Docker. Keep this fragment free of single quotes
 * because its callers execute it inside a single-quoted bash command.
 */
export function getLegacyBalanceDockerRuntimeFenceShellFragment(): string {
  return `legacy_rollout_verify_docker() { \
      PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; \
      export PATH; \
      hash -r; \
      unset DOCKER_CONTEXT; \
      DOCKER_HOST=unix:///var/run/docker.sock; \
      export DOCKER_HOST; \
      if ! command -v docker >/dev/null 2>&1; then \
        echo "ERROR: Legacy Balance mutation blocked because local Docker CLI is unavailable" >&2; \
        return 1; \
      fi; \
      if [ ! -S /var/run/docker.sock ]; then \
        echo "ERROR: Legacy Balance mutation blocked because local Docker socket is unavailable" >&2; \
        return 1; \
      fi; \
      if ! ROLLOUT_RESERVED_BACKUP_IDS="$(docker ps -aq --no-trunc --filter "name=^/${BALANCE_ROLLBACK_CONTAINER_NAME}$" 2>/dev/null)"; then \
        echo "ERROR: Legacy Balance mutation blocked because reserved rollback identity cannot be verified" >&2; \
        return 1; \
      fi; \
      if [ -n "$ROLLOUT_RESERVED_BACKUP_IDS" ]; then \
        echo "ERROR: Legacy Balance mutation blocked because reserved rollback container exists" >&2; \
        return 1; \
      fi; \
    }; \
    export -f legacy_rollout_verify_docker`;
}

/**
 * Acquires the shared rollout reservation without requiring Docker to exist.
 * This lets a fresh installer reserve the host before Docker package changes,
 * while exporting the post-install runtime verifier into its child shell.
 */
export function getLegacyBalanceRolloutReservationShellFragment(): string {
  return `PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; \
      export PATH; \
      hash -r; \
      ${getLegacyBalanceDockerRuntimeFenceShellFragment()}; \
      ROLLOUT_UNIT=${BALANCE_ROLLOUT_UNIT}; \
      ROLLOUT_STATE_DIR=${BALANCE_ROLLOUT_STATE_DIR}; \
      ROLLOUT_STATE_FILE=${BALANCE_ROLLOUT_STATE_FILE}; \
      ROLLOUT_EXPECTED_OWNER=0; \
      legacy_rollout_fail() { echo "ERROR: $1" >&2; exit 1; }; \
      if [ -L "$ROLLOUT_STATE_DIR" ]; then \
        legacy_rollout_fail "Legacy Balance mutation blocked because managed rollout directory is a symlink"; \
      fi; \
      if [ ! -e "$ROLLOUT_STATE_DIR" ]; then \
        mkdir -p -m 0700 -- "$ROLLOUT_STATE_DIR" 2>/dev/null || \
          legacy_rollout_fail "Legacy Balance mutation blocked because managed rollout directory cannot be created"; \
      fi; \
      if [ ! -d "$ROLLOUT_STATE_DIR" ] || [ -L "$ROLLOUT_STATE_DIR" ]; then \
        legacy_rollout_fail "Legacy Balance mutation blocked because managed rollout directory cannot be verified"; \
      fi; \
      if [ "$(stat -c "%u" -- "$ROLLOUT_STATE_DIR" 2>/dev/null)" != "$ROLLOUT_EXPECTED_OWNER" ] || \
        [ "$(stat -c "%a" -- "$ROLLOUT_STATE_DIR" 2>/dev/null)" != 700 ]; then \
        legacy_rollout_fail "Legacy Balance mutation blocked because managed rollout directory ownership or mode is invalid"; \
      fi; \
      if ! exec {ROLLOUT_LEGACY_LOCK_FD}<"$ROLLOUT_STATE_DIR"; then \
        legacy_rollout_fail "Legacy Balance mutation blocked because managed rollout lock cannot be opened"; \
      fi; \
      if ! flock -n "$ROLLOUT_LEGACY_LOCK_FD"; then \
        legacy_rollout_fail "Legacy Balance mutation blocked because managed rollout lock is busy"; \
      fi; \
      ROLLOUT_LOCK_ID="$(stat -Lc "%d:%i" -- "/proc/self/fd/$ROLLOUT_LEGACY_LOCK_FD" 2>/dev/null)"; \
      if [ -z "$ROLLOUT_LOCK_ID" ] || [ ! -d "/proc/self/fd/$ROLLOUT_LEGACY_LOCK_FD" ] || \
        [ "$(stat -Lc "%u" -- "/proc/self/fd/$ROLLOUT_LEGACY_LOCK_FD" 2>/dev/null)" != "$ROLLOUT_EXPECTED_OWNER" ] || \
        [ "$(stat -Lc "%a" -- "/proc/self/fd/$ROLLOUT_LEGACY_LOCK_FD" 2>/dev/null)" != 700 ] || \
        [ -L "$ROLLOUT_STATE_DIR" ] || \
        [ "$(stat -Lc "%d:%i" -- "$ROLLOUT_STATE_DIR" 2>/dev/null)" != "$ROLLOUT_LOCK_ID" ]; then \
        legacy_rollout_fail "Legacy Balance mutation blocked because managed rollout lock identity changed"; \
      fi; \
      if systemctl is-active --quiet "$ROLLOUT_UNIT"; then \
        legacy_rollout_fail "Legacy Balance mutation blocked because managed rollout service is active"; \
      fi; \
      if ! ROLLOUT_UNIT_LOAD_STATE="$(systemctl show "$ROLLOUT_UNIT" --property=LoadState --value 2>/dev/null)"; then \
        legacy_rollout_fail "Legacy Balance mutation blocked because managed rollout service state cannot be verified"; \
      fi; \
      if ! ROLLOUT_UNIT_ACTIVE_STATE="$(systemctl show "$ROLLOUT_UNIT" --property=ActiveState --value 2>/dev/null)"; then \
        legacy_rollout_fail "Legacy Balance mutation blocked because managed rollout service state cannot be verified"; \
      fi; \
      case "$ROLLOUT_UNIT_LOAD_STATE:$ROLLOUT_UNIT_ACTIVE_STATE" in \
        loaded:inactive|loaded:failed|not-found:inactive) ;; \
        *) legacy_rollout_fail "Legacy Balance mutation blocked because managed rollout service state cannot be verified" ;; \
      esac; \
      if [ -e "$ROLLOUT_STATE_FILE" ] || [ -L "$ROLLOUT_STATE_FILE" ]; then \
        if [ -L "$ROLLOUT_STATE_FILE" ] || [ ! -f "$ROLLOUT_STATE_FILE" ] || [ ! -r "$ROLLOUT_STATE_FILE" ] || \
          [ "$(stat -c "%u" -- "$ROLLOUT_STATE_FILE" 2>/dev/null)" != "$ROLLOUT_EXPECTED_OWNER" ] || \
          [ "$(stat -c "%a" -- "$ROLLOUT_STATE_FILE" 2>/dev/null)" != 600 ]; then \
          legacy_rollout_fail "Legacy Balance mutation blocked because managed rollout state cannot be verified"; \
        fi; \
        ROLLOUT_PHASE_COUNT="$(grep -c "^PHASE=" "$ROLLOUT_STATE_FILE" 2>/dev/null)"; \
        ROLLOUT_PHASE_COUNT_EXIT=$?; \
        if [ "$ROLLOUT_PHASE_COUNT_EXIT" -gt 1 ] || [ "$ROLLOUT_PHASE_COUNT" != 1 ]; then \
          legacy_rollout_fail "Legacy Balance mutation blocked because managed rollout state cannot be verified"; \
        fi; \
        if ! ROLLOUT_PHASE="$(sed -n "s/^PHASE=//p" "$ROLLOUT_STATE_FILE" | head -n 1 | tr -d "\\r")"; then \
          legacy_rollout_fail "Legacy Balance mutation blocked because managed rollout state cannot be verified"; \
        fi; \
        case "$ROLLOUT_PHASE" in \
          prepared|old_backed_up|candidate_started|candidate_ready_pending_confirmation|rollback_started|finalize_started) \
            legacy_rollout_fail "Legacy Balance mutation blocked by managed rollout phase: $ROLLOUT_PHASE" \
            ;; \
          complete|rolled_back) ;; \
          *) legacy_rollout_fail "Legacy Balance mutation blocked because managed rollout state cannot be verified" ;; \
        esac; \
      fi`;
}

/** Prevents legacy container commands from racing the managed rollout. */
export function getLegacyBalanceRolloutFenceShellFragment(
  requireDocker = true
): string {
  const reservation = getLegacyBalanceRolloutReservationShellFragment();
  return requireDocker
    ? `${reservation}; legacy_rollout_verify_docker`
    : reservation;
}

/** Holds the legacy fence lock until the wrapped shell command exits. */
export function getLegacyBalanceRolloutFencedCommand(
  command: string,
  requireDocker = true
): string {
  const delimiter = `UNDERCHAT_LEGACY_BALANCE_${createHash('sha256')
    .update(command)
    .digest('hex')}`;
  return `bash -c 'set -o pipefail && \
      ${getLegacyBalanceRolloutFenceShellFragment(requireDocker)} && \
      bash -s' <<'${delimiter}'
${command}
${delimiter}`;
}

export function getLegacyBalanceRolloutFencedCommandSequence(
  commands: readonly string[],
  reservationStartCommand: string,
  dockerRuntimeVerificationBeforeCommand: string
): string[] {
  const reservationStartIndex = commands.indexOf(reservationStartCommand);
  const runtimeVerificationIndex = commands.indexOf(
    dockerRuntimeVerificationBeforeCommand
  );
  if (reservationStartIndex < 0) {
    throw new Error('Legacy Balance rollout reservation marker was not found.');
  }
  if (runtimeVerificationIndex <= reservationStartIndex) {
    throw new Error(
      'Legacy Balance Docker verification marker must follow the reservation marker.'
    );
  }
  const mutationCommands = [
    'set -Eeuo pipefail',
    // A single ordered stream prevents stderr from overtaking stage markers
    // emitted on stdout by the remote SSH process.
    'exec 2>&1',
    ...commands.slice(reservationStartIndex, runtimeVerificationIndex),
    'legacy_rollout_verify_docker',
    ...commands.slice(runtimeVerificationIndex),
  ];
  const mutationScript = [
    mutationCommands[0],
    ...instrumentLegacyInstallCommands(mutationCommands.slice(1)),
  ].join('\n');
  return [
    ...commands.slice(0, reservationStartIndex),
    getLegacyBalanceRolloutFencedCommand(mutationScript, false),
  ];
}

export function getStartBalanceContainerCommand({
  serverId,
  webPort,
}: IGetStartBalanceContainerCommandParams): string {
  const balanceRolloutFence = getLegacyBalanceRolloutFenceShellFragment();

  return `bash -c 'set -o pipefail && \
      ${balanceRolloutFence} && \
      export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH && \
      hash -r && \
      mkdir -p /home/server && \
      cd /home/app && \
      ACTIVE_BALANCE_CONTAINER_IDS=$(docker ps -aq --filter "name=^/under-balance-api$") && \
      RESERVED_PORT_CONTAINER_IDS=$({ \
        docker ps -q --filter "publish=${webPort}" && \
        docker ps -q --filter "publish=50051"; \
      } | sort -u) && \
      for PORT_CONTAINER_ID in $RESERVED_PORT_CONTAINER_IDS; do \
        case " $ACTIVE_BALANCE_CONTAINER_IDS " in \
          *" $PORT_CONTAINER_ID "*) ;; \
          *) echo "ERROR: Reserved Balance port is owned by foreign container $PORT_CONTAINER_ID" >&2; exit 1 ;; \
        esac; \
      done && \
      if [ -n "$ACTIVE_BALANCE_CONTAINER_IDS" ]; then \
        docker rm -f $ACTIVE_BALANCE_CONTAINER_IDS; \
      fi && \
      CONTAINER_ID=$(docker run -d --name under-balance-api \
        --restart always \
        --stop-timeout 10 \
        -p ${webPort}:3003 \
        -p 50051:50051 \
        -v /var/run/docker.sock:/var/run/docker.sock \
        --env-file /home/app/.env \
        --network underchat \
        -e DOCKER_HOST=unix:///var/run/docker.sock \
        -e SERVER_ID=${serverId} \
        under-balance-api:latest 2>&1 | tee -a /home/server/log_${serverId}.log); \
      EXIT_CODE=$?; \
      if [ $EXIT_CODE -eq 0 ] && [ -n "$CONTAINER_ID" ] && echo "$CONTAINER_ID" | grep -qE "^[a-f0-9]{64}$"; then \
        sleep 2 && \
        if docker ps --filter id=$CONTAINER_ID --filter status=running --format "{{.ID}}" | grep -q .; then \
          echo "SUCCESS: Container under-balance-api started with ID: $CONTAINER_ID" | tee -a /home/server/log_${serverId}.log; \
        else \
          echo "ERROR: Container under-balance-api failed to start. ID: $CONTAINER_ID" | tee -a /home/server/log_${serverId}.log; \
          docker logs under-balance-api 2>&1 | tail -20 | tee -a /home/server/log_${serverId}.log; \
          exit 1; \
        fi; \
      else \
        echo "ERROR: Failed to create container. Exit code: $EXIT_CODE. Output: $CONTAINER_ID" | tee -a /home/server/log_${serverId}.log; \
        docker rm -f under-balance-api >/dev/null 2>&1 || true; \
        exit 1; \
      fi'`;
}
