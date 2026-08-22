import fs from 'node:fs';
import path from 'node:path';

const WEB_ROOT = path.resolve(process.cwd(), 'apps/web/src');
const readSource = (relativePath: string): string =>
  fs.readFileSync(path.join(WEB_ROOT, relativePath), 'utf8');

describe('official conversation opening web contract', () => {
  const modalSource = readSource('components/chat/ChatLeftSidebarContent.vue');
  const windowCardSource = readSource(
    'components/chat/official/OfficialOpeningWindowCard.vue'
  );
  const storeSource = readSource('@webcore/stores/chat.ts');
  const pickerSource = readSource(
    'components/schedule/ScheduleOfficialTemplatePicker.vue'
  );
  const sendDialogSource = readSource(
    'components/chat/official/OfficialTemplateSendDialog.vue'
  );

  it('uses requires_template to choose free opening or template reengagement', () => {
    expect(modalSource).toContain(
      'officialOpeningContext.value?.requires_template === true'
    );
    expect(modalSource).toContain(
      'officialOpeningContext.value?.requires_template === false'
    );
    expect(modalSource).toContain(
      'requiresOfficialTemplate.value && selectedOfficialTemplate.value'
    );
    expect(modalSource).toContain(
      'v-else-if="officialOpeningContext && requiresOfficialTemplate"'
    );
  });

  it('blocks a new opening while waiting or provider confirmation is uncertain', () => {
    const composableSource = readSource(
      'composables/useOfficialOpeningContext.ts'
    );

    expect(modalSource).toContain(
      "officialOpeningWindow.value?.state === 'awaiting_contact_reply'"
    );
    expect(modalSource).toContain(
      "officialOpeningWindow.value?.state === 'send_uncertain'"
    );
    expect(modalSource).toContain('if (isOfficialOpeningBlocked.value)');
    expect(modalSource).toContain("'official_opening_waiting_action'");
    expect(modalSource).toContain("'official_opening_uncertain_action'");
    expect(composableSource).toContain(
      'currentWindow.awaiting_contact_reply_expires_at'
    );
    expect(composableSource).toContain(
      "currentWindow?.state === 'send_uncertain'"
    );
    expect(windowCardSource).toContain(
      'props.window?.awaiting_contact_reply_expires_at'
    );
    expect(windowCardSource).toContain("state.value === 'send_uncertain'");
  });

  it('renders the window status and refreshes a stale 409 decision', () => {
    expect(modalSource).toContain('<OfficialOpeningWindowCard');
    expect(modalSource).toContain(':window="officialOpeningWindow"');
    expect(modalSource).toContain('isOfficialWindowRefreshConflict(error)');
    expect(modalSource).toContain('await refreshOfficialOpeningContext();');
  });

  it('uses an available Tabler icon for the awaiting-contact card', () => {
    const tablerIconCatalog = JSON.parse(
      fs.readFileSync(
        path.resolve(
          process.cwd(),
          'node_modules/@iconify-json/tabler/icons.json'
        ),
        'utf8'
      )
    ) as { icons: Record<string, unknown> };
    const awaitingIcon = windowCardSource.match(
      /state\.value === 'awaiting_contact_reply'[\s\S]*?icon: 'tabler-([^']+)'/u
    )?.[1];

    expect(awaitingIcon).toBe('hourglass');
    expect(tablerIconCatalog.icons).toHaveProperty(awaitingIcon as string);
    expect(windowCardSource).not.toContain('tabler-message-hourglass');
  });

  it('locks cancellation and identity changes while the start request is active', () => {
    expect(modalSource).toContain(
      'const isOpeningConversation = shallowRef(false);'
    );
    expect(modalSource).toContain('if (isOpeningConversation.value)');
    expect(modalSource).toContain(
      'const openingContactId = selectedContactForChat.value.contact_id;'
    );
    expect(modalSource).toContain(
      'const openingWorkerId = selectedWorkerId.value;'
    );
    expect(modalSource).toContain(
      'selectedContactForChat.value?.contact_id !== openingContactId'
    );
    expect(modalSource).toContain(':disabled="isOpeningConversation"');
    expect(modalSource).toContain(':loading="isOpenConversationFormBusy"');
    expect(modalSource).toContain('isOpeningConversation.value = false;');
  });

  it('clears and fences worker configuration before enabling the opening form', () => {
    expect(modalSource).toContain(
      'const isLoadingWorkerConfigForChat = shallowRef(false);'
    );
    expect(modalSource).toContain('workerConfigForChat.value = null;');
    expect(modalSource).toContain('isLoadingWorkerConfigForChat.value = true;');
    expect(modalSource).toContain(
      'requestId === workerConfigRequestSequence &&'
    );
    expect(modalSource).toContain(
      'isLoadingWorkerConfigForChat.value = false;'
    );
    expect(modalSource).toContain(
      'isOpeningConversation.value || isLoadingWorkerConfigForChat.value'
    );
    expect(modalSource).toContain(
      'const isOpenConversationFormBusy = computed('
    );
    expect(modalSource).toContain(':loading="isLoadingWorkerConfigForChat"');
    expect(modalSource).toContain(':disabled="isOpenConversationFormBusy"');
  });

  it('keeps server failures generic and exposes a request id for support', () => {
    expect(storeSource).toContain('status >= 500');
    expect(storeSource).toContain(
      "this.i18n.global.t('chat_creation_server_error')"
    );
    expect(storeSource).toContain('getApiErrorRequestId(error)');
    expect(storeSource).toContain("this.i18n.global.t('request_id')");
  });

  it('describes the initial API response as queued instead of delivered', () => {
    expect(storeSource).toContain(
      "this.i18n.global.t('official_template_conversation_queued')"
    );
    expect(storeSource).not.toContain(
      "this.i18n.global.t('official_template_conversation_success')"
    );
  });

  it('uses named-aware labels and variable insertion in schedule fields', () => {
    expect(pickerSource).toContain('formatOfficialTemplateVariableLabel,');
    expect(pickerSource).toContain(
      '{{ formatOfficialTemplateVariableLabel(variable) }}'
    );
    expect(pickerSource).not.toContain('const formatVariableLabel');
    expect(
      pickerSource.match(/<OfficialTemplateVariableField\b/gu)
    ).toHaveLength(2);
    expect(pickerSource.match(/:variables="availableTags"/gu)).toHaveLength(2);
    expect(pickerSource).toContain(
      'createOfficialTemplateVariableValueRecord('
    );
  });

  it('initializes opening variable keys before an empty field is clicked', () => {
    expect(modalSource).toContain('createOfficialTemplateVariableValueRecord(');
    expect(modalSource).toContain('selectedOfficialTemplate.value?.variables');
  });

  it('provides UnderChat runtime tags to the direct template dialog', () => {
    expect(sendDialogSource).toContain(
      "import { createUnderchatVariableCatalog } from '@/utils/underchatVariableCatalog';"
    );
    expect(sendDialogSource).toContain('createUnderchatVariableCatalog(t)');
    expect(sendDialogSource).toContain(':available-tags="availableTags"');
    expect(sendDialogSource).not.toContain(':available-tags="[]"');
  });
});
