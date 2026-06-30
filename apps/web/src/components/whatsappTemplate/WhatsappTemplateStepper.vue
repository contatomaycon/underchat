<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const currentStep = defineModel<number>({ required: true });
const { t } = useI18n();
</script>

<template>
  <VStepper v-model="currentStep" alt-labels>
    <VStepperHeader>
      <VStepperItem :title="t('whatsapp_template_step_configure')" :value="1" />
      <VDivider />
      <VStepperItem :title="t('whatsapp_template_step_edit')" :value="2" />
      <VDivider />
      <VStepperItem :title="t('whatsapp_template_step_submit')" :value="3" />
    </VStepperHeader>

    <slot />
  </VStepper>
</template>
