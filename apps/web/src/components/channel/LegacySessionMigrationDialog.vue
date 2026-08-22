<script setup lang="ts">
import { computed } from 'vue';
import { useNow } from '@vueuse/core';
import type { ListChannelsResponse } from '@core/schema/config/listChannels/response.schema';
import type { SessionStorageMigrationSummary } from '@core/schema/config/sessionStorageMigration/response.schema';

const props = defineProps<{
  modelValue: boolean;
  channel: ListChannelsResponse | null;
  migration: SessionStorageMigrationSummary | null;
  loading?: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'start'): void;
  (event: 'delete-volume'): void;
  (event: 'keep-volume'): void;
}>();

const { t } = useI18n();
const now = useNow({ interval: 1_000 });
const terminalSuccess = computed(() =>
  ['cleanup_pending', 'deleting_volume', 'completed'].includes(
    props.migration?.state ?? ''
  )
);
const restored = computed(() => props.migration?.state === 'restored');
const recoveryRequired = computed(
  () => props.migration?.state === 'recovery_required'
);
const isProgress = computed(
  () =>
    Boolean(props.migration) &&
    !terminalSuccess.value &&
    !restored.value &&
    !recoveryRequired.value
);
const elapsedSeconds = computed(() => {
  const started = props.migration?.attempt_started_at;
  return started
    ? Math.max(
        0,
        Math.floor((now.value.getTime() - Date.parse(started)) / 1000)
      )
    : 0;
});
const formatDuration = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(
    seconds % 60
  ).padStart(2, '0')}`;
const progress = computed(() =>
  Math.min(100, Math.round((elapsedSeconds.value / 300) * 100))
);
const close = () => emit('update:modelValue', false);
</script>

<template>
  <VDialog
    :model-value="modelValue"
    max-width="920"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <DialogCloseBtn :aria-label="t('close')" @click="close" />

    <VCard class="legacy-migration overflow-hidden">
      <div class="legacy-migration__glow" />

      <VCardText class="pa-8 pa-md-10 position-relative">
        <template v-if="!migration">
          <div class="text-center mb-8">
            <VAvatar color="info" variant="tonal" size="64" class="mb-4">
              <VIcon icon="tabler-database-export" size="34" />
            </VAvatar>
            <h2 class="text-h3 mb-3">
              {{ t('session_migration_confirm_title') }}
            </h2>
            <p class="text-body-1 text-medium-emphasis mx-auto migration-copy">
              {{ t('session_migration_confirm_description') }}
            </p>
          </div>

          <div class="migration-summary mb-6">
            <div>
              <span class="migration-kicker">{{ t('channel') }}</span>
              <strong>{{ channel?.name }}</strong>
              <small>{{ channel?.number || '-' }}</small>
            </div>
            <div>
              <span class="migration-kicker">{{ t('provider') }}</span>
              <strong>{{ channel?.type?.name || channel?.type?.id }}</strong>
              <small>{{ channel?.server?.name || '-' }}</small>
            </div>
          </div>

          <div class="migration-route mb-6">
            <div class="migration-endpoint">
              <VIcon icon="tabler-box" color="warning" size="28" />
              <div>
                <span>{{ t('origin') }}</span>
                <strong>{{ t('session_storage_legacy_volume') }}</strong>
              </div>
            </div>
            <VIcon icon="tabler-arrow-right" color="info" size="30" />
            <div class="migration-endpoint migration-endpoint--target">
              <VIcon icon="tabler-database" color="success" size="28" />
              <div>
                <span>{{ t('destination') }}</span>
                <strong>{{ t('session_storage_postgres') }}</strong>
              </div>
            </div>
          </div>

          <VAlert
            color="warning"
            variant="tonal"
            icon="tabler-shield-lock"
            class="mb-7"
          >
            {{ t('session_migration_non_cancelable_warning') }}
          </VAlert>
          <div class="d-flex justify-end gap-3">
            <VBtn variant="text" @click="close">{{ t('close') }}</VBtn>
            <VBtn color="primary" :loading="loading" @click="emit('start')">
              <VIcon icon="tabler-transfer" start />
              {{ t('migrate_session') }}
            </VBtn>
          </div>
        </template>

        <template v-else-if="isProgress">
          <div class="text-center mb-8">
            <VChip color="info" variant="tonal" class="mb-4">
              <VIcon icon="tabler-loader-2" start class="migration-spin" />
              {{ t('session_migration_secure_in_progress') }}
            </VChip>
            <h2 class="text-h3 mb-3">
              {{ t('session_migration_progress_title') }}
            </h2>
            <p class="text-body-1 text-medium-emphasis">
              {{ t('session_migration_progress_description') }}
            </p>
          </div>

          <div class="migration-route mb-6">
            <div class="migration-endpoint">
              <VIcon icon="tabler-box" color="warning" size="28" />
              <div>
                <span>{{ t('origin') }}</span>
                <strong>{{ t('session_storage_legacy_volume') }}</strong>
                <small>{{ t('session_migration_source_preserved') }}</small>
              </div>
            </div>
            <VAvatar color="info" size="48"
              ><VIcon icon="tabler-lock-check"
            /></VAvatar>
            <div class="migration-endpoint migration-endpoint--target">
              <VIcon icon="tabler-database" color="info" size="28" />
              <div>
                <span>{{ t('destination') }}</span>
                <strong>{{ t('session_storage_postgres') }}</strong>
                <small>{{
                  t(`session_migration_phase_${migration.phase}`)
                }}</small>
              </div>
            </div>
          </div>

          <div class="migration-status pa-5 mb-6">
            <div
              class="d-flex align-center justify-space-between flex-wrap gap-3 mb-4"
            >
              <div>
                <span class="migration-kicker">{{
                  t('real_time_status')
                }}</span>
                <strong class="d-block">
                  {{ t(`session_migration_phase_${migration.phase}`) }}
                </strong>
              </div>
              <div class="d-flex gap-6 text-right">
                <div>
                  <small>{{ t('attempt') }}</small
                  ><strong class="d-block"
                    >{{ migration.attempt_count }} / 3</strong
                  >
                </div>
                <div>
                  <small>{{ t('elapsed') }}</small
                  ><strong class="d-block">{{
                    formatDuration(elapsedSeconds)
                  }}</strong>
                </div>
                <div>
                  <small>{{ t('limit') }}</small
                  ><strong class="d-block">05:00</strong>
                </div>
              </div>
            </div>
            <VProgressLinear
              :model-value="progress"
              color="info"
              rounded
              height="7"
            />
          </div>

          <VAlert
            color="success"
            variant="tonal"
            icon="tabler-shield-check"
            class="mb-5"
          >
            {{ t('session_migration_close_safe') }}
          </VAlert>
          <div class="d-flex justify-end">
            <VBtn variant="outlined" @click="close">{{
              t('close_and_follow_later')
            }}</VBtn>
          </div>
        </template>

        <template v-else-if="recoveryRequired">
          <div class="text-center">
            <VAvatar color="error" variant="tonal" size="72" class="mb-4">
              <VIcon icon="tabler-database-x" size="42" />
            </VAvatar>
            <h2 class="text-h3 mb-3">
              {{ t('session_migration_recovery_required_title') }}
            </h2>
            <p
              class="text-body-1 text-medium-emphasis migration-copy mx-auto mb-5"
            >
              {{ t('session_migration_recovery_required_description') }}
            </p>
            <VAlert
              color="error"
              variant="tonal"
              icon="tabler-shield-x"
              class="text-start mb-7"
            >
              {{ t('session_migration_recovery_required_warning') }}
            </VAlert>
            <VBtn color="primary" @click="close">{{ t('close') }}</VBtn>
          </div>
        </template>

        <template v-else-if="terminalSuccess">
          <div class="text-center mb-8">
            <VAvatar color="success" variant="tonal" size="72" class="mb-4">
              <VIcon icon="tabler-circle-check" size="42" />
            </VAvatar>
            <h2 class="text-h3 mb-3">
              {{ t('session_migration_success_title') }}
            </h2>
            <p class="text-body-1 text-medium-emphasis migration-copy mx-auto">
              {{ t('session_migration_success_description') }}
            </p>
          </div>
          <div class="evidence-grid mb-7">
            <VChip
              color="success"
              variant="tonal"
              prepend-icon="tabler-user-check"
              >{{ t('authenticated') }}</VChip
            >
            <VChip
              color="success"
              variant="tonal"
              prepend-icon="tabler-database"
              >{{ t('session_migration_revision_active') }}</VChip
            >
            <VChip color="success" variant="tonal" prepend-icon="tabler-send">{{
              t('session_migration_send_receive_ready')
            }}</VChip>
            <VChip
              color="success"
              variant="tonal"
              prepend-icon="tabler-plug-connected"
              >{{ t('session_migration_ingress_ready') }}</VChip
            >
          </div>
          <VAlert
            v-if="migration.state !== 'completed'"
            color="warning"
            variant="tonal"
            icon="tabler-box-off"
            class="mb-7"
          >
            {{ t('session_migration_cleanup_manual_warning') }}
          </VAlert>
          <VAlert
            v-else
            color="success"
            variant="tonal"
            icon="tabler-check"
            class="mb-7"
          >
            {{ t('session_migration_volume_absence_confirmed') }}
          </VAlert>
          <div class="d-flex justify-end flex-wrap gap-3">
            <VBtn variant="text" @click="emit('keep-volume')">
              {{
                migration.state === 'completed' ? t('close') : t('keep_for_now')
              }}
            </VBtn>
            <VBtn
              v-if="migration.state !== 'completed'"
              color="error"
              :loading="loading || migration.state === 'deleting_volume'"
              @click="emit('delete-volume')"
            >
              <VIcon icon="tabler-trash-x" start />
              {{ t('delete_legacy_volume') }}
            </VBtn>
          </div>
        </template>

        <template v-else>
          <div class="text-center">
            <VAvatar color="warning" variant="tonal" size="72" class="mb-4">
              <VIcon icon="tabler-restore" size="42" />
            </VAvatar>
            <h2 class="text-h3 mb-3">
              {{ t('session_migration_restored_title') }}
            </h2>
            <p
              class="text-body-1 text-medium-emphasis migration-copy mx-auto mb-7"
            >
              {{ t('session_migration_restored_description') }}
            </p>
            <VBtn color="primary" @click="close">{{ t('close') }}</VBtn>
          </div>
        </template>
      </VCardText>
    </VCard>
  </VDialog>
</template>

<style scoped lang="scss">
.legacy-migration {
  position: relative;
}
.legacy-migration__glow {
  position: absolute;
  inset: 0 15% auto;
  block-size: 220px;
  background: radial-gradient(
    circle,
    rgba(var(--v-theme-info), 0.18),
    transparent 68%
  );
  pointer-events: none;
}
.migration-copy {
  max-inline-size: 620px;
}
.migration-summary,
.migration-route {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 18px;
  align-items: center;
}
.migration-summary {
  grid-template-columns: repeat(2, 1fr);
}
.migration-summary > div,
.migration-endpoint,
.migration-status {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  background: rgba(var(--v-theme-surface), 0.8);
}
.migration-summary > div {
  padding: 18px;
  display: grid;
}
.migration-endpoint {
  padding: 22px;
  display: flex;
  align-items: center;
  gap: 14px;
  min-block-size: 104px;
}
.migration-endpoint div {
  display: grid;
}
.migration-endpoint span,
.migration-kicker {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.migration-endpoint small,
.migration-summary small {
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin-block-start: 4px;
}
.migration-endpoint--target {
  border-color: rgba(var(--v-theme-info), 0.45);
}
.evidence-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.evidence-grid :deep(.v-chip) {
  justify-content: flex-start;
  block-size: 44px;
}
.migration-spin {
  animation: migration-spin 1s linear infinite;
}
@keyframes migration-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 700px) {
  .migration-summary,
  .migration-route,
  .evidence-grid {
    grid-template-columns: 1fr;
  }
  .migration-route > .v-icon,
  .migration-route > .v-avatar {
    transform: rotate(90deg);
    justify-self: center;
  }
}
</style>
