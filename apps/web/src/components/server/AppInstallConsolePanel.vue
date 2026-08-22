<script setup lang="ts">
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue';
import { formatDateTimeSeconds } from '@core/common/functions/formatDateTimeSeconds';
import {
  buildInstallConsoleModel,
  type InstallConsoleSeverity,
  type InstallConsoleSourceItem,
  type InstallConsoleStage,
} from './installConsole';

const props = withDefaults(
  defineProps<{
    hasMore?: boolean;
    items: InstallConsoleSourceItem[];
    live?: boolean;
    loading?: boolean;
    serverStatus?: string | null;
  }>(),
  {
    hasMore: false,
    live: false,
    loading: false,
  }
);

const emit = defineEmits<{
  loadMore: [];
}>();

const search = shallowRef('');
const severityFilter = shallowRef<'all' | InstallConsoleSeverity>('all');
const isTechnicalVisible = shallowRef(true);
const feedRef = useTemplateRef<HTMLElement>('feed');

const model = computed(() =>
  buildInstallConsoleModel(props.items, props.serverStatus)
);

const latestAtLabel = computed(() => {
  if (!model.value.latestAt) {
    return 'Sem eventos recebidos';
  }

  return formatDateTimeSeconds(model.value.latestAt);
});

const filteredEntries = computed(() => {
  const query = search.value.trim().toLowerCase();

  return model.value.entries.filter((entry) => {
    const matchesSeverity =
      severityFilter.value === 'all' || entry.severity === severityFilter.value;
    const matchesSearch =
      !query ||
      entry.message.toLowerCase().includes(query) ||
      entry.commandLabel.toLowerCase().includes(query);

    return matchesSeverity && matchesSearch;
  });
});

const statusLabel = (status: InstallConsoleStage['status']): string => {
  if (status === 'complete') return 'Pronto';
  if (status === 'running') return 'Agora';
  if (status === 'error') return 'Erro';
  if (status === 'canceled') return 'Cancelada';

  return 'Pendente';
};

const stageColor = (status: InstallConsoleStage['status']): string => {
  if (status === 'complete') return 'success';
  if (status === 'running') return 'warning';
  if (status === 'error') return 'error';
  if (status === 'canceled') return 'secondary';

  return 'secondary';
};

const severityColor = (severity: InstallConsoleSeverity): string => {
  if (severity === 'success') return 'success';
  if (severity === 'warning') return 'warning';
  if (severity === 'error') return 'error';

  return 'info';
};

const severityIcon = (severity: InstallConsoleSeverity): string => {
  if (severity === 'success') return 'tabler-circle-check';
  if (severity === 'warning') return 'tabler-alert-triangle';
  if (severity === 'error') return 'tabler-circle-x';

  return 'tabler-point';
};

const scrollFeedToBottom = async (): Promise<void> => {
  if (!isTechnicalVisible.value) return;

  await nextTick();

  if (typeof window === 'undefined') {
    const feed = feedRef.value;
    if (feed) feed.scrollTop = feed.scrollHeight;
    return;
  }

  window.requestAnimationFrame(() => {
    const feed = feedRef.value;
    if (!feed) return;

    feed.scrollTop = feed.scrollHeight;

    window.requestAnimationFrame(() => {
      feed.scrollTop = feed.scrollHeight;
    });
  });
};

watch(
  [
    () => filteredEntries.value.length,
    () => filteredEntries.value.at(-1)?.id,
    isTechnicalVisible,
    () => props.loading,
  ],
  () => {
    void scrollFeedToBottom();
  },
  { immediate: true, flush: 'post' }
);
</script>

<template>
  <div class="install-console">
    <div class="install-console__summary">
      <div class="install-console__summary-copy">
        <div class="install-console__eyebrow">
          {{ live ? 'Console ao vivo' : 'Histórico da instalação' }}
        </div>
        <h3 class="install-console__title">Console de Instalação</h3>
        <div class="install-console__meta">
          <VIcon icon="tabler-clock" size="16" />
          <span>{{ latestAtLabel }}</span>
        </div>
      </div>

      <VChip
        :color="model.statusColor"
        class="install-console__status"
        label
        size="small"
      >
        <VIcon
          :class="{
            'install-console__spin': model.statusText === 'Em andamento',
          }"
          :icon="model.statusIcon"
          size="16"
          start
        />
        {{ model.statusText }}
      </VChip>
    </div>

    <VProgressLinear
      :color="model.statusColor"
      :model-value="model.progress"
      class="install-console__progress"
      height="8"
      rounded
    />

    <div class="install-console__metrics">
      <div class="install-console__metric">
        <span class="install-console__metric-value">
          {{ model.entries.length }}
        </span>
        <span class="install-console__metric-label">eventos</span>
      </div>
      <div class="install-console__metric">
        <span class="install-console__metric-value">
          {{ model.warningCount }}
        </span>
        <span class="install-console__metric-label">avisos</span>
      </div>
      <div class="install-console__metric">
        <span class="install-console__metric-value">
          {{ model.errorCount }}
        </span>
        <span class="install-console__metric-label">erros</span>
      </div>
    </div>

    <div class="install-console__grid">
      <section class="install-console__timeline" aria-label="Etapas">
        <div
          v-for="stage in model.stages"
          :key="stage.id"
          :class="[
            'install-console__stage',
            `install-console__stage--${stage.status}`,
          ]"
        >
          <div class="install-console__stage-marker">
            <VIcon :icon="stage.icon" size="18" />
          </div>

          <div class="install-console__stage-body">
            <div class="install-console__stage-title-row">
              <span class="install-console__stage-title">
                {{ stage.title }}
              </span>
              <VChip
                :color="stageColor(stage.status)"
                label
                size="x-small"
                variant="tonal"
              >
                {{ statusLabel(stage.status) }}
              </VChip>
            </div>
            <p class="install-console__stage-description">
              {{ stage.description }}
            </p>
          </div>
        </div>
      </section>

      <section class="install-console__details" aria-label="Eventos">
        <div class="install-console__toolbar">
          <VTextField
            v-model="search"
            class="install-console__search"
            clearable
            density="compact"
            hide-details
            prepend-inner-icon="tabler-search"
            placeholder="Buscar nos eventos"
            variant="outlined"
          />

          <VBtn
            :prepend-icon="
              isTechnicalVisible ? 'tabler-eye-off' : 'tabler-list-details'
            "
            color="secondary"
            size="small"
            variant="tonal"
            @click="isTechnicalVisible = !isTechnicalVisible"
          >
            {{ isTechnicalVisible ? 'Ocultar' : 'Detalhes' }}
          </VBtn>
        </div>

        <div class="install-console__filters">
          <VBtn
            :color="severityFilter === 'all' ? 'primary' : 'secondary'"
            :variant="severityFilter === 'all' ? 'tonal' : 'outlined'"
            class="install-console__filter-button"
            prepend-icon="tabler-list"
            size="small"
            @click="severityFilter = 'all'"
          >
            Todos
          </VBtn>
          <VBtn
            :color="severityFilter === 'error' ? 'error' : 'secondary'"
            :variant="severityFilter === 'error' ? 'tonal' : 'outlined'"
            class="install-console__filter-button"
            prepend-icon="tabler-circle-x"
            size="small"
            @click="severityFilter = 'error'"
          >
            Erros
          </VBtn>
          <VBtn
            :color="severityFilter === 'warning' ? 'warning' : 'secondary'"
            :variant="severityFilter === 'warning' ? 'tonal' : 'outlined'"
            class="install-console__filter-button"
            prepend-icon="tabler-alert-triangle"
            size="small"
            @click="severityFilter = 'warning'"
          >
            Avisos
          </VBtn>
        </div>

        <div
          v-show="isTechnicalVisible"
          ref="feed"
          class="install-console__feed"
        >
          <div v-if="props.loading" class="install-console__empty">
            <VProgressCircular color="primary" indeterminate size="24" />
            <span>Carregando eventos...</span>
          </div>

          <div
            v-else-if="filteredEntries.length === 0"
            class="install-console__empty"
          >
            <VIcon icon="tabler-terminal-2" size="24" />
            <span>Nenhum evento encontrado</span>
          </div>

          <template v-else>
            <div
              v-for="entry in filteredEntries"
              :key="entry.id"
              class="install-console__row"
            >
              <VIcon
                :color="severityColor(entry.severity)"
                :icon="severityIcon(entry.severity)"
                class="install-console__row-icon"
                size="16"
              />
              <div class="install-console__row-content">
                <div class="install-console__row-meta">
                  <time class="install-console__row-time">
                    {{ formatDateTimeSeconds(entry.date) }}
                  </time>
                  <span class="install-console__row-command">
                    {{ entry.commandLabel }}
                  </span>
                </div>
                <div class="install-console__row-message">
                  {{ entry.message }}
                </div>
              </div>
            </div>
          </template>
        </div>

        <div v-if="props.hasMore" class="install-console__load-more">
          <VBtn
            color="primary"
            prepend-icon="tabler-arrow-down-circle"
            variant="tonal"
            @click="emit('loadMore')"
          >
            Carregar anteriores
          </VBtn>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.install-console {
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  gap: 18px;
  block-size: 100%;
  min-inline-size: 0;
  min-block-size: 0;
  overflow: hidden;
}

.install-console__summary {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px;
  border: 1px solid rgba(var(--v-theme-primary), 0.18);
  border-radius: 8px;
  background:
    linear-gradient(
      135deg,
      rgba(var(--v-theme-primary), 0.08),
      transparent 58%
    ),
    rgba(var(--v-theme-surface), 1);
}

.install-console__summary-copy {
  display: grid;
  gap: 4px;
  min-inline-size: 0;
}

.install-console__eyebrow {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
}

.install-console__title {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.92);
  font-size: 1.35rem;
  font-weight: 800;
  letter-spacing: 0;
  line-height: 1.2;
}

.install-console__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.86rem;
}

.install-console__status {
  flex: 0 0 auto;
}

.install-console__progress {
  overflow: hidden;
}

.install-console__metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.install-console__metric {
  display: grid;
  gap: 2px;
  padding: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 8px;
  background: rgba(var(--v-theme-surface), 0.72);
}

.install-console__metric-value {
  color: rgba(var(--v-theme-on-surface), 0.92);
  font-size: 1.15rem;
  font-weight: 800;
  line-height: 1;
}

.install-console__metric-label {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.78rem;
}

.install-console__grid {
  display: grid;
  grid-template-columns: minmax(250px, 0.86fr) minmax(0, 1.44fr);
  align-items: stretch;
  gap: 16px;
  block-size: 100%;
  min-block-size: 0;
}

.install-console__timeline,
.install-console__details {
  min-inline-size: 0;
}

.install-console__timeline {
  display: grid;
  align-content: start;
  gap: 10px;
  min-block-size: 0;
  overflow: auto;
  padding-inline-end: 2px;
}

.install-console__stage {
  position: relative;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 8px;
  background: rgba(var(--v-theme-surface), 0.78);
}

.install-console__stage--running {
  border-color: rgba(var(--v-theme-warning), 0.5);
  background: rgba(var(--v-theme-warning), 0.08);
}

.install-console__stage--complete {
  border-color: rgba(var(--v-theme-success), 0.34);
}

.install-console__stage--error {
  border-color: rgba(var(--v-theme-error), 0.5);
  background: rgba(var(--v-theme-error), 0.08);
}

.install-console__stage-marker {
  display: grid;
  place-items: center;
  block-size: 34px;
  inline-size: 34px;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}

.install-console__stage-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.install-console__stage-title {
  overflow-wrap: anywhere;
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-size: 0.92rem;
  font-weight: 800;
}

.install-console__stage-description {
  margin: 4px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.78rem;
  line-height: 1.35;
}

.install-console__details {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  align-content: stretch;
  gap: 10px;
  min-block-size: 0;
}

.install-console__toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
}

.install-console__search {
  min-inline-size: 0;
}

.install-console__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.install-console__filter-button {
  min-inline-size: 104px;
}

.install-console__feed {
  display: grid;
  align-content: start;
  gap: 8px;
  block-size: 100%;
  min-block-size: 0;
  max-block-size: none;
  overflow: auto;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: #111414;
  color: #eaf1ec;
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
    monospace;
}

.install-console__row {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  padding: 7px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.install-console__row:last-child {
  border-bottom: 0;
}

.install-console__row-time {
  color: rgba(234, 241, 236, 0.54);
  font-size: 0.72rem;
  white-space: nowrap;
}

.install-console__row-icon {
  margin-block-start: 1px;
}

.install-console__row-content {
  min-inline-size: 0;
}

.install-console__row-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  min-inline-size: 0;
}

.install-console__row-command {
  min-inline-size: 0;
  overflow-wrap: anywhere;
  color: rgba(234, 241, 236, 0.62);
  font-size: 0.72rem;
  line-height: 1.35;
}

.install-console__row-message {
  overflow-wrap: anywhere;
  color: #f7fbf8;
  font-size: 0.82rem;
  line-height: 1.45;
  white-space: pre-wrap;
}

.install-console__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-block-size: 180px;
  color: rgba(234, 241, 236, 0.72);
}

.install-console__load-more {
  display: flex;
  justify-content: flex-end;
}

.install-console__spin {
  animation: install-console-spin 1s linear infinite;
}

@keyframes install-console-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 900px) {
  .install-console__grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .install-console__summary,
  .install-console__toolbar {
    grid-template-columns: 1fr;
  }

  .install-console__summary {
    display: grid;
  }

  .install-console__metrics {
    grid-template-columns: 1fr;
  }

  .install-console__row-time {
    white-space: normal;
  }
}
</style>
