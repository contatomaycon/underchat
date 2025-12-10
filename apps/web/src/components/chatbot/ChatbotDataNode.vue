<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import { useI18n } from 'vue-i18n';

type DataType = 'name' | 'email' | 'cpf' | 'cnpj' | null;

interface DataNodeData {
  dataType: DataType;
  firstName: string;
  email: string;
  cpf: string;
  cnpj: string;
  onRemove?: () => void;
}

const props = defineProps<NodeProps>();
const { t } = useI18n();

const getInitialData = (): DataNodeData => {
  const data = props.data as DataNodeData | undefined;
  return {
    dataType: data?.dataType || null,
    firstName: data?.firstName || t('chatbot_data_default_name_question'),
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
const showEmailField = computed(() => dataNodeData.value.dataType === 'email');
const showCpfField = computed(() => dataNodeData.value.dataType === 'cpf');
const showCnpjField = computed(() => dataNodeData.value.dataType === 'cnpj');

const firstNameRules = computed(() => [
  (v: string | null | undefined) => {
    if (!showNameFields.value) return true;
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
    data.dataType = dataNodeData.value.dataType;
    data.firstName = dataNodeData.value.firstName;
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
  <div class="chatbot-data-node">
    <Handle type="target" :position="Position.Top" class="handle-target" />
    <Handle type="source" :position="Position.Bottom" class="handle-source" />

    <VCard class="data-card" elevation="2">
      <VCardTitle
        class="d-flex align-center justify-space-between pa-2 node-drag-handle"
      >
        <div class="d-flex align-center ga-2">
          <VIcon icon="tabler-database" color="info" size="20" />
          <span class="text-sm font-weight-medium">{{
            t('chatbot_data')
          }}</span>
        </div>
        <VIcon
          v-if="(props.data as DataNodeData)?.onRemove"
          icon="tabler-x"
          size="18"
          color="error"
          class="cursor-pointer"
          @click.stop="handleRemove"
        />
      </VCardTitle>

      <VCardText class="pa-3">
        <VSelect
          v-model="dataNodeData.dataType"
          :items="dataTypeOptions"
          :label="t('chatbot_data_type')"
          variant="outlined"
          density="compact"
          class="mb-3"
          hide-details
        />

        <template v-if="showNameFields">
          <VTextField
            v-model="dataNodeData.firstName"
            :label="t('chatbot_data_question')"
            variant="outlined"
            density="compact"
            class="mb-3"
            :rules="firstNameRules"
            hide-details="auto"
          />
        </template>

        <VTextField
          v-if="showEmailField"
          v-model="dataNodeData.email"
          :label="t('chatbot_data_question')"
          variant="outlined"
          density="compact"
          class="mb-3"
          :rules="emailRules"
          hide-details="auto"
        />

        <VTextField
          v-if="showCpfField"
          v-model="dataNodeData.cpf"
          :label="t('chatbot_data_question')"
          variant="outlined"
          density="compact"
          class="mb-3"
          :rules="cpfRules"
          hide-details="auto"
        />

        <VTextField
          v-if="showCnpjField"
          v-model="dataNodeData.cnpj"
          :label="t('chatbot_data_question')"
          variant="outlined"
          density="compact"
          class="mb-3"
          :rules="cnpjRules"
          hide-details="auto"
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
