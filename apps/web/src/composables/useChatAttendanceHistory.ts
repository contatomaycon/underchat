import { computed, ref, shallowRef, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useChatStore } from '@/@webcore/stores/chat';
import {
  getPermissions,
  getSectors,
  getUser,
} from '@/@webcore/localStorage/user';
import { EColor } from '@core/common/enums/EColor';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { formatDate } from '@core/common/functions/formatDate';
import type { SearchChatsQuery } from '@core/schema/chat/searchChats/request.schema';
import type { ListChatsResult } from '@core/schema/chat/listChats/response.schema';

type UseChatAttendanceHistoryOptions = {
  activePhone: Ref<string>;
  enabled?: Ref<boolean>;
  excludeChatId?: Ref<string | null | undefined>;
  perPage?: number;
};

const formatTimeWithSeconds = (date: Date): string => {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
};

const formatDateTimeWithSeconds = (date: Date): string => {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year} ${formatTimeWithSeconds(date)}`;
};

export function useChatAttendanceHistory({
  activePhone,
  enabled,
  excludeChatId,
  perPage = 20,
}: UseChatAttendanceHistoryOptions) {
  const chatStore = useChatStore();
  const { t } = useI18n();

  const attendanceHistory = ref<ListChatsResult[]>([]);
  const isLoading = shallowRef(false);
  const isLoadingMore = shallowRef(false);
  const currentPage = shallowRef(1);
  const totalPages = shallowRef(0);
  const hasLoaded = shallowRef(false);

  const isEnabled = computed(() => enabled?.value !== false);

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

  const hasMore = computed(() => currentPage.value < totalPages.value);

  const resetAttendanceHistory = () => {
    attendanceHistory.value = [];
    currentPage.value = 1;
    totalPages.value = 0;
    hasLoaded.value = false;
    isLoading.value = false;
    isLoadingMore.value = false;
  };

  const filterExcludedChat = (chats: ListChatsResult[]) => {
    const ignoredChatId = excludeChatId?.value;
    if (!ignoredChatId) return chats;
    return chats.filter((chat) => chat.chat_id !== ignoredChatId);
  };

  const loadAttendanceHistory = async (reset = true) => {
    if (!activePhone.value || !isEnabled.value) {
      resetAttendanceHistory();
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

      if (!canListAllChats.value && sectors && sectors.length === 1) {
        query.filter_sector_id = sectors[0];
      }

      const response = await chatStore.searchChats(query);
      const results = filterExcludedChat(response?.results ?? []);

      if (reset) {
        attendanceHistory.value = results;
      } else {
        attendanceHistory.value.push(...results);
      }

      currentPage.value = response?.pagings.current_page ?? currentPage.value;
      totalPages.value = response?.pagings.total_pages ?? 0;
      hasLoaded.value = true;
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
      isLoading.value ||
      !hasMore.value ||
      !activePhone.value ||
      !isEnabled.value
    ) {
      return;
    }

    currentPage.value += 1;
    await loadAttendanceHistory(false);
  };

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
      return formatTimeWithSeconds(date);
    }

    if (date.toDateString() === yesterday.toDateString()) {
      return `${t('yesterday')} ${formatTimeWithSeconds(date)}`.trim();
    }

    return formatDateTimeWithSeconds(date);
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

  return {
    attendanceHistory,
    isLoading,
    isLoadingMore,
    currentPage,
    totalPages,
    hasLoaded,
    hasMore,
    loadAttendanceHistory,
    loadMoreResults,
    resetAttendanceHistory,
    formatAttendanceDate,
    formatLastInteractionDate,
    calculateAttendanceTime,
  };
}
