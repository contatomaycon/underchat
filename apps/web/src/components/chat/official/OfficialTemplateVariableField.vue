<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import ApiVariableField from '@/components/chatbot/api-request/ApiVariableField.vue';
import type { ApiRequestVariable } from '@/components/chatbot/api-request/types';
import { containsUnderchatVariableTag } from '@/utils/officialTemplate';

interface Props {
  variables?: readonly ApiRequestVariable[];
  placeholder?: string;
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  variables: () => [],
  placeholder: '',
  disabled: false,
});
const model = defineModel<string>({ required: true });
const { t } = useI18n();

const hasRuntimeTag = computed(() => containsUnderchatVariableTag(model.value));
</script>

<template>
  <ApiVariableField
    v-model="model"
    :variables="props.variables"
    :placeholder="props.placeholder"
    :disabled="props.disabled"
    :hint="
      hasRuntimeTag ? t('official_template_variable_resolved_on_send') : ''
    "
    :persistent-hint="hasRuntimeTag"
    :insert-variable-title="t('official_template_insert_variable')"
    :variables-label="t('chatbot_message_variables_legend')"
  />
</template>
