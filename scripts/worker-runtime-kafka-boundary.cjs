'use strict';

const forbiddenKafkaAdminDistPathFragments = [
  '/packages/common/functions/ensureKafkaTopic.',
  '/packages/common/functions/kafkaAdminConfig.',
  '/packages/common/functions/kafkaTopicRecoveryPolicy.',
  '/packages/common/functions/serviceApiKafkaCutoverBarrier.',
  '/packages/services/kafka.service.',
  '/packages/services/workerKafkaTopicAdmin.service.',
  '/packages/services/workerKafkaTopicLifecycle.service.',
];
const forbiddenKafkaAdminModuleFragments = [
  'common/functions/ensureKafkaTopic',
  'common/functions/kafkaAdminConfig',
  'common/functions/kafkaTopicRecoveryPolicy',
  'common/functions/serviceApiKafkaCutoverBarrier',
  'services/kafka.service',
  'services/workerKafkaTopicAdmin.service',
  'services/workerKafkaTopicLifecycle.service',
];
const forbiddenKafkaAdminSymbolPattern =
  /\b(?:AdminClient|KafkaAdminLike|KafkaService|WorkerKafkaTopicAdminService|WorkerKafkaTopicLifecycleService|buildNodeKafkaAdminConfig|buildRdKafkaAdminConfig|createAdminClient|createKafkaAdmin|ensureAuthorizedWorkerKafkaTopic|ensureKafkaTopic)\b/u;
const forbiddenKafkaAdminMemberCallPattern =
  /\.\s*(?:admin|alterConfigs|createPartitions|createTopics|deleteGroups|deleteTopics|incrementalAlterConfigs)\s*\(/u;

function findKafkaAdminArtifactViolations(relativePath, source) {
  const violations = [];
  if (
    forbiddenKafkaAdminDistPathFragments.some((fragment) =>
      relativePath.includes(fragment)
    )
  ) {
    violations.push(`forbidden Kafka admin artifact ${relativePath}`);
  }
  if (typeof source !== 'string') {
    return violations;
  }
  if (
    forbiddenKafkaAdminModuleFragments.some((fragment) =>
      source.includes(fragment)
    )
  ) {
    violations.push(`forbidden Kafka admin module reference ${relativePath}`);
  }
  if (
    forbiddenKafkaAdminSymbolPattern.test(source) ||
    forbiddenKafkaAdminMemberCallPattern.test(source)
  ) {
    violations.push(`forbidden Kafka admin symbol ${relativePath}`);
  }
  return violations;
}

module.exports = {
  findKafkaAdminArtifactViolations,
};
