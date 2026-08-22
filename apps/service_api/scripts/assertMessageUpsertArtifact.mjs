import fs from 'node:fs';
import path from 'node:path';

const windowRecorderOnly = process.argv[2] === '--window-recorder-only';
const artifactPath = windowRecorderOnly ? null : process.argv[2];
const webhookArtifactPath = windowRecorderOnly ? null : process.argv[3];
const windowRecorderArtifactPath = windowRecorderOnly ? process.argv[3] : null;

if (
  (windowRecorderOnly && !windowRecorderArtifactPath) ||
  (!windowRecorderOnly && (!artifactPath || !webhookArtifactPath))
) {
  console.error(
    '[service-artifact-guard] Usage: node assertMessageUpsertArtifact.mjs <MessageUpsert.consume.js> <OfficialWhatsappWebhook.consume.js> | --window-recorder-only <OfficialWhatsappWebhookWindowRecorder.service.js>'
  );
  process.exit(2);
}

function readArtifact(targetPath) {
  try {
    return fs.readFileSync(targetPath, 'utf8');
  } catch (error) {
    console.error(
      `[service-artifact-guard] Cannot read ${path.resolve(targetPath)}: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}

const artifact = artifactPath ? readArtifact(artifactPath) : '';
const webhookArtifact = webhookArtifactPath
  ? readArtifact(webhookArtifactPath)
  : '';
const windowRecorderArtifact = windowRecorderArtifactPath
  ? readArtifact(windowRecorderArtifactPath)
  : '';

const requiredSemantics = [
  {
    description: 'WorkerCommandAdmissionService import/reference',
    pattern: /\bWorkerCommandAdmissionService\b/,
  },
  {
    description: 'mark_read admission call',
    pattern:
      /container\s*\.\s*resolve\s*\(\s*WorkerCommandAdmissionService\s*\)\s*\.\s*admit\s*\(/,
  },
  {
    description: 'mark_read command type',
    pattern: /commandType\s*:\s*['"]mark_read['"]/,
  },
  {
    description: 'consumer parking redrive startup',
    pattern:
      /inboundMessageSpoolService\s*\.\s*startMessageUpsertConsumerRedrive\s*\(/,
  },
  {
    description: 'Redis-admitted redrive bypass before processing',
    pattern:
      /officialReplay\s*=\s*Number\s*\(\s*data\s*\.\s*consumer_redrive_attempt\s*\)\s*>\s*0\s*\?\s*null\s*:\s*this\s*\.\s*classifyOfficialWhatsappReplay\s*\(\s*data\s*\)/,
  },
  {
    description: 'official WhatsApp replay max-age policy',
    pattern: /\bOFFICIAL_WHATSAPP_REPLAY_EFFECT_MAX_AGE_MS\b/,
  },
  {
    description: 'provider-time chat creation',
    pattern:
      /messageDate\s*=\s*this\s*\.\s*resolvePersistedMessageDate\s*\(\s*data\s*\)/,
  },
];

const requiredWebhookSemantics = [
  {
    description: 'official webhook provider timestamp classifier call',
    pattern: /classifyOfficialWhatsappProviderTimestampForEffects\s*\(/,
  },
  {
    description: 'official webhook terminal quarantine call',
    pattern: /await\s+this\s*\.\s*parkRejectedOfficialInbound\s*\(/,
  },
  {
    description: 'official webhook mapper does not synthesize current time',
    pattern:
      /toTimestampSeconds\s*\(\s*value\s*\)\s*\{[\s\S]{0,700}?return\s+undefined\s*;/,
  },
  {
    description: 'stale Meta re-engagement status window guard',
    pattern:
      /providerErrorCode\s*===\s*131047[\s\S]{0,300}?statusFreshness\s*\.\s*accepted/,
  },
];

const requiredWindowRecorderSemantics = [
  {
    description: 'pre-Kafka window provider timestamp classifier call',
    pattern: /classifyOfficialWhatsappProviderTimestampForEffects\s*\(/,
  },
  {
    description: 'pre-Kafka window freshness rejection',
    pattern:
      /!freshness\s*\.\s*accepted\s*\|\|\s*freshness\s*\.\s*providerTimestampMs\s*===\s*null/,
  },
  {
    description: 'pre-Kafka window provider-time persistence',
    pattern:
      /inboundAt\s*:\s*new\s+Date\s*\(\s*freshness\s*\.\s*providerTimestampMs\s*\)\s*\.\s*toISOString\s*\(\s*\)/,
  },
];

const forbiddenSemantics = [
  {
    description: 'removed Kafka markMessageRead route',
    pattern: /kafkaServiceQueueService\s*\.\s*markMessageRead\s*\(/,
  },
  {
    description: 'Meta timestamp recheck after Redis redrive admission',
    pattern: /classifyOfficialWhatsappReplay\s*\(\s*redriveUpsert\s*\)/,
  },
];

const windowRecorderFailures = [
  ...requiredWindowRecorderSemantics
    .filter(({ pattern }) => !pattern.test(windowRecorderArtifact))
    .map(({ description }) => `missing ${description}`),
];

const windowClassificationCall = windowRecorderArtifact.indexOf(
  'classifyOfficialWhatsappProviderTimestampForEffects('
);
const windowMutationCall = windowRecorderArtifact.indexOf(
  'this.windowService.recordInboundMessage('
);
if (
  windowClassificationCall === -1 ||
  windowMutationCall === -1 ||
  windowClassificationCall > windowMutationCall
) {
  windowRecorderFailures.push(
    'official pre-Kafka window classification is not before window mutation'
  );
}

if (windowRecorderOnly) {
  if (windowRecorderFailures.length > 0) {
    console.error(
      `[service-artifact-guard] Rejected ${path.resolve(windowRecorderArtifactPath)}: ${windowRecorderFailures.join('; ')}`
    );
    process.exit(1);
  }
  console.log(
    `[service-artifact-guard] Validated ${path.resolve(windowRecorderArtifactPath)}`
  );
  process.exit(0);
}

const failures = [
  ...requiredSemantics
    .filter(({ pattern }) => !pattern.test(artifact))
    .map(({ description }) => `missing ${description}`),
  ...forbiddenSemantics
    .filter(({ pattern }) => pattern.test(artifact))
    .map(({ description }) => `contains ${description}`),
  ...requiredWebhookSemantics
    .filter(({ pattern }) => !pattern.test(webhookArtifact))
    .map(({ description }) => `missing ${description}`),
];

const quarantineCall = webhookArtifact.indexOf(
  'await this.parkRejectedOfficialInbound('
);
const mappingCall = webhookArtifact.indexOf(
  'await this.buildUpsertFromMetaMessage('
);
if (
  quarantineCall === -1 ||
  mappingCall === -1 ||
  quarantineCall > mappingCall
) {
  failures.push('official webhook quarantine is not before message mapping');
}

if (failures.length > 0) {
  console.error(
    `[service-artifact-guard] Rejected ${path.resolve(artifactPath)}: ${failures.join('; ')}`
  );
  process.exit(1);
}

console.log(
  `[service-artifact-guard] Validated ${path.resolve(artifactPath)} and ${path.resolve(webhookArtifactPath)}`
);
