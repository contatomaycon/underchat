import fs from 'node:fs';
import path from 'node:path';

const WEB_ROOT = path.resolve(process.cwd(), 'apps/web/src');
const CHATBOT_COMPONENT_ROOT = path.join(WEB_ROOT, 'components/chatbot');

type StructuralField = {
  tag: string;
  model: string;
};

type ConsumerContract = {
  name: string;
  filename: string;
  catalogBinding: string;
  variableModels: string[];
  structuralFields: StructuralField[];
};

const consumerContracts: ConsumerContract[] = [
  {
    name: 'Menu',
    filename: 'ChatbotMenuNode.vue',
    catalogBinding: 'availableVariables',
    variableModels: ['menuData.message'],
    structuralFields: [
      { tag: 'VTextField', model: 'menuData.title' },
      { tag: 'VTextField', model: 'option.text' },
    ],
  },
  {
    name: 'Satisfacao',
    filename: 'ChatbotSatisfactionNode.vue',
    catalogBinding: 'availableVariables',
    variableModels: ['satisfactionData.message'],
    structuralFields: [
      { tag: 'VTextField', model: 'satisfactionData.title' },
      { tag: 'VTextField', model: 'option.text' },
    ],
  },
  {
    name: 'Mensagem',
    filename: 'ChatbotMessageNode.vue',
    catalogBinding: 'availableMessageVariables',
    variableModels: [
      'messageData.attachmentFileName',
      'messageData.attachmentMimetype',
      'messageData.text',
    ],
    structuralFields: [
      { tag: 'VSelect', model: 'messageData.messageType' },
      { tag: 'VBtnToggle', model: 'messageData.attachmentSource' },
      { tag: 'VSelect', model: 'messageData.continueType' },
    ],
  },
  {
    name: 'Dados',
    filename: 'ChatbotDataNode.vue',
    catalogBinding: 'availableVariables',
    variableModels: [
      'dataNodeData.firstName',
      'dataNodeData.lastName',
      'dataNodeData.email',
      'dataNodeData.cpf',
      'dataNodeData.cnpj',
    ],
    structuralFields: [{ tag: 'VSelect', model: 'dataNodeData.dataType' }],
  },
  {
    name: 'Underchat',
    filename: 'ChatbotUnderchatNode.vue',
    catalogBinding: 'availableVariables',
    variableModels: ['lookupExpression'],
    structuralFields: [{ tag: 'VSelect', model: 'lookupType' }],
  },
  {
    name: 'Condicional',
    filename: 'ChatbotConditionalNode.vue',
    catalogBinding: 'availableVariables',
    variableModels: [
      'conditionalData.conditionalVariable',
      'condition.conditionTerm',
    ],
    structuralFields: [
      { tag: 'VSelect', model: 'condition.conditionType' },
      { tag: 'VSelect', model: 'condition.valueType' },
    ],
  },
  {
    name: 'Feriados',
    filename: 'ChatbotHolidayNode.vue',
    catalogBinding: 'availableVariables',
    variableModels: ['holidayData.holidayMessage'],
    structuralFields: [{ tag: 'VTextField', model: 'option.text' }],
  },
  {
    name: 'Anotacoes',
    filename: 'ChatbotAnnotationNode.vue',
    catalogBinding: 'availableVariables',
    variableModels: ['annotationData.annotation'],
    structuralFields: [],
  },
];

const readWebSource = (relativePath: string): string =>
  fs.readFileSync(path.join(WEB_ROOT, relativePath), 'utf8');

const readConsumerSource = (filename: string): string =>
  fs.readFileSync(path.join(CHATBOT_COMPONENT_ROOT, filename), 'utf8');

const getOpeningTags = (source: string, tagName: string): string[] => {
  const pattern = new RegExp(`<${tagName}\\b(?:[^>"']|"[^"]*"|'[^']*')*>`, 'g');

  return source.match(pattern) ?? [];
};

const tagUsesModel = (tag: string, model: string): boolean =>
  tag.includes(`v-model="${model}"`) || tag.includes(`:model-value="${model}`);

const getFunctionSource = (
  source: string,
  startMarker: string,
  endMarker: string
): string => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);

  if (start < 0 || end < 0) {
    throw new Error(`Unable to locate source contract: ${startMarker}`);
  }

  return source.slice(start, end);
};

describe('chatbot API variable consumer catalog', () => {
  const flowSource = readWebSource('pages/chatbot-flow.vue');

  it('delivers runtime variables only to the supported consumer node types', () => {
    const consumerSet = flowSource.match(
      /const VARIABLE_CONSUMER_NODE_TYPES = new Set\(\[([\s\S]*?)\]\);/
    );

    expect(consumerSet).not.toBeNull();

    const nodeTypes = Array.from(
      consumerSet?.[1].matchAll(/'([^']+)'/g) ?? [],
      (match) => match[1]
    );

    expect(nodeTypes).toEqual([
      'menu',
      'satisfaction',
      'message',
      'data',
      'underchat',
      'conditional',
      'holiday',
      'annotation',
      'officialTemplate',
    ]);

    const syncSource = getFunctionSource(
      flowSource,
      'const syncRuntimeVariableCatalogs',
      'const apiGraphSignature'
    );

    expect(syncSource).toContain('VARIABLE_CONSUMER_NODE_TYPES.has(node.type)');
    expect(
      syncSource.match(
        /node\.data\.availableVariables = getVariablesForNode\(node\.id\);/g
      )
    ).toHaveLength(1);
  });

  it('exposes API outputs only after a successful evidenced test', () => {
    const catalogSource = getFunctionSource(
      flowSource,
      'const getVariablesForNode',
      'const getApiUpstreamContracts'
    );

    expect(catalogSource).toContain("config.test.state !== 'tested'");
    expect(catalogSource).toContain('!config.test.evidence');
  });
});

describe.each(consumerContracts)(
  '$name API variable field contract',
  ({ filename, catalogBinding, variableModels, structuralFields }) => {
    const source = readConsumerSource(filename);
    const variableTags = getOpeningTags(source, 'ApiVariableField');

    it('keeps an explicit typed upstream variable catalog', () => {
      expect(source).toMatch(
        /import type \{ ApiRequestVariable \} from ['"].+api-request\/types['"];/
      );
      expect(source).toContain('availableVariables?: ApiRequestVariable[];');
    });

    it('uses ApiVariableField for every compatible content field', () => {
      expect(variableTags).toHaveLength(variableModels.length);

      for (const model of variableModels) {
        const matchingTags = variableTags.filter((tag) =>
          tagUsesModel(tag, model)
        );

        expect(matchingTags).toHaveLength(1);
        expect(matchingTags[0]).toContain(`:variables="${catalogBinding}"`);
      }
    });

    it('keeps structural fields outside ApiVariableField', () => {
      for (const { tag, model } of structuralFields) {
        expect(
          getOpeningTags(source, tag).filter((openingTag) =>
            tagUsesModel(openingTag, model)
          )
        ).toHaveLength(1);
        expect(
          variableTags.filter((openingTag) => tagUsesModel(openingTag, model))
        ).toHaveLength(0);
      }
    });
  }
);

describe('specialized variable and structural controls', () => {
  it('exposes the runtime catalog in official template value fields', () => {
    const source = readConsumerSource('ChatbotOfficialNode.vue');
    const variableFields = getOpeningTags(
      source,
      'OfficialTemplateVariableField'
    ).filter((tag) => tagUsesModel(tag, 'variable.value'));

    expect(source).toContain('availableVariables?: ApiRequestVariable[];');
    expect(variableFields).toHaveLength(2);
    for (const field of variableFields) {
      expect(field).toContain(':variables="availableVariables"');
    }
  });

  it('keeps the Message attachment source variable in its typed selector', () => {
    const source = readConsumerSource('ChatbotMessageNode.vue');
    const attachmentSelectors = getOpeningTags(source, 'VCombobox').filter(
      (tag) => tagUsesModel(tag, 'messageData.attachmentVariable')
    );

    expect(attachmentSelectors).toHaveLength(1);
    expect(attachmentSelectors[0]).toContain(
      ':items="attachmentVariableItems"'
    );
  });

  it('keeps Conditional operand mode and default branch structural', () => {
    const source = readConsumerSource('ChatbotConditionalNode.vue');
    const variableTags = getOpeningTags(source, 'ApiVariableField');

    expect(source).toContain("updateOperand('message')");
    expect(source).toContain("updateOperand('variable')");
    expect(variableTags.some((tag) => tag.includes('conditionalOperand'))).toBe(
      false
    );
    expect(
      getOpeningTags(source, 'VTextField').some(
        (tag) =>
          tag.includes("t('chatbot_conditional_default_placeholder')") &&
          tag.includes('disabled')
      )
    ).toBe(true);
  });
});

describe('captured Data and Message output frontend contract', () => {
  const flowSource = readWebSource('pages/chatbot-flow.vue');
  const dataSource = readConsumerSource('ChatbotDataNode.vue');
  const messageSource = readConsumerSource('ChatbotMessageNode.vue');

  it('keeps runtime catalogs transient while persisting automatic output keys', () => {
    const runtimeKeys = flowSource.match(
      /const RUNTIME_NODE_DATA_KEYS = new Set\(\[([\s\S]*?)\]\);/
    );

    expect(runtimeKeys?.[1]).toContain("'availableVariables'");
    expect(runtimeKeys?.[1]).not.toContain("'outputKey'");
    expect(flowSource).toContain('reservedApiOutputKeys');
    expect(flowSource).toContain('reservedNodeOutputKeys');
  });

  it('adds guaranteed captured origins to the same downstream catalog', () => {
    const catalogSource = getFunctionSource(
      flowSource,
      'const getVariablesForNode',
      'const getApiUpstreamContracts'
    );

    expect(catalogSource).toContain('getChatbotNodeOutputDefinition(node)');
    expect(catalogSource).toContain('formatChatbotNodeOutputTag');
    expect(catalogSource).toContain('sourceNodeId: node.id');
  });

  it('shows Data value and semantic aliases without an editable key field', () => {
    expect(dataSource).toContain(
      "formatChatbotNodeOutputTag(dataNodeData.value.outputKey, 'value')"
    );
    expect(dataSource).toContain(
      'formatChatbotNodeOutputTag(dataNodeData.value.outputKey, dataType)'
    );
    expect(dataSource).toContain('<CapturableOutputStrip');
    expect(dataSource).not.toMatch(/v-model="dataNodeData\.outputKey"/);
  });

  it('offers Message capture only while waiting for a response', () => {
    expect(messageSource).toContain('getChatbotNodeOutputDefinition({');
    expect(messageSource).toContain('formatChatbotNodeOutputTag(');
    expect(messageSource).toContain('field.path');
    expect(messageSource).toContain('<CapturableOutputStrip');
    expect(messageSource).not.toMatch(/v-model="messageData\.outputKey"/);
  });
});

describe('Underchat node frontend contract', () => {
  const flowSource = readWebSource('pages/chatbot-flow.vue');
  const underchatSource = readConsumerSource('ChatbotUnderchatNode.vue');

  it('registers and creates the node only for full-access profiles', () => {
    expect(flowSource).toContain('const hasFullAccess = computed(() =>');
    expect(flowSource).toContain('EGeneralPermissions.full_access');
    expect(flowSource).toContain('EGeneralPermissions.full_access_group');
    expect(flowSource).toContain('underchat: markRaw(ChatbotUnderchatNode)');
    expect(flowSource).toContain('if (hasFullAccess.value)');
    expect(flowSource).toContain(
      "if (nodeType === 'underchat' && !hasFullAccess.value) return;"
    );
  });

  it('keeps a stable output key and scopes the picker to the found branch', () => {
    expect(flowSource).toContain("allocateNodeOutputKey('underchat')");
    expect(flowSource).toContain('underchat: new Set<string>()');
    expect(flowSource).toContain('isChatbotNodeOutputAvailableAtNode(');
    expect(flowSource).toContain('capturedOutput.sourceHandle');
  });

  it('exposes fixed found and not-found handles and one connection per route', () => {
    expect(underchatSource).toContain('id="found"');
    expect(underchatSource).toContain('id="not_found"');
    expect(flowSource).toContain("edge.sourceHandle === 'found'");
    expect(flowSource).toContain("edge.sourceHandle === 'not_found'");
    expect(flowSource).toContain(
      "t('chatbot_flow_validation_underchat_handle_already_connected')"
    );
  });

  it('hides protected configuration and blocks canvas mutations in restricted flows', () => {
    expect(underchatSource).toContain('v-if="isRestricted"');
    expect(underchatSource).toContain('if (isRestricted.value) return [];');
    expect(flowSource).toContain('flow.read_only === true');
    expect(flowSource).toContain(':nodes-draggable="!isFlowReadOnly"');
    expect(flowSource).toContain(':nodes-connectable="!isFlowReadOnly"');
    expect(flowSource).toContain(':inert="isFlowReadOnly"');
    expect(flowSource).toContain('v-if="!isFlowReadOnly"');
  });
});
