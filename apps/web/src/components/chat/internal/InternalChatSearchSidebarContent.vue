<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { refDebounced } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import { useInternalChatStore } from '@/@webcore/stores/internalChat';
import { formatDateLong } from '@/@webcore/utils/formatters';
import type { SearchInternalChatMessagesResult } from '@core/schema/internalChat/searchMessages/response.schema';

const props = defineProps<{
  conversationId: string;
  conversationName: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'selectMessage', messageId: string): void;
}>();

type HighlightSegment = {
  text: string;
  highlighted: boolean;
};

const internalChatStore = useInternalChatStore();
const { t } = useI18n();

const searchQuery = ref('');
const searchResults = ref<SearchInternalChatMessagesResult[]>([]);
const isLoading = ref(false);
const isLoadingMore = ref(false);
const currentPage = ref(1);
const totalPages = ref(0);
const perPage = 50;
const debouncedSearch = refDebounced(searchQuery, 500);
const searchResultsContainer = ref<HTMLElement | null>(null);

const searchMessageText = computed(() =>
  t('search_messages_with', { name: props.conversationName })
);

const canSearch = computed(() => debouncedSearch.value.trim().length >= 3);

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

  return formatDateLong(dateString, t);
};

const buildHighlightedSegments = (
  text: string | null | undefined,
  search: string
): HighlightSegment[] => {
  const source = text ?? '';
  const normalizedSearch = search.trim();

  if (!source || !normalizedSearch) {
    return [{ text: source, highlighted: false }];
  }

  const segments: HighlightSegment[] = [];
  const lowerSource = source.toLocaleLowerCase();
  const lowerSearch = normalizedSearch.toLocaleLowerCase();
  let cursor = 0;

  while (cursor < source.length) {
    const matchIndex = lowerSource.indexOf(lowerSearch, cursor);

    if (matchIndex === -1) {
      segments.push({
        text: source.slice(cursor),
        highlighted: false,
      });
      break;
    }

    if (matchIndex > cursor) {
      segments.push({
        text: source.slice(cursor, matchIndex),
        highlighted: false,
      });
    }

    segments.push({
      text: source.slice(matchIndex, matchIndex + normalizedSearch.length),
      highlighted: true,
    });
    cursor = matchIndex + normalizedSearch.length;
  }

  return segments.length > 0
    ? segments
    : [{ text: source, highlighted: false }];
};

const resetSearchResults = () => {
  searchResults.value = [];
  currentPage.value = 1;
  totalPages.value = 0;
};

const handleSearch = async (reset = true) => {
  if (!canSearch.value || !props.conversationId) {
    resetSearchResults();
    return;
  }

  if (reset) {
    currentPage.value = 1;
    isLoading.value = true;
  } else {
    isLoadingMore.value = true;
  }

  try {
    const response = await internalChatStore.searchMessages(
      props.conversationId,
      debouncedSearch.value.trim(),
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
  } finally {
    isLoading.value = false;
    isLoadingMore.value = false;
  }
};

const loadMoreResults = async () => {
  if (
    isLoadingMore.value ||
    isLoading.value ||
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
    void loadMoreResults();
  }
};

const handleMessageClick = (messageId: string) => {
  emit('selectMessage', messageId);
  emit('close');
};

watch(debouncedSearch, () => {
  if (canSearch.value) {
    void handleSearch(true);
    return;
  }

  resetSearchResults();
});

watch(
  () => props.conversationId,
  () => {
    searchQuery.value = '';
    resetSearchResults();
  }
);

watch(searchResultsContainer, (container, previousContainer) => {
  previousContainer?.removeEventListener('scroll', handleScroll);
  container?.addEventListener('scroll', handleScroll, { passive: true });
});

onBeforeUnmount(() => {
  searchResultsContainer.value?.removeEventListener('scroll', handleScroll);
});
</script>

<template>
  <div class="internal-chat-search-sidebar-content">
    <div class="internal-chat-search-header">
      <IconBtn class="internal-chat-search-close" @click="$emit('close')">
        <VIcon icon="tabler-x" />
      </IconBtn>
      <h6 class="text-h6">{{ $t('search_messages') }}</h6>
    </div>

    <div class="internal-chat-search-body">
      <div class="internal-chat-search-input-block">
        <AppTextField
          v-model="searchQuery"
          :placeholder="$t('search_messages_placeholder')"
          prepend-inner-icon="tabler-search"
          class="mb-4"
          hide-details
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

      <div class="internal-chat-search-results-shell">
        <div v-if="isLoading" class="internal-chat-search-loading">
          <VProgressCircular indeterminate color="primary" />
        </div>

        <div
          v-else-if="canSearch && searchResults.length > 0"
          ref="searchResultsContainer"
          class="internal-chat-search-results"
        >
          <button
            v-for="result in searchResults"
            :key="result.message_id"
            type="button"
            class="internal-chat-search-result"
            @click="handleMessageClick(result.message_id)"
          >
            <span class="internal-chat-search-date text-caption">
              {{ formatMessageDate(result.date) }}
            </span>
            <span class="internal-chat-search-message text-body-2">
              <span
                v-for="(segment, index) in buildHighlightedSegments(
                  result.message,
                  debouncedSearch
                )"
                :key="`${result.message_id}-${index}`"
                :class="{
                  'internal-chat-search-highlight': segment.highlighted,
                }"
              >
                {{ segment.text }}
              </span>
            </span>
          </button>

          <div v-if="isLoadingMore" class="internal-chat-search-footer">
            <VProgressCircular indeterminate color="primary" size="24" />
          </div>

          <div
            v-else-if="currentPage >= totalPages && searchResults.length > 0"
            class="internal-chat-search-footer"
          >
            <p class="text-caption text-medium-emphasis mb-0">
              {{ $t('no_more_results') }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.internal-chat-search-sidebar-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.internal-chat-search-header {
  display: flex;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.internal-chat-search-close {
  margin-inline-end: 8px;
}

.internal-chat-search-body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  flex-direction: column;
  padding: 16px;
}

.internal-chat-search-input-block {
  flex: 0 0 auto;
}

.internal-chat-search-results-shell {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.internal-chat-search-loading {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
}

.internal-chat-search-results {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}

.internal-chat-search-result {
  display: flex;
  width: 100%;
  flex-direction: column;
  padding: 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: start;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
}

.internal-chat-search-result:hover,
.internal-chat-search-result:focus-visible {
  border-color: rgba(var(--v-theme-primary), 0.2);
  background-color: rgba(var(--v-theme-primary), 0.08);
  outline: none;
}

.internal-chat-search-date {
  margin-block-end: 4px;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  font-weight: 500;
}

.internal-chat-search-message {
  color: rgba(var(--v-theme-on-surface), var(--v-high-emphasis-opacity));
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.internal-chat-search-highlight {
  border-radius: 4px;
  padding: 2px 4px;
  background-color: rgba(var(--v-theme-primary), 0.2);
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}

.internal-chat-search-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
</style>
