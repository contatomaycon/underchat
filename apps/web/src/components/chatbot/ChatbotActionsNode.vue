<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import { useI18n } from 'vue-i18n';

type ActionType = 'inactivity_alert' | null;

interface ActionsNodeData {
  actionType: ActionType;
  alertQuantity: string;
  onRemove?: () => void;
}

const props = defineProps<NodeProps>();
const { t } = useI18n();

const getInitialData = (): ActionsNodeData => {
  const data = props.data as ActionsNodeData | undefined;
  return {
    actionType: data?.actionType || null,
    alertQuantity: data?.alertQuantity || '',
  };
};

const actionsNodeData = ref<ActionsNodeData>(getInitialData());

const actionTypeOptions = computed(() => [
  {
    value: 'inactivity_alert',
    title: t('chatbot_actions_type_inactivity_alert'),
  },
]);

const showInactivityAlertFields = computed(
  () => actionsNodeData.value.actionType === 'inactivity_alert'
);

const onlyDigits = (s: string) => s.replaceAll(/\D+/g, '');

const onAlertQuantityInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const value = onlyDigits(target.value);
  actionsNodeData.value.alertQuantity = value;
  updateNodeData();
};

const updateNodeData = () => {
  if (props.data) {
    const data = props.data as ActionsNodeData;
    data.actionType = actionsNodeData.value.actionType;
    data.alertQuantity = actionsNodeData.value.alertQuantity;
  }
};

watch(
  () => actionsNodeData.value.actionType,
  (newType) => {
    if (newType !== 'inactivity_alert') {
      actionsNodeData.value.alertQuantity = '';
    }
    updateNodeData();
  }
);

watch(
  () => actionsNodeData.value.alertQuantity,
  () => {
    updateNodeData();
  }
);

const handleRemove = () => {
  const data = props.data as ActionsNodeData;
  if (data?.onRemove) {
    data.onRemove();
  }
};
</script>

<template>
  <div class="chatbot-actions-node">
    <Handle type="target" :position="Position.Top" />

    <VCard class="actions-card" elevation="2">
      <VCardTitle
        class="d-flex align-center justify-space-between pa-2 node-drag-handle"
      >
        <div class="d-flex align-center ga-2">
          <VIcon icon="tabler-settings" color="primary" size="20" />
          <span class="text-sm font-weight-medium">{{
            t('chatbot_actions')
          }}</span>
        </div>
        <VIcon
          v-if="(props.data as ActionsNodeData)?.onRemove"
          icon="tabler-x"
          size="18"
          color="error"
          class="cursor-pointer"
          @click.stop="handleRemove"
        />
      </VCardTitle>

      <VCardText class="pa-3">
        <VSelect
          v-model="actionsNodeData.actionType"
          :items="actionTypeOptions"
          item-title="title"
          item-value="value"
          :label="t('chatbot_actions_type')"
          variant="outlined"
          density="compact"
          class="mb-3"
          hide-details
        />

        <div v-if="showInactivityAlertFields">
          <VTextField
            :model-value="actionsNodeData.alertQuantity"
            @input="onAlertQuantityInput"
            :label="t('chatbot_actions_alert_quantity')"
            variant="outlined"
            density="compact"
            class="mb-3"
            hide-details
            inputmode="numeric"
            type="text"
          />
        </div>

        <div class="actions-outputs">
          <div class="action-output-item">
            <span class="text-body-2">{{ t('chatbot_actions_continue') }}</span>
            <Handle
              id="continue"
              type="source"
              :position="Position.Right"
              class="action-handle"
            />
          </div>
          <div class="action-output-item">
            <span class="text-body-2">{{
              t('chatbot_actions_alert_exhausted')
            }}</span>
            <Handle
              id="exhausted"
              type="source"
              :position="Position.Right"
              class="action-handle"
            />
          </div>
        </div>
      </VCardText>
    </VCard>
  </div>
</template>

<style scoped>
.chatbot-actions-node {
  min-width: 300px;
}

.actions-card {
  border-radius: 8px;
}

.node-drag-handle {
  cursor: grab;
  user-select: none;
}

.node-drag-handle:active {
  cursor: grabbing;
}

.cursor-pointer {
  cursor: pointer;
}

.actions-outputs {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.action-output-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px;
  background-color: rgba(var(--v-theme-surface-variant), 0.1);
  border-radius: 4px;
  position: relative;
}

.action-handle {
  position: absolute;
  right: -8px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
}
</style>
