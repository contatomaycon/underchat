import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const appRoot = resolve(import.meta.dirname, '..');
const certDir = resolve(appRoot, 'build/certs');
const passwordPath = resolve(certDir, 'windows-codesign.password');
const keyPath = resolve(certDir, 'underchat-passkey-helper.key.pem');
const certPath = resolve(certDir, 'underchat-passkey-helper.cert.pem');
const pfxPath = resolve(certDir, 'underchat-passkey-helper-self-signed.pfx');

async function exists(path) {
  return Boolean(await stat(path).catch(() => undefined));
}

async function run(command, args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: appRoot,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

await mkdir(certDir, { recursive: true });

if ((await exists(pfxPath)) && (await exists(passwordPath))) {
  console.log(
    '[passkey_helper] Windows self-signed certificate already exists',
    {
      pfx: pfxPath,
    }
  );
  process.exit(0);
}

const password = randomBytes(30).toString('base64url');
await writeFile(passwordPath, `${password}\n`, { mode: 0o600 });
await chmod(passwordPath, 0o600).catch(() => undefined);

await run('openssl', [
  'req',
  '-x509',
  '-newkey',
  'rsa:4096',
  '-sha256',
  '-days',
  '825',
  '-nodes',
  '-keyout',
  keyPath,
  '-out',
  certPath,
  '-subj',
  '/C=BR/ST=Sao Paulo/L=Sao Paulo/O=Underchat/OU=Desktop/CN=Underchat Passkey Helper',
  '-addext',
  'extendedKeyUsage=codeSigning',
  '-addext',
  'keyUsage=digitalSignature',
]);

await run('openssl', [
  'pkcs12',
  '-export',
  '-inkey',
  keyPath,
  '-in',
  certPath,
  '-out',
  pfxPath,
  '-name',
  'Underchat Passkey Helper',
  '-passout',
  `file:${passwordPath}`,
]);

await chmod(pfxPath, 0o600).catch(() => undefined);
await rm(keyPath, { force: true }).catch(() => undefined);
await rm(certPath, { force: true }).catch(() => undefined);

const savedPassword = (await readFile(passwordPath, 'utf8')).trim();
if (!savedPassword) {
  throw new Error('Generated Windows signing password is empty');
}

console.log('[passkey_helper] Windows self-signed certificate generated', {
  pfx: pfxPath,
});
