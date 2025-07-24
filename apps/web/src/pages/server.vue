<script setup lang="ts">
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EServerPermissions } from '@core/common/enums/EPermissions/server';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EServerPermissions.server_create,
      EServerPermissions.server_view,
      EServerPermissions.server_edit,
      EServerPermissions.server_delete,
    ],
  },
});

const headers = [
  { title: t('name'), key: 'name' },
  { title: t('status'), key: 'status' },
  { title: t('ssh_ip'), key: 'ssh_ip' },
  { title: t('ssh_port'), key: 'ssh_port' },
  { title: t('created_at'), key: 'created_at' },
  { title: t('actions'), key: 'actions' },
];
</script>

<template>
  <div>
    <VDataTable :headers="headers" :items="userList" :items-per-page="5">
      <!-- full name -->
      <template #item.fullName="{ item }">
        <div class="d-flex align-center">
          <!-- avatar -->
          <VAvatar
            size="32"
            :color="item.avatar ? '' : 'primary'"
            :class="item.avatar ? '' : 'v-avatar-light-bg primary--text'"
            :variant="!item.avatar ? 'tonal' : undefined"
          >
            <VImg v-if="item.avatar" :src="item.avatar" />
            <span v-else>{{ avatarText(item.fullName) }}</span>
          </VAvatar>

          <div class="d-flex flex-column ms-3">
            <span
              class="d-block font-weight-medium text-high-emphasis text-truncate"
              >{{ item.fullName }}</span
            >
            <small>{{ item.post }}</small>
          </div>
        </div>
      </template>

      <!-- status -->
      <template #item.status="{ item }">
        <VChip :color="resolveStatusVariant(item.status).color" size="small">
          {{ resolveStatusVariant(item.status).text }}
        </VChip>
      </template>

      <!-- Actions -->
      <template #item.actions="{ item }">
        <div class="d-flex gap-1">
          <IconBtn>
            <VIcon icon="tabler-edit" />
          </IconBtn>
          <IconBtn>
            <VIcon icon="tabler-trash" />
          </IconBtn>
        </div>
      </template>
    </VDataTable>
  </div>
</template>
