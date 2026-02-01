<script lang="ts" setup>
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAiAgentStore } from '@/@webcore/stores/aiAgent';
import { DataTableHeader } from 'vuetify';
import { ListAiAgentUsageResponseItem } from '@core/schema/aiAgent/listAiAgentUsage/response.schema';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import TablePagination from '@/@webcore/components/TablePagination.vue';

const aiAgentStore = useAiAgentStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  aiAgentId: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void;
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const aiAgentId = computed(() => props.aiAgentId);
const options = ref({
  page: 1,
  itemsPerPage: 10,
});

const headers: DataTableHeader<ListAiAgentUsageResponseItem>[] = [
  { title: t('ai_agent_usage_prompt_tokens'), key: 'prompt_tokens' },
  { title: t('ai_agent_usage_completion_tokens'), key: 'completion_tokens' },
  { title: t('ai_agent_usage_total_tokens'), key: 'total_tokens' },
  { title: t('model'), key: 'model' },
  { title: t('ai_agent_usage_latency_ms'), key: 'latency_ms' },
  { title: t('status'), key: 'success' },
  { title: t('created_at'), key: 'created_at' },
];

const loadUsage = async () => {
  if (!aiAgentId.value) return;

  await aiAgentStore.listAiAgentUsage(
    aiAgentId.value,
    options.value.page,
    options.value.itemsPerPage
  );
};

const handleTableChange = (o: { page: number; itemsPerPage: number }) => {
  const pageChanged = options.value.page !== o.page;
  const perPageChanged = options.value.itemsPerPage !== o.itemsPerPage;
  options.value.page = o.page;
  options.value.itemsPerPage = o.itemsPerPage;
  if (
    (pageChanged || perPageChanged) &&
    isVisible.value &&
    aiAgentId.value
  ) {
    loadUsage();
  }
};

watch(
  isVisible,
  (newValue) => {
    if (newValue && aiAgentId.value) {
      options.value.page = 1;
      loadUsage();
    }
  },
  { immediate: true }
);
</script>

<template>
  <VDialog v-model="isVisible" max-width="900" persistent>
    <VCard>
      <VCardTitle class="d-flex align-center justify-space-between pa-4">
        <span>{{ $t('ai_agent_usage_title') }}</span>
        <VBtn
          icon
          size="small"
          variant="text"
          @click="isVisible = false"
          :disabled="aiAgentStore.usageLoading"
        >
          <VIcon icon="tabler-x" />
        </VBtn>
      </VCardTitle>
      <VDivider />
      <VCardText class="pa-4">
        <template v-if="aiAgentStore.usageLoading">
          <div class="ai-agent-usage-skeleton">
            <div class="d-flex gap-2 mb-4">
              <VSkeletonLoader
                v-for="i in 7"
                :key="`header-${i}`"
                type="text"
                width="80"
                height="20"
                class="flex-grow-1"
              />
            </div>
            <div
              v-for="row in 8"
              :key="row"
              class="d-flex gap-2 align-center mb-3"
            >
              <VSkeletonLoader
                v-for="col in 7"
                :key="`${row}-${col}`"
                type="text"
                height="16"
                :width="col === 4 ? 100 : 60"
                class="flex-grow-1"
              />
            </div>
          </div>
        </template>
        <VDataTableServer
          v-else
          v-model:page="options.page"
          v-model:items-per-page="options.itemsPerPage"
          :headers="headers"
          :items="aiAgentStore.usageList"
          :items-length="aiAgentStore.usagePagings.total"
          :loading="false"
          class="data-table"
          @update:options="handleTableChange"
          :loading-text="$t('loading_text')"
        >
          <template #item.prompt_tokens="{ item }">
            {{ item.prompt_tokens ?? '-' }}
          </template>

          <template #item.completion_tokens="{ item }">
            {{ item.completion_tokens ?? '-' }}
          </template>

          <template #item.total_tokens="{ item }">
            {{ item.total_tokens ?? '-' }}
          </template>

          <template #item.model="{ item }">
            {{ item.model ?? '-' }}
          </template>

          <template #item.latency_ms="{ item }">
            {{ item.latency_ms != null ? item.latency_ms + ' ms' : '-' }}
          </template>

          <template #item.success="{ item }">
            <VChip
              :color="item.success === true ? 'success' : 'error'"
              size="small"
            >
              {{
                item.success === true
                  ? $t('ai_agent_usage_success')
                  : $t('ai_agent_usage_failure')
              }}
            </VChip>
          </template>

          <template #item.created_at="{ item }">
            {{ formatDateTime(item.created_at ?? null) }}
          </template>

          <template #no-data>
            {{ $t('no_data_available') }}
          </template>

          <template #bottom>
            <TablePagination
              v-if="
                options.itemsPerPage !== -1 &&
                aiAgentStore.usagePagings.total > 0
              "
              v-model:page="options.page"
              :items-per-page="options.itemsPerPage"
              :total-items="aiAgentStore.usagePagings.total"
            />
          </template>
        </VDataTableServer>
      </VCardText>
    </VCard>
  </VDialog>
</template>

<style lang="scss" scoped>
.ai-agent-usage-skeleton {
  min-height: 200px;
}

.data-table {
  :deep(.v-table__wrapper > table > thead) {
    background-color: rgba(var(--v-theme-on-surface), 0.04);
  }

  :deep(.v-table__wrapper > table > thead > tr > th) {
    background-color: transparent;
    color: rgb(var(--v-theme-primary));
    font-weight: 700;
    border-bottom: 1px solid rgba(var(--v-theme-primary), 0.25);
  }
}
</style>
