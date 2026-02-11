import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type { AdvancedFilterValues } from '../components/AdvancedFilterModal';

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

interface ChatFilterContextValue {
  hasAppliedAdvancedFilters: boolean;
  setHasAppliedAdvancedFilters: (value: boolean) => void;
  advancedFilterValues: AdvancedFilterValues;
  setAdvancedFilterValues: (values: AdvancedFilterValues) => void;
  clearAdvancedFilters: () => void;
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

  const setFilters = useCallback((value: boolean) => {
    setHasAppliedAdvancedFilters(value);
  }, []);

  const clearAdvancedFilters = useCallback(() => {
    setAdvancedFilterValues(EMPTY_FILTER_VALUES);
    setHasAppliedAdvancedFilters(false);
  }, []);

  const value: ChatFilterContextValue = {
    hasAppliedAdvancedFilters,
    setHasAppliedAdvancedFilters: setFilters,
    advancedFilterValues,
    setAdvancedFilterValues,
    clearAdvancedFilters,
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
