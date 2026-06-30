<script setup lang="ts">
import { computed, reactive } from 'vue';

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

const localFilters = reactive<TemplateFilters>({
  search: props.filters.search,
  status: props.filters.status,
  category: props.filters.category,
  language: props.filters.language,
  is_active: props.filters.is_active,
});

const statusItems = computed(() => [
  { title: 'Todos', value: null },
  { title: 'Aprovado', value: 'APPROVED' },
  { title: 'Pendente', value: 'PENDING' },
  { title: 'Rejeitado', value: 'REJECTED' },
  { title: 'Pausado', value: 'PAUSED' },
  { title: 'Desativado', value: 'DISABLED' },
  { title: 'Erro de sync', value: 'SYNC_ERROR' },
]);

const categoryItems = computed(() => [
  { title: 'Todas', value: null },
  { title: 'Marketing', value: 'MARKETING' },
  { title: 'Utilidade', value: 'UTILITY' },
  { title: 'Autenticação', value: 'AUTHENTICATION' },
]);

const activeItems = computed(() => [
  { title: 'Todos', value: null },
  { title: 'Ativos', value: true },
  { title: 'Desativados', value: false },
]);

const emitFilters = () => {
  emit('update:filters', { ...localFilters });
};
</script>

<template>
  <div class="template-toolbar">
    <div class="template-toolbar__primary">
      <VBtn prepend-icon="tabler-plus" @click="emit('add')">
        Adicionar modelo
      </VBtn>
      <VBtn
        variant="tonal"
        prepend-icon="tabler-refresh"
        :loading="syncing"
        @click="emit('sync')"
      >
        Sincronizar modelos
      </VBtn>
    </div>

    <div class="template-toolbar__filters">
      <AppTextField
        v-model="localFilters.search"
        placeholder="Buscar..."
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
        placeholder="Categoria"
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
        placeholder="Status"
        clearable
        hide-details
        density="compact"
        @update:model-value="emitFilters"
      />
      <AppTextField
        v-model="localFilters.language"
        placeholder="Idioma"
        hide-details
        density="compact"
        @update:model-value="emitFilters"
      />
      <AppSelect
        v-model="localFilters.is_active"
        :items="activeItems"
        item-title="title"
        item-value="value"
        placeholder="Ativação"
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
