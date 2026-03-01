import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type { AdvancedFilterValues } from '../components/AdvancedFilterModal';

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
