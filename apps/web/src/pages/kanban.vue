<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { PerfectScrollbar } from 'vue3-perfect-scrollbar';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { useChatStore } from '@/@webcore/stores/chat';
import { useChatSocket } from '@/composables/useChatSocket';
import ChatQueue from '@/components/chat/ChatQueue.vue';
import type { ListChatsResult } from '@core/schema/chat/listChats/response.schema';

definePage({
  meta: {
    layoutWrapperClasses: 'layout-content-height-fixed',
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
      EChatPermissions.chat_kanban,
    ],
  },
});

const router = useRouter();
const chatStore = useChatStore();
const chatSocket = useChatSocket();
const isInitialLoading = ref(true);
const isManualOnlyKanbanMode = ref(false);
const isBrowserFullscreen = ref(false);
const isApiFullscreen = ref(false);

const ONLY_KANBAN_MODE_CLASS = 'kanban-only-mode';

const INITIAL_SKELETON_ITEMS = 6;
const LOAD_MORE_SKELETON_ITEMS = 3;

const KANBAN_COLUMNS = [
  {
    key: 'chatbot' as const,
    listKey: 'kanbanChatbot' as const,
    pagingsKey: 'kanbanChatbotPagings' as const,
    titleKey: 'chatbot',
    colorClass: 'kanban-column-chatbot',
  },
  {
    key: 'queue' as const,
    listKey: 'kanbanQueue' as const,
    pagingsKey: 'kanbanQueuePagings' as const,
    titleKey: 'waiting_for_service',
    colorClass: 'kanban-column-queue',
  },
  {
    key: 'in_chat' as const,
    listKey: 'kanbanInChat' as const,
    pagingsKey: 'kanbanInChatPagings' as const,
    titleKey: 'in_service',
    colorClass: 'kanban-column-in-chat',
  },
  {
    key: 'closed' as const,
    listKey: 'kanbanClosed' as const,
    pagingsKey: 'kanbanClosedPagings' as const,
    titleKey: 'closed',
    colorClass: 'kanban-column-closed',
  },
] as const;

type KanbanColumnKey = (typeof KANBAN_COLUMNS)[number]['key'];

const columnScrollRefs = ref<
  Record<KanbanColumnKey, InstanceType<typeof PerfectScrollbar> | null>
>({
  chatbot: null,
  queue: null,
  in_chat: null,
  closed: null,
});

const hasMore = (column: KanbanColumnKey) => {
  const pagingsKey = KANBAN_COLUMNS.find((c) => c.key === column)!.pagingsKey;
  const pagings = chatStore[pagingsKey];
  return pagings.current_page < pagings.total_pages;
};

const isLoadingMore = (column: KanbanColumnKey) =>
  chatStore.loadingKanbanColumn === column;

const showInitialSkeleton = computed(
  () => isInitialLoading.value || chatStore.loadingKanban
);

const isOnlyKanbanMode = computed(
  () =>
    isManualOnlyKanbanMode.value ||
    isBrowserFullscreen.value ||
    isApiFullscreen.value
);

const getColumnTotal = (column: (typeof KANBAN_COLUMNS)[number]): number => {
  const pagings = chatStore[column.pagingsKey];
  if (typeof pagings?.total === 'number') {
    return pagings.total;
  }
  return chatStore[column.listKey].length;
};

const handleColumnScroll = (column: KanbanColumnKey, event: Event) => {
  const target = event.target as HTMLElement;
  if (!target) return;
  const scrollContainer = target.closest('.ps') as HTMLElement;
  if (!scrollContainer) return;
  const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
  const threshold = 150;
  if (
    scrollTop + clientHeight >= scrollHeight - threshold &&
    hasMore(column) &&
    !isLoadingMore(column)
  ) {
    chatStore.loadMoreKanbanColumn(column);
  }
};

const openChat = (chatId: ListChatsResult['chat_id']) => {
  chatStore.setActiveChat(chatId);
  router.push({ name: 'chat' });
};

const detectBrowserFullscreen = () => {
  const tolerance = 2;
  isBrowserFullscreen.value =
    Math.abs(window.innerWidth - window.screen.width) <= tolerance &&
    Math.abs(window.innerHeight - window.screen.height) <= tolerance;
};

const syncApiFullscreenState = () => {
  isApiFullscreen.value = Boolean(document.fullscreenElement);
};

const syncOnlyKanbanBodyClass = () => {
  document.body.classList.toggle(ONLY_KANBAN_MODE_CLASS, isOnlyKanbanMode.value);
};

const requestFullscreen = async () => {
  if (!document.documentElement.requestFullscreen || document.fullscreenElement) {
    return;
  }
  try {
    await document.documentElement.requestFullscreen();
  } catch {
    // Ignore fullscreen errors and keep focus mode without browser fullscreen
  }
};

const exitFullscreen = async () => {
  if (!document.exitFullscreen || !document.fullscreenElement) {
    return;
  }
  try {
    await document.exitFullscreen();
  } catch {
    // Ignore exit fullscreen errors
  }
};

const enterOnlyKanbanMode = async (useFullscreenApi = true) => {
  isManualOnlyKanbanMode.value = true;
  if (useFullscreenApi) {
    await requestFullscreen();
  }
  detectBrowserFullscreen();
  syncApiFullscreenState();
};

const leaveOnlyKanbanMode = async (useFullscreenApi = true) => {
  isManualOnlyKanbanMode.value = false;
  if (useFullscreenApi) {
    await exitFullscreen();
  }
  detectBrowserFullscreen();
  syncApiFullscreenState();
};

const toggleOnlyKanbanMode = async (useFullscreenApi = true) => {
  if (isOnlyKanbanMode.value) {
    await leaveOnlyKanbanMode(useFullscreenApi);
    return;
  }
  await enterOnlyKanbanMode(useFullscreenApi);
};

const handleFullscreenChange = () => {
  syncApiFullscreenState();
  detectBrowserFullscreen();
  if (!isApiFullscreen.value && !isBrowserFullscreen.value) {
    isManualOnlyKanbanMode.value = false;
  }
};

const handleWindowResize = () => {
  detectBrowserFullscreen();
};

const handleWindowKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'F11') return;
  event.preventDefault();
  void toggleOnlyKanbanMode(false);
};

watch(isOnlyKanbanMode, () => {
  syncOnlyKanbanBodyClass();
});

onMounted(async () => {
  window.addEventListener('keydown', handleWindowKeydown);
  window.addEventListener('resize', handleWindowResize);
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  detectBrowserFullscreen();
  syncApiFullscreenState();
  syncOnlyKanbanBodyClass();
  chatSocket.initializeSocket();
  try {
    await chatStore.loadKanbanInitial();
  } finally {
    isInitialLoading.value = false;
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleWindowKeydown);
  window.removeEventListener('resize', handleWindowResize);
  document.removeEventListener('fullscreenchange', handleFullscreenChange);
  document.body.classList.remove(ONLY_KANBAN_MODE_CLASS);
  if (document.fullscreenElement) {
    void exitFullscreen();
  }
});
</script>

<template>
  <div class="kanban-page d-flex flex-column h-100 overflow-hidden">
    <div class="kanban-header px-4 py-3">
      <h1 class="text-h5 font-weight-medium">{{ $t('kanban') }}</h1>
      <VBtn
        icon
        variant="text"
        density="comfortable"
        class="kanban-fullscreen-btn"
        :title="
          isOnlyKanbanMode
            ? 'Sair do modo maximizado'
            : 'Maximizar Kanban'
        "
        @click="toggleOnlyKanbanMode()"
      >
        <VIcon
          :icon="
            isOnlyKanbanMode
              ? 'tabler-arrows-minimize'
              : 'tabler-arrows-maximize'
          "
          size="20"
        />
      </VBtn>
    </div>
    <VDivider />
    <div
      class="kanban-columns-wrapper flex-grow-1 overflow-hidden d-flex gap-3 px-4 py-3"
    >
      <div
        v-for="col in KANBAN_COLUMNS"
        :key="col.key"
        class="kanban-column d-flex flex-column rounded-lg overflow-hidden"
        :class="col.colorClass"
      >
        <div
          class="kanban-column-header px-3 py-2 text-subtitle-2 font-weight-medium"
        >
          {{ $t(col.titleKey) }}
          <VChip size="x-small" variant="flat" class="ms-2">
            {{ getColumnTotal(col) }}
          </VChip>
        </div>
        <PerfectScrollbar
          :ref="
            (el) => {
              if (el)
                columnScrollRefs[col.key] = el as InstanceType<
                  typeof PerfectScrollbar
                >;
            }
          "
          class="kanban-column-scroll flex-grow-1"
          :options="{ wheelPropagation: false }"
          @ps-scroll-y="(e: Event) => handleColumnScroll(col.key, e)"
        >
          <ul class="d-flex flex-column gap-y-1 chat-list px-2 py-2 list-none">
            <template v-if="showInitialSkeleton">
              <li
                v-for="i in INITIAL_SKELETON_ITEMS"
                :key="`skeleton-${col.key}-${i}`"
                class="chat d-flex align-center pa-2 kanban-skeleton-item"
              >
                <VSkeletonLoader type="avatar" width="40" height="40" />
                <div class="flex-grow-1 ms-3 overflow-hidden min-w-0">
                  <VSkeletonLoader
                    type="text"
                    width="70%"
                    height="18"
                    class="mb-1"
                  />
                  <VSkeletonLoader type="text" width="50%" height="14" />
                </div>
              </li>
            </template>
            <template v-else>
              <ChatQueue
                v-for="chat in chatStore[col.listKey]"
                :key="`${col.key}-${chat.chat_id}`"
                :user="chat"
                :show-chatbot-type-indicator="col.key === 'chatbot'"
                @click="openChat(chat.chat_id)"
              />
              <li
                v-if="!chatStore[col.listKey].length && !showInitialSkeleton"
                class="no-chat-items-text text-medium-emphasis text-center py-4"
              >
                {{ $t('no_chats') }}
              </li>
              <template v-if="isLoadingMore(col.key)">
                <li
                  v-for="i in LOAD_MORE_SKELETON_ITEMS"
                  :key="`skeleton-load-more-${col.key}-${i}`"
                  class="chat d-flex align-center pa-2 kanban-skeleton-item"
                >
                  <VSkeletonLoader type="avatar" width="40" height="40" />
                  <div class="flex-grow-1 ms-3 overflow-hidden min-w-0">
                    <VSkeletonLoader
                      type="text"
                      width="70%"
                      height="18"
                      class="mb-1"
                    />
                    <VSkeletonLoader type="text" width="50%" height="14" />
                  </div>
                </li>
              </template>
            </template>
          </ul>
        </PerfectScrollbar>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kanban-page {
  min-height: 0;
  --kanban-surface-border: rgba(15, 23, 42, 0.12);
  --kanban-chip-bg: rgba(255, 255, 255, 0.72);
  --kanban-chip-color: currentcolor;
  --kanban-empty-text: rgba(71, 85, 105, 0.92);
}

.kanban-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.kanban-header h1 {
  margin: 0;
}

.kanban-fullscreen-btn {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

:global(.v-theme--dark .kanban-page) {
  --kanban-surface-border: rgba(148, 163, 184, 0.26);
  --kanban-chip-bg: rgba(2, 6, 23, 0.45);
  --kanban-chip-color: #e2e8f0;
  --kanban-empty-text: rgba(203, 213, 225, 0.9);
}

:global(.v-theme--dark .kanban-page .kanban-fullscreen-btn) {
  color: rgba(var(--v-theme-on-surface), var(--v-high-emphasis-opacity));
}

:global(
    body.kanban-only-mode
      .layout-wrapper.layout-nav-type-vertical
      .vertical-nav-wrapper
  ),
:global(
    body.kanban-only-mode
      .layout-wrapper.layout-nav-type-vertical
      .layout-navbar
  ),
:global(
    body.kanban-only-mode
      .layout-wrapper.layout-nav-type-vertical
      .layout-footer
  ),
:global(
    body.kanban-only-mode
      .layout-wrapper.layout-nav-type-horizontal
      .layout-navbar-and-nav-container
  ),
:global(
    body.kanban-only-mode
      .layout-wrapper.layout-nav-type-horizontal
      .layout-footer
  ) {
  display: none !important;
}

:global(
    body.kanban-only-mode
      .layout-wrapper.layout-nav-type-vertical
      .layout-content-wrapper
  ) {
  padding-inline-start: 0 !important;
  min-block-size: 100dvh !important;
}

:global(body.kanban-only-mode .layout-wrapper .layout-page-content) {
  padding: 0 !important;
  block-size: 100dvh !important;
  max-block-size: 100dvh !important;
  margin: 0 !important;
  max-inline-size: 100% !important;
}

:global(body.kanban-only-mode .layout-wrapper .page-content-container) {
  block-size: 100dvh !important;
  padding-inline: 0 !important;
  max-inline-size: 100% !important;
}

.kanban-columns-wrapper {
  min-height: 0;
  display: grid !important;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-items: stretch;
}
.kanban-column {
  width: 100%;
  min-width: 0;
  max-height: 100%;
  background: var(--kanban-column-bg, rgb(var(--v-theme-surface)));
  border: 1px solid var(--kanban-column-border, var(--kanban-surface-border));
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.08);
}

:global(.v-theme--dark .kanban-page .kanban-column) {
  box-shadow: 0 10px 26px rgba(2, 6, 23, 0.32);
}

@media (max-width: 1279px) {
  .kanban-columns-wrapper {
    grid-template-columns: none;
    grid-auto-flow: column;
    grid-auto-columns: minmax(280px, 1fr);
    overflow-x: auto !important;
    overflow-y: hidden !important;
    padding-bottom: 0.25rem;
  }
}

.kanban-column-scroll {
  min-height: 200px;
}

.kanban-column-header {
  background: var(--kanban-header-bg, rgba(15, 23, 42, 0.05));
  color: var(--kanban-header-color, rgb(var(--v-theme-on-surface)));
  border-bottom: 1px solid
    var(--kanban-column-border, var(--kanban-surface-border));
}

.kanban-column-header :deep(.v-chip) {
  background: var(--kanban-chip-bg) !important;
  color: var(--kanban-chip-color) !important;
  font-weight: 600;
}

.kanban-column-chatbot {
  --kanban-column-bg: #f7fbff;
  --kanban-column-border: #bfd9f8;
  --kanban-header-bg: #e7f2ff;
  --kanban-header-color: #1d4f86;
}

.kanban-column-queue {
  --kanban-column-bg: #fff9f1;
  --kanban-column-border: #f3c892;
  --kanban-header-bg: #fff1de;
  --kanban-header-color: #7a4a0e;
}

.kanban-column-in-chat {
  --kanban-column-bg: #f2fcf8;
  --kanban-column-border: #9fdcc6;
  --kanban-header-bg: #e5f7f1;
  --kanban-header-color: #0f5a46;
}

.kanban-column-closed {
  --kanban-column-bg: #f8fafc;
  --kanban-column-border: #c9d3df;
  --kanban-header-bg: #edf1f5;
  --kanban-header-color: #364152;
}

:global(.v-theme--dark .kanban-page .kanban-column-chatbot) {
  --kanban-column-bg: rgba(14, 25, 41, 0.9);
  --kanban-column-border: rgba(96, 165, 250, 0.34);
  --kanban-header-bg: rgba(59, 130, 246, 0.22);
  --kanban-header-color: #bfdbfe;
}

:global(.v-theme--dark .kanban-page .kanban-column-queue) {
  --kanban-column-bg: rgba(37, 28, 15, 0.88);
  --kanban-column-border: rgba(245, 158, 11, 0.34);
  --kanban-header-bg: rgba(245, 158, 11, 0.24);
  --kanban-header-color: #fcd9a6;
}

:global(.v-theme--dark .kanban-page .kanban-column-in-chat) {
  --kanban-column-bg: rgba(14, 34, 28, 0.9);
  --kanban-column-border: rgba(52, 211, 153, 0.34);
  --kanban-header-bg: rgba(16, 185, 129, 0.23);
  --kanban-header-color: #a7f3d0;
}

:global(.v-theme--dark .kanban-page .kanban-column-closed) {
  --kanban-column-bg: rgba(30, 41, 59, 0.84);
  --kanban-column-border: rgba(148, 163, 184, 0.32);
  --kanban-header-bg: rgba(148, 163, 184, 0.22);
  --kanban-header-color: #cbd5e1;
}

.chat-list .chat {
  cursor: pointer;
}

.kanban-skeleton-item {
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  background: rgba(248, 250, 252, 0.65);
}

:global(.v-theme--dark .kanban-page .kanban-skeleton-item) {
  border-color: rgba(100, 116, 139, 0.35);
  background: rgba(15, 23, 42, 0.45);
}

.no-chat-items-text {
  font-size: 0.875rem;
  color: var(--kanban-empty-text) !important;
}
</style>
