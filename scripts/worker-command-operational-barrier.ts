import 'reflect-metadata';
import dotenv from 'dotenv';
import Redis from 'ioredis';
import { cacheEnvironment } from '../packages/config/environments/index';
import { WorkerCommandOperationalBarrierService } from '../packages/services/workerCommandOperationalBarrier.service';

dotenv.config({ quiet: true });

type Command = 'status' | 'pause' | 'resume';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`worker_command_barrier_option_missing:${name}`);
  }
  return value;
}

function requiredOption(name: string): string {
  const value = option(name)?.trim();
  if (!value) throw new Error(`worker_command_barrier_option_required:${name}`);
  return value;
}

function generation(name: string): number {
  const value = Number(requiredOption(name));
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`worker_command_barrier_option_invalid:${name}`);
  }
  return value;
}

async function resumeToken(): Promise<string> {
  if (!process.argv.includes('--token-stdin')) return requiredOption('token');
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const token = Buffer.concat(chunks).toString('utf8').trim();
  if (!token) {
    throw new Error('worker_command_barrier_option_required:token-stdin');
  }
  return token;
}

function command(): Command {
  const candidate = process.argv[2]?.trim();
  if (
    candidate === 'status' ||
    candidate === 'pause' ||
    candidate === 'resume'
  ) {
    return candidate;
  }
  throw new Error(
    'usage: pnpm worker-command:barrier <status|pause|resume> [options]'
  );
}

async function main(): Promise<void> {
  const redis = new Redis({
    host: cacheEnvironment.cacheHost,
    port: cacheEnvironment.cachePort,
    password: cacheEnvironment.cachePassword,
    lazyConnect: true,
    connectTimeout: 10_000,
    commandTimeout: 3_000,
    maxRetriesPerRequest: 1,
  });
  const barrier = new WorkerCommandOperationalBarrierService(redis);
  try {
    await redis.connect();
    const action = command();
    if (action === 'status') {
      console.log(JSON.stringify(await barrier.getStatus(), null, 2));
      return;
    }
    if (action === 'pause') {
      const result = await barrier.pause({
        expectedGeneration: generation('expected-generation'),
        actor: requiredOption('actor'),
        reason: requiredOption('reason'),
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const result = await barrier.resume({
      generation: generation('generation'),
      token: await resumeToken(),
      actor: requiredOption('actor'),
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await redis.quit().catch(() => redis.disconnect());
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ status: false, error: message }));
  process.exitCode = 1;
});
