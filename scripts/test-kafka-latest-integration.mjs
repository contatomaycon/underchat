import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const broker = process.env.TEST_KAFKA_BROKER?.trim();
if (!broker) {
  console.error(
    'TEST_KAFKA_BROKER is required; refusing to skip the latest-on-assignment integration gate.'
  );
  process.exit(1);
}

function run(command, args, cwd = process.cwd(), env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('pnpm', [
  'exec',
  'jest',
  '--runInBand',
  'packages/tests/contracts/plugins/kafkaLatest.integration.contract.test.ts',
]);
run(
  'go',
  [
    'test',
    '-race',
    '-count=1',
    '-run',
    '^(TestKafkaLatest(OnEveryConnection|CutoverCommitsDiscardWatermark)Integration|TestKafkaAssignmentlessStandbyRejoinsAndTakesOwnershipIntegration)$',
    './internal/app',
  ],
  fileURLToPath(new URL('../apps/worker_whatsmeow/', import.meta.url)),
  {
    ...process.env,
    TEST_KAFKA_BROKER: broker.split(',')[0].trim(),
  }
);
