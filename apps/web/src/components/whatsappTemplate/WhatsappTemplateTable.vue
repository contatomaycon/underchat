<script setup lang="ts">
import { computed } from 'vue';
import { DataTableHeader } from 'vuetify';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { WhatsappTemplateResponse } from '@core/schema/worker/whatsappOfficialTemplate';
import { EColor } from '@core/common/enums/EColor';

const props = defineProps<{
  templates: WhatsappTemplateResponse[];
  loading: boolean;
  totalItems: number;
  page: number;
  itemsPerPage: number;
}>();

const emit = defineEmits<{
  edit: [template: WhatsappTemplateResponse];
  delete: [template: WhatsappTemplateResponse];
  deactivate: [template: WhatsappTemplateResponse];
  'update:page': [value: number];
  'update:itemsPerPage': [value: number];
}>();

const headers = computed<DataTableHeader<WhatsappTemplateResponse>[]>(() => [
  { title: 'Nome', key: 'name' },
  { title: 'Idioma', key: 'language' },
  { title: 'Categoria', key: 'category' },
  { title: 'Status', key: 'status' },
  { title: 'Qualidade', key: 'quality_score' },
  { title: 'Última sync', key: 'last_synced_at' },
  { title: 'Ações', key: 'actions', sortable: false },
]);

const statusColor = (status: string): EColor => {
  if (status === 'APPROVED') return EColor.success;
  if (status === 'PENDING') return EColor.warning;
  if (status === 'REJECTED' || status === 'SYNC_ERROR') return EColor.error;
  if (status === 'PAUSED' || status === 'DISABLED') return EColor.warning;
  return EColor.info;
};

const categoryLabel = (category: string): string => {
  if (category === 'MARKETING') return 'Marketing';
  if (category === 'UTILITY') return 'Utilidade';
  if (category === 'AUTHENTICATION') return 'Autenticação';
  return category;
};
</script>

<template>
  <VDataTableServer
    class="data-table"
    :headers="headers"
    :items="props.templates"
    :loading="props.loading"
    :items-length="props.totalItems"
    :page="props.page"
    :items-per-page="props.itemsPerPage"
    loading-text="Carregando..."
    @update:page="emit('update:page', $event)"
    @update:items-per-page="emit('update:itemsPerPage', $event)"
  >
    <template #item.name="{ item }">
      <div class="template-name">
        <span class="template-name__title">{{ item.name }}</span>
        <span v-if="item.sub_category" class="template-name__subtitle">
          {{ item.sub_category }}
        </span>
        <span v-if="item.last_error" class="template-name__error">
          {{ item.last_error }}
        </span>
      </div>
    </template>

    <template #item.category="{ item }">
      <VChip size="small" color="primary" variant="tonal">
        {{ categoryLabel(item.category) }}
      </VChip>
    </template>

    <template #item.status="{ item }">
      <VChip size="small" :color="statusColor(item.status)">
        {{ item.status }}
      </VChip>
      <VChip v-if="!item.is_active" size="small" color="secondary" class="ms-1">
        Local inativo
      </VChip>
    </template>

    <template #item.quality_score="{ item }">
      <span>{{ item.quality_score || '-' }}</span>
    </template>

    <template #item.last_synced_at="{ item }">
      <span>
        {{ item.last_synced_at ? formatDateTime(item.last_synced_at) : '-' }}
      </span>
    </template>

    <template #item.actions="{ item }">
      <div class="template-actions">
        <IconBtn @click="emit('edit', item)">
          <VTooltip activator="parent" location="top">
            <span>Editar modelo</span>
          </VTooltip>
          <VIcon icon="tabler-edit" />
        </IconBtn>

        <IconBtn :disabled="!item.is_active" @click="emit('deactivate', item)">
          <VTooltip activator="parent" location="top">
            <span>Desativar no Underchat</span>
          </VTooltip>
          <VIcon icon="tabler-ban" />
        </IconBtn>

        <IconBtn @click="emit('delete', item)">
          <VTooltip activator="parent" location="top">
            <span>Excluir na Meta</span>
          </VTooltip>
          <VIcon icon="tabler-trash" />
        </IconBtn>
      </div>
    </template>

    <template #no-data> Nenhum modelo oficial encontrado. </template>

    <template #bottom>
      <TablePagination
        :page="props.page"
        :items-per-page="props.itemsPerPage"
        :total-items="props.totalItems"
        @update:page="emit('update:page', $event)"
      />
    </template>
  </VDataTableServer>
</template>

<style scoped>
.template-name {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-inline-size: 180px;
}

.template-name__title {
  font-weight: 600;
}

.template-name__subtitle,
.template-name__error {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.8rem;
}

.template-name__error {
  color: rgb(var(--v-theme-error));
}

.template-actions {
  display: flex;
  gap: 4px;
}
</style>
