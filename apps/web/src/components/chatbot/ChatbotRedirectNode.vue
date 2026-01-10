<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
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

const normalizeValue = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.toString().trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getInitialData = (): RedirectData => {
  const data = props.data as RedirectData | undefined;
  return {
    redirectType: data?.redirectType || null,
    selectedUser: normalizeValue(data?.selectedUser),
    selectedSector: normalizeValue(data?.selectedSector),
    selectedSectorUser: normalizeValue(data?.selectedSectorUser),
  };
};

const redirectData = ref<RedirectData>(getInitialData());

const users = ref<any[]>([]);
const sectors = ref<any[]>([]);
const sectorUsers = ref<any[]>([]);
const isLoadingUsers = ref(false);
const isLoadingSectors = ref(false);
const isLoadingSectorUsers = ref(false);

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
  if (isLoadingUsers.value) return;

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

    if (
      redirectData.value.selectedUser &&
      !users.value.some((u) => u.value === redirectData.value.selectedUser)
    ) {
      users.value.unshift({
        value: redirectData.value.selectedUser,
        title: redirectData.value.selectedUser,
        photo: null,
        status: null,
      });
    }
  } catch (error) {
    console.error('Error loading users:', error);
  } finally {
    isLoadingUsers.value = false;
  }
};

const loadSectors = async () => {
  if (isLoadingSectors.value) return;

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

    if (
      redirectData.value.selectedSector &&
      !sectors.value.some((s) => s.value === redirectData.value.selectedSector)
    ) {
      sectors.value.unshift({
        value: redirectData.value.selectedSector,
        title: redirectData.value.selectedSector,
        color: null,
      });
    }
  } catch (error) {
    console.error('Error loading sectors:', error);
  } finally {
    isLoadingSectors.value = false;
  }
};

const loadSectorUsers = async (sectorId: string) => {
  if (isLoadingSectorUsers.value) return;

  isLoadingSectorUsers.value = true;
  try {
    const usersList = await chatbotStore.listChatbotSectorUsers(sectorId);
    sectorUsers.value = usersList.map((user) => ({
      value: user.id,
      title: user.name,
      photo: user.photo || null,
      status: user.status,
    }));

    if (
      redirectData.value.selectedSectorUser &&
      !sectorUsers.value.some(
        (u) => u.value === redirectData.value.selectedSectorUser
      )
    ) {
      sectorUsers.value.unshift({
        value: redirectData.value.selectedSectorUser,
        title: redirectData.value.selectedSectorUser,
        photo: null,
        status: null,
      });
    }
  } catch (error) {
    sectorUsers.value = [];
    console.error('Error loading sector users:', error);
  } finally {
    isLoadingSectorUsers.value = false;
  }
};

watch(
  () => redirectData.value.redirectType,
  (newType) => {
    if (newType === 'user' && users.value.length === 0) {
      loadUsers();
    } else if (newType === 'sector' && sectors.value.length === 0) {
      loadSectors();
    }
  }
);

watch(
  () => redirectData.value.selectedSector,
  (sectorId) => {
    if (sectorId) {
      loadSectorUsers(sectorId);
    }
  }
);

watch(
  () => redirectData.value.redirectType,
  (newType) => {
    redirectData.value.selectedUser = null;
    redirectData.value.selectedSector = null;
    redirectData.value.selectedSectorUser = null;
    sectorUsers.value = [];
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

onMounted(() => {
  if (redirectData.value.redirectType === 'user') {
    loadUsers();
  }

  if (redirectData.value.redirectType === 'sector') {
    loadSectors();

    if (redirectData.value.selectedSector) {
      loadSectorUsers(redirectData.value.selectedSector);

      if (
        redirectData.value.selectedSectorUser &&
        !sectorUsers.value.some(
          (u) => u.value === redirectData.value.selectedSectorUser
        )
      ) {
        sectorUsers.value.unshift({
          value: redirectData.value.selectedSectorUser,
          title: redirectData.value.selectedSectorUser,
          photo: null,
          status: null,
        });
      }
    }
  }
});
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
        <VLabel class="text-body-2 mb-1">{{ t('chatbot_redirect_to') }}</VLabel>
        <VSelect
          v-model="redirectData.redirectType"
          :items="[
            { value: 'user', title: t('chatbot_redirect_user') },
            { value: 'sector', title: t('chatbot_redirect_sector') },
          ]"
          variant="outlined"
          density="compact"
          class="mb-3"
          hide-details
        />

        <div v-if="redirectData.redirectType === 'user'" class="mb-3">
          <VLabel class="text-body-2 mb-1">{{
            t('chatbot_user_label')
          }}</VLabel>
          <AppSelectSearch
            v-model="redirectData.selectedUser"
            :items="users"
            :placeholder="t('chatbot_search')"
            :loading="isLoadingUsers"
            :clearable="true"
            item-value="value"
            item-title="title"
            @select="loadUsers()"
          >
            <template #item-prepend="{ item }">
              <VAvatar
                size="32"
                :variant="!item.photo ? 'tonal' : undefined"
                color="primary"
              >
                <VImg v-if="item.photo" :src="item.photo" :alt="item.title" />
                <VIcon v-else icon="tabler-user" size="18" />
              </VAvatar>
            </template>
          </AppSelectSearch>
        </div>

        <div v-if="redirectData.redirectType === 'sector'" class="mb-3">
          <VLabel class="text-body-2 mb-1">{{
            t('chatbot_sector_label')
          }}</VLabel>
          <AppSelectSearch
            v-model="redirectData.selectedSector"
            :items="sectors"
            :placeholder="t('chatbot_search')"
            :loading="isLoadingSectors"
            :clearable="true"
            item-value="value"
            item-title="title"
            @select="loadSectors()"
          >
            <template #item-prepend="{ item }">
              <VAvatar
                size="24"
                :style="{
                  backgroundColor: item.color || '#1976D2',
                }"
              />
            </template>
          </AppSelectSearch>
        </div>

        <div
          v-if="
            redirectData.redirectType === 'sector' &&
            redirectData.selectedSector
          "
          class="mb-3"
        >
          <VLabel class="text-body-2 mb-1">{{
            t('chatbot_sector_user_label')
          }}</VLabel>
          <AppSelectSearch
            v-model="redirectData.selectedSectorUser"
            :items="sectorUsers"
            :placeholder="t('chatbot_search_optional')"
            :loading="isLoadingSectorUsers"
            :clearable="true"
            item-value="value"
            item-title="title"
            @select="loadSectorUsers(redirectData.selectedSector)"
          >
            <template #item-prepend="{ item }">
              <VAvatar
                size="32"
                :variant="!item.photo ? 'tonal' : undefined"
                color="primary"
              >
                <VImg v-if="item.photo" :src="item.photo" :alt="item.title" />
                <VIcon v-else icon="tabler-user" size="18" />
              </VAvatar>
            </template>
          </AppSelectSearch>
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
