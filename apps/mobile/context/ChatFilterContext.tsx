import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type { AdvancedFilterValues } from '../components/AdvancedFilterModal';
import type { ChatListCounts } from '../types/chat';

export type InChatScope = 'all' | 'mine';
export type ChatbotFilterStatus =
  | 'ura'
  | 'ura_output'
  | 'ura_schedule'
  | 'ura_webhook';

const EMPTY_FILTER_VALUES: AdvancedFilterValues = {
  filter_label_template_id: null,
  filter_worker_id: null,
  filter_user_id: null,
  filter_sector_id: null,
  filter_name: null,
  filter_phone: null,
  filter_protocol: null,
  filter_date_start: null,
  filter_date_end: null,
  sort_field: null,
  sort_order: null,
};

const DEFAULT_IN_CHAT_SCOPE: InChatScope = 'all';
const DEFAULT_CHATBOT_FILTERS: ChatbotFilterStatus[] = ['ura'];

const DEFAULT_CHAT_COUNTS: ChatListCounts = {
  total: 0,
  queue: 0,
  in_chat: 0,
  chatbot: 0,
  schedule: 0,
  my_chats: 0,
  closed: 0,
  in_chat_mine: 0,
  chatbot_input: 0,
  chatbot_output: 0,
  chatbot_schedule: 0,
  chatbot_webhook: 0,
};

interface ChatFilterContextValue {
  hasAppliedAdvancedFilters: boolean;
  setHasAppliedAdvancedFilters: (value: boolean) => void;
  advancedFilterValues: AdvancedFilterValues;
  setAdvancedFilterValues: (values: AdvancedFilterValues) => void;
  clearAdvancedFilters: () => void;
  inChatScope: InChatScope;
  setInChatScope: (scope: InChatScope) => void;
  chatbotFilters: ChatbotFilterStatus[];
  setChatbotFilters: (filters: ChatbotFilterStatus[]) => void;
  toggleChatbotFilter: (filter: ChatbotFilterStatus) => void;
  clearAllChatListFilters: () => void;
  canViewChatbotTab: boolean;
  chatCounts: ChatListCounts;
  setChatCounts: (counts: Partial<ChatListCounts>) => void;
  resetChatCounts: () => void;
}

const ChatFilterContext = createContext<ChatFilterContextValue | null>(null);

export function ChatFilterProvider({
  children,
  canViewChatbotTab,
}: {
  children: ReactNode;
  canViewChatbotTab: boolean;
}) {
  const [hasAppliedAdvancedFilters, setHasAppliedAdvancedFilters] =
    useState(false);
  const [advancedFilterValues, setAdvancedFilterValues] =
    useState<AdvancedFilterValues>(EMPTY_FILTER_VALUES);
  const [inChatScope, setInChatScope] = useState<InChatScope>(
    DEFAULT_IN_CHAT_SCOPE
  );
  const [chatbotFilters, setChatbotFilters] = useState<ChatbotFilterStatus[]>(
    DEFAULT_CHATBOT_FILTERS
  );
  const [chatCounts, setChatCountsState] =
    useState<ChatListCounts>(DEFAULT_CHAT_COUNTS);

  const setFilters = useCallback((value: boolean) => {
    setHasAppliedAdvancedFilters(value);
  }, []);

  const clearAdvancedFilters = useCallback(() => {
    setAdvancedFilterValues(EMPTY_FILTER_VALUES);
    setHasAppliedAdvancedFilters(false);
  }, []);

  const toggleChatbotFilter = useCallback((filter: ChatbotFilterStatus) => {
    setChatbotFilters((current) => {
      if (current.includes(filter)) {
        if (current.length === 1) return current;
        return current.filter((item) => item !== filter);
      }

      return [...current, filter];
    });
  }, []);

  const clearAllChatListFilters = useCallback(() => {
    setAdvancedFilterValues(EMPTY_FILTER_VALUES);
    setHasAppliedAdvancedFilters(false);
    setInChatScope(DEFAULT_IN_CHAT_SCOPE);
    setChatbotFilters(DEFAULT_CHATBOT_FILTERS);
  }, []);

  const setChatCounts = useCallback((counts: Partial<ChatListCounts>) => {
    setChatCountsState((current) => ({
      ...current,
      ...counts,
    }));
  }, []);

  const resetChatCounts = useCallback(() => {
    setChatCountsState(DEFAULT_CHAT_COUNTS);
  }, []);

  const value: ChatFilterContextValue = {
    hasAppliedAdvancedFilters,
    setHasAppliedAdvancedFilters: setFilters,
    advancedFilterValues,
    setAdvancedFilterValues,
    clearAdvancedFilters,
    inChatScope,
    setInChatScope,
    chatbotFilters,
    setChatbotFilters,
    toggleChatbotFilter,
    clearAllChatListFilters,
    canViewChatbotTab,
    chatCounts,
    setChatCounts,
    resetChatCounts,
  };

  return (
    <ChatFilterContext.Provider value={value}>
      {children}
    </ChatFilterContext.Provider>
  );
}

export function useChatFilter(): ChatFilterContextValue {
  const ctx = useContext(ChatFilterContext);
  if (!ctx) {
    throw new Error('useChatFilter must be used within ChatFilterProvider');
  }
  return ctx;
}
