import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

interface RuntimeArtifactFixture {
  relativePath: string;
  source: string;
}

interface KafkaAdminArtifactBoundary {
  findKafkaAdminArtifactViolations(
    relativePath: string,
    source?: string
  ): string[];
}

const workspaceRoot = process.cwd();
const boundaryScript = path.join(
  workspaceRoot,
  'scripts',
  'prepare-worker-runtime.mjs'
);
const requireFromWorkspace = createRequire(
  path.join(workspaceRoot, 'package.json')
);
const kafkaAdminBoundary = requireFromWorkspace(
  path.join(workspaceRoot, 'scripts', 'worker-runtime-kafka-boundary.cjs')
) as KafkaAdminArtifactBoundary;
const forbiddenKafkaAdminArtifactPaths = [
  'packages/common/functions/ensureKafkaTopic.js',
  'packages/common/functions/kafkaAdminConfig.js',
  'packages/common/functions/kafkaTopicRecoveryPolicy.js',
  'packages/common/functions/serviceApiKafkaCutoverBarrier.js',
  'packages/services/kafka.service.js',
  'packages/services/workerKafkaTopicAdmin.service.js',
  'packages/services/workerKafkaTopicLifecycle.service.js',
] as const;
const forbiddenKafkaAdminModuleSpecifiers = [
  '@core/common/functions/ensureKafkaTopic',
  '@core/common/functions/kafkaAdminConfig',
  '@core/common/functions/kafkaTopicRecoveryPolicy',
  '@core/common/functions/serviceApiKafkaCutoverBarrier',
  '@core/services/kafka.service',
  '@core/services/workerKafkaTopicAdmin.service',
  '@core/services/workerKafkaTopicLifecycle.service',
] as const;
const forbiddenKafkaAdminSymbols = [
  'AdminClient',
  'KafkaAdminLike',
  'KafkaService',
  'WorkerKafkaTopicAdminService',
  'WorkerKafkaTopicLifecycleService',
  'buildNodeKafkaAdminConfig',
  'buildRdKafkaAdminConfig',
  'createAdminClient',
  'createKafkaAdmin',
  'ensureAuthorizedWorkerKafkaTopic',
  'ensureKafkaTopic',
] as const;
const forbiddenKafkaAdminMemberCalls = [
  'admin',
  'alterConfigs',
  'createPartitions',
  'createTopics',
  'deleteGroups',
  'deleteTopics',
  'incrementalAlterConfigs',
] as const;

function inspectRuntimeArtifact(fixture: RuntimeArtifactFixture): string[] {
  return kafkaAdminBoundary.findKafkaAdminArtifactViolations(
    `/${fixture.relativePath.replaceAll(path.sep, '/')}`,
    fixture.source
  );
}

function expectKafkaAdminBoundaryFailure(
  fixture: RuntimeArtifactFixture,
  expectedReason: string
): void {
  expect(inspectRuntimeArtifact(fixture)).toEqual(
    expect.arrayContaining([expect.stringContaining(expectedReason)])
  );
}

describe('prepare worker runtime Kafka admin artifact boundary', () => {
  it('accepts the worker-safe recovery policy and runtime producer/consumer calls', () => {
    const fixtures: RuntimeArtifactFixture[] = [
      {
        relativePath:
          'packages/common/functions/workerKafkaTopicRecoveryPolicy.js',
        source: `
          export async function recoverKafkaTopicForProduce(input) {
            return input.produce();
          }
        `,
      },
      {
        relativePath: 'apps/worker/src/runtime.js',
        source: `
          runtimeProducer.produce(topic, payload);
          runtimeConsumer.consume();
        `,
      },
    ];

    expect(fixtures.flatMap(inspectRuntimeArtifact)).toEqual([]);
  });

  it('wires the boundary into the CLI and both worker Docker builds', () => {
    const script = fs.readFileSync(boundaryScript, 'utf8');
    const dockerIgnore = fs.readFileSync(
      path.join(workspaceRoot, '.dockerignore'),
      'utf8'
    );
    expect(script).toContain(
      "import kafkaAdminBoundary from './worker-runtime-kafka-boundary.cjs';"
    );
    expect(script).toContain('findKafkaAdminArtifactViolations(');
    expect(dockerIgnore).toContain('**/node_modules');
    expect(dockerIgnore).toContain('**/dist');

    for (const [dockerfile, workerDist] of [
      ['apps/worker_baileys/Dockerfile', 'apps/worker_baileys/dist'],
      ['apps/worker_wwebjs/Dockerfile', 'apps/worker_wwebjs/dist'],
    ] as const) {
      const source = fs.readFileSync(
        path.join(workspaceRoot, dockerfile),
        'utf8'
      );
      expect(source).toContain(
        'COPY scripts/worker-runtime-kafka-boundary.cjs ./scripts/worker-runtime-kafka-boundary.cjs'
      );
      expect(source).toContain('RUN node scripts/prepare-worker-runtime.mjs');
      expect(source).toContain(`RUN rm -rf ${workerDist}`);
      expect(source.indexOf(`RUN rm -rf ${workerDist}`)).toBeLessThan(
        source.indexOf('RUN node scripts/prepare-worker-runtime.mjs')
      );
      expect(source).toContain('node node_modules/typescript/bin/tsc');
      expect(source).toContain('node node_modules/tsc-alias/dist/bin/index.js');
    }
  });

  it.each(forbiddenKafkaAdminArtifactPaths)(
    'rejects the compiled Kafka admin artifact %s',
    (relativePath) => {
      expectKafkaAdminBoundaryFailure(
        {
          relativePath,
          source: 'export const runtime = true;',
        },
        'forbidden Kafka admin artifact'
      );
    }
  );

  it.each(forbiddenKafkaAdminModuleSpecifiers)(
    'rejects the Kafka admin module reference %s',
    (specifier) => {
      expectKafkaAdminBoundaryFailure(
        {
          relativePath: 'apps/worker/src/index.js',
          source: `import '${specifier}';`,
        },
        'forbidden Kafka admin module reference'
      );
    }
  );

  it.each(forbiddenKafkaAdminSymbols)(
    'rejects the Kafka admin symbol %s',
    (symbol) => {
      expectKafkaAdminBoundaryFailure(
        {
          relativePath: 'apps/worker/src/index.js',
          source: `export const leakedCapability = ${symbol};`,
        },
        'forbidden Kafka admin symbol'
      );
    }
  );

  it.each(forbiddenKafkaAdminMemberCalls)(
    'rejects the Kafka admin member call %s',
    (member) => {
      expectKafkaAdminBoundaryFailure(
        {
          relativePath: 'apps/worker/src/index.js',
          source: `kafkaClient.${member}();`,
        },
        'forbidden Kafka admin symbol'
      );
    }
  );
});
