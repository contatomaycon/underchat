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
import { useInternalChatStore } from '@/@webcore/stores/internalChat';
import { useAuthStore } from '@/@webcore/stores/auth';
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
const internalChatStore = useInternalChatStore();
const authStore = useAuthStore();
const {
  activeNotification,
  pendingTransferNotifications,
  hideToast,
  restorePendingTransferNotifications,
  consumeTransferNotificationById,
} = useChatNotificationToast();
const attendanceGuardStore = useAttendanceGuardStore();
useInternalChatNotifications();
let restoreTransferNotificationKey = '';

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
  [() => chatStore.user?.account_id, () => authStore.planIsActive] as const,
  async ([accountId, planIsActive]) => {
    if (!accountId) {
      chatStore.resetUnreadSummary();
      await chatSocket.cleanup();
      return;
    }

    if (!planIsActive || !hasChatRealtimeAccess()) {
      chatStore.resetUnreadSummary();
      await chatSocket.cleanup();
      return;
    }

    chatStore.ensureUnreadSummaryAccountScope(accountId);
    void presenceOnline().catch(() => {});

    if (!chatSocket.isInitialized()) {
      await chatSocket.initializeSocket().catch(() => {});
    }

    void chatStore.viewUnreadSummary();
  },
  { immediate: true }
);

watch(
  [
    () => chatStore.user?.account_id,
    () => authStore.planIsActive,
    () => authStore.planProducts.join('|'),
  ] as const,
  async ([accountId, planIsActive]) => {
    if (!accountId) {
      internalChatStore.resetUnreadSummary();
      await internalChatSocket.cleanup();
      return;
    }

    if (!planIsActive || !hasInternalChatRealtimeAccess()) {
      internalChatStore.resetUnreadSummary();
      await internalChatSocket.cleanup();
      return;
    }

    internalChatStore.ensureUnreadSummaryAccountScope(accountId);
    if (!internalChatSocket.isInitialized()) {
      await internalChatSocket.initializeSocket().catch(() => {});
    }

    void internalChatStore.viewUnreadSummary();
  },
  { immediate: true }
);

onMounted(async () => {
  await attendanceGuardStore.bootstrap();
});

watch(
  [() => chatStore.user?.account_id, () => chatStore.user?.user_id],
  ([accountId, userId]) => {
    if (!accountId || !userId) {
      return;
    }

    const nextKey = `${accountId}:${userId}`;
    if (restoreTransferNotificationKey === nextKey) {
      return;
    }

    restoreTransferNotificationKey = nextKey;
    restorePendingTransferNotifications();
  },
  { immediate: true }
);

onUnmounted(async () => {
  attendanceGuardStore.shutdown();
  chatStore.resetUnreadSummary();
  internalChatStore.resetUnreadSummary();
  await chatSocket.cleanup();
  await internalChatSocket.cleanup();
});
</script>

<template>
  <VLocaleProvider :rtl="configStore.isAppRTL">
    <VApp
      :style="`--v-global-theme-primary: ${hexToRgb(String(global.current.value.colors.primary))}`"
    >
      <RouterView />
      <AppAttendanceGuardLock />

      <ScrollToTop v-if="!isRegisterPage" />

      <div
        v-if="
          pendingTransferNotifications.length > 0 ||
          (activeNotification && activeNotification.type !== 'transfer')
        "
        class="chat-notification-toast-stack"
      >
        <template v-if="pendingTransferNotifications.length > 0">
          <ChatNotificationToast
            v-for="notification in pendingTransferNotifications"
            :key="notification.id"
            :notification="notification"
            :visible="true"
            @close="consumeTransferNotificationById(notification.id)"
          />
        </template>

        <ChatNotificationToast
          v-else-if="activeNotification"
          :notification="activeNotification"
          :visible="true"
          @close="hideToast"
          @click="hideToast"
        />
      </div>
    </VApp>
  </VLocaleProvider>
</template>

<style lang="scss" scoped>
.chat-notification-toast-stack {
  position: fixed;
  top: 24px;
  right: 24px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
  width: min(400px, calc(100vw - 48px));
}
</style>
