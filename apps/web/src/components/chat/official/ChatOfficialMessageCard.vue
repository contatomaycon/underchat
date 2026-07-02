<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import type {
  ContentMessageChat,
  ListMessageResult,
} from '@core/schema/chat/listMessageChats/response.schema';
import { useI18n } from 'vue-i18n';

type OfficialMetadata = NonNullable<ContentMessageChat['official']>;
type OfficialDisplay = NonNullable<OfficialMetadata['display']>;
type OfficialAction = NonNullable<OfficialDisplay['actions']>[number];
type OfficialSection = NonNullable<OfficialDisplay['sections']>[number];
type OfficialCard = NonNullable<OfficialDisplay['cards']>[number];

type OfficialListOptionSection = Omit<OfficialSection, 'rows'> & {
  rows: OfficialAction[];
};

interface Props {
  message: ListMessageResult;
  isOutgoing?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isOutgoing: false,
});

const { t } = useI18n();
const isOptionsDialogOpen = shallowRef(false);

const display = computed<OfficialDisplay | null>(
  () => props.message.content?.official?.display ?? null
);

const isUnsupported = computed(() => display.value?.kind === 'unsupported');
const isReply = computed(() => display.value?.kind === 'reply');

const unsupportedTitle = computed(() => t('official_whatsapp_unsupported'));

const unsupportedDescription = computed(() =>
  t('official_whatsapp_unsupported_hint')
);

const collapsedActionIconByKind: Record<string, string> = {
  list: 'tabler-list',
  product_list: 'tabler-shopping-cart-plus',
  catalog: 'tabler-shopping-cart',
  carousel: 'tabler-stack-2',
  flow: 'tabler-route',
  location_request: 'tabler-current-location',
  address: 'tabler-map',
  call_permission_request: 'tabler-phone-call',
};

const visibleActions = computed<OfficialAction[]>(() =>
  (display.value?.actions ?? []).filter(
    (action) => action.title || action.url || action.id || action.description
  )
);

const visibleSections = computed<OfficialSection[]>(() =>
  (display.value?.sections ?? []).filter(
    (section) =>
      section.title ||
      (section.rows && section.rows.length > 0) ||
      (section.items && section.items.length > 0)
  )
);

const visibleItems = computed<OfficialAction[]>(() =>
  (display.value?.items ?? []).filter(
    (item) => item.title || item.id || item.description
  )
);

const visibleCards = computed<OfficialCard[]>(() =>
  (display.value?.cards ?? []).filter(
    (card) =>
      card.title ||
      card.body ||
      card.footer ||
      card.media?.url ||
      card.media?.link ||
      (card.actions && card.actions.length > 0) ||
      (card.items && card.items.length > 0)
  )
);

const selectedReplyAction = computed<OfficialAction | null>(
  () => visibleActions.value[0] ?? null
);

const replyTitle = computed(() => {
  const action = selectedReplyAction.value;
  return (
    action?.title ||
    display.value?.title ||
    props.message.content?.message ||
    action?.id ||
    'Resposta'
  );
});

const replyDescription = computed(() => {
  const title = replyTitle.value?.trim();
  const description =
    selectedReplyAction.value?.description || display.value?.body || null;
  if (!description?.trim() || description.trim() === title) {
    return null;
  }
  return description;
});

const replyContextText = computed(() => {
  const quotedMessage = props.message.content?.quoted?.message?.trim();
  if (quotedMessage && quotedMessage !== replyTitle.value?.trim()) {
    return quotedMessage;
  }

  const displayBody = display.value?.body?.trim();
  if (
    displayBody &&
    displayBody !== replyTitle.value?.trim() &&
    displayBody !== replyDescription.value?.trim()
  ) {
    return displayBody;
  }

  return null;
});

const collapsedActionLabel = computed(() => {
  if (!display.value || isReply.value) return null;
  if (display.value.kind === 'button') return null;

  return display.value.action_label || null;
});

const collapsedActionIcon = computed(() => {
  if (!display.value) return null;
  return collapsedActionIconByKind[display.value.kind] || null;
});

const shouldShowInlineSections = computed(() => {
  const kind = display.value?.kind;
  return Boolean(kind && kind !== 'list' && kind !== 'product_list');
});

const shouldShowActionRows = computed(() => {
  const kind = display.value?.kind;
  if (collapsedActionLabel.value) return false;
  return Boolean(kind && kind !== 'list' && kind !== 'product_list');
});

const listOptionSections = computed<OfficialListOptionSection[]>(() => {
  if (display.value?.kind !== 'list') {
    return [];
  }

  return visibleSections.value
    .map((section) => ({
      ...section,
      rows: sectionRows(section).filter(
        (row) => row.title || row.description || row.id
      ),
    }))
    .filter((section) => section.rows.length > 0);
});

const hasListOptionSnapshot = computed(
  () => listOptionSections.value.length > 0
);

const submittedEntries = computed<Array<[string, string]>>(() => {
  const data = display.value?.submitted_data;
  if (!data || typeof data !== 'object') {
    return [];
  }

  return Object.entries(data)
    .map(([key, value]) => [key, formatValue(value)] as [string, string])
    .filter(([, value]) => value.length > 0);
});

const shouldShowBody = computed(() => {
  const title = display.value?.title?.trim();
  const body = display.value?.body?.trim();
  return Boolean(body && body !== title);
});

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function actionTitle(action: OfficialAction): string {
  return (
    action.title ||
    action.description ||
    action.url ||
    action.phone_number ||
    action.id ||
    'Continuar'
  );
}

function actionDescription(action: OfficialAction): string | null {
  const title = actionTitle(action).trim();
  const description = action.description?.trim();
  if (!description || description === title) {
    return null;
  }
  return description;
}

function sectionRows(section: OfficialSection): OfficialAction[] {
  return section.rows && section.rows.length > 0
    ? section.rows
    : (section.items ?? []);
}

function openOptionsDialog(): void {
  if (!hasListOptionSnapshot.value) {
    return;
  }
  isOptionsDialogOpen.value = true;
}

function closeOptionsDialog(): void {
  isOptionsDialogOpen.value = false;
}
</script>

<template>
  <div
    v-if="display"
    class="official-card"
    :class="[
      `official-card--${display.kind}`,
      { 'official-card--outgoing': isOutgoing },
    ]"
  >
    <div v-if="isUnsupported" class="official-unsupported-card">
      <div class="official-unsupported-card__icon">
        <VIcon size="19">tabler-alert-circle</VIcon>
      </div>
      <div class="official-unsupported-card__body">
        <span class="official-unsupported-card__title">
          {{ unsupportedTitle }}
        </span>
        <span class="official-unsupported-card__description">
          {{ unsupportedDescription }}
        </span>
      </div>
    </div>

    <template v-else>
      <div v-if="isReply" class="official-reply">
        <div v-if="replyContextText" class="official-reply__context">
          <div class="official-reply__context-text">
            {{ replyContextText }}
          </div>
        </div>
        <div class="official-reply__answer">
          <div class="official-reply__title">
            {{ replyTitle }}
          </div>
          <div v-if="replyDescription" class="official-reply__description">
            {{ replyDescription }}
          </div>
        </div>
      </div>

      <div v-else class="official-card__surface">
        <div
          v-if="display.media?.url || display.media?.link"
          class="official-card__media"
        >
          <img
            v-if="display.media?.type !== 'video'"
            :src="display.media.url || display.media.link || ''"
            alt=""
          />
          <video
            v-else
            :src="display.media.url || display.media.link || ''"
            muted
            playsinline
            preload="metadata"
          >
            <track kind="captions" />
          </video>
        </div>

        <div class="official-card__message">
          <div v-if="display.title" class="official-card__title">
            {{ display.title }}
          </div>
          <div v-if="shouldShowBody" class="official-card__body">
            {{ display.body }}
          </div>

          <div v-if="visibleItems.length" class="official-card__items">
            <div
              v-for="(item, index) in visibleItems"
              :key="`${item.id || item.title || 'item'}-${index}`"
              class="official-card__item"
            >
              <span class="official-card__item-title">
                {{ item.title || item.id }}
              </span>
              <span v-if="item.description" class="official-card__item-desc">
                {{ item.description }}
              </span>
            </div>
          </div>

          <div
            v-if="visibleSections.length && shouldShowInlineSections"
            class="official-card__sections"
          >
            <div
              v-for="(section, sectionIndex) in visibleSections"
              :key="`${section.id || section.title || 'section'}-${sectionIndex}`"
              class="official-card__section"
            >
              <div v-if="section.title" class="official-card__section-title">
                {{ section.title }}
              </div>
              <div
                v-for="(row, rowIndex) in sectionRows(section)"
                :key="`${row.id || row.title || 'row'}-${rowIndex}`"
                class="official-card__row"
              >
                <span class="official-card__row-title">
                  {{ row.title || row.id }}
                </span>
                <span v-if="row.description" class="official-card__row-desc">
                  {{ row.description }}
                </span>
              </div>
            </div>
          </div>

          <div v-if="visibleCards.length" class="official-card__cards">
            <div
              v-for="(card, cardIndex) in visibleCards"
              :key="`${card.title || card.body || 'card'}-${cardIndex}`"
              class="official-card__carousel-card"
            >
              <div
                v-if="card.media?.url || card.media?.link"
                class="official-card__card-media"
              >
                <img
                  :src="card.media.url || card.media.link || ''"
                  :alt="card.title || ''"
                />
              </div>
              <div v-if="card.title" class="official-card__card-title">
                {{ card.title }}
              </div>
              <div v-if="card.body" class="official-card__card-body">
                {{ card.body }}
              </div>
              <div v-if="card.footer" class="official-card__card-footer">
                {{ card.footer }}
              </div>
              <div
                v-for="(action, actionIndex) in card.actions ?? []"
                :key="`${action.id || action.title || 'card-action'}-${actionIndex}`"
                class="official-card__action official-card__action--nested"
              >
                {{ actionTitle(action) }}
              </div>
            </div>
          </div>

          <div v-if="submittedEntries.length" class="official-card__submitted">
            <div
              v-for="[key, value] in submittedEntries"
              :key="key"
              class="official-card__submitted-row"
            >
              <span>{{ key }}</span>
              <strong>{{ value }}</strong>
            </div>
          </div>

          <div v-if="display.footer" class="official-card__footer">
            {{ display.footer }}
          </div>
        </div>

        <button
          v-if="collapsedActionLabel && hasListOptionSnapshot"
          type="button"
          class="official-card__action official-card__action--collapsed official-card__action--clickable"
          aria-label="Visualizar opções da lista"
          @click.stop="openOptionsDialog"
        >
          <VIcon v-if="collapsedActionIcon" size="17">
            {{ collapsedActionIcon }}
          </VIcon>
          <span>{{ collapsedActionLabel }}</span>
        </button>

        <div
          v-else-if="collapsedActionLabel"
          class="official-card__action official-card__action--collapsed"
        >
          <VIcon v-if="collapsedActionIcon" size="17">
            {{ collapsedActionIcon }}
          </VIcon>
          <span>{{ collapsedActionLabel }}</span>
        </div>

        <div
          v-else-if="display.action_label && !visibleActions.length"
          class="official-card__action-label"
        >
          {{ display.action_label }}
        </div>

        <div
          v-if="visibleActions.length && shouldShowActionRows"
          class="official-card__actions"
        >
          <a
            v-for="(action, index) in visibleActions"
            :key="`${action.id || action.title || action.url || 'action'}-${index}`"
            class="official-card__action"
            :href="action.url || undefined"
            :target="action.url ? '_blank' : undefined"
            :rel="action.url ? 'noopener noreferrer' : undefined"
          >
            <VIcon v-if="action.url" size="14">tabler-external-link</VIcon>
            <span>{{ actionTitle(action) }}</span>
          </a>
        </div>
      </div>
    </template>
  </div>

  <VDialog
    v-if="display && hasListOptionSnapshot"
    v-model="isOptionsDialogOpen"
    max-width="440"
    scrollable
    class="official-list-options-dialog"
  >
    <VCard class="official-list-options-modal">
      <div class="official-list-options-modal__header">
        <button
          type="button"
          class="official-list-options-modal__close"
          aria-label="Fechar opções"
          @click="closeOptionsDialog"
        >
          <VIcon size="22">tabler-x</VIcon>
        </button>
        <span>{{ collapsedActionLabel || 'Selecionar' }}</span>
      </div>

      <div class="official-list-options-modal__body">
        <template
          v-for="(section, sectionIndex) in listOptionSections"
          :key="`${section.id || section.title || 'section'}-${sectionIndex}`"
        >
          <div
            v-if="section.title"
            class="official-list-options-modal__section-title"
          >
            {{ section.title }}
          </div>

          <div class="official-list-options-modal__section">
            <div
              v-for="(row, rowIndex) in section.rows"
              :key="`${row.id || row.title || 'row'}-${rowIndex}`"
              class="official-list-options-modal__row"
            >
              <div class="official-list-options-modal__row-copy">
                <div class="official-list-options-modal__row-title">
                  {{ actionTitle(row) }}
                </div>
                <div
                  v-if="actionDescription(row)"
                  class="official-list-options-modal__row-description"
                >
                  {{ actionDescription(row) }}
                </div>
              </div>
              <span
                class="official-list-options-modal__radio"
                aria-hidden="true"
              />
            </div>
          </div>
        </template>
      </div>
    </VCard>
  </VDialog>
</template>

<style scoped>
.official-card {
  width: min(100%, 336px);
  margin-block: 0;
  color: #111b21;
}

.official-card--outgoing {
  margin-left: auto;
}

.official-card--unsupported {
  width: 100%;
  margin-block: 0;
}

.official-unsupported-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.official-unsupported-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  border-radius: 8px;
  background: rgba(var(--v-theme-warning), 0.12);
  color: rgb(var(--v-theme-warning));
}

.official-unsupported-card__body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding-top: 1px;
}

.official-unsupported-card__title {
  color: rgba(var(--v-theme-on-surface), 0.92);
  font-size: 0.82rem;
  font-weight: 700;
  line-height: 1.25;
}

.official-unsupported-card__description {
  margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.75rem;
  line-height: 1.32;
}

.official-card__surface {
  overflow: hidden;
  border: 1px solid rgba(17, 27, 33, 0.08);
  border-radius: 7.5px;
  background: #fff;
  box-shadow: 0 1px 1px rgba(11, 20, 26, 0.08);
}

.official-card__message {
  overflow: hidden;
  background: #fff;
}

.official-card__title,
.official-card__body,
.official-card__footer {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.official-card__title {
  padding: 10px 12px 3px;
  color: #111b21;
  font-size: 0.88rem;
  font-weight: 700;
  line-height: 1.3;
}

.official-card__body {
  padding: 9px 12px 10px;
  color: #111b21;
  font-size: 0.88rem;
  line-height: 1.38;
}

.official-card__footer {
  padding: 7px 12px 9px;
  border-top: 1px solid #e9edef;
  color: #667781;
  font-size: 0.74rem;
  line-height: 1.25;
}

.official-card__media,
.official-card__card-media {
  overflow: hidden;
  background: #e4e7ec;
}

.official-card__media {
  aspect-ratio: 16 / 9;
}

.official-card__media img,
.official-card__media video,
.official-card__card-media img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.official-card__items,
.official-card__sections,
.official-card__submitted {
  border-top: 1px solid #e9edef;
}

.official-card__item,
.official-card__row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 9px 12px;
}

.official-card__item + .official-card__item,
.official-card__row + .official-card__row {
  border-top: 1px solid #eef0f2;
}

.official-card__item-title,
.official-card__row-title {
  overflow-wrap: anywhere;
  color: #111b21;
  font-size: 0.84rem;
  font-weight: 650;
  line-height: 1.22;
}

.official-card__item-desc,
.official-card__row-desc {
  overflow-wrap: anywhere;
  color: #667781;
  font-size: 0.75rem;
  line-height: 1.22;
}

.official-card__section-title {
  padding: 8px 12px 3px;
  color: #667781;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

.official-card__cards {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 9px;
  border-top: 1px solid rgba(17, 24, 39, 0.07);
}

.official-card__carousel-card {
  min-width: 190px;
  overflow: hidden;
  border: 1px solid rgba(17, 27, 33, 0.08);
  border-radius: 6px;
  background: #fff;
}

.official-card__card-media {
  aspect-ratio: 1.7;
}

.official-card__card-title,
.official-card__card-body,
.official-card__card-footer {
  overflow-wrap: anywhere;
  padding-inline: 9px;
}

.official-card__card-title {
  padding-top: 8px;
  font-size: 0.78rem;
  font-weight: 700;
}

.official-card__card-body {
  padding-top: 3px;
  color: #475467;
  font-size: 0.74rem;
  line-height: 1.3;
}

.official-card__card-footer {
  padding-block: 5px 8px;
  color: #7a8699;
  font-size: 0.69rem;
}

.official-card__submitted {
  display: grid;
  gap: 1px;
  padding: 7px 12px 9px;
  background: #fbfcfd;
}

.official-card__submitted-row {
  display: grid;
  grid-template-columns: minmax(64px, 0.42fr) minmax(0, 1fr);
  gap: 8px;
  color: #667085;
  font-size: 0.72rem;
  line-height: 1.25;
}

.official-card__submitted-row strong {
  overflow-wrap: anywhere;
  color: #344054;
  font-weight: 650;
}

.official-card__action-label,
.official-card__action {
  display: flex;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 9px 12px;
  border-top: 1px solid #e9edef;
  background: #fff;
  color: #008069;
  font-size: 0.88rem;
  font-weight: 500;
  line-height: 1.18;
  text-align: center;
  text-decoration: none;
}

button.official-card__action {
  width: 100%;
  border-inline: 0;
  border-block-end: 0;
  appearance: none;
  cursor: default;
  font: inherit;
}

.official-card__action--collapsed {
  color: #008069;
}

.official-card__action--clickable {
  cursor: pointer;
}

button.official-card__action--clickable {
  cursor: pointer;
}

.official-card__action--clickable:hover,
.official-card__action--clickable:focus-visible {
  background: #f7f8fa;
}

.official-card__action--clickable:focus-visible {
  outline: 2px solid rgba(0, 128, 105, 0.28);
  outline-offset: -2px;
}

.official-card__action--nested {
  min-height: 30px;
  padding-block: 6px;
  font-size: 0.72rem;
}

.official-list-options-modal {
  overflow: hidden;
  border-radius: 8px !important;
  background: #fff;
  color: #111b21;
}

.official-list-options-modal__header {
  display: flex;
  min-height: 56px;
  align-items: center;
  gap: 16px;
  padding: 0 20px;
  color: #111b21;
  font-size: 1rem;
  font-weight: 500;
  line-height: 1.25;
}

.official-list-options-modal__close {
  display: inline-flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  appearance: none;
  background: transparent;
  color: #54656f;
  cursor: pointer;
}

.official-list-options-modal__close:hover,
.official-list-options-modal__close:focus-visible {
  background: #f0f2f5;
}

.official-list-options-modal__close:focus-visible {
  outline: 2px solid rgba(0, 128, 105, 0.3);
  outline-offset: 2px;
}

.official-list-options-modal__body {
  max-height: min(72vh, 620px);
  overflow: auto;
  padding: 18px 0 24px;
}

.official-list-options-modal__section
  + .official-list-options-modal__section-title {
  margin-top: 12px;
}

.official-list-options-modal__section-title {
  padding: 8px 24px 4px;
  color: #667781;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.2;
  text-transform: uppercase;
}

.official-list-options-modal__row {
  display: grid;
  min-height: 64px;
  align-items: center;
  gap: 18px;
  grid-template-columns: minmax(0, 1fr) 20px;
  padding: 10px 24px;
}

.official-list-options-modal__row + .official-list-options-modal__row {
  border-top: 1px solid rgba(233, 237, 239, 0.72);
}

.official-list-options-modal__row-title {
  overflow-wrap: anywhere;
  color: #111b21;
  font-size: 0.94rem;
  font-weight: 600;
  line-height: 1.28;
}

.official-list-options-modal__row-description {
  overflow-wrap: anywhere;
  margin-top: 3px;
  color: #667781;
  font-size: 0.84rem;
  line-height: 1.3;
}

.official-list-options-modal__radio {
  width: 18px;
  height: 18px;
  border: 2px solid #aebac1;
  border-radius: 50%;
}

.official-reply {
  min-width: 188px;
  overflow: visible;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.official-reply__context {
  margin: 0 0 6px;
  padding: 7px 9px;
  border-left: 4px solid #53bdeb;
  border-radius: 6px;
  background: #e9f0f6;
}

.official-card--outgoing .official-reply__context {
  border-left-color: #ff8f2f;
  background: rgba(255, 255, 255, 0.48);
}

.official-reply__context-text {
  display: -webkit-box;
  overflow: hidden;
  color: #3b4a54;
  font-size: 0.84rem;
  line-height: 1.32;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.official-reply__answer {
  padding: 1px 2px 2px;
}

.official-reply__title,
.official-reply__description {
  overflow-wrap: anywhere;
}

.official-reply__title {
  color: #111b21;
  font-size: 0.9rem;
  font-weight: 650;
  line-height: 1.28;
}

.official-reply__description {
  margin-top: 3px;
  color: #3b4a54;
  font-size: 0.82rem;
  line-height: 1.3;
}

.official-card--unsupported .official-card__surface {
  background: #fff7ed;
}

.official-card--unsupported .official-card__meta-icon,
.official-card--unsupported .official-card__meta-label {
  color: #d97706;
}
</style>
