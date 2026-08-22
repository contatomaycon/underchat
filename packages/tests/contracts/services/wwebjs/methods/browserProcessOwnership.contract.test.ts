import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  areWwebjsTerminalProcessGroupSnapshotsStable,
  captureWwebjsOwnedBrowserProcess,
  classifyWwebjsLinuxProcessGroupSnapshot,
  isWwebjsOwnedBrowserProcessTerminated,
  isWwebjsOwnedBrowserProcessIdentityCurrent,
  requestWwebjsOwnedBrowserProcessTermination,
  reconcileWwebjsObservedProcessGroupMembers,
  runWithWwebjsBrowserLaunchOwner,
  type WwebjsExecutableTransitionPolicy,
  type WwebjsLinuxProcessIdentity,
  type WwebjsLinuxProcessStat,
  type WwebjsLinuxProcessStatSnapshot,
  type WwebjsOwnedBrowserProcess,
} from '@core/services/wwebjs/methods/browserProcessOwnership';

interface PuppeteerBrowserProcess {
  nodeProcess: ChildProcess;
  kill: () => void;
}

interface PuppeteerBrowsersModule {
  launch: (options: {
    executablePath: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    handleSIGINT: boolean;
    handleSIGTERM: boolean;
    handleSIGHUP: boolean;
  }) => PuppeteerBrowserProcess;
}

const runtimeRequire = createRequire(
  path.join(process.cwd(), '.wwebjs-browser-ownership-test.cjs')
);
const puppeteerBrowsers = runtimeRequire(
  '@puppeteer/browsers'
) as PuppeteerBrowsersModule;

function ownershipMarker(): string {
  return `/tmp/underchat-wwebjs-launch-${Date.now()}-${Math.random()}`;
}

function simulatedIdentity(
  overrides: Partial<WwebjsLinuxProcessIdentity> = {}
): WwebjsLinuxProcessIdentity {
  return {
    pid: 4100,
    parentPid: process.pid,
    processGroupId: 4100,
    sessionId: 4100,
    processState: 'S',
    startTimeTicks: '991122',
    executablePath: '/usr/bin/bash',
    executableDevice: '8',
    executableInode: '100',
    commandLine: [
      '/usr/bin/google-chrome-stable',
      `--user-data-dir=${ownershipMarker()}`,
    ],
    ...overrides,
  };
}

function launchRawTestBrowserProcess(
  markerArgument = `--user-data-dir=${ownershipMarker()}`
): PuppeteerBrowserProcess {
  return puppeteerBrowsers.launch({
    executablePath: '/bin/sh',
    args: ['-c', 'while :; do sleep 60; done', 'wwebjs-test', markerArgument],
    env: process.env,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
}

function launchTestBrowserProcess(
  registerBrowserProcess: (process: WwebjsOwnedBrowserProcess) => void
): PuppeteerBrowserProcess {
  return runWithWwebjsBrowserLaunchOwner({ registerBrowserProcess }, () =>
    launchRawTestBrowserProcess()
  );
}

async function waitForChildExit(childProcess: ChildProcess): Promise<void> {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    childProcess.once('exit', () => resolve());
  });
}

async function waitForExecutablePath(
  pid: number,
  expectedPath: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 10_000;
    const poll = setInterval(() => {
      try {
        if (fs.readlinkSync(`/proc/${pid}/exe`) === expectedPath) {
          clearInterval(poll);
          resolve();
          return;
        }
      } catch {}
      if (Date.now() >= deadline) {
        clearInterval(poll);
        reject(new Error(`executable transition timeout:${pid}`));
      }
    }, 10);
  });
}

function readLinuxProcessGroup(
  processGroupId: number
): WwebjsLinuxProcessStat[] {
  const members: WwebjsLinuxProcessStat[] = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    try {
      const pid = Number(entry);
      const rawStat = fs.readFileSync(`/proc/${entry}/stat`, 'utf8');
      const commandEnd = rawStat.lastIndexOf(')');
      const fields = rawStat
        .slice(commandEnd + 1)
        .trim()
        .split(/\s+/);
      const member = {
        pid,
        processState: fields[0] as string,
        parentPid: Number(fields[1]),
        processGroupId: Number(fields[2]),
        sessionId: Number(fields[3]),
        startTimeTicks: fields[19] as string,
      };
      if (member.processGroupId === processGroupId) {
        members.push(member);
      }
    } catch {}
  }
  return members;
}

async function waitForProcessGroupReaped(
  processGroupId: number
): Promise<void> {
  const deadline = Date.now() + 10_000;
  let members = readLinuxProcessGroup(processGroupId);
  while (members.length > 0 && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    members = readLinuxProcessGroup(processGroupId);
  }
  if (members.length > 0) {
    throw new Error(
      `process group not reaped:${processGroupId}:${JSON.stringify(members)}`
    );
  }
}

async function waitForOwnedBrowserTermination(
  owned: WwebjsOwnedBrowserProcess
): Promise<void> {
  const deadline = Date.now() + 4_000;
  while (
    !isWwebjsOwnedBrowserProcessTerminated(owned) &&
    Date.now() < deadline
  ) {
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  if (!isWwebjsOwnedBrowserProcessTerminated(owned)) {
    let groupProbe: string | boolean = 'no_identity';
    if (owned.identity) {
      try {
        groupProbe = process.kill(-owned.identity.processGroupId, 0);
      } catch (error) {
        groupProbe =
          error instanceof Error && 'code' in error
            ? String(error.code)
            : String(error);
      }
    }
    throw new Error(
      `owned browser process did not reach terminated state:${JSON.stringify({
        closeObserved: owned.closeObserved,
        exitObserved: owned.exitObserved,
        groupProbe,
        groupMembers: owned.identity
          ? readLinuxProcessGroup(owned.identity.processGroupId)
          : [],
        identity: owned.identity,
      })}`
    );
  }
}

function requireCapturedIdentity(
  owned: WwebjsOwnedBrowserProcess
): WwebjsLinuxProcessIdentity {
  if (!owned.identity) {
    throw new Error(owned.identityCaptureError ?? 'identity not captured');
  }
  return owned.identity;
}

async function terminateTrackedBrowser(
  launched: PuppeteerBrowserProcess,
  owned: WwebjsOwnedBrowserProcess
): Promise<void> {
  if (!isWwebjsOwnedBrowserProcessTerminated(owned)) {
    requestWwebjsOwnedBrowserProcessTermination(owned);
  }
  if (
    launched.nodeProcess.exitCode === null &&
    launched.nodeProcess.signalCode === null
  ) {
    try {
      launched.kill();
    } catch {}
  }
  await waitForChildExit(launched.nodeProcess);
}

function runAsyncOwnedLaunch(
  registerBrowserProcess: (process: WwebjsOwnedBrowserProcess) => void
): Promise<PuppeteerBrowserProcess> {
  return runWithWwebjsBrowserLaunchOwner(
    { registerBrowserProcess },
    () =>
      new Promise<PuppeteerBrowserProcess>((resolve, reject) => {
        setImmediate(() => {
          try {
            resolve(launchRawTestBrowserProcess());
          } catch (error) {
            reject(error);
          }
        });
      })
  );
}

describe('WWebJS browser process ownership', () => {
  it('classifies only proven members when confirming an isolated process group', () => {
    const root = simulatedIdentity();
    const knownMembers = new Map([
      [root.pid, root.startTimeTicks],
      [root.pid + 1, '991123'],
    ]);
    const present = (
      stat: WwebjsLinuxProcessStat
    ): WwebjsLinuxProcessStatSnapshot => ({
      pid: stat.pid,
      status: 'present',
      stat,
    });

    const terminal = classifyWwebjsLinuxProcessGroupSnapshot(
      root.processGroupId,
      root.sessionId,
      knownMembers,
      [
        present({
          ...root,
          processState: 'Z',
        }),
        {
          pid: 9999,
          status: 'unreadable',
        },
      ]
    );
    expect(terminal).toMatchObject({
      knownUnreadableMemberDetected: false,
      liveMemberDetected: false,
      reusedProcessGroupDetected: false,
    });
    expect(terminal.terminalSignature).toContain(`${root.pid}:`);
    expect(
      areWwebjsTerminalProcessGroupSnapshotsStable(terminal, terminal)
    ).toBe(true);

    const live = classifyWwebjsLinuxProcessGroupSnapshot(
      root.processGroupId,
      root.sessionId,
      knownMembers,
      [
        present({
          ...root,
          pid: root.pid + 1,
          parentPid: root.pid,
          processState: 'D',
          startTimeTicks: '991123',
        }),
      ]
    );
    expect(live.liveMemberDetected).toBe(true);
    expect(
      classifyWwebjsLinuxProcessGroupSnapshot(
        root.processGroupId,
        root.sessionId,
        knownMembers,
        [
          present({
            ...root,
            pid: root.pid + 1,
            parentPid: root.pid,
            processState: 'S',
            startTimeTicks: '991123',
          }),
        ]
      ).liveMemberDetected
    ).toBe(true);

    const knownUnreadable = classifyWwebjsLinuxProcessGroupSnapshot(
      root.processGroupId,
      root.sessionId,
      knownMembers,
      [
        {
          pid: root.pid + 1,
          status: 'unreadable',
        },
      ]
    );
    expect(knownUnreadable.knownUnreadableMemberDetected).toBe(true);

    const unknownOnly = classifyWwebjsLinuxProcessGroupSnapshot(
      root.processGroupId,
      root.sessionId,
      knownMembers,
      [
        {
          pid: 9999,
          status: 'unreadable',
        },
      ]
    );
    expect(unknownOnly.terminalSignature).toBe('');
    expect(
      areWwebjsTerminalProcessGroupSnapshotsStable(unknownOnly, unknownOnly)
    ).toBe(false);

    const reused = classifyWwebjsLinuxProcessGroupSnapshot(
      root.processGroupId,
      root.sessionId,
      knownMembers,
      [
        present({
          ...root,
          sessionId: root.sessionId + 1,
        }),
      ]
    );
    expect(reused.reusedProcessGroupDetected).toBe(true);
    expect(reused.liveMemberDetected).toBe(false);
    expect(areWwebjsTerminalProcessGroupSnapshotsStable(reused, reused)).toBe(
      true
    );
    expect(
      areWwebjsTerminalProcessGroupSnapshotsStable(reused, unknownOnly)
    ).toBe(false);

    const retiredPid = root.pid + 1;
    reconcileWwebjsObservedProcessGroupMembers(
      root.processGroupId,
      root.sessionId,
      knownMembers,
      [
        present({
          ...root,
          pid: retiredPid,
          processGroupId: root.processGroupId + 1,
          sessionId: root.sessionId + 1,
          startTimeTicks: '991999',
        }),
      ]
    );
    expect(knownMembers.has(retiredPid)).toBe(false);
    expect(
      classifyWwebjsLinuxProcessGroupSnapshot(
        root.processGroupId,
        root.sessionId,
        knownMembers,
        [{ pid: retiredPid, status: 'unreadable' }]
      ).knownUnreadableMemberDetected
    ).toBe(false);
  });

  it('keeps confirmed termination monotonic across later group reuse and foreign markers', () => {
    const identity = simulatedIdentity();
    const owned = {
      childProcess: {} as ChildProcess,
      identity,
      launch: {
        executablePath: '/usr/bin/google-chrome-stable',
        args: identity.commandLine,
      },
      commandOwnershipMarker: '/tmp/foreign-wwebjs-marker',
      killRequested: true,
      exitObserved: true,
      closeObserved: true,
      terminationConfirmed: true,
      observedProcessGroupMembers: new Map([
        [identity.pid, identity.startTimeTicks],
      ]),
    } satisfies WwebjsOwnedBrowserProcess;
    const processKill = jest.spyOn(process, 'kill');
    try {
      expect(isWwebjsOwnedBrowserProcessTerminated(owned)).toBe(true);
      expect(processKill).not.toHaveBeenCalled();
    } finally {
      processKill.mockRestore();
    }
  });

  it('accepts only an exact allowlisted wrapper-to-Chromium exec transition', () => {
    const marker = ownershipMarker();
    const captured = simulatedIdentity({
      commandLine: [
        '/usr/bin/google-chrome-stable',
        `--user-data-dir=${marker}`,
      ],
    });
    const policy: WwebjsExecutableTransitionPolicy = {
      wrapper: {
        canonicalPath: '/opt/google/chrome/google-chrome',
        device: '8',
        inode: '90',
      },
      interpreter: {
        canonicalPath: '/usr/bin/bash',
        device: '8',
        inode: '100',
      },
      chromiumTargets: [
        {
          canonicalPath: '/opt/google/chrome/chrome',
          device: '8',
          inode: '200',
        },
      ],
    };
    const owned = {
      childProcess: {} as ChildProcess,
      identity: captured,
      executableTransitionPolicy: policy,
      launch: {
        executablePath: '/usr/bin/google-chrome-stable',
        args: [`--user-data-dir=${marker}`],
      },
      commandOwnershipMarker: marker,
      killRequested: false,
      exitObserved: false,
      closeObserved: false,
      terminationConfirmed: false,
      observedProcessGroupMembers: new Map([
        [captured.pid, captured.startTimeTicks],
      ]),
    } satisfies WwebjsOwnedBrowserProcess;
    const transitioned = simulatedIdentity({
      executablePath: '/opt/google/chrome/chrome',
      executableDevice: '8',
      executableInode: '200',
      commandLine: ['/opt/google/chrome/chrome', `--user-data-dir=${marker}`],
    });

    expect(
      isWwebjsOwnedBrowserProcessIdentityCurrent(owned, transitioned)
    ).toBe(true);
    expect(
      isWwebjsOwnedBrowserProcessIdentityCurrent(owned, {
        ...transitioned,
        startTimeTicks: '991123',
      })
    ).toBe(false);
    expect(
      isWwebjsOwnedBrowserProcessIdentityCurrent(owned, {
        ...transitioned,
        parentPid: process.pid + 1,
      })
    ).toBe(false);
    expect(
      isWwebjsOwnedBrowserProcessIdentityCurrent(owned, {
        ...transitioned,
        processGroupId: transitioned.processGroupId + 1,
      })
    ).toBe(false);
    expect(
      isWwebjsOwnedBrowserProcessIdentityCurrent(owned, {
        ...transitioned,
        sessionId: transitioned.sessionId + 1,
      })
    ).toBe(false);
    expect(
      isWwebjsOwnedBrowserProcessIdentityCurrent(owned, {
        ...transitioned,
        executableInode: '201',
      })
    ).toBe(false);
    expect(
      isWwebjsOwnedBrowserProcessIdentityCurrent(owned, {
        ...transitioned,
        executablePath: '/opt/google/chrome/chrome-malware',
      })
    ).toBe(false);
    expect(
      isWwebjsOwnedBrowserProcessIdentityCurrent(owned, {
        ...transitioned,
        executablePath: '/usr/bin/node',
        executableDevice: '8',
        executableInode: '300',
      })
    ).toBe(false);
    expect(
      isWwebjsOwnedBrowserProcessIdentityCurrent(owned, {
        ...transitioned,
        commandLine: [
          '/opt/google/chrome/chrome',
          `prefix--user-data-dir=${marker}`,
        ],
      })
    ).toBe(false);
  });

  const realChromeContract =
    process.platform === 'linux' &&
    fs.existsSync('/usr/bin/google-chrome-stable') &&
    fs.existsSync('/opt/google/chrome/chrome')
      ? it
      : it.skip;

  realChromeContract(
    'tracks the real google-chrome wrapper after it execs the pinned Chrome ELF',
    async () => {
      const profile = fs.mkdtempSync('/tmp/underchat-wwebjs-wrapper-');
      let ownedBrowserProcess: WwebjsOwnedBrowserProcess | undefined;
      let launched: PuppeteerBrowserProcess | undefined;
      try {
        launched = runWithWwebjsBrowserLaunchOwner(
          {
            registerBrowserProcess: (owned) => {
              ownedBrowserProcess = owned;
            },
          },
          () =>
            puppeteerBrowsers.launch({
              executablePath: '/usr/bin/google-chrome-stable',
              args: [
                '--headless=new',
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--remote-debugging-port=0',
                `--user-data-dir=${profile}`,
                'about:blank',
              ],
              env: process.env,
              handleSIGINT: false,
              handleSIGTERM: false,
              handleSIGHUP: false,
            })
        );
        const owned = ownedBrowserProcess as WwebjsOwnedBrowserProcess;
        const pid = owned.childProcess.pid as number;
        await waitForExecutablePath(pid, '/opt/google/chrome/chrome');
        const processGroupId = requireCapturedIdentity(owned).processGroupId;
        expect(owned.executableTransitionPolicy).toBeDefined();
        expect(requestWwebjsOwnedBrowserProcessTermination(owned)).toBe(true);
        await waitForChildExit(owned.childProcess);
        await waitForOwnedBrowserTermination(owned);
        expect(isWwebjsOwnedBrowserProcessTerminated(owned)).toBe(true);
        await waitForProcessGroupReaped(processGroupId);
        expect(readLinuxProcessGroup(processGroupId)).toHaveLength(0);
      } finally {
        if (launched && ownedBrowserProcess) {
          await terminateTrackedBrowser(launched, ownedBrowserProcess);
        }
        fs.rmSync(profile, { force: true, recursive: true });
      }
    }
  );

  it('registers the browser child synchronously from the Puppeteer launch boundary', async () => {
    let ownedBrowserProcess: WwebjsOwnedBrowserProcess | undefined;
    const launched = launchTestBrowserProcess((owned) => {
      ownedBrowserProcess = owned;
    });

    try {
      expect(ownedBrowserProcess).toBeDefined();
      expect(ownedBrowserProcess?.childProcess).toBe(launched.nodeProcess);
      const identity = requireCapturedIdentity(
        ownedBrowserProcess as WwebjsOwnedBrowserProcess
      );
      expect(identity.pid).toBe(launched.nodeProcess.pid);
      expect(identity.parentPid).toBe(process.pid);
      expect(identity.processGroupId).toBe(launched.nodeProcess.pid);
      expect(identity.sessionId).toBe(launched.nodeProcess.pid);

      expect(
        requestWwebjsOwnedBrowserProcessTermination(
          ownedBrowserProcess as WwebjsOwnedBrowserProcess
        )
      ).toBe(true);
      await waitForChildExit(launched.nodeProcess);
      await waitForOwnedBrowserTermination(
        ownedBrowserProcess as WwebjsOwnedBrowserProcess
      );
      expect(
        isWwebjsOwnedBrowserProcessTerminated(
          ownedBrowserProcess as WwebjsOwnedBrowserProcess
        )
      ).toBe(true);
    } finally {
      await terminateTrackedBrowser(
        launched,
        ownedBrowserProcess as WwebjsOwnedBrowserProcess
      );
    }
  });

  it('ignores simultaneously unreadable stat and status files from an unrelated PID', async () => {
    let ownedBrowserProcess: WwebjsOwnedBrowserProcess | undefined;
    const launched = launchTestBrowserProcess((owned) => {
      ownedBrowserProcess = owned;
    });
    const unrelatedProcess = spawn(
      process.execPath,
      ['-e', 'setInterval(() => undefined, 1000)'],
      {
        detached: true,
        stdio: 'ignore',
      }
    );
    const owned = ownedBrowserProcess as WwebjsOwnedBrowserProcess;
    const identity = requireCapturedIdentity(owned);
    const unrelatedPid = unrelatedProcess.pid;
    if (!unrelatedPid) {
      throw new Error('unrelated process PID unavailable');
    }
    const unreadablePaths = new Set([
      `/proc/${unrelatedPid}/stat`,
      `/proc/${unrelatedPid}/status`,
    ]);
    const originalReadFileSync = fs.readFileSync.bind(fs);
    const readFileSync = jest.spyOn(fs, 'readFileSync').mockImplementation(((
      target: fs.PathOrFileDescriptor,
      options
    ) => {
      if (unreadablePaths.has(String(target))) {
        const error = new Error('unrelated process stat churn');
        Object.assign(error, { code: 'EACCES' });
        throw error;
      }
      return originalReadFileSync(target, options);
    }) as typeof fs.readFileSync);

    try {
      expect(identity.processGroupId).not.toBe(unrelatedPid);
      for (const unreadablePath of unreadablePaths) {
        expect(() => fs.readFileSync(unreadablePath, 'utf8')).toThrow(
          'unrelated process stat churn'
        );
      }
      expect(requestWwebjsOwnedBrowserProcessTermination(owned)).toBe(true);
      await waitForChildExit(launched.nodeProcess);
      await waitForOwnedBrowserTermination(owned);
      expect(isWwebjsOwnedBrowserProcessTerminated(owned)).toBe(true);
    } finally {
      readFileSync.mockRestore();
      await terminateTrackedBrowser(launched, owned);
      if (
        unrelatedProcess.exitCode === null &&
        unrelatedProcess.signalCode === null
      ) {
        unrelatedProcess.kill('SIGKILL');
        await waitForChildExit(unrelatedProcess);
      }
    }
  });

  it('fails closed when the isolated browser session root is unreadable', async () => {
    let ownedBrowserProcess: WwebjsOwnedBrowserProcess | undefined;
    const launched = launchTestBrowserProcess((owned) => {
      ownedBrowserProcess = owned;
    });
    const owned = ownedBrowserProcess as WwebjsOwnedBrowserProcess;
    const identity = requireCapturedIdentity(owned);
    const originalReadFileSync = fs.readFileSync.bind(fs);
    const readFileSync = jest.spyOn(fs, 'readFileSync').mockImplementation(((
      target: fs.PathOrFileDescriptor,
      options
    ) => {
      if (
        [`/proc/${identity.pid}/stat`, `/proc/${identity.pid}/status`].includes(
          String(target)
        )
      ) {
        const error = new Error('owned process stat unavailable');
        Object.assign(error, { code: 'EACCES' });
        throw error;
      }
      return originalReadFileSync(target, options);
    }) as typeof fs.readFileSync);
    const processKill = jest.spyOn(process, 'kill');

    try {
      expect(requestWwebjsOwnedBrowserProcessTermination(owned)).toBe(false);
      expect(processKill).not.toHaveBeenCalled();
      expect(launched.nodeProcess.exitCode).toBeNull();
      expect(launched.nodeProcess.signalCode).toBeNull();
    } finally {
      readFileSync.mockRestore();
      processKill.mockRestore();
      await terminateTrackedBrowser(launched, owned);
    }
  });

  it('refuses to signal a reused PID whose start time no longer matches', async () => {
    let ownedBrowserProcess: WwebjsOwnedBrowserProcess | undefined;
    const launched = launchTestBrowserProcess((owned) => {
      ownedBrowserProcess = owned;
    });
    const processKill = jest.spyOn(process, 'kill');

    try {
      expect(ownedBrowserProcess).toBeDefined();
      const identity = requireCapturedIdentity(
        ownedBrowserProcess as WwebjsOwnedBrowserProcess
      );
      const staleIdentity = {
        ...(ownedBrowserProcess as WwebjsOwnedBrowserProcess),
        identity: {
          ...identity,
          startTimeTicks: (BigInt(identity.startTimeTicks) + 1n).toString(),
        },
      };

      expect(requestWwebjsOwnedBrowserProcessTermination(staleIdentity)).toBe(
        false
      );
      expect(processKill).not.toHaveBeenCalled();
      expect(launched.nodeProcess.exitCode).toBeNull();
      expect(launched.nodeProcess.signalCode).toBeNull();
    } finally {
      processKill.mockRestore();
      await terminateTrackedBrowser(
        launched,
        ownedBrowserProcess as WwebjsOwnedBrowserProcess
      );
    }
  });

  it('registers exit observers and the exact marker before identity capture can fail', async () => {
    let ownedBrowserProcess: WwebjsOwnedBrowserProcess | undefined;
    const originalReadlink = fs.readlinkSync.bind(fs);
    const readlink = jest.spyOn(fs, 'readlinkSync').mockImplementation(((
      target: fs.PathLike
    ) => {
      if (/^\/proc\/\d+\/exe$/.test(String(target))) {
        const error = new Error('identity unavailable');
        Object.assign(error, { code: 'ENOENT' });
        throw error;
      }
      return originalReadlink(target);
    }) as typeof fs.readlinkSync);
    const processKill = jest.spyOn(process, 'kill');

    expect(() =>
      launchTestBrowserProcess((owned) => {
        ownedBrowserProcess = owned;
      })
    ).toThrow('wwebjs_browser_process_identity_unavailable');

    const owned = ownedBrowserProcess as WwebjsOwnedBrowserProcess;
    const childPid = owned.childProcess.pid;
    expect(owned.identity).toBeUndefined();
    expect(owned.identityCaptureError).toContain('identity_unavailable');
    expect(owned.commandOwnershipMarker).toContain(
      '/tmp/underchat-wwebjs-launch-'
    );
    expect(
      processKill.mock.calls.every(([pid]) => Math.abs(pid) === childPid)
    ).toBe(true);

    readlink.mockRestore();
    processKill.mockRestore();
    await waitForChildExit(owned.childProcess);
    expect(owned.exitObserved || owned.closeObserved).toBe(true);
    expect(isWwebjsOwnedBrowserProcessTerminated(owned)).toBe(true);
  });

  it('refuses an unsafe process group and terminates only the exact spawned child', async () => {
    const marker = `--user-data-dir=${ownershipMarker()}`;
    const childProcess = spawn(
      process.execPath,
      ['-e', 'setInterval(() => undefined, 1000)', marker],
      {
        detached: false,
        stdio: 'ignore',
      }
    );
    const processKill = jest.spyOn(process, 'kill');
    const owned = captureWwebjsOwnedBrowserProcess(childProcess, {
      executablePath: process.execPath,
      args: ['-e', 'setInterval(() => undefined, 1000)', marker],
    });

    try {
      expect(owned.identity).toBeUndefined();
      expect(owned.identityCaptureError).toContain('identity_unsafe');
      expect(processKill).not.toHaveBeenCalled();
      await waitForChildExit(childProcess);
      expect(owned.exitObserved || owned.closeObserved).toBe(true);
      expect(isWwebjsOwnedBrowserProcessTerminated(owned)).toBe(true);
    } finally {
      processKill.mockRestore();
      if (childProcess.exitCode === null && childProcess.signalCode === null) {
        childProcess.kill('SIGKILL');
        await waitForChildExit(childProcess);
      }
    }
  });

  it('never confirms termination when the validated group signal fails or produces no exit event', async () => {
    let ownedBrowserProcess: WwebjsOwnedBrowserProcess | undefined;
    const launched = launchTestBrowserProcess((owned) => {
      ownedBrowserProcess = owned;
    });
    const owned = ownedBrowserProcess as WwebjsOwnedBrowserProcess;
    const identity = requireCapturedIdentity(owned);
    const processKill = jest.spyOn(process, 'kill');

    try {
      processKill.mockImplementationOnce(() => {
        const error = new Error('signal refused');
        Object.assign(error, { code: 'EPERM' });
        throw error;
      });
      expect(requestWwebjsOwnedBrowserProcessTermination(owned)).toBe(false);
      expect(owned.killRequested).toBe(false);
      expect(isWwebjsOwnedBrowserProcessTerminated(owned)).toBe(false);

      processKill.mockImplementationOnce(() => true);
      expect(requestWwebjsOwnedBrowserProcessTermination(owned)).toBe(true);
      expect(owned.killRequested).toBe(true);
      expect(isWwebjsOwnedBrowserProcessTerminated(owned)).toBe(false);
      expect(owned.exitObserved || owned.closeObserved).toBe(false);
      expect(processKill.mock.calls).toEqual([
        [-identity.processGroupId, 'SIGKILL'],
        [-identity.processGroupId, 'SIGKILL'],
      ]);
    } finally {
      processKill.mockRestore();
      await terminateTrackedBrowser(launched, owned);
    }
  });

  it('accepts an exact compacted user-data-dir token but rejects generic substrings', async () => {
    const compactedMarker = ownershipMarker();
    let compactedOwned: WwebjsOwnedBrowserProcess | undefined;
    const compacted = runWithWwebjsBrowserLaunchOwner(
      {
        registerBrowserProcess: (owned) => {
          compactedOwned = owned;
        },
      },
      () =>
        launchRawTestBrowserProcess(
          `--another-flag value --user-data-dir=${compactedMarker} --tail`
        )
    );

    try {
      expect(compactedOwned?.commandOwnershipMarker).toBe(compactedMarker);
      requireCapturedIdentity(compactedOwned as WwebjsOwnedBrowserProcess);
    } finally {
      await terminateTrackedBrowser(
        compacted,
        compactedOwned as WwebjsOwnedBrowserProcess
      );
    }

    let rejectedOwned: WwebjsOwnedBrowserProcess | undefined;
    expect(() =>
      runWithWwebjsBrowserLaunchOwner(
        {
          registerBrowserProcess: (owned) => {
            rejectedOwned = owned;
          },
        },
        () =>
          launchRawTestBrowserProcess(
            `prefix--user-data-dir=${ownershipMarker()}`
          )
      )
    ).toThrow('wwebjs_browser_process_marker_missing');
    const rejected = rejectedOwned as WwebjsOwnedBrowserProcess;
    await waitForChildExit(rejected.childProcess);
    expect(rejected.commandOwnershipMarker).toBeUndefined();
    expect(rejected.exitObserved || rejected.closeObserved).toBe(true);
  });

  it('keeps concurrent AsyncLocalStorage launch owners isolated', async () => {
    const ownerA: WwebjsOwnedBrowserProcess[] = [];
    const ownerB: WwebjsOwnedBrowserProcess[] = [];
    const [launchedA, launchedB] = await Promise.all([
      runAsyncOwnedLaunch((owned) => ownerA.push(owned)),
      runAsyncOwnedLaunch((owned) => ownerB.push(owned)),
    ]);

    try {
      expect(ownerA).toHaveLength(1);
      expect(ownerB).toHaveLength(1);
      expect(ownerA[0]?.childProcess).toBe(launchedA.nodeProcess);
      expect(ownerB[0]?.childProcess).toBe(launchedB.nodeProcess);
      expect(ownerA[0]?.childProcess).not.toBe(ownerB[0]?.childProcess);
    } finally {
      await Promise.all([
        terminateTrackedBrowser(
          launchedA,
          ownerA[0] as WwebjsOwnedBrowserProcess
        ),
        terminateTrackedBrowser(
          launchedB,
          ownerB[0] as WwebjsOwnedBrowserProcess
        ),
      ]);
    }
  });
});
