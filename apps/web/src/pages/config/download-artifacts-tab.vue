<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { EColor } from '@core/common/enums/EColor';
import { DownloadArtifactResponse } from '@core/schema/config/downloadArtifacts/response.schema';
import { useSettingsStore } from '@/@webcore/stores/settings';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';

type ArtifactForm = Record<string, string>;
type DownloadEnvironment = DownloadArtifactResponse['environment'];

type ProductGroup = {
  artifacts: DownloadArtifactResponse[];
  configuredCount: number;
  product: DownloadArtifactResponse['product'];
};

const { t } = useI18n();
const settingsStore = useSettingsStore();
useSnackbarCleanup(settingsStore);

const form = ref<ArtifactForm>({});
const isSaving = shallowRef(false);
const copiedArtifactKey = shallowRef<string | null>(null);
const selectedEnvironment = shallowRef<DownloadEnvironment>(
  import.meta.env.PROD ? 'prod' : 'dev'
);

const productOrder = [
  'underchat_authenticator',
  'underchat_chrome_extension',
] as const;

const environmentOptions = [
  { value: 'dev', labelKey: 'download_artifacts_environment_dev' },
  { value: 'prod', labelKey: 'download_artifacts_environment_prod' },
] as const;

const artifacts = computed(
  () => settingsStore.downloadArtifacts?.artifacts ?? []
);

const totalLinks = computed(() => artifacts.value.length);

const configuredLinks = computed(
  () =>
    artifacts.value.filter((artifact) =>
      form.value[artifact.artifact_key]?.trim()
    ).length
);

const visibleArtifacts = computed(() =>
  artifacts.value.filter(
    (artifact) => artifact.environment === selectedEnvironment.value
  )
);

const visibleConfiguredLinks = computed(
  () =>
    visibleArtifacts.value.filter((artifact) =>
      form.value[artifact.artifact_key]?.trim()
    ).length
);

const productGroups = computed<ProductGroup[]>(() =>
  productOrder
    .map((product) => {
      const productArtifacts = visibleArtifacts.value.filter(
        (artifact) => artifact.product === product
      );

      return {
        artifacts: productArtifacts,
        configuredCount: productArtifacts.filter((artifact) =>
          form.value[artifact.artifact_key]?.trim()
        ).length,
        product,
      };
    })
    .filter((group) => group.artifacts.length > 0)
);

const syncForm = (items: DownloadArtifactResponse[]) => {
  form.value = Object.fromEntries(
    items.map((artifact) => [artifact.artifact_key, artifact.url ?? ''])
  );
};

const loadArtifacts = async () => {
  const response = await settingsStore.getDownloadArtifacts();

  if (response) {
    syncForm(response.artifacts);
  }
};

const saveArtifacts = async () => {
  isSaving.value = true;

  try {
    const response = await settingsStore.updateDownloadArtifacts({
      artifacts: artifacts.value.map((artifact) => ({
        artifact_key: artifact.artifact_key,
        url: form.value[artifact.artifact_key]?.trim() || null,
      })),
    });

    if (response) {
      syncForm(response.artifacts);
    }
  } finally {
    isSaving.value = false;
  }
};

const openArtifact = (artifact: DownloadArtifactResponse) => {
  const url = form.value[artifact.artifact_key]?.trim();

  if (!url) {
    settingsStore.showSnackbar(
      t('download_artifacts_public_url_required'),
      EColor.error
    );
    return;
  }

  globalThis.open(url, '_blank', 'noopener');
};

const copyArtifactUrl = async (artifact: DownloadArtifactResponse) => {
  const url = form.value[artifact.artifact_key]?.trim();

  if (!url) {
    settingsStore.showSnackbar(
      t('download_artifacts_public_url_required'),
      EColor.error
    );
    return;
  }

  await globalThis.navigator.clipboard.writeText(url);
  copiedArtifactKey.value = artifact.artifact_key;
  globalThis.setTimeout(() => {
    if (copiedArtifactKey.value === artifact.artifact_key) {
      copiedArtifactKey.value = null;
    }
  }, 1800);
};

const getProductIcon = (product: DownloadArtifactResponse['product']) =>
  product === 'underchat_authenticator'
    ? 'tabler-shield-lock'
    : 'tabler-brand-chrome';

watch(artifacts, syncForm, { immediate: true });

onMounted(loadArtifacts);
</script>

<template>
  <VCard class="download-artifacts-card">
    <div class="download-artifacts-header">
      <div class="download-artifacts-title">
        <span class="download-artifacts-main-icon">
          <VIcon icon="tabler-download" size="22" />
        </span>
        <div>
          <h2 class="text-h6 mb-1">
            {{ $t('download_artifacts') }}
          </h2>
          <p class="download-artifacts-description mb-0">
            {{ $t('download_artifacts_description') }}
          </p>
        </div>
      </div>

      <div class="download-artifacts-header-actions">
        <VBtnToggle
          v-model="selectedEnvironment"
          class="download-artifacts-toggle"
          color="primary"
          divided
          mandatory
          density="comfortable"
          variant="outlined"
        >
          <VBtn
            v-for="environment in environmentOptions"
            :key="environment.value"
            :value="environment.value"
            size="small"
          >
            {{ $t(environment.labelKey) }}
          </VBtn>
        </VBtnToggle>

        <VBtn
          type="button"
          color="primary"
          :loading="isSaving || settingsStore.loading"
          prepend-icon="tabler-device-floppy"
          @click="saveArtifacts"
        >
          {{ $t('save') }}
        </VBtn>
      </div>
    </div>

    <VDivider />

    <VCardText class="download-artifacts-content">
      <div class="download-artifacts-summary">
        <div class="download-artifacts-summary-item">
          <span>{{ $t('download_artifacts_total') }}</span>
          <strong>{{ totalLinks }}</strong>
        </div>
        <div class="download-artifacts-summary-item">
          <span>{{ $t('download_artifacts_configured') }}</span>
          <strong>{{ configuredLinks }}</strong>
        </div>
        <div class="download-artifacts-summary-item">
          <span>
            {{ $t(`download_artifacts_environment_${selectedEnvironment}`) }}
          </span>
          <strong
            >{{ visibleConfiguredLinks }}/{{ visibleArtifacts.length }}</strong
          >
        </div>
      </div>

      <div class="download-artifacts-layout">
        <section
          v-for="productGroup in productGroups"
          :key="productGroup.product"
          class="download-artifacts-product"
        >
          <header class="download-artifacts-product-header">
            <div class="download-artifacts-product-title">
              <span class="download-artifacts-product-icon">
                <VIcon :icon="getProductIcon(productGroup.product)" size="22" />
              </span>
              <div>
                <h3 class="text-subtitle-1 mb-1">
                  {{ $t(`download_artifacts_product_${productGroup.product}`) }}
                </h3>
                <span>
                  {{ productGroup.configuredCount }}/{{
                    productGroup.artifacts.length
                  }}
                  {{ $t('download_artifacts_configured_short') }}
                </span>
              </div>
            </div>

            <VChip color="primary" variant="tonal" size="small">
              {{ $t(`download_artifacts_environment_${selectedEnvironment}`) }}
            </VChip>
          </header>

          <div class="download-artifacts-table">
            <div
              v-for="artifact in productGroup.artifacts"
              :key="artifact.artifact_key"
              class="download-artifacts-row"
            >
              <div class="download-artifacts-row-meta">
                <strong>{{ artifact.label }}</strong>
                <span>
                  {{ $t('download_artifacts_filename') }}:
                  {{ artifact.filename }}
                </span>
              </div>

              <AppTextField
                v-model="form[artifact.artifact_key]"
                class="download-artifacts-input"
                :label="$t('download_artifacts_url_label')"
                :placeholder="$t('download_artifacts_missing_url')"
                hide-details
              />

              <div class="download-artifacts-actions">
                <VBtn
                  type="button"
                  icon
                  variant="tonal"
                  size="small"
                  :disabled="!form[artifact.artifact_key]"
                  :aria-label="$t('download_artifacts_open')"
                  @click.stop="openArtifact(artifact)"
                >
                  <VIcon size="18">tabler-external-link</VIcon>
                  <VTooltip activator="parent" location="top">
                    {{ $t('download_artifacts_open') }}
                  </VTooltip>
                </VBtn>

                <VBtn
                  type="button"
                  icon
                  variant="tonal"
                  size="small"
                  :disabled="!form[artifact.artifact_key]"
                  :aria-label="$t('download_artifacts_copy')"
                  @click.stop="copyArtifactUrl(artifact)"
                >
                  <VIcon size="18">
                    {{
                      copiedArtifactKey === artifact.artifact_key
                        ? 'tabler-check'
                        : 'tabler-copy'
                    }}
                  </VIcon>
                  <VTooltip activator="parent" location="top">
                    {{ $t('download_artifacts_copy') }}
                  </VTooltip>
                </VBtn>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div class="download-artifacts-savebar">
        <span>
          {{ visibleConfiguredLinks }}/{{ visibleArtifacts.length }}
          {{ $t('download_artifacts_visible_configured') }}
        </span>
        <VBtn
          type="button"
          color="primary"
          :loading="isSaving || settingsStore.loading"
          prepend-icon="tabler-device-floppy"
          @click="saveArtifacts"
        >
          {{ $t('save') }}
        </VBtn>
      </div>
    </VCardText>
  </VCard>
</template>

<style scoped lang="scss">
.download-artifacts-card {
  overflow: hidden;
}

.download-artifacts-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 24px;
}

.download-artifacts-title,
.download-artifacts-header-actions,
.download-artifacts-product-title {
  display: flex;
  align-items: center;
  min-inline-size: 0;
}

.download-artifacts-title {
  gap: 14px;
}

.download-artifacts-header-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
}

.download-artifacts-main-icon,
.download-artifacts-product-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid rgba(var(--v-theme-primary), 0.18);
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
}

.download-artifacts-main-icon {
  block-size: 42px;
  inline-size: 42px;
}

.download-artifacts-product-icon {
  block-size: 38px;
  inline-size: 38px;
}

.download-artifacts-description {
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.875rem;
  line-height: 1.45;
}

.download-artifacts-toggle {
  flex: 0 0 auto;
}

.download-artifacts-content {
  display: grid;
  gap: 20px;
  padding: 20px 24px 24px;
}

.download-artifacts-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
}

.download-artifacts-summary-item {
  display: grid;
  min-inline-size: 0;
  gap: 3px;
  padding: 14px 16px;
  background: rgba(var(--v-theme-on-surface), 0.018);
}

.download-artifacts-summary-item + .download-artifacts-summary-item {
  border-inline-start: 1px solid
    rgba(var(--v-border-color), var(--v-border-opacity));
}

.download-artifacts-summary-item span,
.download-artifacts-product-header span,
.download-artifacts-row-meta span,
.download-artifacts-savebar span {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.8125rem;
}

.download-artifacts-summary-item strong {
  color: rgb(var(--v-theme-on-surface));
  font-size: 1.25rem;
  line-height: 1.2;
}

.download-artifacts-layout {
  display: grid;
  gap: 16px;
}

.download-artifacts-product {
  overflow: hidden;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
}

.download-artifacts-product-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 16px 18px;
  background: rgba(var(--v-theme-primary), 0.035);
}

.download-artifacts-product-title {
  gap: 12px;
}

.download-artifacts-table {
  display: grid;
}

.download-artifacts-row {
  display: grid;
  grid-template-columns: minmax(180px, 0.36fr) minmax(260px, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
}

.download-artifacts-row + .download-artifacts-row {
  border-block-start: 1px solid
    rgba(var(--v-border-color), var(--v-border-opacity));
}

.download-artifacts-row-meta {
  display: grid;
  min-inline-size: 0;
  gap: 2px;
}

.download-artifacts-row-meta strong,
.download-artifacts-row-meta span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.download-artifacts-input {
  min-inline-size: 0;
}

.download-artifacts-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.download-artifacts-savebar {
  position: sticky;
  z-index: 1;
  inset-block-end: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14px;
  padding-block-start: 4px;
  background: rgb(var(--v-theme-surface));
}

@media (max-width: 1180px) {
  .download-artifacts-row {
    grid-template-columns: minmax(150px, 0.42fr) minmax(240px, 1fr) auto;
  }
}

@media (max-width: 960px) {
  .download-artifacts-header,
  .download-artifacts-product-header,
  .download-artifacts-savebar {
    align-items: stretch;
    flex-direction: column;
  }

  .download-artifacts-header-actions,
  .download-artifacts-savebar {
    justify-content: stretch;
  }

  .download-artifacts-header-actions > *,
  .download-artifacts-savebar > .v-btn {
    inline-size: 100%;
  }

  .download-artifacts-toggle {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .download-artifacts-summary {
    grid-template-columns: 1fr;
  }

  .download-artifacts-summary-item + .download-artifacts-summary-item {
    border-block-start: 1px solid
      rgba(var(--v-border-color), var(--v-border-opacity));
    border-inline-start: 0;
  }

  .download-artifacts-row {
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .download-artifacts-actions {
    justify-content: flex-end;
  }
}
</style>
