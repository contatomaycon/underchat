<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';
import { useTheme } from 'vuetify';
import ScrollToTop from '@/@webcore/components/ScrollToTop.vue';
import initCore from '@/@webcore/initCore';
import { initConfigStore, useConfigStore } from '@/@webcore/stores/config';
import { hexToRgb } from '@/@webcore/utils/colorConverter';
import { useChatSocket } from '@/composables/useChatSocket';
import { useInternalChatSocket } from '@/composables/useInternalChatSocket';
import { useInternalChatNotifications } from '@/composables/useInternalChatNotifications';
import { useChatStore } from '@/@webcore/stores/chat';
import ChatNotificationToast from '@/components/chat/ChatNotificationToast.vue';
import { useChatNotificationToast } from '@/composables/useChatNotificationToast';
import { useAttendanceGuardStore } from '@/@webcore/stores/attendanceGuard';
import AppAttendanceGuardLock from '@/components/AppAttendanceGuardLock.vue';
import { presenceOnline } from '@/@webcore/presence';
import { getPermissions, getPlanProducts } from '@/@webcore/localStorage/user';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EChatbotPermissions } from '@core/common/enums/EPermissions/chatbot';
import { EInternalChatPermissions } from '@core/common/enums/EPermissions/internalChat';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';

const { global } = useTheme();

initCore();
initConfigStore();

const route = useRoute();
const configStore = useConfigStore();
const chatSocket = useChatSocket();
const internalChatSocket = useInternalChatSocket();
const chatStore = useChatStore();
const { activeNotification, hideToast } = useChatNotificationToast();
const attendanceGuardStore = useAttendanceGuardStore();
useInternalChatNotifications();

const isRegisterPage = computed(() => route.path.startsWith('/register'));

const hasChatRealtimeAccess = (): boolean => {
  const permissions = getPermissions();

  if (permissions.length === 0) {
    return true;
  }

  return permissions.some(
    (permission) =>
      permission === EGeneralPermissions.full_access ||
      permission === EGeneralPermissions.full_access_group ||
      permission === EChatPermissions.chat_group ||
      permission === EChatPermissions.chat_access ||
      permission === EChatPermissions.chat_kanban ||
      permission === EChatPermissions.view_chatbot_messages ||
      permission === EChatPermissions.list_all_chats_in_sector ||
      permission === EChatPermissions.list_all_chats_without_sector_limit ||
      permission === EChatbotPermissions.chatbot_group ||
      permission === EChatbotPermissions.chatbot_access
  );
};

const hasInternalChatRealtimeAccess = (): boolean => {
  const permissions = getPermissions();
  const planProducts = getPlanProducts();

  if (permissions.length === 0) {
    return true;
  }

  const hasPermission = permissions.some(
    (permission) =>
      permission === EGeneralPermissions.full_access ||
      permission === EGeneralPermissions.full_access_group ||
      permission === EInternalChatPermissions.internal_chat_group ||
      permission === EInternalChatPermissions.internal_chat_access
  );

  if (!hasPermission) {
    return false;
  }

  return (
    planProducts.length === 0 ||
    planProducts.includes(EPlanProduct.internal_chat)
  );
};

watch(
  () => chatStore.user?.account_id,
  async (accountId) => {
    if (!accountId) {
      await chatSocket.cleanup();
      return;
    }

    if (!hasChatRealtimeAccess()) {
      await chatSocket.cleanup();
      return;
    }

    void presenceOnline().catch(() => {});

    if (!chatSocket.isInitialized()) {
      await chatSocket.initializeSocket();
    }
  },
  { immediate: true }
);

watch(
  () => chatStore.user?.account_id,
  async (accountId) => {
    if (!accountId) {
      await internalChatSocket.cleanup();
      return;
    }

    if (!hasInternalChatRealtimeAccess()) {
      await internalChatSocket.cleanup();
      return;
    }

    if (!internalChatSocket.isInitialized()) {
      await internalChatSocket.initializeSocket();
    }
  },
  { immediate: true }
);

onMounted(async () => {
  await attendanceGuardStore.bootstrap();

  if (chatStore.user?.account_id && hasChatRealtimeAccess()) {
    await chatSocket.initializeSocket();
  } else {
    await chatSocket.cleanup();
  }

  if (chatStore.user?.account_id && hasInternalChatRealtimeAccess()) {
    await internalChatSocket.initializeSocket();
  } else {
    await internalChatSocket.cleanup();
  }
});

onUnmounted(async () => {
  attendanceGuardStore.shutdown();
  await chatSocket.cleanup();
  await internalChatSocket.cleanup();
});
</script>

<template>
  <VLocaleProvider :rtl="configStore.isAppRTL">
    <VApp
      :style="`--v-global-theme-primary: ${hexToRgb(global.current.value.colors.primary)}`"
    >
      <RouterView />
      <AppAttendanceGuardLock />

      <ScrollToTop v-if="!isRegisterPage" />

      <ChatNotificationToast
        v-if="activeNotification"
        :notification="activeNotification"
        :visible="!!activeNotification"
        @close="hideToast"
        @click="hideToast"
      />
    </VApp>
  </VLocaleProvider>
</template>
