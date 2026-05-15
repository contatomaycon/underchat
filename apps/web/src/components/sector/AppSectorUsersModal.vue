<script setup lang="ts">
import { useSectorsStore } from '@/@webcore/stores/sector';
import type { ListSectorUsersResponse } from '@core/schema/sector/listSectorUsers/response.schema';

const sectorStore = useSectorsStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  sectorId: string | null;
  sectorName: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void;
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const isLoading = ref(false);
const hasError = ref(false);
const users = ref<ListSectorUsersResponse[]>([]);

const modalTitle = computed(() => {
  if (!props.sectorName) {
    return t('users');
  }

  return `${t('users')} - ${props.sectorName}`;
});

const getUserDisplayName = (user: ListSectorUsersResponse): string => {
  const firstName = user.user_info?.name?.trim() ?? '';
  const lastName = user.user_info?.last_name?.trim() ?? '';
  const fullName = `${firstName} ${lastName}`.trim();

  return fullName || user.email_partial;
};

const loadSectorUsers = async () => {
  if (!isVisible.value || !props.sectorId) {
    users.value = [];
    hasError.value = false;
    return;
  }

  isLoading.value = true;
  hasError.value = false;

  try {
    const response = await sectorStore.listSectorUsers(props.sectorId);

    if (response === null) {
      users.value = [];
      hasError.value = true;
      return;
    }

    users.value = response;
  } catch {
    users.value = [];
    hasError.value = true;
  } finally {
    isLoading.value = false;
  }
};

watch(
  () => [isVisible.value, props.sectorId] as const,
  async ([visible, sectorId]) => {
    if (!visible || !sectorId) {
      users.value = [];
      hasError.value = false;
      isLoading.value = false;
      return;
    }

    await loadSectorUsers();
  },
  { immediate: true }
);
</script>

<template>
  <VDialog v-model="isVisible" max-width="620">
    <DialogCloseBtn @click="isVisible = false" />

    <VCard :title="modalTitle">
      <VCardText>
        <VProgressLinear v-if="isLoading" indeterminate color="primary" />

        <VAlert
          v-else-if="hasError"
          type="error"
          variant="tonal"
          density="compact"
        >
          {{ $t('error_loading_sector_users') }}
        </VAlert>

        <template v-else-if="users.length">
          <VList class="pa-0">
            <VListItem
              v-for="user in users"
              :key="user.user_id"
              class="px-0"
              :title="getUserDisplayName(user)"
              :subtitle="user.email_partial"
            >
              <template #prepend>
                <VAvatar
                  size="36"
                  color="primary"
                  variant="tonal"
                  class="me-3"
                >
                  <VImg
                    v-if="user.user_info?.photo"
                    :src="user.user_info.photo"
                    :alt="getUserDisplayName(user)"
                  />
                  <VIcon v-else icon="tabler-user" size="18" />
                </VAvatar>
              </template>
            </VListItem>
          </VList>
        </template>

        <VAlert v-else type="info" variant="tonal" density="compact">
          {{ $t('no_data_available') }}
        </VAlert>
      </VCardText>

      <VCardText class="d-flex justify-end">
        <VBtn variant="tonal" color="secondary" @click="isVisible = false">
          {{ $t('close') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>
