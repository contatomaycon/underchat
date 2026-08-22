import type {
  ApiRequestConfig,
  ChatbotFlowData,
  ChatbotFlowNode,
} from '@core/schema/chatbot/chatbotFlow.schema';
import {
  extractChatbotTemplatePaths,
  normalizeChatbotVariablePath,
} from '@core/common/functions/chatbotApiVariables';
import {
  getChatbotNodeOutputDefinition,
  getChatbotNodeOutputType,
  isChatbotCaptureNodeType,
  isChatbotNodeOutputKey,
} from '@core/common/functions/chatbotNodeOutputs';

const API_OUTPUT_PATTERN = /^api_[1-9]\d*$/u;

type ApiRequestFlowNode = ChatbotFlowNode & {
  type: 'apiRequest';
  data: ChatbotFlowNode['data'] & { apiRequest: ApiRequestConfig };
};

const hasApiRequestConfig = (
  node: ChatbotFlowNode
): node is ApiRequestFlowNode =>
  node.type === 'apiRequest' && node.data.apiRequest !== undefined;

const normalizeContractPath = (path: string): string =>
  path
    .replaceAll('[]', '')
    .replaceAll(/\[\d+\]/gu, '')
    .replace(/^\.+|\.+$/gu, '');

const collectTemplatePaths = (value: unknown, result: Set<string>): void => {
  if (typeof value === 'string') {
    for (const path of extractChatbotTemplatePaths(value)) result.add(path);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectTemplatePaths(entry, result);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'ciphertext' || key === 'proof') continue;
      collectTemplatePaths(entry, result);
    }
  }
};

export const extractChatbotNodeTemplatePaths = (
  node: ChatbotFlowNode
): string[] => {
  const result = new Set<string>();
  collectTemplatePaths(node.data, result);
  return [...result];
};

const intersect = <T>(sets: readonly Set<T>[]): Set<T> => {
  const [firstSet, ...remainingSets] = sets;
  if (!firstSet) return new Set<T>();
  return new Set(
    [...firstSet].filter((value) =>
      remainingSets.every((set) => set.has(value))
    )
  );
};

/** Computes graph dominators so a variable is exposed only when guaranteed. */
export const computeChatbotFlowDominators = (
  flow: Pick<ChatbotFlowData, 'nodes' | 'edges'>
): Map<string, Set<string>> => {
  const ids = flow.nodes.map((node) => node.id);
  const allIds = new Set(ids);
  const predecessors = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const edge of flow.edges) {
    if (allIds.has(edge.source) && allIds.has(edge.target)) {
      predecessors.get(edge.target)?.add(edge.source);
    }
  }

  const starts = new Set(
    flow.nodes
      .filter(
        (node) => node.type === 'start' || predecessors.get(node.id)?.size === 0
      )
      .map((node) => node.id)
  );
  const dominators = new Map<string, Set<string>>();
  for (const id of ids) {
    dominators.set(id, starts.has(id) ? new Set([id]) : new Set(allIds));
  }

  for (let iteration = 0; iteration < ids.length * 2 + 1; iteration += 1) {
    let changed = false;
    for (const id of ids) {
      if (starts.has(id)) continue;
      const previous = dominators.get(id) ?? new Set<string>();
      const predecessorSets = [...(predecessors.get(id) ?? [])].map(
        (predecessor) => dominators.get(predecessor) ?? new Set<string>()
      );
      const next = new Set([id, ...intersect(predecessorSets)]);
      if (
        previous.size !== next.size ||
        [...previous].some((entry) => !next.has(entry))
      ) {
        dominators.set(id, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return dominators;
};

/**
 * Returns whether an output produced by `sourceNodeId` is guaranteed to be
 * available when `targetNodeId` executes. Handle-scoped outputs are available
 * only when every route to the target crosses one of the matching source
 * edges. This keeps branch merges and bypasses from leaking conditional data.
 */
export const isChatbotNodeOutputAvailableAtNode = (
  flow: Pick<ChatbotFlowData, 'nodes' | 'edges'>,
  sourceNodeId: string,
  targetNodeId: string,
  sourceHandle?: string
): boolean => {
  if (sourceNodeId === targetNodeId) return false;

  if (!sourceHandle) {
    return Boolean(
      computeChatbotFlowDominators(flow).get(targetNodeId)?.has(sourceNodeId)
    );
  }

  const nodeIds = new Set(flow.nodes.map((node) => node.id));
  if (!nodeIds.has(sourceNodeId) || !nodeIds.has(targetNodeId)) return false;

  const predecessors = new Map(
    flow.nodes.map((node) => [node.id, new Set<string>()])
  );
  const outgoing = new Map(
    flow.nodes.map((node) => [node.id, [] as typeof flow.edges])
  );

  for (const edge of flow.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    predecessors.get(edge.target)?.add(edge.source);
    outgoing.get(edge.source)?.push(edge);
  }

  const startNodeIds = flow.nodes
    .filter(
      (node) =>
        node.type === 'start' || (predecessors.get(node.id)?.size ?? 0) === 0
    )
    .map((node) => node.id);

  type AvailabilityState = {
    nodeId: string;
    passedRequiredHandle: boolean;
  };

  const queue: AvailabilityState[] = startNodeIds.map((nodeId) => ({
    nodeId,
    passedRequiredHandle: false,
  }));
  const visited = new Set<string>();
  const targetStates = new Set<boolean>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const stateKey = `${current.nodeId}:${current.passedRequiredHandle ? 1 : 0}`;
    if (visited.has(stateKey)) continue;
    visited.add(stateKey);

    if (current.nodeId === targetNodeId) {
      targetStates.add(current.passedRequiredHandle);
    }

    for (const edge of outgoing.get(current.nodeId) ?? []) {
      const passedRequiredHandle =
        edge.source === sourceNodeId
          ? edge.sourceHandle === sourceHandle
          : current.passedRequiredHandle;
      queue.push({
        nodeId: edge.target,
        passedRequiredHandle,
      });
    }
  }

  return targetStates.has(true) && !targetStates.has(false);
};

export const assignStableApiRequestOutputKeys = (
  flow: ChatbotFlowData,
  previousFlow?: Pick<ChatbotFlowData, 'nodes'> | null
): ChatbotFlowData => {
  const next = structuredClone(flow);
  const previousKeys = new Map(
    (previousFlow?.nodes ?? []).flatMap((node) => {
      if (!hasApiRequestConfig(node)) return [];
      return [[node.id, node.data.apiRequest.outputKey] as const];
    })
  );
  const reserved = new Set(
    [...previousKeys.values()].filter((key) => API_OUTPUT_PATTERN.test(key))
  );
  const used = new Set<string>();
  const assignedNodeIds = new Set<string>();

  for (const node of next.nodes) {
    if (node.type !== 'apiRequest' || !node.data.apiRequest) continue;
    const stable = previousKeys.get(node.id);
    if (stable && API_OUTPUT_PATTERN.test(stable) && !used.has(stable)) {
      node.data.apiRequest.outputKey = stable;
      used.add(stable);
      assignedNodeIds.add(node.id);
    }
  }

  for (const node of next.nodes) {
    if (node.type !== 'apiRequest' || !node.data.apiRequest) continue;
    if (assignedNodeIds.has(node.id)) continue;
    const requested = node.data.apiRequest.outputKey;
    if (
      API_OUTPUT_PATTERN.test(requested) &&
      !reserved.has(requested) &&
      !used.has(requested)
    ) {
      used.add(requested);
      assignedNodeIds.add(node.id);
    }
  }

  let candidate = 1;
  for (const node of next.nodes) {
    if (node.type !== 'apiRequest' || !node.data.apiRequest) continue;
    if (assignedNodeIds.has(node.id)) continue;
    while (reserved.has(`api_${candidate}`) || used.has(`api_${candidate}`)) {
      candidate += 1;
    }
    const key = `api_${candidate}`;
    node.data.apiRequest.outputKey = key;
    used.add(key);
    candidate += 1;
  }
  return next;
};

const pathIsCaptured = (config: ApiRequestConfig, path: string): boolean => {
  if (!path) return true;
  if (path === '_response.status') return true;
  if (path.startsWith('_response.headers.')) {
    const header = path.slice('_response.headers.'.length).toLowerCase();
    return config.capture.responseHeaders.some(
      (selected) => selected.toLowerCase() === header
    );
  }
  if (path.startsWith('_response.')) return false;

  const normalized = normalizeContractPath(path);
  const contractContains = config.capture.contract.some((field) => {
    const contractPath = normalizeContractPath(field.path);
    return (
      contractPath === normalized || contractPath.startsWith(`${normalized}.`)
    );
  });
  if (!contractContains) return false;
  if (config.capture.mode === 'full') return true;
  return config.capture.paths.some((selected) => {
    const selection = normalizeContractPath(selected);
    return normalized === selection || normalized.startsWith(`${selection}.`);
  });
};

export interface ChatbotApiGraphValidationError {
  code:
    | 'missing_api_origin'
    | 'ambiguous_api_dependency'
    | 'uncaptured_api_path'
    | 'missing_output_origin'
    | 'ambiguous_output_dependency'
    | 'uncaptured_output_path'
    | 'missing_api_branch';
  nodeId: string;
  path?: string;
  sourceNodeId?: string;
}

export const validateChatbotApiVariableDependencies = (
  flow: ChatbotFlowData
): ChatbotApiGraphValidationError[] => {
  const errors: ChatbotApiGraphValidationError[] = [];
  const dominators = computeChatbotFlowDominators(flow);
  const origins = new Map<string, ChatbotFlowNode[]>();
  for (const node of flow.nodes) {
    if (hasApiRequestConfig(node)) {
      const key = node.data.apiRequest.outputKey;
      if (key) origins.set(key, [...(origins.get(key) ?? []), node]);
      continue;
    }
    if (
      isChatbotCaptureNodeType(node.type) &&
      isChatbotNodeOutputKey(node.type, node.data.outputKey)
    ) {
      const key = node.data.outputKey;
      origins.set(key, [...(origins.get(key) ?? []), node]);
    }
  }

  for (const node of flow.nodes) {
    if (node.type === 'apiRequest') {
      const outgoing = flow.edges.filter((edge) => edge.source === node.id);
      if (!outgoing.some((edge) => edge.sourceHandle === 'success')) {
        errors.push({
          code: 'missing_api_branch',
          nodeId: node.id,
          path: 'success',
        });
      }
      if (!outgoing.some((edge) => edge.sourceHandle === 'failure')) {
        errors.push({
          code: 'missing_api_branch',
          nodeId: node.id,
          path: 'failure',
        });
      }
    }

    for (const rawPath of extractChatbotNodeTemplatePaths(node)) {
      const segments = normalizeChatbotVariablePath(rawPath);
      const root = segments[0];
      const isApiOutput = Boolean(root && API_OUTPUT_PATTERN.test(root));
      const capturedNodeType = getChatbotNodeOutputType(root);
      if (!root || (!isApiOutput && !capturedNodeType)) continue;
      const candidates = origins.get(root) ?? [];
      if (candidates.length === 0) {
        errors.push({
          code: isApiOutput ? 'missing_api_origin' : 'missing_output_origin',
          nodeId: node.id,
          path: rawPath,
        });
        continue;
      }
      if (candidates.length > 1) {
        errors.push({
          code: isApiOutput
            ? 'ambiguous_api_dependency'
            : 'ambiguous_output_dependency',
          nodeId: node.id,
          path: rawPath,
        });
        continue;
      }
      const [source] = candidates;
      if (!source) continue;
      const outputDefinition = getChatbotNodeOutputDefinition(source);
      const outputIsAvailable =
        source.id !== node.id &&
        (outputDefinition
          ? isChatbotNodeOutputAvailableAtNode(
              flow,
              source.id,
              node.id,
              outputDefinition.sourceHandle
            )
          : Boolean(dominators.get(node.id)?.has(source.id)));
      if (!outputIsAvailable) {
        errors.push({
          code: isApiOutput
            ? 'ambiguous_api_dependency'
            : 'ambiguous_output_dependency',
          nodeId: node.id,
          sourceNodeId: source.id,
          path: rawPath,
        });
        continue;
      }
      const requestedPath = segments.slice(1).join('.');
      const pathIsAvailable = hasApiRequestConfig(source)
        ? pathIsCaptured(source.data.apiRequest, requestedPath)
        : Boolean(
            getChatbotNodeOutputDefinition(source)?.fields.some(
              (field) => field.path === requestedPath
            )
          );
      if (!pathIsAvailable) {
        errors.push({
          code: isApiOutput ? 'uncaptured_api_path' : 'uncaptured_output_path',
          nodeId: node.id,
          sourceNodeId: source.id,
          path: rawPath,
        });
      }
    }
  }
  return errors;
};

export const getUpstreamApiContracts = (
  flow: ChatbotFlowData,
  nodeId: string
): Record<string, unknown> => {
  const dominators =
    computeChatbotFlowDominators(flow).get(nodeId) ?? new Set();
  const entries: Array<readonly [string, unknown]> = [];
  for (const node of flow.nodes) {
    if (node.id === nodeId) continue;
    if (hasApiRequestConfig(node)) {
      if (!dominators.has(node.id)) continue;
      entries.push([
        node.data.apiRequest.outputKey,
        {
          contract: node.data.apiRequest.capture.contract,
          headers: node.data.apiRequest.capture.responseHeaders,
        },
      ]);
      continue;
    }
    const capturedOutput = getChatbotNodeOutputDefinition(node);
    if (!capturedOutput) continue;
    if (
      !isChatbotNodeOutputAvailableAtNode(
        flow,
        node.id,
        nodeId,
        capturedOutput.sourceHandle
      )
    ) {
      continue;
    }
    entries.push([
      capturedOutput.outputKey,
      {
        type: capturedOutput.nodeType,
        contract: capturedOutput.fields,
      },
    ]);
  }
  return Object.fromEntries(entries);
};
