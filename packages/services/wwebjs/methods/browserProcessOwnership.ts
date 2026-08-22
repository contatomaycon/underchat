import { AsyncLocalStorage } from 'node:async_hooks';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const WWEBJS_BROWSER_LAUNCH_PATCH = Symbol.for(
  'underchat.wwebjs.browser-launch-ownership'
);
const USER_DATA_DIR_ARGUMENT = '--user-data-dir';
const CHROMIUM_EXECUTABLE_ALLOWLIST_ENV =
  'WWEBJS_CHROMIUM_EXECUTABLE_ALLOWLIST';
const WRAPPER_EXECUTABLE_ALLOWLIST_ENV =
  'WWEBJS_BROWSER_WRAPPER_EXECUTABLE_ALLOWLIST';
const DEFAULT_CHROMIUM_EXECUTABLE_PATHS = [
  '/opt/google/chrome/chrome',
  '/usr/lib/chromium/chromium',
] as const;
const DEFAULT_WRAPPER_EXECUTABLE_PATHS = [
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chrome',
  '/opt/google/chrome/google-chrome',
] as const;
const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);

interface PuppeteerBrowserProcess {
  nodeProcess?: ChildProcess;
  kill?: () => void;
}

interface PuppeteerBrowserLaunchOptions {
  executablePath?: string;
  args?: string[];
}

interface PuppeteerBrowsersModule {
  launch: (options: PuppeteerBrowserLaunchOptions) => PuppeteerBrowserProcess;
  [WWEBJS_BROWSER_LAUNCH_PATCH]?: WwebjsBrowserLaunchPatchState;
}

interface WwebjsBrowserLaunchPatchState {
  originalLaunch: PuppeteerBrowsersModule['launch'];
  ownershipScope: AsyncLocalStorage<WwebjsBrowserLaunchOwner>;
}

export interface WwebjsLinuxProcessStat {
  pid: number;
  parentPid: number;
  processGroupId: number;
  sessionId: number;
  processState: string;
  startTimeTicks: string;
}

export type WwebjsLinuxProcessStatSnapshot =
  | { pid: number; status: 'present'; stat: WwebjsLinuxProcessStat }
  | { pid: number; status: 'absent' }
  | { pid: number; status: 'unreadable' };

export interface WwebjsLinuxProcessGroupClassification {
  knownUnreadableMemberDetected: boolean;
  liveMemberDetected: boolean;
  reusedProcessGroupDetected: boolean;
  terminalSignature: string;
  observedMembers: WwebjsLinuxProcessStat[];
}

export interface WwebjsTrustedExecutableIdentity {
  canonicalPath: string;
  device: string;
  inode: string;
}

export interface WwebjsExecutableTransitionPolicy {
  wrapper: WwebjsTrustedExecutableIdentity;
  interpreter: WwebjsTrustedExecutableIdentity;
  chromiumTargets: WwebjsTrustedExecutableIdentity[];
}

interface WwebjsAllowlistedExecutable extends WwebjsTrustedExecutableIdentity {
  configuredPath: string;
}

export interface WwebjsBrowserLaunchMetadata {
  executablePath?: string;
  args: string[];
}

export interface WwebjsLinuxProcessIdentity extends WwebjsLinuxProcessStat {
  executablePath: string;
  executableDevice: string;
  executableInode: string;
  commandLine: string[];
}

export interface WwebjsOwnedBrowserProcess {
  childProcess: ChildProcess;
  identity?: WwebjsLinuxProcessIdentity;
  executableTransitionPolicy?: WwebjsExecutableTransitionPolicy;
  launch: WwebjsBrowserLaunchMetadata;
  commandOwnershipMarker?: string;
  identityCaptureError?: string;
  killRequested: boolean;
  exitObserved: boolean;
  closeObserved: boolean;
  terminationConfirmed: boolean;
  observedProcessGroupMembers: Map<number, string>;
}

export interface WwebjsBrowserLaunchOwner {
  registerBrowserProcess: (process: WwebjsOwnedBrowserProcess) => void;
  browserProcessIdentityCaptured?: (process: WwebjsOwnedBrowserProcess) => void;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getErrorCode(error: unknown): string | undefined {
  return (typeof error === 'object' || typeof error === 'function') &&
    error !== null &&
    'code' in error
    ? String(error.code)
    : undefined;
}

function parseLinuxProcessStat(
  pid: number,
  stat: string
): WwebjsLinuxProcessStat {
  const commandEnd = stat.lastIndexOf(')');
  if (commandEnd < 0) {
    throw new Error(`wwebjs_browser_process_stat_invalid:${pid}`);
  }

  const fieldsAfterCommand = stat
    .slice(commandEnd + 1)
    .trim()
    .split(/\s+/);
  const processState = fieldsAfterCommand[0];
  const parentPid = Number(fieldsAfterCommand[1]);
  const processGroupId = Number(fieldsAfterCommand[2]);
  const sessionId = Number(fieldsAfterCommand[3]);
  const startTimeTicks = fieldsAfterCommand[19];
  if (
    !processState ||
    !/^[RSDZTWXxKPIt]$/.test(processState) ||
    !Number.isSafeInteger(parentPid) ||
    !Number.isSafeInteger(processGroupId) ||
    !Number.isSafeInteger(sessionId) ||
    !startTimeTicks
  ) {
    throw new Error(`wwebjs_browser_process_stat_incomplete:${pid}`);
  }

  return {
    pid,
    parentPid,
    processGroupId,
    sessionId,
    processState,
    startTimeTicks,
  };
}

function readLinuxProcessStatSnapshot(
  pid: number
): WwebjsLinuxProcessStatSnapshot {
  try {
    return {
      pid,
      status: 'present',
      stat: parseLinuxProcessStat(
        pid,
        fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
      ),
    };
  } catch (error) {
    const errorCode = getErrorCode(error);
    return errorCode === 'ENOENT' || errorCode === 'ESRCH'
      ? { pid, status: 'absent' }
      : { pid, status: 'unreadable' };
  }
}

function readExecutablePrefix(executablePath: string, length: number): Buffer {
  const handle = fs.openSync(executablePath, 'r');
  try {
    const prefix = Buffer.alloc(length);
    const bytesRead = fs.readSync(handle, prefix, 0, length, 0);
    return prefix.subarray(0, bytesRead);
  } finally {
    fs.closeSync(handle);
  }
}

function hasTrustedExecutableOwner(ownerUid: bigint): boolean {
  const effectiveUid = process.geteuid?.();
  if (effectiveUid === undefined) {
    return false;
  }
  return effectiveUid === 0
    ? ownerUid === 0n
    : ownerUid !== BigInt(effectiveUid);
}

function inspectTrustedExecutable(
  configuredPath: string,
  requireElf: boolean
): WwebjsAllowlistedExecutable | undefined {
  if (!path.isAbsolute(configuredPath)) {
    return undefined;
  }

  try {
    const normalizedPath = path.normalize(configuredPath);
    const canonicalPath = fs.realpathSync(normalizedPath);
    const stats = fs.statSync(canonicalPath, { bigint: true });
    if (
      !stats.isFile() ||
      (stats.mode & 0o111n) === 0n ||
      (stats.mode & 0o022n) !== 0n ||
      !hasTrustedExecutableOwner(stats.uid)
    ) {
      return undefined;
    }
    if (
      requireElf &&
      !readExecutablePrefix(canonicalPath, ELF_MAGIC.length).equals(ELF_MAGIC)
    ) {
      return undefined;
    }
    return {
      configuredPath: normalizedPath,
      canonicalPath,
      device: stats.dev.toString(),
      inode: stats.ino.toString(),
    };
  } catch {
    return undefined;
  }
}

function configuredExecutablePaths(environmentName: string): string[] {
  const configured = process.env[environmentName];
  if (configured === undefined || configured.trim() === '') {
    return [];
  }
  const paths = configured.split(path.delimiter).map((value) => value.trim());
  if (
    paths.some(
      (configuredPath) =>
        configuredPath === '' || !path.isAbsolute(configuredPath)
    )
  ) {
    throw new Error(
      `wwebjs_browser_executable_allowlist_invalid:${environmentName}`
    );
  }
  return paths;
}

function loadExecutableAllowlist(
  defaults: readonly string[],
  environmentName: string,
  requireElf: boolean
): WwebjsAllowlistedExecutable[] {
  const configured = configuredExecutablePaths(environmentName);
  const defaultsFound = defaults
    .map((executablePath) =>
      inspectTrustedExecutable(executablePath, requireElf)
    )
    .filter(
      (executable): executable is WwebjsAllowlistedExecutable =>
        executable !== undefined
    );
  const configuredFound = configured.map((executablePath) => {
    const executable = inspectTrustedExecutable(executablePath, requireElf);
    if (!executable) {
      throw new Error(
        `wwebjs_browser_executable_allowlist_unsafe:${environmentName}:${executablePath}`
      );
    }
    return executable;
  });
  const unique = new Map<string, WwebjsAllowlistedExecutable>();
  for (const executable of [...defaultsFound, ...configuredFound]) {
    const key = `${executable.configuredPath}:${executable.device}:${executable.inode}`;
    unique.set(key, executable);
  }
  return [...unique.values()];
}

function readWrapperInterpreterPath(
  wrapper: WwebjsTrustedExecutableIdentity
): string | undefined {
  const firstLine = readExecutablePrefix(wrapper.canonicalPath, 512)
    .toString('utf8')
    .split(/\r?\n/, 1)[0];
  const match = /^#!\s*(\/[^\s]+)(?:\s+.*)?$/.exec(firstLine ?? '');
  return match?.[1];
}

function hasExactTrustedExecutableIdentity(
  processIdentity: WwebjsLinuxProcessIdentity,
  executable: WwebjsTrustedExecutableIdentity
): boolean {
  return (
    processIdentity.executablePath === executable.canonicalPath &&
    processIdentity.executableDevice === executable.device &&
    processIdentity.executableInode === executable.inode
  );
}

function createExecutableTransitionPolicy(
  launchExecutablePath: string | undefined,
  captured: WwebjsLinuxProcessIdentity
): WwebjsExecutableTransitionPolicy | undefined {
  if (!launchExecutablePath || !path.isAbsolute(launchExecutablePath)) {
    return undefined;
  }
  const normalizedLaunchPath = path.normalize(launchExecutablePath);
  const wrappers = loadExecutableAllowlist(
    DEFAULT_WRAPPER_EXECUTABLE_PATHS,
    WRAPPER_EXECUTABLE_ALLOWLIST_ENV,
    false
  );
  const wrapper = wrappers.find(
    (candidate) => candidate.configuredPath === normalizedLaunchPath
  );
  if (!wrapper) {
    return undefined;
  }
  if (
    readExecutablePrefix(wrapper.canonicalPath, ELF_MAGIC.length).equals(
      ELF_MAGIC
    )
  ) {
    return undefined;
  }

  const interpreterPath = readWrapperInterpreterPath(wrapper);
  const interpreter = interpreterPath
    ? inspectTrustedExecutable(interpreterPath, true)
    : undefined;
  const chromiumTargets = loadExecutableAllowlist(
    DEFAULT_CHROMIUM_EXECUTABLE_PATHS,
    CHROMIUM_EXECUTABLE_ALLOWLIST_ENV,
    true
  );
  if (!interpreter || chromiumTargets.length === 0) {
    throw new Error('wwebjs_browser_exec_transition_policy_incomplete');
  }
  if (
    !hasExactTrustedExecutableIdentity(captured, interpreter) &&
    !chromiumTargets.some((target) =>
      hasExactTrustedExecutableIdentity(captured, target)
    )
  ) {
    throw new Error(
      `wwebjs_browser_exec_transition_capture_unsafe:${captured.executablePath}`
    );
  }
  return {
    wrapper,
    interpreter,
    chromiumTargets,
  };
}

function readLinuxProcessIdentity(
  pid: number
): WwebjsLinuxProcessIdentity | undefined {
  if (process.platform !== 'linux' || pid <= 1 || pid === process.pid) {
    return undefined;
  }

  try {
    const processPath = `/proc/${pid}`;
    const parsed = parseLinuxProcessStat(
      pid,
      fs.readFileSync(path.join(processPath, 'stat'), 'utf8')
    );
    const executablePath = fs.readlinkSync(path.join(processPath, 'exe'));
    const executableStats = fs.statSync(path.join(processPath, 'exe'), {
      bigint: true,
    });
    const commandLine = fs
      .readFileSync(path.join(processPath, 'cmdline'))
      .toString('utf8')
      .split('\0')
      .filter(Boolean);
    const confirmed = parseLinuxProcessStat(
      pid,
      fs.readFileSync(path.join(processPath, 'stat'), 'utf8')
    );
    if (
      confirmed.parentPid !== parsed.parentPid ||
      confirmed.processGroupId !== parsed.processGroupId ||
      confirmed.sessionId !== parsed.sessionId ||
      confirmed.startTimeTicks !== parsed.startTimeTicks
    ) {
      return undefined;
    }
    return {
      ...confirmed,
      executablePath,
      executableDevice: executableStats.dev.toString(),
      executableInode: executableStats.ino.toString(),
      commandLine,
    };
  } catch {
    return undefined;
  }
}

function stripMatchingQuotes(value: string): string {
  const trimmed = value.trim();
  const first = trimmed.at(0);
  const last = trimmed.at(-1);
  if (
    trimmed.length >= 2 &&
    ((first === '"' && last === '"') || (first === "'" && last === "'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function extractUserDataDirFromCompactedArgument(argument: string): string[] {
  const matches = argument.matchAll(
    /(?:^|\s)--user-data-dir(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))(?=$|\s)/g
  );
  return [...matches]
    .map((match) => match[1] ?? match[2] ?? match[3])
    .filter((value): value is string => value !== undefined)
    .map(stripMatchingQuotes);
}

function extractCommandOwnershipMarkers(args: string[]): string[] {
  const markers: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === USER_DATA_DIR_ARGUMENT) {
      const value = args[index + 1];
      if (value !== undefined) {
        markers.push(stripMatchingQuotes(value));
      }
      continue;
    }
    if (argument.startsWith(`${USER_DATA_DIR_ARGUMENT}=`)) {
      markers.push(
        stripMatchingQuotes(argument.slice(USER_DATA_DIR_ARGUMENT.length + 1))
      );
      continue;
    }

    markers.push(...extractUserDataDirFromCompactedArgument(argument));
  }
  return markers;
}

function findCommandOwnershipMarker(args: string[]): string | undefined {
  const markers = extractCommandOwnershipMarkers(args);
  return markers.length === 1 && markers[0] ? markers[0] : undefined;
}

function hasExactCommandOwnershipMarker(
  commandLine: string[],
  expectedMarker: string
): boolean {
  return extractCommandOwnershipMarkers(commandLine).includes(expectedMarker);
}

function waitForProcIdentityRetry(): void {
  const retryGate = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(retryGate, 0, 0, 5);
}

function captureLinuxProcessIdentity(
  pid: number,
  expectedMarker?: string
): WwebjsLinuxProcessIdentity | undefined {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const identity = readLinuxProcessIdentity(pid);
    if (
      identity &&
      (expectedMarker === undefined ||
        hasExactCommandOwnershipMarker(identity.commandLine, expectedMarker))
    ) {
      return identity;
    }
    waitForProcIdentityRetry();
  }
  return undefined;
}

function hasSameExecutableIdentity(
  captured: WwebjsLinuxProcessIdentity,
  current: WwebjsLinuxProcessIdentity
): boolean {
  return (
    current.executablePath === captured.executablePath &&
    current.executableDevice === captured.executableDevice &&
    current.executableInode === captured.executableInode
  );
}

function isAllowlistedWrapperExecTransition(
  owned: WwebjsOwnedBrowserProcess,
  captured: WwebjsLinuxProcessIdentity,
  current: WwebjsLinuxProcessIdentity
): boolean {
  const policy = owned.executableTransitionPolicy;
  return Boolean(
    policy &&
    hasExactTrustedExecutableIdentity(captured, policy.interpreter) &&
    policy.chromiumTargets.some((target) =>
      hasExactTrustedExecutableIdentity(current, target)
    )
  );
}

function isIsolatedProcessSessionLeader(
  identity: WwebjsLinuxProcessStat
): boolean {
  return (
    identity.pid > 1 &&
    identity.processGroupId === identity.pid &&
    identity.sessionId === identity.pid
  );
}

export function isWwebjsOwnedBrowserProcessIdentityCurrent(
  owned: WwebjsOwnedBrowserProcess,
  current: WwebjsLinuxProcessIdentity
): boolean {
  const captured = owned.identity;
  const marker = owned.commandOwnershipMarker;
  return Boolean(
    captured &&
    marker &&
    isIsolatedProcessSessionLeader(captured) &&
    isIsolatedProcessSessionLeader(current) &&
    current.pid === captured.pid &&
    current.parentPid === captured.parentPid &&
    current.processGroupId === captured.processGroupId &&
    current.sessionId === captured.sessionId &&
    current.startTimeTicks === captured.startTimeTicks &&
    (hasSameExecutableIdentity(captured, current) ||
      isAllowlistedWrapperExecTransition(owned, captured, current)) &&
    hasExactCommandOwnershipMarker(current.commandLine, marker)
  );
}

function isTerminalLinuxProcessState(processState: string): boolean {
  return processState === 'Z' || processState === 'X' || processState === 'x';
}

export function classifyWwebjsLinuxProcessGroupSnapshot(
  processGroupId: number,
  sessionId: number,
  knownMembers: ReadonlyMap<number, string>,
  snapshots: readonly WwebjsLinuxProcessStatSnapshot[]
): WwebjsLinuxProcessGroupClassification {
  let knownUnreadableMemberDetected = false;
  let liveMemberDetected = false;
  let reusedProcessGroupDetected = false;
  const observedMembers: WwebjsLinuxProcessStat[] = [];
  const terminalMembers: string[] = [];

  for (const snapshot of snapshots) {
    if (snapshot.status === 'unreadable') {
      if (knownMembers.has(snapshot.pid)) {
        knownUnreadableMemberDetected = true;
      }
      continue;
    }
    if (
      snapshot.status === 'absent' ||
      snapshot.stat.processGroupId !== processGroupId
    ) {
      continue;
    }
    if (snapshot.stat.sessionId !== sessionId) {
      reusedProcessGroupDetected = true;
      continue;
    }

    observedMembers.push(snapshot.stat);
    if (isTerminalLinuxProcessState(snapshot.stat.processState)) {
      terminalMembers.push(
        `${snapshot.stat.pid}:${snapshot.stat.startTimeTicks}:${snapshot.stat.processState}`
      );
    } else {
      liveMemberDetected = true;
    }
  }

  terminalMembers.sort();
  return {
    knownUnreadableMemberDetected,
    liveMemberDetected,
    reusedProcessGroupDetected,
    terminalSignature: terminalMembers.join('|'),
    observedMembers,
  };
}

export function reconcileWwebjsObservedProcessGroupMembers(
  processGroupId: number,
  sessionId: number,
  knownMembers: Map<number, string>,
  snapshots: readonly WwebjsLinuxProcessStatSnapshot[]
): void {
  for (const snapshot of snapshots) {
    const knownStartTime = knownMembers.get(snapshot.pid);
    if (knownStartTime === undefined || snapshot.status === 'unreadable') {
      continue;
    }
    if (
      snapshot.status === 'absent' ||
      snapshot.stat.startTimeTicks !== knownStartTime ||
      snapshot.stat.processGroupId !== processGroupId ||
      snapshot.stat.sessionId !== sessionId
    ) {
      knownMembers.delete(snapshot.pid);
    }
  }
}

export function areWwebjsTerminalProcessGroupSnapshotsStable(
  first: WwebjsLinuxProcessGroupClassification,
  second: WwebjsLinuxProcessGroupClassification
): boolean {
  if (first.reusedProcessGroupDetected || second.reusedProcessGroupDetected) {
    return (
      first.reusedProcessGroupDetected && second.reusedProcessGroupDetected
    );
  }
  return (
    first.terminalSignature !== '' &&
    first.terminalSignature === second.terminalSignature
  );
}

function readLinuxProcessGroupClassification(
  identity: WwebjsLinuxProcessIdentity,
  knownMembers: Map<number, string>
): WwebjsLinuxProcessGroupClassification | undefined {
  let processEntries: string[];
  try {
    processEntries = fs.readdirSync('/proc');
  } catch {
    return undefined;
  }

  const processIds = processEntries
    .filter((entry) => /^\d+$/.test(entry))
    .map(Number);
  const listedProcessIds = new Set(processIds);
  for (const knownPid of knownMembers.keys()) {
    if (!listedProcessIds.has(knownPid)) {
      knownMembers.delete(knownPid);
    }
  }
  const snapshots = processIds.map(readLinuxProcessStatSnapshot);
  reconcileWwebjsObservedProcessGroupMembers(
    identity.processGroupId,
    identity.sessionId,
    knownMembers,
    snapshots
  );
  const classification = classifyWwebjsLinuxProcessGroupSnapshot(
    identity.processGroupId,
    identity.sessionId,
    knownMembers,
    snapshots
  );
  for (const member of classification.observedMembers) {
    knownMembers.set(member.pid, member.startTimeTicks);
  }
  return classification;
}

function linuxProcessGroupPresence(
  processGroupId: number
): 'present' | 'absent' | 'unknown' {
  if (process.platform !== 'linux' || processGroupId <= 1) {
    return 'unknown';
  }
  try {
    process.kill(-processGroupId, 0);
    return 'present';
  } catch (error) {
    const errorCode = getErrorCode(error);
    if (errorCode === 'ESRCH') {
      return 'absent';
    }
    if (errorCode === 'EPERM') {
      return 'present';
    }
    return 'unknown';
  }
}

function markerPresence(
  marker: string | undefined
): 'present' | 'absent' | 'unknown' {
  if (!marker || process.platform !== 'linux') {
    return 'unknown';
  }

  let processEntries: string[];
  try {
    processEntries = fs.readdirSync('/proc');
  } catch {
    return 'unknown';
  }

  for (const entry of processEntries) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    try {
      const commandLine = fs
        .readFileSync(`/proc/${entry}/cmdline`)
        .toString('utf8')
        .split('\0')
        .filter(Boolean);
      if (hasExactCommandOwnershipMarker(commandLine, marker)) {
        return 'present';
      }
    } catch (error) {
      if (getErrorCode(error) !== 'ENOENT') {
        return 'unknown';
      }
    }
  }
  return 'absent';
}

function confirmOwnedLinuxProcessGroupTerminated(
  owned: WwebjsOwnedBrowserProcess,
  identity: WwebjsLinuxProcessIdentity
): boolean {
  const initialPresence = linuxProcessGroupPresence(identity.processGroupId);
  if (initialPresence === 'absent') {
    return true;
  }
  if (initialPresence === 'unknown') {
    return false;
  }

  const first = readLinuxProcessGroupClassification(
    identity,
    owned.observedProcessGroupMembers
  );
  if (
    !first ||
    first.knownUnreadableMemberDetected ||
    first.liveMemberDetected
  ) {
    return false;
  }

  waitForProcIdentityRetry();
  const second = readLinuxProcessGroupClassification(
    identity,
    owned.observedProcessGroupMembers
  );
  if (
    !second ||
    second.knownUnreadableMemberDetected ||
    second.liveMemberDetected
  ) {
    return false;
  }

  const finalPresence = linuxProcessGroupPresence(identity.processGroupId);
  if (finalPresence === 'absent') {
    return true;
  }
  if (finalPresence === 'unknown') {
    return false;
  }
  return areWwebjsTerminalProcessGroupSnapshotsStable(first, second);
}

function observeExactChildProcess(owned: WwebjsOwnedBrowserProcess): void {
  owned.childProcess.once('exit', () => {
    owned.exitObserved = true;
  });
  owned.childProcess.once('close', () => {
    owned.closeObserved = true;
  });
}

function createWwebjsOwnedBrowserProcessTracker(
  childProcess: ChildProcess,
  launch: WwebjsBrowserLaunchMetadata
): WwebjsOwnedBrowserProcess {
  const owned: WwebjsOwnedBrowserProcess = {
    childProcess,
    launch,
    commandOwnershipMarker: findCommandOwnershipMarker(launch.args),
    killRequested: false,
    exitObserved: false,
    closeObserved: false,
    terminationConfirmed: false,
    observedProcessGroupMembers: new Map(),
  };
  observeExactChildProcess(owned);
  return owned;
}

function captureWwebjsOwnedBrowserProcessIdentity(
  owned: WwebjsOwnedBrowserProcess
): void {
  const pid = owned.childProcess.pid;
  if (!pid || pid <= 1 || pid === process.pid) {
    throw new Error('wwebjs_browser_process_pid_invalid');
  }
  if (process.platform !== 'linux') {
    throw new Error('wwebjs_browser_process_ownership_requires_linux');
  }
  if (!owned.commandOwnershipMarker) {
    throw new Error(`wwebjs_browser_process_marker_missing:${pid}`);
  }

  const identity = captureLinuxProcessIdentity(
    pid,
    owned.commandOwnershipMarker
  );
  if (!identity) {
    throw new Error(`wwebjs_browser_process_identity_unavailable:${pid}`);
  }
  if (
    identity.parentPid !== process.pid ||
    !isIsolatedProcessSessionLeader(identity) ||
    !hasExactCommandOwnershipMarker(
      identity.commandLine,
      owned.commandOwnershipMarker
    )
  ) {
    throw new Error(
      `wwebjs_browser_process_identity_unsafe:${pid}:${identity.parentPid}:${identity.processGroupId}:${identity.sessionId}`
    );
  }

  const executableTransitionPolicy = createExecutableTransitionPolicy(
    owned.launch.executablePath,
    identity
  );
  owned.identity = identity;
  owned.executableTransitionPolicy = executableTransitionPolicy;
  owned.observedProcessGroupMembers.set(identity.pid, identity.startTimeTicks);
}

function requestImmediateSpawnTermination(
  browserProcess: PuppeteerBrowserProcess,
  owned: WwebjsOwnedBrowserProcess
): void {
  try {
    browserProcess.kill?.();
    owned.killRequested = true;
    return;
  } catch {}

  try {
    owned.killRequested = owned.childProcess.kill('SIGKILL');
  } catch {}
}

export function captureWwebjsOwnedBrowserProcess(
  childProcess: ChildProcess,
  launch: WwebjsBrowserLaunchMetadata
): WwebjsOwnedBrowserProcess {
  const owned = createWwebjsOwnedBrowserProcessTracker(childProcess, launch);
  try {
    captureWwebjsOwnedBrowserProcessIdentity(owned);
  } catch (error) {
    owned.identityCaptureError = getErrorMessage(error);
    try {
      owned.killRequested = childProcess.kill('SIGKILL');
    } catch {}
  }
  return owned;
}

export function requestWwebjsOwnedBrowserProcessTermination(
  owned: WwebjsOwnedBrowserProcess
): boolean {
  if (isWwebjsOwnedBrowserProcessTerminated(owned)) {
    return true;
  }

  const identity = owned.identity;
  if (!identity) {
    return false;
  }

  readLinuxProcessGroupClassification(
    identity,
    owned.observedProcessGroupMembers
  );

  const currentRoot = readLinuxProcessIdentity(identity.pid);
  if (
    !currentRoot ||
    !isWwebjsOwnedBrowserProcessIdentityCurrent(owned, currentRoot)
  ) {
    return false;
  }

  // Puppeteer launches detached on Linux. A root with PID = PGID = SID owns a
  // new session, and Linux forbids processes from another session joining its
  // process group. Revalidating that exact root is therefore stronger than a
  // racy scan of every unrelated PID in /proc.
  try {
    process.kill(-identity.processGroupId, 'SIGKILL');
    owned.killRequested = true;
    return true;
  } catch {
    return isWwebjsOwnedBrowserProcessTerminated(owned);
  }
}

export function isWwebjsOwnedBrowserProcessTerminated(
  owned: WwebjsOwnedBrowserProcess
): boolean {
  if (owned.terminationConfirmed) {
    return true;
  }
  if (!owned.exitObserved && !owned.closeObserved) {
    return false;
  }
  let terminationConfirmed: boolean;
  if (owned.identity) {
    terminationConfirmed = confirmOwnedLinuxProcessGroupTerminated(
      owned,
      owned.identity
    );
  } else {
    terminationConfirmed =
      markerPresence(owned.commandOwnershipMarker) === 'absent';
  }
  owned.terminationConfirmed = terminationConfirmed;
  return terminationConfirmed;
}

function installPuppeteerBrowserLaunchOwnershipPatch(): WwebjsBrowserLaunchPatchState {
  const runtimeRequire = createRequire(
    path.join(process.cwd(), '.wwebjs-browser-process-ownership.cjs')
  );
  const wwebjsEntry = runtimeRequire.resolve('@wwebjs/whatsapp-web.js');
  const wwebjsRequire = createRequire(wwebjsEntry);
  const puppeteerEntry = wwebjsRequire.resolve('puppeteer');
  const puppeteerRequire = createRequire(puppeteerEntry);
  const browsersModule = puppeteerRequire(
    '@puppeteer/browsers'
  ) as PuppeteerBrowsersModule;
  const installed = browsersModule[WWEBJS_BROWSER_LAUNCH_PATCH];
  if (installed) {
    return installed;
  }

  const originalLaunch = browsersModule.launch;
  const ownershipScope = new AsyncLocalStorage<WwebjsBrowserLaunchOwner>();
  const state: WwebjsBrowserLaunchPatchState = {
    originalLaunch,
    ownershipScope,
  };
  const wrappedLaunch: PuppeteerBrowsersModule['launch'] = function (options) {
    const browserProcess = originalLaunch.call(browsersModule, options);
    const owner = ownershipScope.getStore();
    const childProcess = browserProcess.nodeProcess;
    if (!owner || !childProcess) {
      return browserProcess;
    }

    const owned = createWwebjsOwnedBrowserProcessTracker(childProcess, {
      executablePath: options.executablePath,
      args: [...(options.args ?? [])],
    });
    try {
      owner.registerBrowserProcess(owned);
      captureWwebjsOwnedBrowserProcessIdentity(owned);
      owner.browserProcessIdentityCaptured?.(owned);
    } catch (error) {
      owned.identityCaptureError = getErrorMessage(error);
      requestImmediateSpawnTermination(browserProcess, owned);
      throw error;
    }
    return browserProcess;
  };

  Object.defineProperty(browsersModule, 'launch', {
    configurable: true,
    enumerable: true,
    value: wrappedLaunch,
    writable: false,
  });
  Object.defineProperty(browsersModule, WWEBJS_BROWSER_LAUNCH_PATCH, {
    configurable: false,
    enumerable: false,
    value: state,
    writable: false,
  });
  return state;
}

const browserLaunchPatchState = installPuppeteerBrowserLaunchOwnershipPatch();

export function runWithWwebjsBrowserLaunchOwner<T>(
  owner: WwebjsBrowserLaunchOwner,
  launch: () => T
): T {
  return browserLaunchPatchState.ownershipScope.run(owner, launch);
}
