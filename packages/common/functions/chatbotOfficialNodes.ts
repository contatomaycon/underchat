export const OFFICIAL_CHATBOT_NODE_TYPES = [
  'officialReplyButtons',
  'officialList',
  'officialCtaUrl',
  'officialLocationRequest',
  'officialFlow',
  'officialSingleProduct',
  'officialMultiProduct',
  'officialCatalog',
  'officialMediaCarousel',
  'officialAddress',
  'officialTemplate',
  'officialLocation',
  'officialContacts',
  'officialSticker',
  'officialReaction',
] as const;

export type OfficialChatbotNodeType =
  (typeof OFFICIAL_CHATBOT_NODE_TYPES)[number];

const OFFICIAL_CHATBOT_NODE_TYPE_SET = new Set<string>(
  OFFICIAL_CHATBOT_NODE_TYPES
);

export interface ChatbotFlowNodeLike {
  type?: string | null;
}

export interface ChatbotFlowLike {
  nodes?: ChatbotFlowNodeLike[] | null;
}

export const isOfficialChatbotNodeType = (
  nodeType?: string | null
): nodeType is OfficialChatbotNodeType => {
  return !!nodeType && OFFICIAL_CHATBOT_NODE_TYPE_SET.has(nodeType);
};

export const hasOfficialChatbotNodes = (
  flow?: ChatbotFlowLike | null
): boolean => {
  return (
    Array.isArray(flow?.nodes) &&
    flow.nodes.some((node) => isOfficialChatbotNodeType(node.type))
  );
};

export const getOfficialChatbotNodes = <TNode extends ChatbotFlowNodeLike>(
  nodes?: TNode[] | null
): TNode[] => {
  if (!Array.isArray(nodes)) {
    return [];
  }

  return nodes.filter((node) => isOfficialChatbotNodeType(node.type));
};
