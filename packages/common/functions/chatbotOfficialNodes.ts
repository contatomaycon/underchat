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
  id?: string | null;
  type?: string | null;
}

export interface ChatbotFlowEdgeLike {
  source?: string | null;
  target?: string | null;
}

export interface ChatbotFlowLike {
  nodes?: ChatbotFlowNodeLike[] | null;
  edges?: ChatbotFlowEdgeLike[] | null;
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

export const getFirstNodeAfterStart = <TNode extends ChatbotFlowNodeLike>(
  flow?: ChatbotFlowLike | null
): TNode | null => {
  if (!Array.isArray(flow?.nodes) || !Array.isArray(flow?.edges)) {
    return null;
  }

  const startNode = flow.nodes.find((node) => node.type === 'start');
  const startNodeId = startNode?.id;
  if (!startNodeId) {
    return null;
  }

  const firstEdge = flow.edges.find((edge) => edge.source === startNodeId);
  const firstNodeId = firstEdge?.target;
  if (!firstNodeId) {
    return null;
  }

  return (flow.nodes.find((node) => node.id === firstNodeId) as TNode) ?? null;
};

export const doesChatbotFlowStartWithOfficialTemplate = (
  flow?: ChatbotFlowLike | null
): boolean => getFirstNodeAfterStart(flow)?.type === 'officialTemplate';
