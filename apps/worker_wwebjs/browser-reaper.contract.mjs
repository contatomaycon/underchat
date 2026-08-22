import { createRequire } from 'node:module';
import fs from 'node:fs';

import {
  isWwebjsOwnedBrowserProcessTerminated,
  requestWwebjsOwnedBrowserProcessTermination,
  runWithWwebjsBrowserLaunchOwner,
} from '/app/packages/services/wwebjs/methods/browserProcessOwnership.js';

const runtimeRequire = createRequire('/app/apps/worker_wwebjs/package.json');
const puppeteerBrowsers = runtimeRequire('@puppeteer/browsers');

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readProcessGroup(processGroupId) {
  const members = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    try {
      const rawStat = fs.readFileSync(`/proc/${entry}/stat`, 'utf8');
      const commandEnd = rawStat.lastIndexOf(')');
      if (commandEnd < 0) {
        continue;
      }
      const fields = rawStat
        .slice(commandEnd + 1)
        .trim()
        .split(/\s+/);
      if (Number(fields[2]) === processGroupId) {
        members.push({
          pid: Number(entry),
          state: fields[0],
          parentPid: Number(fields[1]),
        });
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }
  return members;
}

async function waitForExecutable(pid, expectedPath) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      if (fs.readlinkSync(`/proc/${pid}/exe`) === expectedPath) {
        return;
      }
    } catch {}
    await delay(10);
  }
  throw new Error(`chrome executable transition timed out:${pid}`);
}

async function waitForChildExit(childProcess) {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
    return;
  }
  await new Promise((resolve) => childProcess.once('exit', resolve));
}

async function waitForTermination(owned) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (isWwebjsOwnedBrowserProcessTerminated(owned)) {
      return;
    }
    await delay(20);
  }
  throw new Error('owned Chrome process never reached terminated state');
}

async function waitForProcessGroupReaped(processGroupId) {
  const deadline = Date.now() + 10_000;
  let members = readProcessGroup(processGroupId);
  while (members.length > 0 && Date.now() < deadline) {
    await delay(20);
    members = readProcessGroup(processGroupId);
  }
  if (members.length > 0) {
    throw new Error(
      `Chrome process group was not reaped:${JSON.stringify(members)}`
    );
  }
}

async function runContract() {
  const initExecutable = fs.readlinkSync('/proc/1/exe');
  if (process.pid === 1 || initExecutable !== '/usr/bin/tini') {
    throw new Error(
      `contract requires tini as PID 1:${process.pid}:${initExecutable}`
    );
  }

  const profile = fs.mkdtempSync('/tmp/underchat-wwebjs-reaper-');
  let launched;
  let owned;
  try {
    launched = runWithWwebjsBrowserLaunchOwner(
      {
        registerBrowserProcess: (registered) => {
          owned = registered;
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
    if (!owned?.identity || !launched?.nodeProcess?.pid) {
      throw new Error(owned?.identityCaptureError ?? 'identity not captured');
    }

    await waitForExecutable(
      launched.nodeProcess.pid,
      '/opt/google/chrome/chrome'
    );
    const processGroupId = owned.identity.processGroupId;
    if (!requestWwebjsOwnedBrowserProcessTermination(owned)) {
      throw new Error('validated Chrome process group signal was refused');
    }
    await waitForChildExit(launched.nodeProcess);
    await waitForTermination(owned);
    await waitForProcessGroupReaped(processGroupId);

    const remainingMembers = readProcessGroup(processGroupId);
    if (remainingMembers.length > 0) {
      throw new Error(
        `Chrome group still has members:${JSON.stringify(remainingMembers)}`
      );
    }
    process.stdout.write(
      `${JSON.stringify({
        contract: 'wwebjs-browser-reaper',
        initExecutable,
        isTerminated: isWwebjsOwnedBrowserProcessTerminated(owned),
        remainingMembers,
      })}\n`
    );
  } finally {
    if (owned && !isWwebjsOwnedBrowserProcessTerminated(owned)) {
      requestWwebjsOwnedBrowserProcessTermination(owned);
    }
    if (
      launched?.nodeProcess?.exitCode === null &&
      launched.nodeProcess.signalCode === null
    ) {
      launched.nodeProcess.kill('SIGKILL');
    }
    fs.rmSync(profile, { force: true, recursive: true });
  }
}

try {
  await runContract();
} catch (error) {
  process.stderr.write(
    `wwebjs-browser-reaper-contract-failed:${error?.stack ?? error}\n`
  );
  process.exitCode = 1;
}
