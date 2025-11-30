<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import { useI18n } from 'vue-i18n';

type DataType = 'name' | 'email' | 'cpf' | 'cnpj' | null;

interface DataNodeData {
  dataType: DataType;
  firstName: string;
  lastName: string;
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
    firstName: data?.firstName || '',
    lastName: data?.lastName || '',
    email: data?.email || '',
    cpf: data?.cpf || '',
    cnpj: data?.cnpj || '',
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

const cpfMask = '###.###.###-##';
const cnpjMask = '##.###.###/####-##';

const onlyDigits = (s: string) => s.replaceAll(/\D+/g, '');

const isValidCPF = (cpf: string): boolean => {
  const digits = onlyDigits(cpf);

  if (digits.length !== 11) return false;

  if (/^(\d)\1{10}$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(digits.charAt(i)) * (10 - i);
  }
  let remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(digits.charAt(9))) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(digits.charAt(i)) * (11 - i);
  }
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(digits.charAt(10))) return false;

  return true;
};

const isValidCNPJ = (cnpj: string): boolean => {
  const digits = onlyDigits(cnpj);

  if (digits.length !== 14) return false;

  if (/^(\d)\1{13}$/.test(digits)) return false;

  let length = digits.length - 2;
  let numbers = digits.substring(0, length);
  const multipliers = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;

  for (let i = 0; i < length; i++) {
    sum += parseInt(numbers.charAt(i)) * multipliers[i];
  }

  let remainder = sum % 11;
  let digit = remainder < 2 ? 0 : 11 - remainder;

  if (digit !== parseInt(digits.charAt(length))) return false;

  length = length + 1;
  numbers = digits.substring(0, length);
  const multipliers2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  sum = 0;

  for (let i = 0; i < length; i++) {
    sum += parseInt(numbers.charAt(i)) * multipliers2[i];
  }

  remainder = sum % 11;
  digit = remainder < 2 ? 0 : 11 - remainder;

  if (digit !== parseInt(digits.charAt(length))) return false;

  return true;
};

const emailValidator = (v: string | null | undefined) => {
  const s = (v ?? '').trim();
  if (!s) return t('chatbot_data_field_required');
  const re = /^[^\s@]+@(?:[^\s@.]+\.)+[^\s@.]{2,}$/;
  return re.test(s) || t('email_invalid');
};

const cpfValidator = (v: string | null | undefined) => {
  const s = (v ?? '').trim();
  if (!s) return t('chatbot_data_field_required');
  const digits = onlyDigits(s);
  if (digits.length !== 11) return t('chatbot_data_cpf_must_have_11_digits');
  if (!isValidCPF(s)) return t('cpf_invalid');
  return true;
};

const cnpjValidator = (v: string | null | undefined) => {
  const s = (v ?? '').trim();
  if (!s) return t('chatbot_data_field_required');
  const digits = onlyDigits(s);
  if (digits.length !== 14) return t('chatbot_data_cnpj_must_have_14_digits');
  if (!isValidCNPJ(s)) return t('cnpj_invalid');
  return true;
};

const firstNameRules = computed(() => [
  (v: string | null | undefined) => {
    if (!showNameFields.value) return true;
    const s = (v ?? '').trim();
    return !!s || t('chatbot_data_field_required');
  },
]);

const lastNameRules = computed(() => [
  (v: string | null | undefined) => {
    if (!showNameFields.value) return true;
    const s = (v ?? '').trim();
    return !!s || t('chatbot_data_field_required');
  },
]);

const emailRules = computed(() => [
  (v: string | null | undefined) => {
    if (!showEmailField.value) return true;
    return emailValidator(v);
  },
]);

const cpfRules = computed(() => [
  (v: string | null | undefined) => {
    if (!showCpfField.value) return true;
    return cpfValidator(v);
  },
]);

const cnpjRules = computed(() => [
  (v: string | null | undefined) => {
    if (!showCnpjField.value) return true;
    return cnpjValidator(v);
  },
]);

const updateNodeData = () => {
  if (props.data) {
    const data = props.data as DataNodeData;
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
      dataNodeData.value.firstName = '';
      dataNodeData.value.lastName = '';
      dataNodeData.value.email = '';
      dataNodeData.value.cpf = '';
      dataNodeData.value.cnpj = '';
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
    <Handle type="target" :position="Position.Top" />
    <Handle type="source" :position="Position.Bottom" />

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
            :label="t('chatbot_data_first_name_question')"
            variant="outlined"
            density="compact"
            class="mb-3"
            :rules="firstNameRules"
            hide-details="auto"
          />
          <VTextField
            v-model="dataNodeData.lastName"
            :label="t('chatbot_data_last_name_question')"
            variant="outlined"
            density="compact"
            class="mb-3"
            :rules="lastNameRules"
            hide-details="auto"
          />
        </template>

        <VTextField
          v-if="showEmailField"
          v-model="dataNodeData.email"
          :label="t('chatbot_data_email_question')"
          variant="outlined"
          density="compact"
          class="mb-3"
          :rules="emailRules"
          hide-details="auto"
        />

        <VTextField
          v-if="showCpfField"
          v-model="dataNodeData.cpf"
          v-maska="cpfMask"
          :label="t('chatbot_data_cpf_question')"
          placeholder="000.000.000-00"
          variant="outlined"
          density="compact"
          class="mb-3"
          :rules="cpfRules"
          hide-details="auto"
          inputmode="numeric"
        />

        <VTextField
          v-if="showCnpjField"
          v-model="dataNodeData.cnpj"
          v-maska="cnpjMask"
          :label="t('chatbot_data_cnpj_question')"
          placeholder="00.000.000/0000-00"
          variant="outlined"
          density="compact"
          class="mb-3"
          :rules="cnpjRules"
          hide-details="auto"
          inputmode="numeric"
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
