<script lang="ts" setup>
import { useChatStore } from '@/@webcore/stores/chat';
import { computed, watch, onUnmounted, nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ListChatsResult } from '@core/schema/chat/listChats/response.schema';
import { formatDate } from '@core/common/functions/formatDate';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import { EColor } from '@core/common/enums/EColor';
import { SearchChatsQuery } from '@core/schema/chat/searchChats/request.schema';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import {
  getPermissions,
  getSectors,
  getUser,
} from '@/@webcore/localStorage/user';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { ListMessageResult } from '@core/schema/chat/listMessageChats/response.schema';
import ChatLogViewer from '@/components/chat/ChatLogViewer.vue';
import ChatMediaViewer from '@/components/chat/ChatMediaViewer.vue';
import ChatContactViewModal from '@/components/chat/ChatContactViewModal.vue';
import { ViewChatContactResponse } from '@core/schema/chat/viewContact/response.schema';

const props = defineProps<{
  isOpen?: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const chatStore = useChatStore();
const { t } = useI18n();

const attendanceHistory = ref<ListChatsResult[]>([]);
const isLoading = ref(false);
const isLoadingMore = ref(false);
const currentPage = ref(1);
const totalPages = ref(0);
const perPage = 20;
const attendanceHistoryContainer = ref<HTMLElement | null>(null);

const isConversationModalOpen = ref(false);
const conversationMessages = ref<ListMessageResult[]>([]);
const loadingMessages = ref(false);
const selectedChat = ref<ListChatsResult | null>(null);
const conversationScrollRef = ref<HTMLElement | null>(null);

const activePhone = computed(() => {
  return chatStore.activeChat?.phone ?? '';
});

const canListAllChats = computed(() => {
  const permissions = getPermissions();
  if (!permissions) return false;

  return permissions.some(
    (perm) =>
      perm === EGeneralPermissions.full_access ||
      perm === EGeneralPermissions.full_access_group ||
      perm === EChatPermissions.chat_group ||
      perm === EChatPermissions.list_all_chats_in_sector ||
      perm === EChatPermissions.list_all_chats_without_sector_limit
  );
});

const formatAttendanceDate = (
  dateString: string | null | undefined
): string => {
  if (!dateString) return '-';

  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return t('today');
  }

  if (date.toDateString() === yesterday.toDateString()) {
    return t('yesterday');
  }

  return formatDate(dateString);
};

const formatLastInteractionDate = (
  dateString: string | null | undefined
): string => {
  if (!dateString) return '-';
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return (
      formatDateTime(dateString).split(' às ')[1] || formatDate(dateString)
    );
  }

  if (date.toDateString() === yesterday.toDateString()) {
    return `${t('yesterday')} ${formatDateTime(dateString).split(' às ')[1] || ''}`.trim();
  }

  return formatDateTime(dateString);
};

const calculateAttendanceTime = (
  startDate: string | null | undefined,
  endDate: string | null | undefined
): string => {
  if (!startDate || !endDate) {
    return '-';
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return '-';
  }

  const diffMs = end.getTime() - start.getTime();
  if (diffMs < 0) {
    return '-';
  }

  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    const hours = diffHours % 24;
    const minutes = diffMinutes % 60;
    if (hours > 0 && minutes > 0) {
      return `${diffDays}d ${hours}h ${minutes}min`;
    }
    if (hours > 0) {
      return `${diffDays}d ${hours}h`;
    }
    return `${diffDays}d ${minutes}min`;
  }

  if (diffHours > 0) {
    const minutes = diffMinutes % 60;
    if (minutes > 0) {
      return `${diffHours}h ${minutes}min`;
    }
    return `${diffHours}h`;
  }

  if (diffMinutes > 0) {
    const seconds = diffSeconds % 60;
    if (seconds > 0) {
      return `${diffMinutes}min ${seconds}s`;
    }
    return `${diffMinutes}min`;
  }

  return `${diffSeconds}s`;
};

const loadAttendanceHistory = async (reset: boolean = true) => {
  if (!activePhone.value) {
    attendanceHistory.value = [];
    currentPage.value = 1;
    totalPages.value = 0;
    return;
  }

  if (reset) {
    currentPage.value = 1;
    isLoading.value = true;
  } else {
    isLoadingMore.value = true;
  }

  try {
    const user = getUser();
    const userId = user?.user_id;
    const sectors = getSectors();

    const query: SearchChatsQuery = {
      current_page: currentPage.value,
      per_page: perPage,
      search: '',
      status: EChatStatus.closed,
      filter_phone: activePhone.value,
      sort_field: 'closed_at',
      sort_order: 'desc',
    };

    if (!canListAllChats.value && userId) {
      query.filter_user_id = userId;
    }

    if (!canListAllChats.value && sectors && sectors.length > 0) {
      if (sectors.length === 1) {
        query.filter_sector_id = sectors[0];
      }
    }

    const response = await chatStore.searchChats(query);

    if (response) {
      if (reset) {
        attendanceHistory.value = response.results;
      } else {
        attendanceHistory.value.push(...response.results);
      }

      currentPage.value = response.pagings.current_page;
      totalPages.value = response.pagings.total_pages;
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : t('attendance_history_load_error') || 'Erro ao carregar histórico';
    chatStore.showSnackbar(errorMessage, EColor.error);
    if (reset) {
      attendanceHistory.value = [];
    }
  } finally {
    isLoading.value = false;
    isLoadingMore.value = false;
  }
};

const loadMoreResults = async () => {
  if (
    isLoadingMore.value ||
    currentPage.value >= totalPages.value ||
    !activePhone.value
  ) {
    return;
  }

  currentPage.value += 1;
  await loadAttendanceHistory(false);
};

const handleScroll = () => {
  const container = attendanceHistoryContainer.value;
  if (!container) return;

  const threshold = 100;
  const { scrollTop, scrollHeight, clientHeight } = container;

  if (scrollTop + clientHeight >= scrollHeight - threshold) {
    loadMoreResults();
  }
};

watch(
  () => props.isOpen,
  async (isOpen) => {
    if (isOpen && activePhone.value) {
      await loadAttendanceHistory(true);
    }
    if (!isOpen) {
      attendanceHistory.value = [];
      currentPage.value = 1;
      totalPages.value = 0;
    }
  }
);

watch(
  () => chatStore.activeChat?.chat_id,
  () => {
    if (!props.isOpen) {
      attendanceHistory.value = [];
      currentPage.value = 1;
      totalPages.value = 0;
      return;
    }
    if (activePhone.value) {
      loadAttendanceHistory(true);
    }
  }
);

watch(
  () => attendanceHistoryContainer.value,
  (container) => {
    if (!container) return;
    container.addEventListener('scroll', handleScroll, { passive: true });
  },
  { immediate: true }
);

const loadChatMessages = async (chatId: string) => {
  loadingMessages.value = true;
  conversationMessages.value = [];

  try {
    const response = await chatStore.getChatMessagesById(chatId, {
      current_page: 1,
      per_page: 100,
    });

    if (response) {
      conversationMessages.value = [...response.results].reverse();
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : t('error_loading_messages') || 'Erro ao carregar mensagens';
    chatStore.showSnackbar(errorMessage, EColor.error);
  } finally {
    loadingMessages.value = false;
    await nextTick();
    setTimeout(() => {
      scrollToBottom();
    }, 300);
  }
};

const handleChatClick = async (chat: ListChatsResult) => {
  selectedChat.value = chat;
  isConversationModalOpen.value = true;
  await loadChatMessages(chat.chat_id);
};

const scrollToBottom = (retries = 5) => {
  requestAnimationFrame(() => {
    let scrollContainer: HTMLElement | null = null;

    if (conversationScrollRef.value) {
      const element = conversationScrollRef.value as HTMLElement;
      if (element && element.parentElement) {
        scrollContainer = element.parentElement;
      }
    }

    if (scrollContainer) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
      return;
    }

    if (retries > 0) {
      setTimeout(() => scrollToBottom(retries - 1), 100);
    }
  });
};

const imageViewerOpen = ref(false);
const imageViewerSrc = ref('');
const imageViewerCaption = ref('');
const imageViewerKind = ref<'image' | 'video'>('image');
const locationModalOpen = ref(false);
const locationData = ref<{
  latitude: number;
  longitude: number;
  name?: string | null;
  address?: string | null;
} | null>(null);
const contactModalOpen = ref(false);
const selectedContact = ref<ViewChatContactResponse | null>(null);

const handleOpenImage = (src: string, caption?: string) => {
  imageViewerSrc.value = src;
  imageViewerCaption.value = caption || '';
  imageViewerKind.value = 'image';
  imageViewerOpen.value = true;
};

const handleOpenVideo = (src: string, caption?: string) => {
  imageViewerSrc.value = src;
  imageViewerCaption.value = caption || '';
  imageViewerKind.value = 'video';
  imageViewerOpen.value = true;
};

const handleOpenLocation = (location: {
  latitude: number;
  longitude: number;
  name?: string | null;
  address?: string | null;
}) => {
  locationData.value = location;
  locationModalOpen.value = true;
};

const handleOpenContact = async (contactId: string) => {
  if (!contactId) return;

  try {
    const contact = await chatStore.getChatContactById(contactId, true);
    if (contact) {
      selectedContact.value = contact;
      contactModalOpen.value = true;
    }
  } catch (error) {
    chatStore.showSnackbar(
      t('error_loading_contact') || 'Erro ao carregar contato',
      EColor.error
    );
  }
};

onUnmounted(() => {
  attendanceHistoryContainer.value?.removeEventListener('scroll', handleScroll);
});
</script>

<template>
  <div class="chat-attendance-history-sidebar-content">
    <div class="d-flex align-center pa-4 border-b">
      <IconBtn class="me-2" @click="$emit('close')">
        <VIcon icon="tabler-x" />
      </IconBtn>
      <h6 class="text-h6">{{ $t('attendance_history') }}</h6>
    </div>

    <div class="pa-4 d-flex flex-column" style="height: calc(100% - 64px)">
      <div
        class="flex-grow-1 d-flex flex-column"
        style="min-height: 0; overflow: hidden"
      >
        <div
          v-if="isLoading"
          class="d-flex flex-column flex-grow-1"
          style="gap: 16px"
        >
          <div v-for="i in 5" :key="i" class="attendance-history-skeleton">
            <div class="d-flex align-start gap-3">
              <VSkeletonLoader type="avatar" width="40" height="40" />
              <div class="flex-grow-1">
                <VSkeletonLoader type="text" width="40%" class="mb-1" />
                <VSkeletonLoader type="text" width="70%" class="mb-1" />
                <VSkeletonLoader type="text" width="50%" />
              </div>
            </div>
          </div>
        </div>

        <div
          v-else-if="attendanceHistory.length > 0"
          ref="attendanceHistoryContainer"
          class="attendance-history-container flex-grow-1"
          style="overflow-y: auto"
        >
          <div class="attendance-history-list">
            <div
              v-for="chat in attendanceHistory"
              :key="chat.chat_id"
              class="attendance-history-item"
              style="cursor: pointer"
              @click="handleChatClick(chat)"
            >
              <div class="d-flex align-start gap-3">
                <VAvatar
                  size="40"
                  :variant="
                    !(chat.photo ?? chat.contact?.photo) ? 'tonal' : undefined
                  "
                  color="primary"
                >
                  <VImg
                    v-if="chat.contact?.photo ?? chat.photo"
                    :src="chat.contact?.photo ?? chat.photo ?? ''"
                    :alt="chat.contact?.name ?? chat.name ?? ''"
                  />
                  <VImg
                    v-else
                    :src="'/images/svg/avatar-default.svg'"
                    :alt="chat.contact?.name ?? chat.name ?? ''"
                  />
                </VAvatar>
                <div class="flex-grow-1">
                  <div class="text-body-2 font-weight-medium mb-1">
                    {{ formatAttendanceDate(chat.date) }}
                  </div>
                  <div class="text-caption text-medium-emphasis mb-1">
                    {{ $t('last_interaction') }}:
                    {{
                      formatLastInteractionDate(chat.summary?.last_date ?? null)
                    }}
                  </div>
                  <div class="text-caption text-medium-emphasis">
                    {{ $t('attendance_time') }}:
                    {{
                      calculateAttendanceTime(
                        chat.started_at ?? null,
                        chat.closed_at ?? null
                      )
                    }}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div
            v-if="isLoadingMore"
            class="d-flex justify-center align-center pa-4"
          >
            <VProgressCircular indeterminate color="primary" size="24" />
          </div>
          <div
            v-else-if="
              currentPage >= totalPages && attendanceHistory.length > 0
            "
            class="d-flex justify-center align-center pa-4"
          >
            <p class="text-caption text-medium-emphasis">
              {{ $t('no_more_results') }}
            </p>
          </div>
        </div>

        <div v-else class="d-flex justify-center align-center flex-grow-1">
          <p class="text-body-2 text-medium-emphasis">
            {{ $t('no_attendance_history') }}
          </p>
        </div>
      </div>
    </div>
  </div>

  <VDialog
    v-model="isConversationModalOpen"
    max-width="900"
    :scrollable="false"
  >
    <VCard>
      <VCardTitle class="d-flex align-center justify-space-between">
        <div class="d-flex align-center gap-3">
          <VAvatar
            size="40"
            :variant="
              !(selectedChat?.photo ?? selectedChat?.contact?.photo)
                ? 'tonal'
                : undefined
            "
            color="primary"
          >
            <VImg
              v-if="selectedChat?.contact?.photo ?? selectedChat?.photo"
              :src="selectedChat?.contact?.photo ?? selectedChat?.photo ?? ''"
              :alt="selectedChat?.contact?.name ?? selectedChat?.name ?? ''"
            />
            <VImg
              v-else
              :src="'/images/svg/avatar-default.svg'"
              :alt="selectedChat?.contact?.name ?? selectedChat?.name ?? ''"
            />
          </VAvatar>
          <div>
            <div class="text-h6">
              {{ selectedChat?.contact?.name ?? selectedChat?.name ?? '' }}
            </div>
            <div
              v-if="selectedChat?.phone"
              class="text-caption text-medium-emphasis"
            >
              {{ formatPhoneBR(selectedChat.phone) }}
            </div>
          </div>
        </div>
        <VBtn icon variant="text" @click="isConversationModalOpen = false">
          <VIcon>tabler-x</VIcon>
        </VBtn>
      </VCardTitle>

      <VDivider />

      <VCardText
        class="pa-0 position-relative conversation-modal-scroll"
        style="
          height: 600px;
          overflow-y: auto;
          background-color: rgb(var(--v-theme-background));
        "
      >
        <div ref="conversationScrollRef" class="pa-4" style="min-height: 100%">
          <ChatLogViewer
            :messages="conversationMessages"
            :client-name="
              selectedChat?.contact?.name ?? selectedChat?.name ?? ''
            "
            :operator-name="selectedChat?.user?.name ?? ''"
            :client-photo="
              selectedChat?.contact?.photo ?? selectedChat?.photo ?? null
            "
            :loading="loadingMessages"
            @open-image="handleOpenImage"
            @open-video="handleOpenVideo"
            @open-location="handleOpenLocation"
            @open-contact="handleOpenContact"
          />
        </div>
      </VCardText>
    </VCard>
  </VDialog>

  <ChatMediaViewer
    v-model="imageViewerOpen"
    :src="imageViewerSrc"
    :caption="imageViewerCaption"
    :kind="imageViewerKind"
  />

  <ChatContactViewModal v-model="contactModalOpen" :contact="selectedContact" />

  <VDialog v-model="locationModalOpen" max-width="800" :scrollable="false">
    <VCard v-if="locationData">
      <VCardTitle class="d-flex align-center justify-space-between">
        <div>
          <div v-if="locationData.name" class="text-h6">
            {{ locationData.name }}
          </div>
          <div v-else class="text-h6">
            {{ $t('location_label') }}
          </div>
          <div
            v-if="locationData.address"
            class="text-caption text-medium-emphasis mt-1"
          >
            {{ locationData.address }}
          </div>
        </div>
        <VBtn
          icon
          variant="text"
          size="small"
          @click="locationModalOpen = false"
        >
          <VIcon>tabler-x</VIcon>
        </VBtn>
      </VCardTitle>
      <VCardText class="pa-0">
        <div class="location-map-wrapper">
          <div class="d-flex justify-center align-center pa-8">
            <div class="d-flex flex-column align-center">
              <VIcon size="48" color="primary">tabler-map-pin</VIcon>
              <span class="text-body-1 mt-4">
                {{ $t('location_map_unavailable') || 'Mapa indisponível' }}
              </span>
              <div class="text-caption text-medium-emphasis mt-2">
                {{ locationData.latitude }}, {{ locationData.longitude }}
              </div>
            </div>
          </div>
        </div>
      </VCardText>
    </VCard>
  </VDialog>
</template>

<style scoped>
.chat-attendance-history-sidebar-content {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.border-b {
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.attendance-history-container {
  max-height: calc(100vh - 200px);
  overflow-y: auto;
}

.attendance-history-container::-webkit-scrollbar {
  width: 6px;
}

.attendance-history-container::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.05);
  border-radius: 10px;
}

.attendance-history-container::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 10px;
  transition: background 0.2s ease;
}

.attendance-history-container::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.3);
}

@supports (scrollbar-width: thin) {
  .attendance-history-container {
    scrollbar-width: thin;
    scrollbar-color: rgba(0, 0, 0, 0.2) rgba(0, 0, 0, 0.05);
  }
}

.attendance-history-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.attendance-history-item {
  padding: 12px;
  border-radius: 8px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  transition: background-color 0.2s ease;
}

.attendance-history-item:hover {
  background-color: rgba(var(--v-theme-primary), 0.04);
}

.attendance-history-skeleton {
  padding: 12px;
  border-radius: 8px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  display: flex;
  flex-direction: column;
}

.conversation-modal-scroll::-webkit-scrollbar {
  width: 6px;
}

.conversation-modal-scroll::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.05);
  border-radius: 10px;
}

.conversation-modal-scroll::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 10px;
  transition: background 0.2s ease;
}

.conversation-modal-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.3);
}

@supports (scrollbar-width: thin) {
  .conversation-modal-scroll {
    scrollbar-width: thin;
    scrollbar-color: rgba(0, 0, 0, 0.2) rgba(0, 0, 0, 0.05);
  }
}
</style>
