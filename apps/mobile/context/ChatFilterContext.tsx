import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';

interface ChatFilterContextValue {
  hasAppliedAdvancedFilters: boolean;
  setHasAppliedAdvancedFilters: (value: boolean) => void;
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

  const setFilters = useCallback((value: boolean) => {
    setHasAppliedAdvancedFilters(value);
  }, []);

  const value: ChatFilterContextValue = {
    hasAppliedAdvancedFilters,
    setHasAppliedAdvancedFilters: setFilters,
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
