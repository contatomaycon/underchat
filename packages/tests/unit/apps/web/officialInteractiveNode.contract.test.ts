import fs from 'node:fs';
import path from 'node:path';

const WEB_ROOT = path.resolve(process.cwd(), 'apps/web/src');
const readSource = (relativePath: string): string =>
  fs.readFileSync(path.join(WEB_ROOT, relativePath), 'utf8');

describe('official interactive node Meta limit UX', () => {
  const nodeSource = readSource('components/chatbot/ChatbotOfficialNode.vue');
  const fieldSource = readSource(
    'components/chatbot/OfficialMetaLimitedField.vue'
  );
  const flowSource = readSource('pages/chatbot-flow.vue');

  it('shows codepoint-aware counters and explicit overflow feedback', () => {
    expect(fieldSource).toContain(':counter="limit"');
    expect(fieldSource).toContain(':counter-value="counterValue"');
    expect(fieldSource).toContain('persistent-counter');
    expect(fieldSource).toContain('chatbot_official_meta_limit_exceeded');
    expect(fieldSource).not.toContain(':maxlength="limit"');
    expect(fieldSource).not.toContain('.slice(');
  });

  it('derives shared and type-specific limits with computed state', () => {
    expect(nodeSource).toContain('const headerNode = computed(');
    expect(nodeSource).toContain('const footerNode = computed(');
    expect(nodeSource).toContain('const bodyNode = computed(');
    expect(nodeSource).toContain('const optionTextLimit = computed(');
    expect(nodeSource).toContain('const buttonTextLimit = computed(');
    expect(nodeSource).toContain('OFFICIAL_INTERACTIVE_LIMITS.flowCtaTitle');
    expect(nodeSource).toContain(
      ':forbid-emoji="nodeType === \'officialFlow\'"'
    );
    expect(nodeSource).toContain('OFFICIAL_INTERACTIVE_LIMITS.sectionTitle');
    expect(nodeSource).toContain(
      'OFFICIAL_INTERACTIVE_LIMITS.productSectionCount'
    );
    expect(nodeSource).toContain(
      'OFFICIAL_INTERACTIVE_LIMITS.productItemCount'
    );
  });

  it('renders all requested fields through the shared limited control', () => {
    expect(nodeSource).toContain('v-model="nodeData.header"');
    expect(nodeSource).toContain('v-model="nodeData.message"');
    expect(nodeSource).toContain('v-model="nodeData.footer"');
    expect(nodeSource).toContain('v-model="nodeData.sectionTitle"');
    expect(nodeSource).toContain('v-model="option.text"');
    expect(nodeSource).toContain('v-model="option.description"');
    expect(nodeSource).toContain('v-model="nodeData.buttonText"');
    expect(nodeSource).toContain(
      '(nodeData.options?.length ?? 0) > maxOptions'
    );
    expect(nodeSource).toContain(
      ':required="nodeType === \'officialMultiProduct\'"'
    );
    expect(nodeSource).toContain(
      "nodeType.value === 'officialSingleProduct' ? '' : data?.header || ''"
    );
    expect(nodeSource).toContain('delete data.header');
  });

  it('blocks flow persistence before calling the store when a value is invalid', () => {
    const validationStart = flowSource.indexOf(
      'const validateOfficialNodesBeforeSave'
    );
    const saveStart = flowSource.indexOf('const handleSave', validationStart);
    const validationSource = flowSource.slice(validationStart, saveStart);
    const handleSaveSource = flowSource.slice(saveStart);

    expect(validationSource).toContain(
      'findOfficialInteractiveLimitViolation('
    );
    expect(validationSource).toContain(
      "t('chatbot_flow_validation_official_meta_limit'"
    );
    expect(validationSource).toContain(
      "t('chatbot_flow_validation_official_multi_product_content'"
    );
    expect(flowSource).toContain("header: 'Produtos'");
    const validationCall = handleSaveSource.indexOf(
      'validateOfficialNodesBeforeSave()'
    );
    expect(validationCall).toBeGreaterThanOrEqual(0);
    expect(validationCall).toBeLessThan(
      handleSaveSource.indexOf('chatbotStore.saveChatbotFlow(formData)')
    );
  });

  it('normalizes CTA URL continuation to automatic for defaults, hydration and save', () => {
    expect(nodeSource).toContain(
      "nodeType.value === 'officialCtaUrl'\n        ? 'automatic'"
    );
    expect(nodeSource).toContain(
      "nodeType.value === 'officialCtaUrl') {\n    data.continueType = 'automatic'"
    );
    expect(flowSource).toContain(
      "node.type === 'officialCtaUrl') {\n      nodeData.continueType = 'automatic'"
    );
    expect(flowSource).toContain(
      "node.type === 'officialCtaUrl') {\n    node.data.continueType = 'automatic'"
    );
  });
});
