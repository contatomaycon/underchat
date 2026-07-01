<script setup lang="ts">
import { computed } from 'vue';
import type {
  ContentMessageChat,
  ListMessageResult,
} from '@core/schema/chat/listMessageChats/response.schema';

type OfficialMetadata = NonNullable<ContentMessageChat['official']>;
type OfficialDisplay = NonNullable<OfficialMetadata['display']>;
type OfficialAction = NonNullable<OfficialDisplay['actions']>[number];
type OfficialSection = NonNullable<OfficialDisplay['sections']>[number];
type OfficialCard = NonNullable<OfficialDisplay['cards']>[number];

interface Props {
  message: ListMessageResult;
  isOutgoing?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isOutgoing: false,
});

const display = computed<OfficialDisplay | null>(
  () => props.message.content?.official?.display ?? null
);

const kindLabelByKind: Record<string, string> = {
  button: 'Botões',
  list: 'Lista',
  cta_url: 'Link',
  location_request: 'Localização',
  flow: 'Fluxo WhatsApp',
  product: 'Produto',
  product_list: 'Produtos',
  catalog: 'Catálogo',
  carousel: 'Carrossel',
  address: 'Endereço',
  template: 'Template',
  order: 'Pedido',
  reply: 'Resposta',
  referral: 'Origem',
  system: 'Sistema',
  unsupported: 'Mensagem não suportada',
  call_permission_request: 'Ligação',
};

const iconByKind: Record<string, string> = {
  button: 'tabler-circle-dot',
  list: 'tabler-list',
  cta_url: 'tabler-external-link',
  location_request: 'tabler-current-location',
  flow: 'tabler-route',
  product: 'tabler-package',
  product_list: 'tabler-shopping-cart-plus',
  catalog: 'tabler-shopping-cart',
  carousel: 'tabler-stack-2',
  address: 'tabler-map',
  template: 'tabler-file-description',
  order: 'tabler-basket',
  reply: 'tabler-message-reply',
  referral: 'tabler-speakerphone',
  system: 'tabler-info-circle',
  unsupported: 'tabler-alert-circle',
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

const submittedEntries = computed<Array<[string, string]>>(() => {
  const data = display.value?.submitted_data;
  if (!data || typeof data !== 'object') {
    return [];
  }

  return Object.entries(data)
    .map(([key, value]) => [key, formatValue(value)] as [string, string])
    .filter(([, value]) => value.length > 0);
});

const label = computed(() =>
  display.value ? kindLabelByKind[display.value.kind] || display.value.kind : ''
);

const icon = computed(() =>
  display.value ? iconByKind[display.value.kind] || 'tabler-brand-whatsapp' : ''
);

const rawTypeLabel = computed(() => {
  const rawType = display.value?.raw_type;
  if (!rawType || rawType === display.value?.kind) {
    return null;
  }

  return rawType;
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

function sectionRows(section: OfficialSection): OfficialAction[] {
  return section.rows && section.rows.length > 0
    ? section.rows
    : (section.items ?? []);
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
    <div class="official-card__meta">
      <VIcon size="15" class="official-card__meta-icon">{{ icon }}</VIcon>
      <span class="official-card__meta-label">{{ label }}</span>
      <span v-if="rawTypeLabel" class="official-card__raw">
        {{ rawTypeLabel }}
      </span>
    </div>

    <div class="official-card__surface">
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

        <div v-if="visibleSections.length" class="official-card__sections">
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

      <div v-if="display.action_label" class="official-card__action-label">
        {{ display.action_label }}
      </div>

      <div v-if="visibleActions.length" class="official-card__actions">
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
  </div>
</template>

<style scoped>
.official-card {
  width: min(100%, 360px);
  margin-block: 6px;
  color: #1f2933;
}

.official-card--outgoing {
  margin-left: auto;
}

.official-card__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-block-end: 5px;
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1.1;
}

.official-card__meta-icon {
  color: #128c7e;
}

.official-card__raw {
  max-width: 150px;
  overflow: hidden;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.66rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.official-card__surface {
  overflow: hidden;
  border: 1px solid rgba(17, 24, 39, 0.08);
  border-radius: 7px;
  background: #f0ebe3;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.42);
}

.official-card__message {
  margin: 8px;
  overflow: hidden;
  border-radius: 6px;
  background: #fff;
}

.official-card__title,
.official-card__body,
.official-card__footer {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.official-card__title {
  padding: 10px 11px 4px;
  font-size: 0.86rem;
  font-weight: 700;
  line-height: 1.3;
}

.official-card__body {
  padding: 5px 11px 10px;
  color: #344054;
  font-size: 0.83rem;
  line-height: 1.35;
}

.official-card__footer {
  padding: 7px 11px 9px;
  border-top: 1px solid rgba(17, 24, 39, 0.07);
  color: #7a8699;
  font-size: 0.72rem;
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
  border-top: 1px solid rgba(17, 24, 39, 0.07);
}

.official-card__item,
.official-card__row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 11px;
}

.official-card__item + .official-card__item,
.official-card__row + .official-card__row {
  border-top: 1px solid rgba(17, 24, 39, 0.06);
}

.official-card__item-title,
.official-card__row-title {
  overflow-wrap: anywhere;
  font-size: 0.81rem;
  font-weight: 650;
  line-height: 1.22;
}

.official-card__item-desc,
.official-card__row-desc {
  overflow-wrap: anywhere;
  color: #667085;
  font-size: 0.72rem;
  line-height: 1.22;
}

.official-card__section-title {
  padding: 8px 11px 3px;
  color: #667085;
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
  border: 1px solid rgba(17, 24, 39, 0.08);
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
  padding: 7px 11px 9px;
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
  min-height: 36px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 8px 12px;
  border-top: 1px solid rgba(17, 24, 39, 0.08);
  background: #fff;
  color: #027eb5;
  font-size: 0.79rem;
  font-weight: 750;
  line-height: 1.18;
  text-align: center;
  text-decoration: none;
}

.official-card__action--nested {
  min-height: 30px;
  padding-block: 6px;
  font-size: 0.72rem;
}

.official-card--unsupported .official-card__surface {
  background: #fff7ed;
}

.official-card--unsupported .official-card__meta-icon,
.official-card--unsupported .official-card__meta-label {
  color: #d97706;
}
</style>
