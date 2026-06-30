<script setup lang="ts">
import { computed, reactive } from 'vue';
import { useI18n } from 'vue-i18n';

interface TemplateFilters {
  search: string | null;
  status: string | null;
  category: string | null;
  language: string | null;
  is_active: boolean | null;
}

const props = defineProps<{
  filters: TemplateFilters;
  syncing: boolean;
}>();

const emit = defineEmits<{
  add: [];
  sync: [];
  'update:filters': [value: TemplateFilters];
}>();

const { t } = useI18n();

const localFilters = reactive<TemplateFilters>({
  search: props.filters.search,
  status: props.filters.status,
  category: props.filters.category,
  language: props.filters.language,
  is_active: props.filters.is_active,
});

const statusItems = computed(() => [
  { title: t('whatsapp_template_filter_all_masculine'), value: null },
  { title: t('whatsapp_template_status_approved'), value: 'APPROVED' },
  { title: t('whatsapp_template_status_pending'), value: 'PENDING' },
  { title: t('whatsapp_template_status_rejected'), value: 'REJECTED' },
  { title: t('whatsapp_template_status_paused'), value: 'PAUSED' },
  { title: t('whatsapp_template_status_disabled'), value: 'DISABLED' },
  { title: t('whatsapp_template_status_sync_error'), value: 'SYNC_ERROR' },
]);

const categoryItems = computed(() => [
  { title: t('whatsapp_template_filter_all_feminine'), value: null },
  { title: t('whatsapp_template_category_marketing'), value: 'MARKETING' },
  { title: t('whatsapp_template_category_utility'), value: 'UTILITY' },
  {
    title: t('whatsapp_template_category_authentication'),
    value: 'AUTHENTICATION',
  },
]);

const activeItems = computed(() => [
  { title: t('whatsapp_template_filter_all_masculine'), value: null },
  { title: t('whatsapp_template_active_only'), value: true },
  { title: t('whatsapp_template_inactive_only'), value: false },
]);

const emitFilters = () => {
  emit('update:filters', { ...localFilters });
};
</script>

<template>
  <div class="template-toolbar">
    <div class="template-toolbar__primary">
      <VBtn prepend-icon="tabler-plus" @click="emit('add')">
        {{ t('whatsapp_template_add_model') }}
      </VBtn>
      <VBtn
        variant="tonal"
        prepend-icon="tabler-refresh"
        :loading="syncing"
        @click="emit('sync')"
      >
        {{ t('whatsapp_template_sync_models') }}
      </VBtn>
    </div>

    <div class="template-toolbar__filters">
      <AppTextField
        v-model="localFilters.search"
        :placeholder="t('whatsapp_template_search_placeholder')"
        append-inner-icon="tabler-search"
        single-line
        hide-details
        density="compact"
        @update:model-value="emitFilters"
      />
      <AppSelect
        v-model="localFilters.category"
        :items="categoryItems"
        item-title="title"
        item-value="value"
        :placeholder="t('whatsapp_template_category_placeholder')"
        clearable
        hide-details
        density="compact"
        @update:model-value="emitFilters"
      />
      <AppSelect
        v-model="localFilters.status"
        :items="statusItems"
        item-title="title"
        item-value="value"
        :placeholder="t('whatsapp_template_status_placeholder')"
        clearable
        hide-details
        density="compact"
        @update:model-value="emitFilters"
      />
      <AppTextField
        v-model="localFilters.language"
        :placeholder="t('whatsapp_template_language_filter_placeholder')"
        hide-details
        density="compact"
        @update:model-value="emitFilters"
      />
      <AppSelect
        v-model="localFilters.is_active"
        :items="activeItems"
        item-title="title"
        item-value="value"
        :placeholder="t('whatsapp_template_activation_placeholder')"
        clearable
        hide-details
        density="compact"
        @update:model-value="emitFilters"
      />
    </div>
  </div>
</template>

<style scoped>
.template-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  justify-content: space-between;
}

.template-toolbar__primary {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.template-toolbar__filters {
  display: grid;
  grid-template-columns: minmax(220px, 1.4fr) repeat(4, minmax(140px, 1fr));
  gap: 12px;
  min-inline-size: min(100%, 840px);
}

@media (max-width: 960px) {
  .template-toolbar__filters {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 600px) {
  .template-toolbar,
  .template-toolbar__primary {
    inline-size: 100%;
  }

  .template-toolbar__primary > * {
    flex: 1 1 auto;
  }

  .template-toolbar__filters {
    grid-template-columns: 1fr;
    inline-size: 100%;
  }
}
</style>
