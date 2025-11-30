<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import { useChatbotStore } from '@/@webcore/stores/chatbot';
import { getUser } from '@/@webcore/localStorage/user';
import { useI18n } from 'vue-i18n';

interface RedirectData {
  redirectType: 'user' | 'sector' | null;
  selectedUser: string | null;
  selectedSector: string | null;
  selectedSectorUser: string | null;
  onRemove?: () => void;
}

const props = defineProps<NodeProps>();
const chatbotStore = useChatbotStore();
const { t } = useI18n();

const getInitialData = (): RedirectData => {
  const data = props.data as RedirectData | undefined;
  return {
    redirectType: data?.redirectType || null,
    selectedUser: data?.selectedUser || null,
    selectedSector: data?.selectedSector || null,
    selectedSectorUser: data?.selectedSectorUser || null,
  };
};

const redirectData = ref<RedirectData>(getInitialData());

const users = ref<any[]>([]);
const sectors = ref<any[]>([]);
const sectorUsers = ref<any[]>([]);
const userSearch = ref('');
const sectorSearch = ref('');
const sectorUserSearch = ref('');
const isLoadingUsers = ref(false);
const isLoadingSectors = ref(false);
const isLoadingSectorUsers = ref(false);
const isUserMenuOpen = ref(false);
const isSectorMenuOpen = ref(false);
const isSectorUserMenuOpen = ref(false);

const filteredUsers = computed(() => {
  if (!userSearch.value) {
    return users.value;
  }
  const query = userSearch.value.toLowerCase();
  return users.value.filter((user) =>
    user?.title?.toLowerCase().includes(query)
  );
});

const filteredSectors = computed(() => {
  if (!sectorSearch.value) {
    return sectors.value;
  }
  const query = sectorSearch.value.toLowerCase();
  return sectors.value.filter((sector) =>
    sector.title.toLowerCase().includes(query)
  );
});

const filteredSectorUsers = computed(() => {
  if (!sectorUsers.value || sectorUsers.value.length === 0) {
    return [];
  }
  if (!sectorUserSearch.value) {
    return sectorUsers.value;
  }
  const query = sectorUserSearch.value.toLowerCase();
  return sectorUsers.value.filter((user) =>
    user?.title?.toLowerCase().includes(query)
  );
});

const updateNodeData = () => {
  if (props.data) {
    const data = props.data as RedirectData;
    data.redirectType = redirectData.value.redirectType;
    data.selectedUser = redirectData.value.selectedUser;
    data.selectedSector = redirectData.value.selectedSector;
    data.selectedSectorUser = redirectData.value.selectedSectorUser;
  }
};

const loadUsers = async () => {
  const user = getUser();
  if (!user?.account_id) return;

  isLoadingUsers.value = true;
  try {
    const usersList = await chatbotStore.listChatbotUsers();
    users.value = usersList.map((user) => ({
      value: user.id,
      title: user.name,
      photo: user.photo || null,
      status: user.status || null,
    }));
  } catch (error) {
    console.error('Error loading users:', error);
  } finally {
    isLoadingUsers.value = false;
  }
};

const loadSectors = async () => {
  const user = getUser();
  if (!user?.account_id) return;

  isLoadingSectors.value = true;
  try {
    const sectorsList = await chatbotStore.listChatbotSectors();
    sectors.value = sectorsList.map((sector) => ({
      value: sector.id,
      title: sector.name,
      color: sector.color || null,
    }));
  } catch (error) {
    console.error('Error loading sectors:', error);
  } finally {
    isLoadingSectors.value = false;
  }
};

const loadSectorUsers = async (sectorId: string) => {
  isLoadingSectorUsers.value = true;
  try {
    const usersList = await chatbotStore.listChatbotSectorUsers(sectorId);
    sectorUsers.value = usersList.map((user) => ({
      value: user.id,
      title: user.name,
      photo: user.photo || null,
      status: user.status,
    }));
  } catch (error) {
    sectorUsers.value = [];
    console.error('Error loading sector users:', error);
  } finally {
    isLoadingSectorUsers.value = false;
  }
};

watch(isUserMenuOpen, (isOpen) => {
  if (isOpen) {
    loadUsers();
  } else {
    userSearch.value = '';
  }
});

watch(isSectorMenuOpen, (isOpen) => {
  if (isOpen) {
    loadSectors();
  } else {
    sectorSearch.value = '';
  }
});

watch(isSectorUserMenuOpen, (isOpen) => {
  if (!isOpen) {
    sectorUserSearch.value = '';
  } else if (redirectData.value.selectedSector) {
    loadSectorUsers(redirectData.value.selectedSector);
  }
});

watch(
  () => redirectData.value.redirectType,
  (newType) => {
    redirectData.value.selectedUser = null;
    redirectData.value.selectedSector = null;
    redirectData.value.selectedSectorUser = null;
    sectorUsers.value = [];
    userSearch.value = '';
    sectorSearch.value = '';
    sectorUserSearch.value = '';
    isUserMenuOpen.value = false;
    isSectorMenuOpen.value = false;
    isSectorUserMenuOpen.value = false;
    updateNodeData();
  }
);

watch(
  () => redirectData.value.selectedSector,
  (sectorId) => {
    redirectData.value.selectedSectorUser = null;
    sectorUsers.value = [];

    if (sectorId) {
      loadSectorUsers(sectorId);
    }
    updateNodeData();
  }
);

watch(
  () => redirectData.value,
  () => {
    updateNodeData();
  },
  { deep: true }
);

const handleRemove = () => {
  const data = props.data as RedirectData;
  if (data?.onRemove) {
    data.onRemove();
  }
};
</script>

<template>
  <div class="chatbot-redirect-node">
    <Handle type="target" :position="Position.Top" class="handle-target" />

    <VCard class="redirect-card" elevation="2">
      <VCardTitle
        class="d-flex align-center justify-space-between pa-2 node-drag-handle"
      >
        <div class="d-flex align-center ga-2">
          <VIcon icon="tabler-arrow-forward" color="info" size="20" />
          <span class="text-sm font-weight-medium">{{
            t('chatbot_redirect')
          }}</span>
        </div>
        <VIcon
          v-if="(props.data as RedirectData)?.onRemove"
          icon="tabler-x"
          size="18"
          color="error"
          class="cursor-pointer"
          @click.stop="handleRemove"
        />
      </VCardTitle>

      <VCardText class="pa-3">
        <VSelect
          v-model="redirectData.redirectType"
          :items="[
            { value: 'user', title: t('chatbot_redirect_user') },
            { value: 'sector', title: t('chatbot_redirect_sector') },
          ]"
          :label="t('chatbot_redirect_to')"
          variant="outlined"
          density="compact"
          class="mb-3"
          hide-details
        />

        <div v-if="redirectData.redirectType === 'user'" class="mb-3">
          <VLabel class="mb-1 text-body-2">{{
            t('chatbot_user_label')
          }}</VLabel>
          <VMenu v-model="isUserMenuOpen">
            <template #activator="{ props: menuProps }">
              <VTextField
                v-bind="menuProps"
                :model-value="
                  users.find((u) => u.value === redirectData.selectedUser)
                    ?.title || ''
                "
                :placeholder="t('chatbot_search')"
                variant="outlined"
                readonly
                append-inner-icon="tabler-chevron-down"
                :loading="isLoadingUsers"
                density="compact"
              />
            </template>
            <VCard>
              <VCardText>
                <VTextField
                  v-model="userSearch"
                  :placeholder="t('chatbot_search_user')"
                  variant="outlined"
                  density="compact"
                  prepend-inner-icon="tabler-search"
                  hide-details
                />
              </VCardText>
              <VDivider />
              <VList density="compact" class="max-height-300">
                <VListItem
                  v-for="user in filteredUsers"
                  :key="user.value"
                  :value="user.value"
                  @click="
                    redirectData.selectedUser = user.value;
                    isUserMenuOpen = false;
                  "
                >
                  <template #prepend>
                    <VAvatar
                      size="32"
                      :variant="!user.photo ? 'tonal' : undefined"
                      color="primary"
                    >
                      <VImg
                        v-if="user.photo"
                        :src="user.photo"
                        :alt="user.title"
                      />
                      <VIcon v-else icon="tabler-user" size="18" />
                    </VAvatar>
                  </template>
                  <VListItemTitle>{{ user.title }}</VListItemTitle>
                  <template #append v-if="user.status === 'online'">
                    <VChip size="small" color="success" variant="tonal">
                      {{ t('chatbot_online') }}
                    </VChip>
                  </template>
                </VListItem>
                <VListItem
                  v-if="filteredUsers.length === 0 && !isLoadingUsers"
                  disabled
                >
                  <VListItemTitle
                    class="text-center text-body-2 text-medium-emphasis"
                  >
                    {{ t('chatbot_no_results_found') }}
                  </VListItemTitle>
                </VListItem>
              </VList>
            </VCard>
          </VMenu>
        </div>

        <div v-if="redirectData.redirectType === 'sector'" class="mb-3">
          <VLabel class="mb-1 text-body-2">{{
            t('chatbot_sector_label')
          }}</VLabel>
          <VMenu v-model="isSectorMenuOpen">
            <template #activator="{ props: menuProps }">
              <VTextField
                v-bind="menuProps"
                :model-value="
                  sectors.find((s) => s.value === redirectData.selectedSector)
                    ?.title || ''
                "
                :placeholder="t('chatbot_search')"
                variant="outlined"
                readonly
                append-inner-icon="tabler-chevron-down"
                :loading="isLoadingSectors"
                density="compact"
              />
            </template>
            <VCard>
              <VCardText>
                <VTextField
                  v-model="sectorSearch"
                  :placeholder="t('chatbot_search_sector')"
                  variant="outlined"
                  density="compact"
                  prepend-inner-icon="tabler-search"
                  hide-details
                />
              </VCardText>
              <VDivider />
              <VList density="compact" class="max-height-300">
                <VListItem
                  v-for="sector in filteredSectors"
                  :key="sector.value"
                  :value="sector.value"
                  @click="
                    redirectData.selectedSector = sector.value;
                    isSectorMenuOpen = false;
                  "
                >
                  <template #prepend>
                    <VAvatar
                      size="24"
                      :style="{
                        backgroundColor: sector.color || '#1976D2',
                      }"
                    />
                  </template>
                  <VListItemTitle>{{ sector.title }}</VListItemTitle>
                </VListItem>
                <VListItem
                  v-if="filteredSectors.length === 0 && !isLoadingSectors"
                  disabled
                >
                  <VListItemTitle
                    class="text-center text-body-2 text-medium-emphasis"
                  >
                    {{ t('chatbot_no_results_found') }}
                  </VListItemTitle>
                </VListItem>
              </VList>
            </VCard>
          </VMenu>
        </div>

        <div
          v-if="
            redirectData.redirectType === 'sector' &&
            redirectData.selectedSector
          "
          class="mb-3"
        >
          <VLabel class="mb-1 text-body-2">{{
            t('chatbot_sector_user_label')
          }}</VLabel>
          <VMenu v-model="isSectorUserMenuOpen">
            <template #activator="{ props: menuProps }">
              <VTextField
                v-bind="menuProps"
                :model-value="
                  sectorUsers.find(
                    (u) => u.value === redirectData.selectedSectorUser
                  )?.title || ''
                "
                :placeholder="t('chatbot_search_optional')"
                variant="outlined"
                readonly
                append-inner-icon="tabler-chevron-down"
                :loading="isLoadingSectorUsers"
                density="compact"
              />
            </template>
            <VCard>
              <VCardText>
                <VTextField
                  v-model="sectorUserSearch"
                  :placeholder="t('chatbot_search_user')"
                  variant="outlined"
                  density="compact"
                  prepend-inner-icon="tabler-search"
                  hide-details
                />
              </VCardText>
              <VDivider />
              <VList density="compact" class="max-height-300">
                <VListItem
                  v-for="user in filteredSectorUsers"
                  :key="user.value"
                  :value="user.value"
                  @click="
                    redirectData.selectedSectorUser = user.value;
                    isSectorUserMenuOpen = false;
                  "
                >
                  <template #prepend>
                    <VAvatar
                      size="32"
                      :variant="!user.photo ? 'tonal' : undefined"
                      color="primary"
                    >
                      <VImg
                        v-if="user.photo"
                        :src="user.photo"
                        :alt="user.title"
                      />
                      <VIcon v-else icon="tabler-user" size="18" />
                    </VAvatar>
                  </template>
                  <VListItemTitle>{{ user.title }}</VListItemTitle>
                  <template #append v-if="user.status === 'online'">
                    <VChip size="small" color="success" variant="tonal">
                      {{ t('chatbot_online') }}
                    </VChip>
                  </template>
                </VListItem>
                <VListItem
                  v-if="
                    filteredSectorUsers.length === 0 && !isLoadingSectorUsers
                  "
                  disabled
                >
                  <VListItemTitle
                    class="text-center text-body-2 text-medium-emphasis"
                  >
                    {{ t('chatbot_no_results_found') }}
                  </VListItemTitle>
                </VListItem>
              </VList>
            </VCard>
          </VMenu>
        </div>
      </VCardText>
    </VCard>
  </div>
</template>

<style scoped>
.chatbot-redirect-node {
  min-width: 350px;
}

.redirect-card {
  border-radius: 8px;
}

.max-height-300 {
  max-height: 300px;
  overflow-y: auto;
}

.cursor-pointer {
  cursor: pointer;
}

.node-drag-handle {
  cursor: grab;
  user-select: none;
}

.node-drag-handle:active {
  cursor: grabbing;
}
</style>
