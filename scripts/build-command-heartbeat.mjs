import { spawn } from 'node:child_process';

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_KILL_GRACE_MS = 5_000;
const TIMEOUT_EXIT_CODE = 124;

function parsePositiveInteger(environmentName, defaultValue) {
  const rawValue = process.env[environmentName]?.trim();
  if (!rawValue) {
    return defaultValue;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${environmentName} must be a positive integer.`);
  }

  return parsedValue;
}

function formatDuration(durationMs) {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

function normalizeLabel(rawLabel) {
  const normalizedLabel = rawLabel
    ?.replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalizedLabel || 'build command';
}

const commandArguments = process.argv.slice(2);
if (commandArguments[0] === '--') {
  commandArguments.shift();
}

const command = commandArguments.shift();
if (!command) {
  console.error(
    'Usage: node scripts/build-command-heartbeat.mjs -- <command> [args...]'
  );
  process.exit(64);
}

const heartbeatIntervalMs = parsePositiveInteger(
  'UNDERCHAT_COMMAND_HEARTBEAT_INTERVAL_MS',
  DEFAULT_HEARTBEAT_INTERVAL_MS
);
const commandTimeoutMs = parsePositiveInteger(
  'UNDERCHAT_COMMAND_TIMEOUT_MS',
  DEFAULT_COMMAND_TIMEOUT_MS
);
const killGraceMs = parsePositiveInteger(
  'UNDERCHAT_COMMAND_KILL_GRACE_MS',
  DEFAULT_KILL_GRACE_MS
);
const commandLabel = normalizeLabel(
  process.env.UNDERCHAT_COMMAND_HEARTBEAT_LABEL
);
const commandStartedAt = Date.now();
const canSignalProcessGroup = process.platform !== 'win32';
const child = spawn(command, commandArguments, {
  detached: canSignalProcessGroup,
  env: process.env,
  stdio: 'inherit',
});

let didTimeOut = false;
let forwardedSignal = null;
let forceKillTimer = null;

function signalChildProcessTree(signal) {
  if (canSignalProcessGroup && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {}
  }

  try {
    child.kill(signal);
  } catch {}
}

function requestTermination(signal) {
  signalChildProcessTree(signal);

  if (forceKillTimer) {
    return;
  }

  forceKillTimer = setTimeout(() => {
    signalChildProcessTree('SIGKILL');
  }, killGraceMs);
}

const heartbeatTimer = setInterval(() => {
  console.log(
    `[build-heartbeat] ${commandLabel} still running after ${formatDuration(Date.now() - commandStartedAt)}`
  );
}, heartbeatIntervalMs);

const commandTimeoutTimer = setTimeout(() => {
  didTimeOut = true;
  console.error(
    `[build-heartbeat] ${commandLabel} exceeded ${formatDuration(commandTimeoutMs)}; terminating process tree`
  );
  requestTermination('SIGTERM');
}, commandTimeoutMs);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    forwardedSignal = signal;
    requestTermination(signal);
  });
}

function clearTimers() {
  clearInterval(heartbeatTimer);
  clearTimeout(commandTimeoutTimer);
  if (forceKillTimer) {
    clearTimeout(forceKillTimer);
    forceKillTimer = null;
  }
}

child.once('error', (error) => {
  clearTimers();
  console.error(
    `[build-heartbeat] Unable to start ${commandLabel}: ${error.message}`
  );
  process.exitCode = 1;
});

child.once('close', (exitCode, signal) => {
  clearTimers();

  if (didTimeOut) {
    process.exitCode = TIMEOUT_EXIT_CODE;
    return;
  }

  if (typeof exitCode === 'number') {
    process.exitCode = exitCode;
    return;
  }

  console.error(
    `[build-heartbeat] ${commandLabel} stopped by ${signal ?? forwardedSignal ?? 'unknown signal'}`
  );
  process.exitCode = 1;
});
