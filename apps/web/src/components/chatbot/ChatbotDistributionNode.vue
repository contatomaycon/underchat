<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import { useI18n } from 'vue-i18n';
import AppInfoTooltip from '@/components/AppInfoTooltip.vue';
import AppSelectSearch from '@/components/AppSelectSearch.vue';
import { useChatbotStore } from '@/@webcore/stores/chatbot';
import { getUser } from '@/@webcore/localStorage/user';

type DistributionType = 'sequential' | 'random' | 'load' | null;

interface DistributionNodeData {
  distributionType: DistributionType;
  distributionHasSector: boolean | null;
  distributionSelectedSector: string | null;
  onRemove?: () => void;
}

const props = defineProps<NodeProps>();
const { t } = useI18n();
const chatbotStore = useChatbotStore();

const getInitialData = (): DistributionNodeData => {
  const data = props.data as DistributionNodeData | undefined;
  return {
    distributionType: data?.distributionType || null,
    distributionHasSector: data?.distributionHasSector ?? false,
    distributionSelectedSector: data?.distributionSelectedSector || null,
  };
};

const distributionNodeData = ref<DistributionNodeData>(getInitialData());

const sectors = ref<any[]>([]);
const isLoadingSectors = ref(false);

const showSectorSelect = computed(
  () => distributionNodeData.value.distributionHasSector === true
);

const distributionTypeOptions = computed(() => [
  {
    value: 'sequential',
    title: t('chatbot_distribution_type_sequential'),
  },
  {
    value: 'random',
    title: t('chatbot_distribution_type_random'),
  },
  {
    value: 'load',
    title: t('chatbot_distribution_type_load'),
  },
]);

const loadSectors = async () => {
  if (isLoadingSectors.value) return;

  const user = getUser();
  if (!user?.account_id) return;

  isLoadingSectors.value = true;
  try {
    const sectorsList = await chatbotStore.listChatbotSectors();
    sectors.value = sectorsList.map((sector) => ({
      value: sector.id,
      title: sector.name,
      color: sector.color || null,
    }));

    if (
      distributionNodeData.value.distributionSelectedSector &&
      !sectors.value.some(
        (s) => s.value === distributionNodeData.value.distributionSelectedSector
      )
    ) {
      sectors.value.unshift({
        value: distributionNodeData.value.distributionSelectedSector,
        title: distributionNodeData.value.distributionSelectedSector,
        color: null,
      });
    }
  } catch (error) {
    console.error('Error loading sectors:', error);
  } finally {
    isLoadingSectors.value = false;
  }
};

const updateNodeData = () => {
  if (props.data) {
    const data = props.data as DistributionNodeData;
    data.distributionType = distributionNodeData.value.distributionType;
    data.distributionHasSector =
      distributionNodeData.value.distributionHasSector;
    data.distributionSelectedSector =
      distributionNodeData.value.distributionSelectedSector;
  }
};

const handleRemove = () => {
  const data = props.data as DistributionNodeData;
  if (data?.onRemove) {
    data.onRemove();
  }
};

watch(
  () => distributionNodeData.value.distributionHasSector,
  (newValue) => {
    if (newValue === true && sectors.value.length === 0) {
      loadSectors();
    }
    if (newValue === false) {
      distributionNodeData.value.distributionSelectedSector = null;
    }
    updateNodeData();
  }
);

watch(
  () => distributionNodeData.value,
  () => {
    updateNodeData();
  },
  { deep: true }
);

onMounted(() => {
  if (distributionNodeData.value.distributionHasSector === true) {
    loadSectors();
  }
});
</script>

<template>
  <div class="chatbot-distribution-node">
    <Handle id="target" type="target" :position="Position.Top" class="handle-target" />

    <VCard class="distribution-card" elevation="2">
      <VCardTitle
        class="d-flex align-center justify-space-between pa-2 node-drag-handle"
      >
        <div class="d-flex align-center ga-2 node-title-container">
          <VIcon icon="tabler-users-group" color="distribution" size="20" />
          <span class="text-sm font-weight-medium node-title">{{
            t('chatbot_distribution')
          }}</span>
        </div>
        <VIcon
          v-if="(props.data as DistributionNodeData)?.onRemove"
          icon="tabler-x"
          size="18"
          color="error"
          class="cursor-pointer"
          @click.stop="handleRemove"
        />
      </VCardTitle>

      <VCardText class="pa-3">
        <div class="mb-3">
          <div class="d-flex align-center ga-1 mb-1">
            <VLabel class="text-body-2">{{
              t('chatbot_distribution_label')
            }}</VLabel>
            <AppInfoTooltip
              :text="t('chatbot_distribution_tooltip')"
              :title="t('chatbot_distribution_label')"
            />
          </div>
          <VSelect
            v-model="distributionNodeData.distributionType"
            :items="distributionTypeOptions"
            variant="outlined"
            density="compact"
            hide-details
          />
        </div>

        <div class="mb-3">
          <VLabel class="text-body-2 mb-1">{{
            t('chatbot_distribution_enable_sector')
          }}</VLabel>
          <VSelect
            v-model="distributionNodeData.distributionHasSector"
            :items="[
              { value: true, title: t('yes') },
              { value: false, title: t('no') },
            ]"
            variant="outlined"
            density="compact"
            hide-details
          />
        </div>

        <div v-if="showSectorSelect" class="mb-2">
          <VLabel class="text-body-2 mb-1">{{
            t('chatbot_sector_label')
          }}</VLabel>
          <AppSelectSearch
            v-model="distributionNodeData.distributionSelectedSector"
            :items="sectors"
            :placeholder="t('chatbot_search')"
            :loading="isLoadingSectors"
            :clearable="true"
            item-value="value"
            item-title="title"
            @select="loadSectors()"
          >
            <template #item-prepend="{ item }">
              <VAvatar
                size="24"
                :style="{
                  backgroundColor: item.color || '#1976D2',
                }"
              />
            </template>
          </AppSelectSearch>
        </div>
      </VCardText>
    </VCard>
  </div>
</template>

<style scoped>
.chatbot-distribution-node {
  min-width: 380px;
  position: relative;
}

.distribution-card {
  border-radius: 8px;
}

.node-drag-handle {
  cursor: grab;
  user-select: none;
}

.node-drag-handle:active {
  cursor: grabbing;
}

.node-title-container {
  flex: 1;
  min-width: 0;
}

.node-title {
  white-space: normal;
  word-break: break-word;
  line-height: 1.3;
  max-width: 280px;
}

.cursor-pointer {
  cursor: pointer;
}

:deep(.handle-source),
:deep(.handle-target) {
  z-index: 10;
}
</style>
