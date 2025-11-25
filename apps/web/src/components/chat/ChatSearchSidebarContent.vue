<script lang="ts" setup>
import { useChatStore } from '@/@webcore/stores/chat';
import { computed, watch, onUnmounted } from 'vue';
import { SearchMessagesResult } from '@core/schema/chat/searchMessages/response.schema';
import { formatDate } from '@/@webcore/utils/formatters';
import { EColor } from '@core/common/enums/EColor';

const emit = defineEmits<{
  close: [];
}>();

const chatStore = useChatStore();
const { t } = useI18n();

const searchQuery = ref('');
const searchResults = ref<SearchMessagesResult[]>([]);
const isLoading = ref(false);
const isLoadingMore = ref(false);
const currentPage = ref(1);
const totalPages = ref(0);
const perPage = 50;
const debouncedSearch = refDebounced(searchQuery, 500);
const searchResultsContainer = ref<HTMLElement | null>(null);

const contactName = computed(() => {
  return (
    chatStore.activeChat?.contact?.name ?? chatStore.activeChat?.name ?? ''
  );
});

const searchMessageText = computed(() => {
  return t('search_messages_with', { name: contactName.value });
});

const canSearch = computed(() => {
  return debouncedSearch.value.length >= 3;
});

const highlightText = (
  text: string | null | undefined,
  search: string
): string => {
  if (!text || !search) return text || '';

  const escapedSearch = search.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedSearch})`, 'gi');
  return text.replace(regex, '<mark class="search-highlight">$1</mark>');
};

const formatMessageDate = (dateString: string): string => {
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

const handleSearch = async (reset: boolean = true) => {
  if (!canSearch.value || !chatStore.activeChat?.chat_id) {
    searchResults.value = [];
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
    const response = await chatStore.searchMessages(
      chatStore.activeChat.chat_id,
      debouncedSearch.value,
      currentPage.value,
      perPage
    );

    if (reset) {
      searchResults.value = response.results;
    } else {
      searchResults.value.push(...response.results);
    }

    currentPage.value = response.pagings.current_page;
    totalPages.value = response.pagings.total_pages;
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : t('search_messages_error') || 'Erro ao buscar mensagens';
    chatStore.showSnackbar(errorMessage, EColor.error);
    if (reset) {
      searchResults.value = [];
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
    !canSearch.value
  ) {
    return;
  }

  currentPage.value += 1;
  await handleSearch(false);
};

const handleScroll = () => {
  const container = searchResultsContainer.value;
  if (!container) return;

  const threshold = 100;
  const { scrollTop, scrollHeight, clientHeight } = container;

  if (scrollTop + clientHeight >= scrollHeight - threshold) {
    loadMoreResults();
  }
};

const handleMessageClick = (messageId: string) => {
  (globalThis as Window & typeof globalThis).dispatchEvent(
    new CustomEvent('scroll-to-message', { detail: messageId })
  );
  emit('close');
};

watch(debouncedSearch, () => {
  if (canSearch.value) {
    handleSearch(true);
  } else {
    searchResults.value = [];
    currentPage.value = 1;
    totalPages.value = 0;
  }
});

watch(
  () => chatStore.activeChat?.chat_id,
  () => {
    searchQuery.value = '';
    searchResults.value = [];
    currentPage.value = 1;
    totalPages.value = 0;
  }
);

watch(
  () => searchResultsContainer.value,
  (container) => {
    if (!container) return;
    container.addEventListener('scroll', handleScroll, { passive: true });
  },
  { immediate: true }
);

onUnmounted(() => {
  searchResultsContainer.value?.removeEventListener('scroll', handleScroll);
});
</script>

<template>
  <div class="chat-search-sidebar-content">
    <div class="d-flex align-center pa-4 border-b">
      <IconBtn class="me-2" @click="$emit('close')">
        <VIcon icon="tabler-x" />
      </IconBtn>
      <h6 class="text-h6">{{ $t('search_messages') }}</h6>
    </div>

    <div class="pa-4 d-flex flex-column" style="height: calc(100% - 64px)">
      <div>
        <AppTextField
          v-model="searchQuery"
          :placeholder="$t('search_messages_placeholder')"
          prepend-inner-icon="tabler-search"
          class="mb-4"
        />

        <p
          v-if="!searchQuery || searchQuery.length === 0"
          class="text-body-2 text-medium-emphasis mb-6"
        >
          {{ searchMessageText }}
        </p>

        <p
          v-else-if="searchQuery.length > 0 && searchQuery.length < 3"
          class="text-body-2 text-medium-emphasis mb-6"
        >
          {{ $t('search_minimum_characters', { count: 3 }) }}
        </p>

        <p
          v-else-if="canSearch && searchResults.length === 0 && !isLoading"
          class="text-body-2 text-medium-emphasis mb-6"
        >
          {{ $t('no_results_found') }}
        </p>
      </div>

      <div
        class="flex-grow-1 d-flex flex-column"
        style="min-height: 0; overflow: hidden"
      >
        <div
          v-if="isLoading"
          class="d-flex justify-center align-center flex-grow-1"
        >
          <VProgressCircular indeterminate color="primary" />
        </div>

        <div
          v-else-if="canSearch && searchResults.length > 0"
          ref="searchResultsContainer"
          class="search-results-container flex-grow-1"
          style="overflow-y: auto"
        >
          <div class="search-results-list">
            <div
              v-for="result in searchResults"
              :key="result.message_id"
              class="search-result-item"
              @click="handleMessageClick(result.message_id)"
            >
              <div
                class="search-result-date text-caption text-medium-emphasis mb-1"
              >
                {{ formatMessageDate(result.date) }}
              </div>
              <div
                class="search-result-message text-body-2"
                v-html="highlightText(result.message, debouncedSearch)"
              ></div>
            </div>
          </div>
          <div
            v-if="isLoadingMore"
            class="d-flex justify-center align-center pa-4"
          >
            <VProgressCircular indeterminate color="primary" size="24" />
          </div>
          <div
            v-else-if="currentPage >= totalPages && searchResults.length > 0"
            class="d-flex justify-center align-center pa-4"
          >
            <p class="text-caption text-medium-emphasis">
              {{ $t('no_more_results') }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-search-sidebar-content {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.border-b {
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.search-results-container {
  max-height: calc(100vh - 200px);
  overflow-y: auto;
}

.search-results-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.search-result-item {
  padding: 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.2s ease;
  border: 1px solid transparent;
}

.search-result-item:hover {
  background-color: rgba(var(--v-theme-primary), 0.08);
  border-color: rgba(var(--v-theme-primary), 0.2);
}

.search-result-date {
  font-weight: 500;
}

.search-result-message {
  line-height: 1.5;
  word-break: break-word;
}

.search-highlight {
  background-color: rgba(var(--v-theme-primary), 0.2);
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
  padding: 2px 4px;
  border-radius: 4px;
}
</style>
