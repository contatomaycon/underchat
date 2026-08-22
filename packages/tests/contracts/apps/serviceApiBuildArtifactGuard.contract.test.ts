import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const projectRoot = process.cwd();
const guardPath = path.resolve(
  projectRoot,
  'apps/service_api/scripts/assertMessageUpsertArtifact.mjs'
);

function runGuard(
  source: string,
  webhookSource: string = canonicalOfficialWebhookArtifact
) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'service-artifact-guard-')
  );
  const artifactPath = path.join(directory, 'MessageUpsert.consume.js');
  const webhookArtifactPath = path.join(
    directory,
    'OfficialWhatsappWebhook.consume.js'
  );
  fs.writeFileSync(artifactPath, source);
  fs.writeFileSync(webhookArtifactPath, webhookSource);

  try {
    return spawnSync(
      process.execPath,
      [guardPath, artifactPath, webhookArtifactPath],
      {
        encoding: 'utf8',
      }
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
}

function runWindowRecorderOnlyGuard(source: string) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'manager-window-artifact-guard-')
  );
  const artifactPath = path.join(
    directory,
    'officialWhatsappWebhookWindowRecorder.service.js'
  );
  fs.writeFileSync(artifactPath, source);

  try {
    return spawnSync(
      process.execPath,
      [guardPath, '--window-recorder-only', artifactPath],
      { encoding: 'utf8' }
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
}

const canonicalMessageUpsertArtifact = `
  import { WorkerCommandAdmissionService } from '../../services/workerCommandAdmission.service.js';
  const OFFICIAL_WHATSAPP_REPLAY_EFFECT_MAX_AGE_MS = 86400000;
  await container.resolve(WorkerCommandAdmissionService).admit({
    commandType: 'mark_read',
  });
  this.inboundMessageSpoolService.startMessageUpsertConsumerRedrive(
    (payload) => this.redriveParkedConsumerMessage(topic, payload)
  );
  function process(data) {
    const officialReplay = Number(data.consumer_redrive_attempt) > 0
      ? null
      : this.classifyOfficialWhatsappReplay(data);
    if (officialReplay.discard) return;
  }
  function redrive(redriveUpsert) {
    return publish(redriveUpsert);
  }
  const messageDate = this.resolvePersistedMessageDate(data);
`;

const canonicalOfficialWebhookArtifact = `
  function toTimestampSeconds(value) {
    if (Number(value) > 0) return Number(value);
    return undefined;
  }
  async function handle(message) {
    const freshness = classifyOfficialWhatsappProviderTimestampForEffects({
      providerTimestamp: message.timestamp,
    });
    if (!freshness.accepted) {
      await this.parkRejectedOfficialInbound(message);
      return;
    }
    const upsert = await this.buildUpsertFromMetaMessage(message);
  }
  function status(providerErrorCode, statusFreshness) {
    if (
      providerErrorCode === 131047 &&
      remoteJid &&
      statusFreshness.accepted
    ) closeWindow();
  }
`;

const canonicalOfficialWindowRecorderArtifact = `
  async function record(message) {
    const freshness = classifyOfficialWhatsappProviderTimestampForEffects({
      providerTimestamp: message.timestamp,
    });
    if (!freshness.accepted || freshness.providerTimestampMs === null) {
      continue;
    }
    await this.windowService.recordInboundMessage({
      inboundAt: new Date(freshness.providerTimestampMs).toISOString(),
    });
  }
`;

describe('service API build artifact guard', () => {
  it('accepts the canonical mark_read admission artifact', () => {
    const result = runGuard(canonicalMessageUpsertArtifact);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[service-artifact-guard] Validated');
  });

  it('rejects the removed Kafka markMessageRead route', () => {
    const result = runGuard(`
      ${canonicalMessageUpsertArtifact}
      await this.streamProducerService.send(
        this.kafkaServiceQueueService.markMessageRead(),
        markReadData
      );
    `);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'contains removed Kafka markMessageRead route'
    );
  });

  it('rejects an artifact that does not contain canonical admission semantics', () => {
    const result = runGuard('export class MessageUpsertConsume {}');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing mark_read admission call');
    expect(result.stderr).toContain('missing mark_read command type');
    expect(result.stderr).toContain('missing consumer parking redrive startup');
    expect(result.stderr).toContain(
      'missing Redis-admitted redrive bypass before processing'
    );
  });

  it('rejects the former hotfix artifact without replay barriers', () => {
    const result = runGuard(`
      import { WorkerCommandAdmissionService } from '../../services/workerCommandAdmission.service.js';
      await container.resolve(WorkerCommandAdmissionService).admit({
        commandType: 'mark_read',
      });
      this.runner = new KafkaConsumerRunner({ topic: 'upsert.message' });
    `);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing consumer parking redrive startup');
    expect(result.stderr).toContain(
      'missing Redis-admitted redrive bypass before processing'
    );
  });

  it('rejects definitions whose replay classifier is no longer called at the processing boundary', () => {
    const mutated = canonicalMessageUpsertArtifact.replace(
      `const officialReplay = Number(data.consumer_redrive_attempt) > 0
      ? null
      : this.classifyOfficialWhatsappReplay(data);`,
      'const officialReplay = { discard: false };'
    );

    const result = runGuard(mutated);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'missing Redis-admitted redrive bypass before processing'
    );
  });

  it('rejects a Meta timestamp recheck after Redis admitted the redrive', () => {
    const unsafe = canonicalMessageUpsertArtifact.replace(
      'return publish(redriveUpsert);',
      'return this.classifyOfficialWhatsappReplay(redriveUpsert);'
    );

    const result = runGuard(unsafe);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'contains Meta timestamp recheck after Redis redrive admission'
    );
  });

  it('rejects an official webhook artifact that maps before quarantine', () => {
    const unsafeWebhook = canonicalOfficialWebhookArtifact
      .replace(
        'const upsert = await this.buildUpsertFromMetaMessage(message);',
        ''
      )
      .replace(
        'const freshness = classifyOfficialWhatsappProviderTimestampForEffects({',
        'const upsert = await this.buildUpsertFromMetaMessage(message);\n    const freshness = classifyOfficialWhatsappProviderTimestampForEffects({'
      );

    const result = runGuard(canonicalMessageUpsertArtifact, unsafeWebhook);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'official webhook quarantine is not before message mapping'
    );
  });

  it('rejects a pre-Kafka window recorder that mutates before freshness classification', () => {
    const unsafeRecorder = canonicalOfficialWindowRecorderArtifact
      .replace(
        'await this.windowService.recordInboundMessage({',
        'await this.windowService.recordInboundMessageUnsafe({'
      )
      .replace(
        'const freshness = classifyOfficialWhatsappProviderTimestampForEffects({',
        'await this.windowService.recordInboundMessage({});\n    const freshness = classifyOfficialWhatsappProviderTimestampForEffects({'
      );

    const result = runWindowRecorderOnlyGuard(unsafeRecorder);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'official pre-Kafka window classification is not before window mutation'
    );
  });

  it('validates the manager pre-Kafka recorder in standalone mode', () => {
    const accepted = runWindowRecorderOnlyGuard(
      canonicalOfficialWindowRecorderArtifact
    );
    const rejected = runWindowRecorderOnlyGuard('recordInboundMessage();');

    expect(accepted.status).toBe(0);
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain(
      'missing pre-Kafka window provider timestamp classifier call'
    );
  });

  it('checks semantics after a clean build and pins the runtime artifact hash', () => {
    const dockerfile = fs.readFileSync(
      path.resolve(projectRoot, 'apps/service_api/Dockerfile'),
      'utf8'
    );
    const clean = dockerfile.indexOf('rm -rf /app/apps/service_api/dist');
    const build = dockerfile.indexOf('pnpm build:service');
    const semanticCheck = dockerfile.indexOf(
      'node /app/apps/service_api/scripts/assertMessageUpsertArtifact.mjs'
    );
    const manifest = dockerfile.indexOf('/service-message-upsert.sha256');
    const runtimeCheck = dockerfile.indexOf(
      'sha256sum -c /usr/local/share/underchat/service-message-upsert.sha256'
    );
    const start = dockerfile.indexOf('exec node src/index.js');

    expect(clean).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(clean);
    expect(semanticCheck).toBeGreaterThan(build);
    expect(manifest).toBeGreaterThan(semanticCheck);
    expect(runtimeCheck).toBeGreaterThan(manifest);
    expect(start).toBeGreaterThan(runtimeCheck);
    expect(dockerfile).toContain(
      '/packages/consumer/webhook/OfficialWhatsappWebhook.consume.js'
    );
  });

  it('does not compile the helper kept only for the removed production overlay', () => {
    const tsconfig = JSON.parse(
      fs.readFileSync(
        path.resolve(projectRoot, 'apps/service_api/tsconfig.json'),
        'utf8'
      )
    ) as { include?: string[] };

    expect(tsconfig.include).not.toContain(
      '../../packages/common/functions/buildMessageMarkReadKafkaKey.ts'
    );
  });

  it('checks and pins the pre-Kafka window recorder in the manager runtime', () => {
    const dockerfile = fs.readFileSync(
      path.resolve(projectRoot, 'apps/manager_api/Dockerfile'),
      'utf8'
    );
    const clean = dockerfile.indexOf('rm -rf /app/apps/manager_api/dist');
    const build = dockerfile.indexOf('pnpm build:manager');
    const semanticCheck = dockerfile.indexOf('--window-recorder-only');
    const manifest = dockerfile.indexOf(
      '/manager-official-window-recorder.sha256'
    );
    const runtimeCheck = dockerfile.indexOf(
      'sha256sum -c /usr/local/share/underchat/manager-official-window-recorder.sha256'
    );
    const start = dockerfile.indexOf('exec node src/index.js');

    expect(clean).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(clean);
    expect(semanticCheck).toBeGreaterThan(build);
    expect(manifest).toBeGreaterThan(semanticCheck);
    expect(runtimeCheck).toBeGreaterThan(manifest);
    expect(start).toBeGreaterThan(runtimeCheck);
  });
});
