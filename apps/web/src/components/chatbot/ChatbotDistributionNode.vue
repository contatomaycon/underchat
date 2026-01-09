<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import { useI18n } from 'vue-i18n';
import AppInfoTooltip from '@/components/AppInfoTooltip.vue';

type DistributionType = 'sequential' | 'random' | 'load' | 'affinity' | null;

interface DistributionNodeData {
  distributionType: DistributionType;
  onRemove?: () => void;
}

const props = defineProps<NodeProps>();
const { t } = useI18n();

const getInitialData = (): DistributionNodeData => {
  const data = props.data as DistributionNodeData | undefined;
  return {
    distributionType: data?.distributionType || null,
  };
};

const distributionNodeData = ref<DistributionNodeData>(getInitialData());

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
  {
    value: 'affinity',
    title: t('chatbot_distribution_type_affinity'),
  },
]);

const updateNodeData = () => {
  if (props.data) {
    const data = props.data as DistributionNodeData;
    data.distributionType = distributionNodeData.value.distributionType;
  }
};

const handleRemove = () => {
  const data = props.data as DistributionNodeData;
  if (data?.onRemove) {
    data.onRemove();
  }
};

watch(
  () => distributionNodeData.value,
  () => {
    updateNodeData();
  },
  { deep: true }
);
</script>

<template>
  <div class="chatbot-distribution-node">
    <Handle type="target" :position="Position.Top" class="handle-target" />
    <Handle type="source" :position="Position.Bottom" class="handle-source" />

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
        <div class="mb-2">
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
      </VCardText>
    </VCard>
  </div>
</template>

<style scoped>
.chatbot-distribution-node {
  min-width: 380px;
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
</style>
