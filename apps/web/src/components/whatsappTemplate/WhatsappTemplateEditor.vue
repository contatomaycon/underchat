<script setup lang="ts">
import { computed, reactive, shallowRef, watch } from 'vue';
import {
  CreateWhatsappTemplateRequest,
  UpdateWhatsappTemplateRequest,
  WhatsappTemplateComponent,
  WhatsappTemplateResponse,
} from '@core/schema/worker/whatsappOfficialTemplate';
import WhatsappTemplatePreview from './WhatsappTemplatePreview.vue';

interface ButtonDraft {
  type: string;
  text: string;
  url: string;
  phone_number: string;
  otp_type: string;
  flow_id: string;
}

interface TemplateDraft {
  name: string;
  language: string;
  category: string;
  sub_category: string | null;
  parameter_format: 'POSITIONAL' | 'NAMED';
  header_format: string;
  header_text: string;
  header_handle: string;
  body_text: string;
  footer_text: string;
  message_send_ttl_seconds: number | null;
  buttons: ButtonDraft[];
}

const props = defineProps<{
  modelValue: boolean;
  template: WhatsappTemplateResponse | null;
  saving: boolean;
  uploading: boolean;
  uploadMedia: (file: File) => Promise<string | null>;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  save: [
    payload: CreateWhatsappTemplateRequest | UpdateWhatsappTemplateRequest,
  ];
}>();

const currentStep = shallowRef(1);
const selectedFile = shallowRef<File | null>(null);

const defaultDraft = (): TemplateDraft => ({
  name: '',
  language: 'pt_BR',
  category: 'MARKETING',
  sub_category: 'STANDARD',
  parameter_format: 'POSITIONAL',
  header_format: 'NONE',
  header_text: '',
  header_handle: '',
  body_text: '',
  footer_text: '',
  message_send_ttl_seconds: null,
  buttons: [],
});

const draft = reactive<TemplateDraft>(defaultDraft());

const categoryOptions = computed(() => [
  {
    title: 'Marketing',
    value: 'MARKETING',
    icon: 'tabler-speakerphone',
    description:
      'Use este modelo para enviar mensagens de marketing interessantes que promovam sua empresa, destaquem novos produtos ou serviços e compartilhem informações importantes com seu público. Este modelo é indicado para mensagens de boas-vindas, boletins informativos, ofertas, cupons, catálogos e horários de atendimento.',
  },
  {
    title: 'Utilidade',
    value: 'UTILITY',
    icon: 'tabler-bell',
    description:
      'Use este modelo para enviar mensagens de utilidade essenciais que facilitem transações, gerenciem contas e melhorem a experiência dos clientes. Os exemplos incluem confirmações de pedidos, atualizações da conta, recibos, lembretes de horas marcadas e notificações de cobrança.',
  },
  {
    title: 'Autenticação',
    value: 'AUTHENTICATION',
    icon: 'tabler-key',
    description:
      'Use este modelo para enviar mensagens de autenticação seguras que protejam a integridade das transações e logins dos clientes. Os exemplos incluem senhas descartáveis para verificação de login, códigos de recuperação da conta e outros pedidos de autenticação sensível.',
  },
]);

const subtypeOptions = computed(() => {
  if (draft.category === 'AUTHENTICATION') {
    return [
      {
        title: 'Código de acesso de uso único',
        value: 'ONE_TIME_PASSCODE',
        description: 'Envie códigos para verificar uma transação ou login.',
      },
    ];
  }

  if (draft.category === 'UTILITY') {
    return [
      {
        title: 'Padrão',
        value: 'STANDARD',
        description: 'Envie mensagens sobre uma conta ou pedido existente.',
      },
      {
        title: 'Status do pedido',
        value: 'ORDER_STATUS',
        description: 'Informe clientes sobre o andamento de pedidos.',
      },
      {
        title: 'Detalhes do pedido',
        value: 'ORDER_DETAILS',
        description: 'Permita pagamentos ou detalhes de uma cobrança.',
      },
      {
        title: 'Solicitação de permissões para ligação',
        value: 'CALL_PERMISSIONS_REQUEST',
        description: 'Pergunte se você pode ligar para o cliente.',
      },
    ];
  }

  return [
    {
      title: 'Padrão',
      value: 'STANDARD',
      description: 'Envie mensagens com mídia e botões personalizados.',
    },
    {
      title: 'Catálogo',
      value: 'CATALOG',
      description: 'Conecte um catálogo de produtos ao modelo.',
    },
    {
      title: 'Detalhes do pedido',
      value: 'ORDER_DETAILS',
      description: 'Mostre dados de cobrança, pedido ou carrinho.',
    },
    {
      title: 'Solicitação de permissões para ligação',
      value: 'CALL_PERMISSIONS_REQUEST',
      description: 'Peça autorização para ligar pelo WhatsApp.',
    },
  ];
});

const languageOptions = computed(() => [
  { title: 'Português (Brasil)', value: 'pt_BR' },
  { title: 'English', value: 'en_US' },
  { title: 'Español', value: 'es_ES' },
]);

const headerFormatOptions = computed(() => [
  { title: 'Nenhum', value: 'NONE' },
  { title: 'Texto', value: 'TEXT' },
  { title: 'Imagem', value: 'IMAGE' },
  { title: 'Vídeo', value: 'VIDEO' },
  { title: 'Documento', value: 'DOCUMENT' },
  { title: 'Localização', value: 'LOCATION' },
]);

const buttonTypeOptions = computed(() => [
  { title: 'Personalizado', value: 'QUICK_REPLY' },
  { title: 'Acessar o site', value: 'URL' },
  { title: 'Ligar no WhatsApp', value: 'VOICE_CALL' },
  { title: 'Ligar', value: 'PHONE_NUMBER' },
  { title: 'Copiar código da oferta', value: 'COPY_CODE' },
  { title: 'OTP', value: 'OTP' },
  { title: 'Flow', value: 'FLOW' },
  { title: 'Catálogo', value: 'CATALOG' },
]);

const isEditingRemote = computed(() =>
  Boolean(props.template?.meta_template_id)
);

const resetDraft = () => {
  Object.assign(draft, defaultDraft());
  currentStep.value = 1;
  selectedFile.value = null;
};

const parseTemplate = (template: WhatsappTemplateResponse | null) => {
  resetDraft();

  if (!template) {
    return;
  }

  draft.name = template.name;
  draft.language = template.language;
  draft.category = template.category;
  draft.sub_category = template.sub_category;
  draft.parameter_format =
    template.parameter_format === 'NAMED' ? 'NAMED' : 'POSITIONAL';
  draft.message_send_ttl_seconds = template.message_send_ttl_seconds;

  const header = template.components.find(
    (component) => component.type === 'HEADER'
  );
  const body = template.components.find(
    (component) => component.type === 'BODY'
  );
  const footer = template.components.find(
    (component) => component.type === 'FOOTER'
  );
  const buttons = template.components.find(
    (component) => component.type === 'BUTTONS'
  );

  draft.header_format = String(header?.format ?? 'NONE');
  draft.header_text = String(header?.text ?? '');
  const headerExample = header?.example as
    { header_handle?: string[] } | undefined;
  draft.header_handle = headerExample?.header_handle?.[0] ?? '';
  draft.body_text = String(body?.text ?? '');
  draft.footer_text = String(footer?.text ?? '');
  draft.buttons = Array.isArray(buttons?.buttons)
    ? (buttons.buttons as Record<string, unknown>[]).map((button) => ({
        type: String(button.type ?? 'QUICK_REPLY'),
        text: String(button.text ?? ''),
        url: String(button.url ?? ''),
        phone_number: String(button.phone_number ?? ''),
        otp_type: String(button.otp_type ?? 'COPY_CODE'),
        flow_id: String(button.flow_id ?? ''),
      }))
    : [];
};

watch(
  () => props.template,
  (template) => parseTemplate(template),
  { immediate: true }
);

watch(
  () => draft.category,
  () => {
    draft.sub_category = subtypeOptions.value[0]?.value ?? null;
    if (draft.category === 'AUTHENTICATION' && !draft.body_text) {
      draft.body_text =
        '{{1}} é seu código de verificação. Por segurança, não compartilhe este código.';
    }
  }
);

const headerComponent = computed<WhatsappTemplateComponent | null>(() => {
  if (draft.header_format === 'NONE') return null;
  if (draft.header_format === 'TEXT') {
    if (!draft.header_text.trim()) return null;
    return {
      type: 'HEADER',
      format: 'TEXT',
      text: draft.header_text.trim(),
    };
  }

  if (draft.header_format === 'LOCATION') {
    return { type: 'HEADER', format: 'LOCATION' };
  }

  if (!draft.header_handle.trim()) {
    return { type: 'HEADER', format: draft.header_format };
  }

  return {
    type: 'HEADER',
    format: draft.header_format,
    example: {
      header_handle: [draft.header_handle.trim()],
    },
  };
});

const bodyComponent = computed<WhatsappTemplateComponent>(() => ({
  type: 'BODY',
  text: draft.body_text.trim() || 'Hello',
}));

const footerComponent = computed<WhatsappTemplateComponent | null>(() =>
  draft.footer_text.trim()
    ? {
        type: 'FOOTER',
        text: draft.footer_text.trim(),
      }
    : null
);

const buttonPayloads = computed<Record<string, unknown>[]>(() =>
  draft.buttons.map((button) => {
    const payload: Record<string, unknown> = {
      type: button.type,
      text: button.text.trim() || button.type,
    };

    if (button.type === 'URL') payload.url = button.url.trim();
    if (button.type === 'PHONE_NUMBER') {
      payload.phone_number = button.phone_number.trim();
    }
    if (button.type === 'OTP') payload.otp_type = button.otp_type;
    if (button.type === 'FLOW') payload.flow_id = button.flow_id.trim();

    return payload;
  })
);

const components = computed<WhatsappTemplateComponent[]>(() => {
  const nextComponents: WhatsappTemplateComponent[] = [];
  if (headerComponent.value) nextComponents.push(headerComponent.value);
  nextComponents.push(bodyComponent.value);
  if (footerComponent.value) nextComponents.push(footerComponent.value);
  if (buttonPayloads.value.length) {
    nextComponents.push({
      type: 'BUTTONS',
      buttons: buttonPayloads.value,
    });
  }

  return nextComponents;
});

const canContinueConfig = computed(() =>
  Boolean(draft.category && draft.sub_category)
);

const canSubmit = computed(() =>
  Boolean(draft.name.trim() && draft.language && draft.body_text.trim())
);

const addButton = () => {
  if (draft.buttons.length >= 10) {
    return;
  }

  draft.buttons.push({
    type: 'QUICK_REPLY',
    text: '',
    url: '',
    phone_number: '',
    otp_type: 'COPY_CODE',
    flow_id: '',
  });
};

const removeButton = (index: number) => {
  draft.buttons.splice(index, 1);
};

const insertBodyVariable = () => {
  const nextIndex = (draft.body_text.match(/\{\{\d+\}\}/gu)?.length ?? 0) + 1;
  draft.body_text = `${draft.body_text}${draft.body_text ? ' ' : ''}{{${nextIndex}}}`;
};

const handleMediaFile = async () => {
  if (!selectedFile.value) {
    return;
  }

  const handle = await props.uploadMedia(selectedFile.value);
  if (handle) {
    draft.header_handle = handle;
  }
};

const submit = () => {
  const payload: CreateWhatsappTemplateRequest | UpdateWhatsappTemplateRequest =
    {
      name: draft.name.trim(),
      language: draft.language,
      category: draft.category as CreateWhatsappTemplateRequest['category'],
      sub_category: draft.sub_category,
      parameter_format: draft.parameter_format,
      components: components.value,
      message_send_ttl_seconds: draft.message_send_ttl_seconds,
    };

  emit('save', payload);
};

const close = () => {
  emit('update:modelValue', false);
};
</script>

<template>
  <VDialog
    :model-value="modelValue"
    max-width="1320"
    persistent
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <DialogCloseBtn :disabled="saving" @click="close" />

    <VCard class="template-editor">
      <VCardTitle class="template-editor__title">
        {{ template ? 'Editar modelo' : 'Adicionar modelo' }}
      </VCardTitle>

      <VCardText class="template-editor__content">
        <div class="template-editor__main">
          <VStepper v-model="currentStep" alt-labels>
            <VStepperHeader>
              <VStepperItem title="Configurar modelo" :value="1" />
              <VDivider />
              <VStepperItem title="Editar modelo" :value="2" />
              <VDivider />
              <VStepperItem title="Enviar para análise" :value="3" />
            </VStepperHeader>

            <VStepperWindow>
              <VStepperWindowItem :value="1">
                <section class="template-editor__section">
                  <h3 class="template-editor__heading">
                    Configurar seu modelo
                  </h3>
                  <VBtnToggle
                    v-model="draft.category"
                    mandatory
                    divided
                    class="template-editor__category-toggle"
                  >
                    <VBtn
                      v-for="category in categoryOptions"
                      :key="category.value"
                      :value="category.value"
                      variant="text"
                    >
                      <VIcon :icon="category.icon" size="18" class="me-2" />
                      {{ category.title }}
                      <VTooltip
                        activator="parent"
                        location="top"
                        max-width="360"
                        open-delay="250"
                        content-class="bg-surface text-high-emphasis elevation-4 px-4 py-3"
                      >
                        <span class="text-body-2">
                          {{ category.description }}
                        </span>
                      </VTooltip>
                    </VBtn>
                  </VBtnToggle>

                  <VRadioGroup
                    v-model="draft.sub_category"
                    class="template-editor__subtype-group"
                    hide-details
                  >
                    <div
                      v-for="subtype in subtypeOptions"
                      :key="subtype.value"
                      class="template-editor__subtype-option"
                      :class="{
                        'template-editor__subtype-option--active':
                          draft.sub_category === subtype.value,
                      }"
                      @click="draft.sub_category = subtype.value"
                    >
                      <VRadio
                        :value="subtype.value"
                        color="primary"
                        hide-details
                      />
                      <div class="template-editor__radio-label">
                        <span>{{ subtype.title }}</span>
                        <small>{{ subtype.description }}</small>
                      </div>
                    </div>
                  </VRadioGroup>
                </section>
              </VStepperWindowItem>

              <VStepperWindowItem :value="2">
                <section class="template-editor__section">
                  <h3 class="template-editor__heading">
                    Nome e idioma do modelo
                  </h3>
                  <div class="template-editor__grid">
                    <AppTextField
                      v-model="draft.name"
                      label="Dê um nome ao seu modelo"
                      placeholder="exemplo_confirmacao_pedido"
                      :disabled="isEditingRemote"
                      maxlength="512"
                    />
                    <AppSelect
                      v-model="draft.language"
                      label="Selecione o idioma"
                      :items="languageOptions"
                      item-title="title"
                      item-value="value"
                      :disabled="isEditingRemote"
                    />
                    <AppSelect
                      v-model="draft.parameter_format"
                      label="Tipo de variável"
                      :items="[
                        { title: 'Número', value: 'POSITIONAL' },
                        { title: 'Nome', value: 'NAMED' },
                      ]"
                      item-title="title"
                      item-value="value"
                    />
                    <AppTextField
                      v-model.number="draft.message_send_ttl_seconds"
                      type="number"
                      label="Validade em segundos"
                      placeholder="Opcional"
                    />
                  </div>
                </section>

                <section class="template-editor__section">
                  <h3 class="template-editor__heading">Conteúdo</h3>
                  <div class="template-editor__grid">
                    <AppSelect
                      v-model="draft.header_format"
                      label="Amostra de mídia / Cabeçalho"
                      :items="headerFormatOptions"
                      item-title="title"
                      item-value="value"
                    />
                    <AppTextField
                      v-if="draft.header_format === 'TEXT'"
                      v-model="draft.header_text"
                      label="Cabeçalho"
                      maxlength="60"
                    />
                    <AppTextField
                      v-if="
                        ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(
                          draft.header_format
                        )
                      "
                      v-model="draft.header_handle"
                      label="Handle da mídia"
                      placeholder="Envie um arquivo ou cole o handle da Meta"
                    />
                    <VFileInput
                      v-if="
                        ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(
                          draft.header_format
                        )
                      "
                      v-model="selectedFile"
                      label="Enviar mídia"
                      density="compact"
                      :loading="uploading"
                      @update:model-value="handleMediaFile"
                    />
                  </div>

                  <AppTextarea
                    v-model="draft.body_text"
                    label="Corpo"
                    rows="8"
                    maxlength="1024"
                    class="mt-4"
                  />
                  <div class="template-editor__body-tools">
                    <VBtn
                      variant="text"
                      size="small"
                      prepend-icon="tabler-variable"
                      @click="insertBodyVariable"
                    >
                      Adicionar variável
                    </VBtn>
                  </div>
                  <AppTextField
                    v-model="draft.footer_text"
                    label="Rodapé"
                    maxlength="60"
                    class="mt-4"
                  />
                </section>

                <section class="template-editor__section">
                  <div class="template-editor__section-title-row">
                    <h3 class="template-editor__heading">Botões</h3>
                    <VBtn
                      variant="tonal"
                      size="small"
                      prepend-icon="tabler-plus"
                      :disabled="draft.buttons.length >= 10"
                      @click="addButton"
                    >
                      Adicionar botão
                    </VBtn>
                  </div>

                  <div
                    v-for="(button, index) in draft.buttons"
                    :key="index"
                    class="template-editor__button-row"
                  >
                    <AppSelect
                      v-model="button.type"
                      label="Tipo"
                      :items="buttonTypeOptions"
                      item-title="title"
                      item-value="value"
                    />
                    <AppTextField v-model="button.text" label="Texto" />
                    <AppTextField
                      v-if="button.type === 'URL'"
                      v-model="button.url"
                      label="URL"
                    />
                    <AppTextField
                      v-if="button.type === 'PHONE_NUMBER'"
                      v-model="button.phone_number"
                      label="Telefone"
                    />
                    <AppSelect
                      v-if="button.type === 'OTP'"
                      v-model="button.otp_type"
                      label="OTP"
                      :items="[
                        { title: 'Copiar código', value: 'COPY_CODE' },
                        { title: 'One tap', value: 'ONE_TAP' },
                        { title: 'Zero tap', value: 'ZERO_TAP' },
                      ]"
                      item-title="title"
                      item-value="value"
                    />
                    <AppTextField
                      v-if="button.type === 'FLOW'"
                      v-model="button.flow_id"
                      label="Flow ID"
                    />
                    <IconBtn @click="removeButton(index)">
                      <VIcon icon="tabler-trash" />
                    </IconBtn>
                  </div>
                </section>
              </VStepperWindowItem>

              <VStepperWindowItem :value="3">
                <section class="template-editor__section">
                  <h3 class="template-editor__heading">Enviar para análise</h3>
                  <div class="template-editor__review">
                    <div>
                      <strong>{{ draft.name || 'Sem nome' }}</strong>
                      <span>{{ draft.language }}</span>
                    </div>
                    <div>
                      <strong>{{ draft.category }}</strong>
                      <span>{{ draft.sub_category }}</span>
                    </div>
                    <div>
                      <strong>{{ components.length }}</strong>
                      <span>componentes configurados</span>
                    </div>
                  </div>
                  <VAlert
                    v-if="isEditingRemote"
                    type="info"
                    variant="tonal"
                    class="mt-4"
                  >
                    Nome e idioma ficam bloqueados para modelos já vinculados à
                    Meta. A edição enviada atualiza categoria, conteúdo,
                    cabeçalho, rodapé, botões e validade quando a Meta permitir.
                  </VAlert>
                </section>
              </VStepperWindowItem>
            </VStepperWindow>
          </VStepper>
        </div>

        <WhatsappTemplatePreview :components="components" />
      </VCardText>

      <VDivider />

      <VCardActions class="template-editor__actions">
        <VBtn color="secondary" variant="tonal" @click="close">
          Descartar
        </VBtn>
        <VBtn
          v-if="currentStep > 1"
          color="secondary"
          variant="tonal"
          prepend-icon="tabler-arrow-left"
          @click="currentStep -= 1"
        >
          Voltar
        </VBtn>
        <VBtn
          v-if="currentStep < 3"
          color="primary"
          variant="flat"
          append-icon="tabler-arrow-right"
          :disabled="currentStep === 1 && !canContinueConfig"
          @click="currentStep += 1"
        >
          Avançar
        </VBtn>
        <VBtn
          v-else
          color="primary"
          variant="flat"
          append-icon="tabler-send"
          :loading="saving"
          :disabled="!canSubmit"
          @click="submit"
        >
          Enviar para análise
        </VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>

<style scoped>
.template-editor {
  max-block-size: 92vh;
}

.template-editor__title {
  border-block-end: 1px solid
    rgba(var(--v-border-color), var(--v-border-opacity));
}

.template-editor__content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 24px;
  padding-block: 20px;
}

.template-editor__main {
  min-inline-size: 0;
}

.template-editor__section {
  padding: 18px 0;
}

.template-editor__heading {
  margin: 0 0 14px;
  font-size: 1rem;
  font-weight: 700;
}

.template-editor__category-toggle {
  display: flex;
  inline-size: 100%;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
}

.template-editor__category-toggle :deep(.v-btn) {
  flex: 1 1 0;
  min-inline-size: 0;
  min-block-size: 44px;
  border-radius: 0;
  letter-spacing: 0;
  text-transform: none;
  font-weight: 600;
}

.template-editor__category-toggle :deep(.v-btn--active) {
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
  box-shadow: none;
}

.template-editor__category-toggle :deep(.v-btn__overlay) {
  opacity: 0;
}

.template-editor__subtype-group {
  margin-block-start: 14px;
}

.template-editor__subtype-group :deep(.v-selection-control-group) {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.template-editor__subtype-option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 8px 10px;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.template-editor__subtype-option:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.template-editor__subtype-option--active {
  border-color: rgba(var(--v-theme-primary), 0.24);
  background: rgba(var(--v-theme-primary), 0.08);
}

.template-editor__subtype-option :deep(.v-selection-control) {
  min-block-size: 0;
}

.template-editor__subtype-option :deep(.v-selection-control__wrapper) {
  margin-block-start: 1px;
}

.template-editor__radio-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.template-editor__radio-label small {
  color: rgba(var(--v-theme-on-surface), 0.62);
}

.template-editor__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(180px, 240px);
  gap: 14px;
}

.template-editor__body-tools {
  display: flex;
  justify-content: flex-end;
  margin-block-start: 4px;
}

.template-editor__section-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.template-editor__button-row {
  display: grid;
  align-items: start;
  grid-template-columns: 180px minmax(180px, 1fr) minmax(180px, 1fr) 44px;
  gap: 12px;
  padding-block: 8px;
}

.template-editor__review {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.template-editor__review > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  padding: 14px;
}

.template-editor__review span {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.85rem;
}

.template-editor__actions {
  justify-content: flex-end;
  gap: 12px;
  padding: 16px;
}

@media (max-width: 1100px) {
  .template-editor__content {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .template-editor__grid,
  .template-editor__review,
  .template-editor__button-row {
    grid-template-columns: 1fr;
  }

  .template-editor__category-toggle :deep(.v-btn) {
    padding-inline: 8px;
    font-size: 0.82rem;
  }
}
</style>
