<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { SelectOption } from './types';

defineProps<{
  categoryOptions: SelectOption[];
  subtypeOptions: SelectOption[];
}>();

const category = defineModel<string>('category', { required: true });
const subCategory = defineModel<string | null>('subCategory', {
  required: true,
});
const { t } = useI18n();
</script>

<template>
  <section class="template-editor__section">
    <h3 class="template-editor__heading">
      {{ t('whatsapp_template_configure_heading') }}
    </h3>
    <p class="template-editor__hint">
      {{ t('whatsapp_template_configure_hint') }}
    </p>

    <VBtnToggle
      v-model="category"
      mandatory
      divided
      class="template-editor__category-toggle"
    >
      <VBtn
        v-for="categoryOption in categoryOptions"
        :key="categoryOption.value"
        :value="categoryOption.value"
        variant="text"
      >
        <VIcon :icon="categoryOption.icon" size="18" class="me-2" />
        {{ categoryOption.title }}
        <VTooltip
          activator="parent"
          location="top"
          max-width="360"
          open-delay="250"
          content-class="template-editor__tooltip"
        >
          {{ categoryOption.description }}
        </VTooltip>
      </VBtn>
    </VBtnToggle>

    <VRadioGroup
      v-model="subCategory"
      class="template-editor__subtype-group"
      hide-details
    >
      <button
        v-for="subtype in subtypeOptions"
        :key="subtype.value"
        type="button"
        class="template-editor__subtype-option"
        :class="{
          'template-editor__subtype-option--active':
            subCategory === subtype.value,
        }"
        @click="subCategory = subtype.value"
      >
        <VRadio :value="subtype.value" color="primary" hide-details />
        <span class="template-editor__radio-label">
          <span>{{ subtype.title }}</span>
          <small>{{ subtype.description }}</small>
        </span>
      </button>
    </VRadioGroup>
  </section>
</template>
