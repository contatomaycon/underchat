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

const { global } = useTheme();

initCore();
initConfigStore();

const configStore = useConfigStore();
const chatSocket = useChatSocket();
const chatStore = useChatStore();
const { activeNotification, hideToast } = useChatNotificationToast();

watch(
  () => chatStore.user?.account_id,
  async (accountId) => {
    if (!accountId) {
      await chatSocket.cleanup();
      return;
    }

    if (!chatSocket.isInitialized()) {
      await chatSocket.initializeSocket();
    }
  },
  { immediate: true }
);

onMounted(async () => {
  if (chatStore.user?.account_id) {
    await chatSocket.initializeSocket();
  }
});

onUnmounted(async () => {
  await chatSocket.cleanup();
});
</script>

<template>
  <VLocaleProvider :rtl="configStore.isAppRTL">
    <VApp
      :style="`--v-global-theme-primary: ${hexToRgb(global.current.value.colors.primary)}`"
    >
      <RouterView />

      <ScrollToTop />

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
