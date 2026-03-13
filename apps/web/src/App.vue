<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';
import { useTheme } from 'vuetify';
import ScrollToTop from '@/@webcore/components/ScrollToTop.vue';
import initCore from '@/@webcore/initCore';
import { initConfigStore, useConfigStore } from '@/@webcore/stores/config';
import { hexToRgb } from '@/@webcore/utils/colorConverter';
import { useChatSocket } from '@/composables/useChatSocket';
import { useChatStore } from '@/@webcore/stores/chat';
import ChatNotificationToast from '@/components/chat/ChatNotificationToast.vue';
import { useChatNotificationToast } from '@/composables/useChatNotificationToast';
import { useAttendanceGuardStore } from '@/@webcore/stores/attendanceGuard';
import AppAttendanceGuardLock from '@/components/AppAttendanceGuardLock.vue';
import { presenceOnline } from '@/@webcore/presence';

const { global } = useTheme();

initCore();
initConfigStore();

const route = useRoute();
const configStore = useConfigStore();
const chatSocket = useChatSocket();
const chatStore = useChatStore();
const { activeNotification, hideToast } = useChatNotificationToast();
const attendanceGuardStore = useAttendanceGuardStore();

const isRegisterPage = computed(() => route.path.startsWith('/register'));

watch(
  () => chatStore.user?.account_id,
  async (accountId) => {
    if (!accountId) {
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

onMounted(async () => {
  await attendanceGuardStore.bootstrap();

  if (chatStore.user?.account_id) {
    await chatSocket.initializeSocket();
  }
});

onUnmounted(async () => {
  attendanceGuardStore.shutdown();
  await chatSocket.cleanup();
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
        :message="activeNotification.message"
        :visible="!!activeNotification"
        @close="hideToast"
        @click="hideToast"
      />
    </VApp>
  </VLocaleProvider>
</template>
