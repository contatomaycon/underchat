<script setup lang="ts">
import './chatbot-node-workbench.css';
import { ref, computed, watch } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import { useI18n } from 'vue-i18n';
import ApiVariableField from '@/components/chatbot/api-request/ApiVariableField.vue';
import type { ApiRequestVariable } from '@/components/chatbot/api-request/types';
import {
  formatChatbotNodeOutputTag,
  normalizeChatbotNodeOutputKey,
} from '@core/common/functions/chatbotNodeOutputs';
import CapturableOutputStrip from './CapturableOutputStrip.vue';

type DataType = 'name' | 'lastname' | 'email' | 'cpf' | 'cnpj' | null;

interface DataNodeData {
  outputKey: string;
  dataType: DataType;
  firstName: string;
  lastName: string;
  email: string;
  cpf: string;
  cnpj: string;
  availableVariables?: ApiRequestVariable[];
  onRemove?: () => void;
}

const props = defineProps<NodeProps>();
const { t } = useI18n();

const getInitialData = (): DataNodeData => {
  const data = props.data as DataNodeData | undefined;
  return {
    outputKey: normalizeChatbotNodeOutputKey('data', data?.outputKey),
    dataType: data?.dataType || null,
    firstName: data?.firstName || t('chatbot_data_default_name_question'),
    lastName: data?.lastName || t('chatbot_data_default_lastname_question'),
    email: data?.email || t('chatbot_data_default_email_question'),
    cpf: data?.cpf || t('chatbot_data_default_cpf_question'),
    cnpj: data?.cnpj || t('chatbot_data_default_cnpj_question'),
  };
};

const dataNodeData = ref<DataNodeData>(getInitialData());

const dataTypeOptions = computed(() => [
  {
    value: 'name',
    title: t('chatbot_data_type_name'),
  },
  {
    value: 'lastname',
    title: t('chatbot_data_type_lastname'),
  },
  {
    value: 'email',
    title: t('chatbot_data_type_email'),
  },
  {
    value: 'cpf',
    title: t('chatbot_data_type_cpf'),
  },
  {
    value: 'cnpj',
    title: t('chatbot_data_type_cnpj'),
  },
]);

const showNameFields = computed(() => dataNodeData.value.dataType === 'name');
const showLastNameField = computed(
  () => dataNodeData.value.dataType === 'lastname'
);
const showEmailField = computed(() => dataNodeData.value.dataType === 'email');
const showCpfField = computed(() => dataNodeData.value.dataType === 'cpf');
const showCnpjField = computed(() => dataNodeData.value.dataType === 'cnpj');
const availableVariables = computed(
  () => (props.data as DataNodeData | undefined)?.availableVariables || []
);
const outputTags = computed(() => {
  const dataType = dataNodeData.value.dataType;
  if (!dataType) return [];
  return [
    formatChatbotNodeOutputTag(dataNodeData.value.outputKey, 'value'),
    formatChatbotNodeOutputTag(dataNodeData.value.outputKey, dataType),
  ];
});

const firstNameRules = computed(() => [
  (v: string | null | undefined) => {
    if (!showNameFields.value) return true;
    const s = (v ?? '').trim();
    return !!s || t('chatbot_data_field_required');
  },
]);

const lastNameRules = computed(() => [
  (v: string | null | undefined) => {
    if (!showLastNameField.value) return true;
    const s = (v ?? '').trim();
    return !!s || t('chatbot_data_field_required');
  },
]);

const emailRules = computed(() => [
  (v: string | null | undefined) => {
    if (!showEmailField.value) return true;
    const s = (v ?? '').trim();
    return !!s || t('chatbot_data_field_required');
  },
]);

const cpfRules = computed(() => [
  (v: string | null | undefined) => {
    if (!showCpfField.value) return true;
    const s = (v ?? '').trim();
    return !!s || t('chatbot_data_field_required');
  },
]);

const cnpjRules = computed(() => [
  (v: string | null | undefined) => {
    if (!showCnpjField.value) return true;
    const s = (v ?? '').trim();
    return !!s || t('chatbot_data_field_required');
  },
]);

const updateNodeData = () => {
  if (props.data) {
    const data = props.data as DataNodeData;
    data.outputKey = dataNodeData.value.outputKey;
    data.dataType = dataNodeData.value.dataType;
    data.firstName = dataNodeData.value.firstName;
    data.lastName = dataNodeData.value.lastName;
    data.email = dataNodeData.value.email;
    data.cpf = dataNodeData.value.cpf;
    data.cnpj = dataNodeData.value.cnpj;
  }
};

const handleRemove = () => {
  const data = props.data as DataNodeData;
  if (data?.onRemove) {
    data.onRemove();
  }
};

watch(
  () => dataNodeData.value.dataType,
  (newType, oldType) => {
    if (oldType !== undefined && oldType !== newType) {
      if (newType === 'name') {
        dataNodeData.value.firstName = t('chatbot_data_default_name_question');
      } else {
        dataNodeData.value.firstName = '';
      }

      if (newType === 'lastname') {
        dataNodeData.value.lastName = t(
          'chatbot_data_default_lastname_question'
        );
      } else {
        dataNodeData.value.lastName = '';
      }

      if (newType === 'email') {
        dataNodeData.value.email = t('chatbot_data_default_email_question');
      } else {
        dataNodeData.value.email = '';
      }

      if (newType === 'cpf') {
        dataNodeData.value.cpf = t('chatbot_data_default_cpf_question');
      } else {
        dataNodeData.value.cpf = '';
      }

      if (newType === 'cnpj') {
        dataNodeData.value.cnpj = t('chatbot_data_default_cnpj_question');
      } else {
        dataNodeData.value.cnpj = '';
      }
    }
    updateNodeData();
  }
);

watch(
  () => dataNodeData.value,
  () => {
    updateNodeData();
  },
  { deep: true }
);
</script>

<template>
  <div class="chatbot-data-node chatbot-workbench-node">
    <Handle
      id="target"
      type="target"
      :position="Position.Top"
      class="handle-target"
    />
    <Handle
      id="source"
      type="source"
      :position="Position.Bottom"
      class="handle-source"
    />

    <VCard class="data-card chatbot-workbench-card" elevation="2">
      <VCardTitle
        class="d-flex align-center justify-space-between pa-2 node-drag-handle chatbot-workbench-header"
      >
        <div class="d-flex align-center ga-2 chatbot-workbench-identity">
          <VIcon
            icon="tabler-database"
            color="info"
            size="20"
            class="chatbot-workbench-icon"
          />
          <span class="text-sm font-weight-medium chatbot-workbench-title">{{
            t('chatbot_data')
          }}</span>
        </div>
        <VIcon
          v-if="(props.data as DataNodeData)?.onRemove"
          icon="tabler-x"
          size="18"
          color="error"
          class="cursor-pointer chatbot-workbench-remove"
          @click.stop="handleRemove"
        />
      </VCardTitle>

      <VCardText class="pa-3 chatbot-workbench-body">
        <VSelect
          v-model="dataNodeData.dataType"
          :items="dataTypeOptions"
          :label="t('chatbot_data_type')"
          variant="outlined"
          density="compact"
          class="mb-3"
          hide-details
        />

        <ApiVariableField
          v-if="showNameFields"
          v-model="dataNodeData.firstName"
          :variables="availableVariables"
          :label="t('chatbot_data_question')"
          class="mb-3"
          :rules="firstNameRules"
          hide-details="auto"
        />

        <ApiVariableField
          v-if="showLastNameField"
          v-model="dataNodeData.lastName"
          :variables="availableVariables"
          :label="t('chatbot_data_question')"
          class="mb-3"
          :rules="lastNameRules"
          hide-details="auto"
        />

        <ApiVariableField
          v-if="showEmailField"
          v-model="dataNodeData.email"
          :variables="availableVariables"
          :label="t('chatbot_data_question')"
          class="mb-3"
          :rules="emailRules"
          hide-details="auto"
        />

        <ApiVariableField
          v-if="showCpfField"
          v-model="dataNodeData.cpf"
          :variables="availableVariables"
          :label="t('chatbot_data_question')"
          class="mb-3"
          :rules="cpfRules"
          hide-details="auto"
        />

        <ApiVariableField
          v-if="showCnpjField"
          v-model="dataNodeData.cnpj"
          :variables="availableVariables"
          :label="t('chatbot_data_question')"
          class="mb-3"
          :rules="cnpjRules"
          hide-details="auto"
        />

        <CapturableOutputStrip
          v-if="outputTags.length"
          :title="t('chatbot_captured_output_title')"
          :description="t('chatbot_captured_output_data_help')"
          :tags="outputTags"
          :copy-label="t('chatbot_captured_output_copy')"
          :copied-label="t('chatbot_captured_output_copied')"
        />
      </VCardText>
    </VCard>
  </div>
</template>

<style scoped>
.chatbot-data-node {
  min-width: 350px;
}

.data-card {
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
</style>
