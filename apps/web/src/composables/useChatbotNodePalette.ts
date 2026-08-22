import { useStorage } from '@vueuse/core';
import { computed, readonly } from 'vue';
import type {
  ChatbotNodePalettePosition,
  ChatbotNodePalettePreferences,
} from '@/types/chatbotNodePalette';

export const CHATBOT_NODE_PALETTE_PREFERENCES_VERSION = 1 as const;
export const DEFAULT_CHATBOT_NODE_PALETTE_POSITION = Object.freeze({
  x: 24,
  y: 24,
});
export const DEFAULT_CHATBOT_NODE_PALETTE_MARGIN = 12;

export interface ChatbotNodePaletteBounds {
  containerWidth: number;
  containerHeight: number;
  panelWidth: number;
  panelHeight: number;
  margin?: number;
}

export interface UseChatbotNodePaletteOptions {
  storageKey: string;
  defaultPosition?: ChatbotNodePalettePosition;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isValidPosition = (value: unknown): value is ChatbotNodePalettePosition =>
  isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);

const clonePosition = (
  position: Readonly<ChatbotNodePalettePosition>
): ChatbotNodePalettePosition => ({
  x: position.x,
  y: position.y,
});

const toNonNegativeFiniteNumber = (value: unknown): number =>
  isFiniteNumber(value) ? Math.max(0, value) : 0;

const createPreferences = (
  defaultPosition: Readonly<ChatbotNodePalettePosition>
): ChatbotNodePalettePreferences => ({
  version: CHATBOT_NODE_PALETTE_PREFERENCES_VERSION,
  minimized: false,
  position: clonePosition(defaultPosition),
});

/**
 * Creates a safe position from unknown input without leaking the fallback
 * object to callers.
 */
export function normalizeChatbotNodePalettePosition(
  value: unknown,
  fallback: Readonly<ChatbotNodePalettePosition> = DEFAULT_CHATBOT_NODE_PALETTE_POSITION
): ChatbotNodePalettePosition {
  const safeFallback = isValidPosition(fallback)
    ? fallback
    : DEFAULT_CHATBOT_NODE_PALETTE_POSITION;

  return isValidPosition(value)
    ? clonePosition(value)
    : clonePosition(safeFallback);
}

/**
 * Validates a persisted preference payload. Unknown or version-mismatched
 * values intentionally return null so callers can use their current defaults.
 */
export function normalizeChatbotNodePalettePreferences(
  value: unknown
): ChatbotNodePalettePreferences | null {
  if (
    !isRecord(value) ||
    value.version !== CHATBOT_NODE_PALETTE_PREFERENCES_VERSION ||
    typeof value.minimized !== 'boolean' ||
    !isValidPosition(value.position)
  ) {
    return null;
  }

  return {
    version: CHATBOT_NODE_PALETTE_PREFERENCES_VERSION,
    minimized: value.minimized,
    position: clonePosition(value.position),
  };
}

/**
 * Keeps the palette within its host canvas while preserving the requested
 * position when the available space allows it.
 */
export function clampChatbotNodePalettePosition(
  position: ChatbotNodePalettePosition,
  bounds: ChatbotNodePaletteBounds
): ChatbotNodePalettePosition {
  const safePosition = normalizeChatbotNodePalettePosition(position);
  const containerWidth = toNonNegativeFiniteNumber(bounds.containerWidth);
  const containerHeight = toNonNegativeFiniteNumber(bounds.containerHeight);
  const panelWidth = toNonNegativeFiniteNumber(bounds.panelWidth);
  const panelHeight = toNonNegativeFiniteNumber(bounds.panelHeight);
  const margin = isFiniteNumber(bounds.margin)
    ? Math.max(0, bounds.margin)
    : DEFAULT_CHATBOT_NODE_PALETTE_MARGIN;

  const maxX = Math.max(0, containerWidth - panelWidth - margin);
  const maxY = Math.max(0, containerHeight - panelHeight - margin);
  const minX = Math.min(margin, maxX);
  const minY = Math.min(margin, maxY);

  return {
    x: Math.min(Math.max(safePosition.x, minX), maxX),
    y: Math.min(Math.max(safePosition.y, minY), maxY),
  };
}

export function useChatbotNodePalette({
  storageKey,
  defaultPosition = DEFAULT_CHATBOT_NODE_PALETTE_POSITION,
}: UseChatbotNodePaletteOptions) {
  const normalizedDefaultPosition =
    normalizeChatbotNodePalettePosition(defaultPosition);
  const defaultPreferences = createPreferences(normalizedDefaultPosition);

  const preferences = useStorage<ChatbotNodePalettePreferences>(
    storageKey,
    defaultPreferences,
    undefined,
    {
      deep: false,
      serializer: {
        read: (raw) => {
          try {
            return (
              normalizeChatbotNodePalettePreferences(JSON.parse(raw)) ??
              createPreferences(normalizedDefaultPosition)
            );
          } catch {
            return createPreferences(normalizedDefaultPosition);
          }
        },
        write: (value) => {
          const normalized = normalizeChatbotNodePalettePreferences(value);

          return JSON.stringify(
            normalized ?? createPreferences(normalizedDefaultPosition)
          );
        },
      },
    }
  );

  const position = computed<Readonly<ChatbotNodePalettePosition>>(() =>
    clonePosition(preferences.value.position)
  );
  const isMinimized = computed(() => preferences.value.minimized);

  const updatePreferences = (
    nextPosition: ChatbotNodePalettePosition,
    minimized: boolean
  ): void => {
    preferences.value = {
      version: CHATBOT_NODE_PALETTE_PREFERENCES_VERSION,
      minimized,
      position: clonePosition(nextPosition),
    };
  };

  const minimize = (): void => {
    if (!preferences.value.minimized) {
      updatePreferences(preferences.value.position, true);
    }
  };

  const restore = (): void => {
    if (preferences.value.minimized) {
      updatePreferences(preferences.value.position, false);
    }
  };

  const toggle = (): void => {
    updatePreferences(preferences.value.position, !preferences.value.minimized);
  };

  const setPosition = (
    nextPosition: ChatbotNodePalettePosition,
    bounds?: ChatbotNodePaletteBounds
  ): void => {
    const normalizedPosition = normalizeChatbotNodePalettePosition(
      nextPosition,
      preferences.value.position
    );
    const boundedPosition = bounds
      ? clampChatbotNodePalettePosition(normalizedPosition, bounds)
      : normalizedPosition;

    updatePreferences(boundedPosition, preferences.value.minimized);
  };

  const resetPosition = (bounds?: ChatbotNodePaletteBounds): void => {
    setPosition(normalizedDefaultPosition, bounds);
  };

  return {
    preferences: readonly(preferences),
    position,
    isMinimized,
    minimize,
    restore,
    toggle,
    setPosition,
    resetPosition,
  };
}
