<script setup lang="ts">
import { computed, type DeepReadonly } from 'vue';
import { useI18n } from 'vue-i18n';
import type { WorkerConnectionHealthResponse } from '@core/schema/worker/workerConnectionLogs/response.schema';
import { formatConnectionBytes } from '@/utils/connectionHealthPresentation';

interface DetailItem {
  key: string;
  label: string;
  value: string;
  icon: string;
  tone?: 'success' | 'warning' | 'neutral';
}

const props = defineProps<{
  health: DeepReadonly<WorkerConnectionHealthResponse>;
}>();

const { t, locale } = useI18n();

const formatDate = (value: string | null): string => {
  if (!value) return '—';

  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
};

const formatNumber = (value: number): string =>
  new Intl.NumberFormat(locale.value).format(value);

const sessionItems = computed<DetailItem[]>(() => [
  {
    key: 'state',
    label: t('connection_health_session_state'),
    value: t(`connection_health_session_${props.health.session.state}`),
    icon: 'tabler-shield-lock',
    tone: props.health.session.state === 'ready' ? 'success' : 'warning',
  },
  {
    key: 'revision',
    label: t('connection_health_active_revision'),
    value: props.health.session.active_revision_id
      ? `#${props.health.session.active_revision_id}`
      : '—',
    icon: 'tabler-history',
  },
  {
    key: 'persisted',
    label: t('connection_health_last_persisted'),
    value: formatDate(props.health.session.last_persisted_at),
    icon: 'tabler-device-floppy',
  },
  {
    key: 'size',
    label: t('connection_health_revision_size'),
    value: formatConnectionBytes(
      props.health.session.active_revision_size_bytes,
      locale.value
    ),
    icon: 'tabler-file-description',
  },
]);

const storageItems = computed<DetailItem[]>(() => [
  {
    key: 'records',
    label: t('connection_health_protected_records'),
    value: formatNumber(props.health.session.protected_record_count),
    icon: 'tabler-lock-check',
  },
  {
    key: 'artifacts',
    label: t('connection_health_ready_artifacts'),
    value: formatNumber(props.health.session.artifact_count),
    icon: 'tabler-package',
  },
  {
    key: 'device',
    label: t('connection_health_device_record'),
    value: props.health.session.device_registered
      ? t('connection_health_present')
      : t('connection_health_not_present'),
    icon: 'tabler-device-mobile',
    tone: props.health.session.device_registered ? 'success' : 'neutral',
  },
  {
    key: 'failures',
    label: t('connection_health_failed_revisions'),
    value: formatNumber(props.health.session.failed_revision_count),
    icon: 'tabler-alert-hexagon',
    tone:
      props.health.session.failed_revision_count > 0 ? 'warning' : 'success',
  },
]);

const runtimeItems = computed<DetailItem[]>(() => [
  {
    key: 'lease',
    label: t('connection_health_lease'),
    value: props.health.lease.active
      ? t('connection_health_lease_active')
      : t('connection_health_lease_inactive'),
    icon: 'tabler-key',
    tone: props.health.lease.active ? 'success' : 'warning',
  },
  {
    key: 'heartbeat',
    label: t('connection_health_last_heartbeat'),
    value: formatDate(props.health.lease.heartbeat_at),
    icon: 'tabler-heartbeat',
  },
  {
    key: 'generation',
    label: t('connection_health_runtime_generation'),
    value: props.health.current_status?.runtime_generation
      ? `#${props.health.current_status.runtime_generation}`
      : '—',
    icon: 'tabler-stack-2',
  },
  {
    key: 'check',
    label: t('connection_health_last_check'),
    value: formatDate(props.health.channel.last_connection_check_at),
    icon: 'tabler-clock-check',
  },
]);

const groups = computed(() => [
  {
    key: 'session',
    title: t('connection_health_session_integrity'),
    subtitle: t('connection_health_session_integrity_description'),
    items: sessionItems.value,
  },
  {
    key: 'storage',
    title: t('connection_health_protected_data'),
    subtitle: t('connection_health_secure_persistence_description'),
    items: storageItems.value,
  },
  {
    key: 'runtime',
    title: t('connection_health_runtime'),
    subtitle: t('connection_health_runtime_description'),
    items: runtimeItems.value,
  },
]);
</script>

<template>
  <section class="details-section">
    <div class="details-section__heading">
      <span>{{ $t('connection_health_diagnostics') }}</span>
      <h3>{{ $t('connection_health_connection_details') }}</h3>
    </div>

    <div class="details-section__grid">
      <article v-for="group in groups" :key="group.key" class="detail-card">
        <header class="detail-card__header">
          <h4>{{ group.title }}</h4>
          <p>{{ group.subtitle }}</p>
        </header>

        <dl class="detail-card__list">
          <div
            v-for="item in group.items"
            :key="item.key"
            class="detail-card__row"
          >
            <dt>
              <span
                class="detail-card__row-icon"
                :class="`is-${item.tone || 'neutral'}`"
              >
                <VIcon :icon="item.icon" size="17" />
              </span>
              {{ item.label }}
            </dt>
            <dd>{{ item.value }}</dd>
          </div>
        </dl>
      </article>
    </div>
  </section>
</template>

<style scoped lang="scss">
.details-section__heading {
  margin-block-end: 0.9rem;
}

.details-section__heading > span {
  color: rgb(var(--v-theme-primary));
  font-size: 0.68rem;
  font-weight: 720;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.details-section__heading h3 {
  margin-block-start: 0.25rem;
  font-size: 1.08rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.details-section__grid {
  display: grid;
  gap: 0.9rem;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.detail-card {
  overflow: hidden;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 1rem;
  background: rgb(var(--v-theme-surface));
}

.detail-card__header {
  padding: 1rem 1rem 0.85rem;
  border-block-end: 1px solid rgba(var(--v-border-color), 0.09);
  background: rgba(var(--v-theme-primary), 0.025);
}

.detail-card__header h4 {
  font-size: 0.86rem;
  font-weight: 680;
}

.detail-card__header p {
  min-block-size: 2.2em;
  margin-block: 0.22rem 0;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.66rem;
  line-height: 1.4;
}

.detail-card__list {
  margin: 0;
  padding: 0.35rem 1rem;
}

.detail-card__row {
  display: flex;
  min-block-size: 3.05rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border-block-end: 1px solid rgba(var(--v-border-color), 0.075);
}

.detail-card__row:last-child {
  border-block-end: 0;
}

.detail-card__row dt {
  display: flex;
  min-inline-size: 0;
  align-items: center;
  gap: 0.55rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.7rem;
}

.detail-card__row dd {
  overflow: hidden;
  margin: 0;
  font-size: 0.72rem;
  font-weight: 650;
  text-align: end;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-card__row-icon {
  display: grid;
  flex: 0 0 auto;
  block-size: 1.85rem;
  inline-size: 1.85rem;
  border-radius: 0.55rem;
  background: rgba(var(--v-theme-on-surface), 0.055);
  color: rgba(var(--v-theme-on-surface), 0.58);
  place-items: center;
}

.detail-card__row-icon.is-success {
  background: rgba(var(--v-theme-success), 0.09);
  color: rgb(var(--v-theme-success));
}

.detail-card__row-icon.is-warning {
  background: rgba(var(--v-theme-warning), 0.1);
  color: rgb(var(--v-theme-warning));
}

@media (max-width: 980px) {
  .details-section__grid {
    grid-template-columns: 1fr;
  }

  .detail-card__header p {
    min-block-size: 0;
  }
}
</style>
