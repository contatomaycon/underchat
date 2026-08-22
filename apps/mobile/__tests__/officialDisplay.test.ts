import { describe, expect, it } from '@jest/globals';
import type {
  MessageContent,
  OfficialDisplayMetadata,
  OfficialTemplate,
} from '../types/chat';
import {
  buildOfficialDisplayModel,
  isSafeOfficialUrl,
} from '../utils/officialDisplay';

function createTemplate(
  overrides: Partial<OfficialTemplate> = {}
): OfficialTemplate {
  return {
    name: 'informacao_importante',
    language: 'pt_BR',
    status: 'APPROVED',
    category: 'UTILITY',
    components: [],
    variables: [],
    preview: {
      header: null,
      body: null,
      footer: null,
      buttons: [],
    },
    ...overrides,
  };
}

function createContent(
  officialTemplate?: OfficialTemplate | null
): MessageContent {
  return {
    type: 'text',
    message: null,
    official_template: officialTemplate ?? null,
  };
}

describe('officialDisplay helpers', () => {
  it('fills official template variables in the display model', () => {
    const template = createTemplate({
      preview: {
        header: null,
        body: 'Hello {{1}}',
        footer: null,
        buttons: [],
      },
      variables: [
        {
          key: 'BODY:1',
          component_type: 'BODY',
          index: 1,
          button_index: null,
          value: 'Maycon',
        },
      ],
    });

    const model = buildOfficialDisplayModel(
      { kind: 'template' },
      createContent(template)
    );

    expect(model.body).toBe('Hello Maycon');
  });

  it('hides technical template title and footer', () => {
    const template = createTemplate({
      preview: {
        header: null,
        body: 'Useful message',
        footer: null,
        buttons: [],
      },
    });

    const model = buildOfficialDisplayModel(
      {
        kind: 'template',
        title: 'informacao_importante',
        footer: 'pt_BR',
      },
      createContent(template)
    );

    expect(model.title).toBeNull();
    expect(model.footer).toBeNull();
    expect(model.body).toBe('Useful message');
  });

  it('hides duplicated body when it matches the title', () => {
    const display: OfficialDisplayMetadata = {
      kind: 'button',
      title: 'Choose an option',
      body: 'Choose an option',
    };

    const model = buildOfficialDisplayModel(display, createContent());

    expect(model.title).toBe('Choose an option');
    expect(model.body).toBeNull();
  });

  it('collapses official lists and exposes rows for the sheet', () => {
    const model = buildOfficialDisplayModel(
      {
        kind: 'list',
        action_label: 'View options',
        sections: [
          {
            id: 'main',
            title: 'Main',
            rows: [
              {
                id: 'talk',
                title: 'Talk to support',
                description: 'Open a support request',
              },
            ],
          },
        ],
      },
      createContent()
    );

    expect(model.collapsedActionLabel).toBe('View options');
    expect(model.shouldShowInlineSections).toBe(false);
    expect(model.listOptionSections).toHaveLength(1);
    expect(model.listOptionSections[0].rows[0].label).toBe('Talk to support');
  });

  it('marks only http and https CTA URLs as safe', () => {
    const model = buildOfficialDisplayModel(
      {
        kind: 'cta_url',
        actions: [
          { title: 'Open', url: 'https://underchat.example' },
          { title: 'Bad', url: 'javascript:alert(1)' },
        ],
      },
      createContent()
    );

    expect(isSafeOfficialUrl('http://underchat.example')).toBe(true);
    expect(isSafeOfficialUrl('https://underchat.example')).toBe(true);
    expect(isSafeOfficialUrl('ftp://underchat.example')).toBe(false);
    expect(model.visibleActions[0].safe_url).toBe('https://underchat.example');
    expect(model.visibleActions[1].safe_url).toBeNull();
  });

  it('formats submitted data as key/value rows and ignores empty values', () => {
    const model = buildOfficialDisplayModel(
      {
        kind: 'flow',
        submitted_data: {
          name: ' Maycon ',
          empty: '',
          missing: null,
          metadata: { count: 1 },
        },
      },
      createContent()
    );

    expect(model.submittedEntries).toEqual([
      { key: 'name', value: 'Maycon' },
      { key: 'metadata', value: '{"count":1}' },
    ]);
  });
});
