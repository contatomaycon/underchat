import type {
  ChatbotFlowData,
  ChatbotFlowNode,
} from '@core/schema/chatbot/chatbotFlow.schema';

export const CHATBOT_CAPTURE_NODE_TYPES = [
  'data',
  'message',
  'underchat',
] as const;
export type ChatbotCaptureNodeType =
  (typeof CHATBOT_CAPTURE_NODE_TYPES)[number];

export type ChatbotNodeOutputField = {
  path: string;
  type:
    | 'string'
    | 'number'
    | 'boolean'
    | 'object'
    | 'array'
    | 'null'
    | 'binary'
    | 'unknown';
  nullable?: boolean;
  projectedFromArray?: boolean;
};

export type ChatbotNodeOutputDefinition = {
  nodeType: ChatbotCaptureNodeType;
  outputKey: string;
  sourceHandle?: string;
  fields: ChatbotNodeOutputField[];
};

type CaptureNodeLike = {
  type?: string | null;
  data?: Record<string, unknown> | null;
};

const DATA_TYPES = new Set(['name', 'lastname', 'email', 'cpf', 'cnpj']);
const UNDERCHAT_LOOKUP_TYPES = new Set(['email', 'document']);

const UNDERCHAT_OUTPUT_FIELDS: ChatbotNodeOutputField[] = [
  { path: 'user.email', type: 'string', nullable: true },
  { path: 'user.name', type: 'string', nullable: true },
  { path: 'user.status', type: 'string', nullable: true },
  { path: 'user.document', type: 'string', nullable: true },
  { path: 'user.phone', type: 'string', nullable: true },
  { path: 'user.access_group', type: 'string', nullable: true },
  { path: 'user.sectors', type: 'array' },
  { path: 'user.channels', type: 'array' },
  { path: 'account.id', type: 'string', nullable: true },
  { path: 'account.name', type: 'string', nullable: true },
  { path: 'account.status', type: 'string', nullable: true },
  { path: 'account.plan', type: 'string', nullable: true },
  { path: 'account.billing_period', type: 'string', nullable: true },
  { path: 'account.last_payment_at', type: 'string', nullable: true },
  { path: 'account.next_renewal_at', type: 'string', nullable: true },
  { path: 'account.last_paid_amount', type: 'string', nullable: true },
];

const outputKeyPattern = (type: ChatbotCaptureNodeType): RegExp =>
  new RegExp(`^${type}_[1-9]\\d*$`, 'u');

export const isChatbotCaptureNodeType = (
  value: unknown
): value is ChatbotCaptureNodeType =>
  typeof value === 'string' &&
  CHATBOT_CAPTURE_NODE_TYPES.includes(value as ChatbotCaptureNodeType);

export const isChatbotNodeOutputKey = (
  type: ChatbotCaptureNodeType,
  value: unknown
): value is string =>
  typeof value === 'string' && outputKeyPattern(type).test(value.trim());

export const getChatbotNodeOutputType = (
  value: unknown
): ChatbotCaptureNodeType | null =>
  CHATBOT_CAPTURE_NODE_TYPES.find((type) =>
    isChatbotNodeOutputKey(type, value)
  ) ?? null;

export const normalizeChatbotNodeOutputKey = (
  type: ChatbotCaptureNodeType,
  value: unknown,
  fallback = `${type}_1`
): string => {
  if (isChatbotNodeOutputKey(type, value)) return value.trim();
  return isChatbotNodeOutputKey(type, fallback) ? fallback.trim() : `${type}_1`;
};

export const getNextChatbotNodeOutputKey = (
  type: ChatbotCaptureNodeType,
  existingKeys: readonly string[]
): string => {
  const usedIndexes = new Set(
    existingKeys.flatMap((key) => {
      const match = outputKeyPattern(type).exec(key.trim());
      return match ? [Number(match[0].slice(type.length + 1))] : [];
    })
  );
  let candidate = 1;
  while (usedIndexes.has(candidate)) candidate += 1;
  return `${type}_${candidate}`;
};

export const formatChatbotNodeOutputTag = (
  outputKey: string,
  path: string
): string => `{{ ${outputKey}.${path} }}`;

/** Returns only outputs that are available at runtime for this configuration. */
export const getChatbotNodeOutputDefinition = (
  node: CaptureNodeLike
): ChatbotNodeOutputDefinition | null => {
  if (!isChatbotCaptureNodeType(node.type)) return null;
  const data = node.data ?? {};
  if (!isChatbotNodeOutputKey(node.type, data.outputKey)) return null;

  if (node.type === 'underchat') {
    const lookup = data.underchatLookup;
    if (!lookup || typeof lookup !== 'object' || Array.isArray(lookup)) {
      return null;
    }
    const lookupRecord = lookup as Record<string, unknown>;
    if (
      lookupRecord.version !== 1 ||
      typeof lookupRecord.lookupType !== 'string' ||
      !UNDERCHAT_LOOKUP_TYPES.has(lookupRecord.lookupType) ||
      typeof lookupRecord.lookupExpression !== 'string' ||
      lookupRecord.lookupExpression.trim().length === 0
    ) {
      return null;
    }
    return {
      nodeType: 'underchat',
      outputKey: data.outputKey.trim(),
      sourceHandle: 'found',
      fields: UNDERCHAT_OUTPUT_FIELDS,
    };
  }

  if (node.type === 'data') {
    const dataType = data.dataType;
    if (typeof dataType !== 'string' || !DATA_TYPES.has(dataType)) return null;
    return {
      nodeType: 'data',
      outputKey: data.outputKey.trim(),
      fields: [
        { path: 'value', type: 'string' },
        { path: dataType, type: 'string' },
      ],
    };
  }

  if (data.continueType !== 'after_response') return null;
  return {
    nodeType: 'message',
    outputKey: data.outputKey.trim(),
    fields: [
      { path: 'text', type: 'string' },
      { path: 'type', type: 'string' },
      { path: 'media', type: 'object', nullable: true },
      { path: 'media.url', type: 'string', nullable: true },
      { path: 'media.name', type: 'string', nullable: true },
      { path: 'media.mimetype', type: 'string', nullable: true },
      { path: 'media.extension', type: 'string', nullable: true },
      { path: 'media.size', type: 'number', nullable: true },
      { path: 'media.duration', type: 'number', nullable: true },
      { path: 'media.width', type: 'number', nullable: true },
      { path: 'media.height', type: 'number', nullable: true },
    ],
  };
};

const isCaptureNode = (
  node: ChatbotFlowNode
): node is ChatbotFlowNode & { type: ChatbotCaptureNodeType } =>
  isChatbotCaptureNodeType(node.type);

/** Assigns durable, server-owned output keys to nodes that capture user input. */
export const assignStableChatbotNodeOutputKeys = (
  flow: ChatbotFlowData,
  previousFlow?: Pick<ChatbotFlowData, 'nodes'> | null
): ChatbotFlowData => {
  const next = structuredClone(flow);
  const previousKeys = new Map<string, string>();
  const reservedByType: Record<ChatbotCaptureNodeType, Set<string>> = {
    data: new Set<string>(),
    message: new Set<string>(),
    underchat: new Set<string>(),
  };

  for (const node of previousFlow?.nodes ?? []) {
    if (!isCaptureNode(node)) continue;
    const key = node.data.outputKey;
    if (!isChatbotNodeOutputKey(node.type, key)) continue;
    previousKeys.set(node.id, key);
    reservedByType[node.type].add(key);
  }

  const assignedNodeIds = new Set<string>();
  const usedByType: Record<ChatbotCaptureNodeType, Set<string>> = {
    data: new Set<string>(),
    message: new Set<string>(),
    underchat: new Set<string>(),
  };

  for (const node of next.nodes) {
    if (!isCaptureNode(node)) {
      delete node.data.outputKey;
      continue;
    }
    const stable = previousKeys.get(node.id);
    if (
      isChatbotNodeOutputKey(node.type, stable) &&
      !usedByType[node.type].has(stable)
    ) {
      node.data.outputKey = stable;
      usedByType[node.type].add(stable);
      assignedNodeIds.add(node.id);
    }
  }

  for (const node of next.nodes) {
    if (!isCaptureNode(node) || assignedNodeIds.has(node.id)) continue;
    const requested = node.data.outputKey;
    if (
      isChatbotNodeOutputKey(node.type, requested) &&
      !reservedByType[node.type].has(requested) &&
      !usedByType[node.type].has(requested)
    ) {
      usedByType[node.type].add(requested);
      assignedNodeIds.add(node.id);
    }
  }

  const candidates: Record<ChatbotCaptureNodeType, number> = {
    data: 1,
    message: 1,
    underchat: 1,
  };
  for (const node of next.nodes) {
    if (!isCaptureNode(node) || assignedNodeIds.has(node.id)) continue;
    const type = node.type;
    while (
      reservedByType[type].has(`${type}_${candidates[type]}`) ||
      usedByType[type].has(`${type}_${candidates[type]}`)
    ) {
      candidates[type] += 1;
    }
    const outputKey = `${type}_${candidates[type]}`;
    node.data.outputKey = outputKey;
    usedByType[type].add(outputKey);
    candidates[type] += 1;
  }

  return next;
};
