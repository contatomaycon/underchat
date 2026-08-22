export const CHATBOT_NODE_PALETTE_CATEGORY_IDS = [
  'conversation',
  'attendance',
  'rules',
  'integrations',
  'organization',
  'official',
] as const;

export type ChatbotNodePaletteCategoryId =
  (typeof CHATBOT_NODE_PALETTE_CATEGORY_IDS)[number];

export type ChatbotNodePaletteTone =
  | 'primary'
  | 'secondary'
  | 'success'
  | 'info'
  | 'warning'
  | 'error'
  | 'randomMessage'
  | 'distribution'
  | 'tertiary'
  | 'annotation';

export interface ChatbotNodePaletteItem {
  id: string;
  category: ChatbotNodePaletteCategoryId;
  label: string;
  icon: string;
  tone: ChatbotNodePaletteTone;
}

export interface ChatbotNodePaletteCategory {
  id: ChatbotNodePaletteCategoryId;
  label: string;
  icon: string;
}

export interface ChatbotNodePalettePosition {
  x: number;
  y: number;
}

export interface ChatbotNodePalettePreferences {
  version: 1;
  minimized: boolean;
  position: ChatbotNodePalettePosition;
}
