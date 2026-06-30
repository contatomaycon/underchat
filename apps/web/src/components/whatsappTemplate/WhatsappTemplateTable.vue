<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
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

const { t } = useI18n();

const headers = computed<DataTableHeader<WhatsappTemplateResponse>[]>(() => [
  { title: t('whatsapp_template_table_name'), key: 'name' },
  { title: t('whatsapp_template_table_language'), key: 'language' },
  { title: t('whatsapp_template_table_category'), key: 'category' },
  { title: t('whatsapp_template_table_status'), key: 'status' },
  { title: t('whatsapp_template_table_quality'), key: 'quality_score' },
  { title: t('whatsapp_template_table_last_sync'), key: 'last_synced_at' },
  {
    title: t('whatsapp_template_table_actions'),
    key: 'actions',
    sortable: false,
  },
]);

const statusColor = (status: string): EColor => {
  if (status === 'APPROVED') return EColor.success;
  if (status === 'PENDING') return EColor.warning;
  if (status === 'REJECTED' || status === 'SYNC_ERROR') return EColor.error;
  if (status === 'PAUSED' || status === 'DISABLED') return EColor.warning;
  return EColor.info;
};

const categoryLabel = (category: string): string => {
  if (category === 'MARKETING')
    return t('whatsapp_template_category_marketing');
  if (category === 'UTILITY') return t('whatsapp_template_category_utility');
  if (category === 'AUTHENTICATION') {
    return t('whatsapp_template_category_authentication');
  }

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
    :loading-text="t('whatsapp_template_loading')"
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
        {{ t('whatsapp_template_local_inactive') }}
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
            <span>{{ t('whatsapp_template_edit_action') }}</span>
          </VTooltip>
          <VIcon icon="tabler-edit" />
        </IconBtn>

        <IconBtn :disabled="!item.is_active" @click="emit('deactivate', item)">
          <VTooltip activator="parent" location="top">
            <span>{{ t('whatsapp_template_deactivate_action') }}</span>
          </VTooltip>
          <VIcon icon="tabler-ban" />
        </IconBtn>

        <IconBtn @click="emit('delete', item)">
          <VTooltip activator="parent" location="top">
            <span>{{ t('whatsapp_template_delete_action') }}</span>
          </VTooltip>
          <VIcon icon="tabler-trash" />
        </IconBtn>
      </div>
    </template>

    <template #no-data>
      {{ t('whatsapp_template_no_data') }}
    </template>

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
