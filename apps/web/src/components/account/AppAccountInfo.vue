<script lang="ts" setup>
import { VForm } from 'vuetify/components/VForm';
import { useAccountStore } from '@/@webcore/stores/account';
import { EContentWidth } from '@core/common/enums/EContentWidth';
import { EContentLayoutNav } from '@core/common/enums/EContentLayoutNav';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ESkin } from '@core/common/enums/ESkin';
import { ENavbar } from '@core/common/enums/ENavbar';
import { EFooter } from '@core/common/enums/EFooter';
import { EditAccountInfoParamsRequest } from '@core/schema/account/editAccountInfo/request.schema';

const accountStore = useAccountStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  accountId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

function appendIfDefined(fd: FormData, key: string, value: unknown) {
  if (value === null || value === undefined) return;
  if (typeof value === 'boolean') fd.append(key, value ? 'true' : 'false');
  else fd.append(key, value as Blob | string);
}

function buildAccountInfoForm(opts: {
  account_id: string;
  logo?: File | null;
  content_width: EContentWidth | null;
  content_layout_nav: EContentLayoutNav | null;
  default_locale: ELanguage | null;
  skin: ESkin | null;
  navbar: ENavbar | null;
  footer: EFooter | null;
  is_vertical_nav_collapsed: boolean | null;
  is_vertical_nav_semi_dark: boolean | null;
  light_primary_color: string | null;
  light_secondary_color: string | null;
  dark_primary_color: string | null;
  dark_secondary_color: string | null;
}) {
  const fd = new FormData();

  if (opts.logo instanceof File) {
    fd.append('logo', opts.logo);
  }

  appendIfDefined(fd, 'account_id', opts.account_id);
  appendIfDefined(fd, 'content_width', opts.content_width);
  appendIfDefined(fd, 'content_layout_nav', opts.content_layout_nav);
  appendIfDefined(fd, 'default_locale', opts.default_locale);
  appendIfDefined(fd, 'skin', opts.skin);
  appendIfDefined(fd, 'navbar', opts.navbar);
  appendIfDefined(fd, 'footer', opts.footer);
  appendIfDefined(
    fd,
    'is_vertical_nav_collapsed',
    opts.is_vertical_nav_collapsed
  );
  appendIfDefined(
    fd,
    'is_vertical_nav_semi_dark',
    opts.is_vertical_nav_semi_dark
  );
  appendIfDefined(fd, 'light_primary_color', opts.light_primary_color);
  appendIfDefined(fd, 'light_secondary_color', opts.light_secondary_color);
  appendIfDefined(fd, 'dark_primary_color', opts.dark_primary_color);
  appendIfDefined(fd, 'dark_secondary_color', opts.dark_secondary_color);

  return fd;
}

const itemsContentWidth = ref([
  { value: EContentWidth.fluid },
  { value: EContentWidth.boxed },
]);

const itemsContentLayoutNav = ref([
  { value: EContentLayoutNav.vertical },
  { value: EContentLayoutNav.horizontal },
]);

const itemsLanguage = ref([
  { value: ELanguage.en, title: t('english') },
  { value: ELanguage.es, title: t('spanish') },
  { value: ELanguage.pt, title: t('portuguese') },
]);

const itemsSkin = ref([{ value: ESkin.default }, { value: ESkin.bordered }]);

const itemsNavbar = ref([
  { value: ENavbar.sticky },
  { value: ENavbar.static },
  { value: ENavbar.hidden },
]);

const itemsFooter = ref([
  { value: EFooter.sticky },
  { value: EFooter.static },
  { value: EFooter.hidden },
]);

const objectUrl = ref<string | null>(null);

const accountId = toRef(props, 'accountId');
const accountInfoId = ref<string | null>(null);

const logoFile = ref<File | null>(null);
const logoUrl = ref<string | null>(null);

const contentWidth = ref<string | null>(null);
const contentLayoutNav = ref<string | null>(null);
const defaultLocale = ref<string | null>(null);
const skin = ref<string | null>(null);
const navbar = ref<string | null>(null);
const footer = ref<string | null>(null);
const isVerticalNavCollapsed = ref<boolean | null>(null);
const isVerticalNavSemiDark = ref<boolean | null>(null);
const lightPrimaryColor = ref<string | null>(null);
const lightSecondaryColor = ref<string | null>(null);
const darkPrimaryColor = ref<string | null>(null);
const darkSecondaryColor = ref<string | null>(null);

const hasAccountInfo = computed(() => !!accountInfoId.value);

const refFormEditAccount = ref<VForm>();

const updateAccountInfo = async () => {
  const validateForm = await refFormEditAccount?.value?.validate();
  if (!validateForm?.valid) return;

  if (!accountInfoId.value || !accountId.value) {
    return;
  }

  const payload: EditAccountInfoParamsRequest = {
    account_info_id: accountInfoId.value,
  };

  const body = buildAccountInfoForm({
    account_id: accountId.value,
    logo: logoFile.value ?? null,
    content_width: contentWidth.value as EContentWidth,
    content_layout_nav: contentLayoutNav.value as EContentLayoutNav,
    default_locale: defaultLocale.value as ELanguage,
    skin: skin.value as ESkin,
    navbar: navbar.value as ENavbar,
    footer: footer.value as EFooter,
    is_vertical_nav_collapsed: isVerticalNavCollapsed.value,
    is_vertical_nav_semi_dark: isVerticalNavSemiDark.value,
    light_primary_color: lightPrimaryColor.value,
    light_secondary_color: lightSecondaryColor.value,
    dark_primary_color: darkPrimaryColor.value,
    dark_secondary_color: darkSecondaryColor.value,
  });

  const result = await accountStore.updateAccountInfo(payload, body);

  if (result) {
    isVisible.value = false;
  }
};

const addAccountInfo = async () => {
  const validateForm = await refFormEditAccount?.value?.validate();
  if (!validateForm?.valid) return;

  if (!accountId.value) {
    return;
  }

  const payload = buildAccountInfoForm({
    account_id: accountId.value,
    logo: logoFile.value ?? null,
    content_width: contentWidth.value as EContentWidth,
    content_layout_nav: contentLayoutNav.value as EContentLayoutNav,
    default_locale: defaultLocale.value as ELanguage,
    skin: skin.value as ESkin,
    navbar: navbar.value as ENavbar,
    footer: footer.value as EFooter,
    is_vertical_nav_collapsed: isVerticalNavCollapsed.value ?? false,
    is_vertical_nav_semi_dark: isVerticalNavSemiDark.value ?? true,
    light_primary_color: lightPrimaryColor.value,
    light_secondary_color: lightSecondaryColor.value,
    dark_primary_color: darkPrimaryColor.value,
    dark_secondary_color: darkSecondaryColor.value,
  });

  const result = await accountStore.addAccountInfo(payload);

  if (result) {
    isVisible.value = false;
  }
};

watch(logoFile, (file) => {
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value);
  objectUrl.value = file ? URL.createObjectURL(file) : null;
});

const previewSrc = computed(() => objectUrl.value ?? logoUrl.value ?? null);

onBeforeUnmount(() => {
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value);
});

onMounted(async () => {
  if (!accountId.value) return;

  const account = await accountStore.getAccountInfoById(accountId.value);
  if (account) {
    accountInfoId.value = account.account_info_id;
    logoUrl.value = account.logo ?? null;
    contentWidth.value = account.content_width;
    contentLayoutNav.value = account.content_layout_nav;
    defaultLocale.value = account.default_locale;
    skin.value = account.skin;
    navbar.value = account.navbar;
    footer.value = account.footer;
    isVerticalNavCollapsed.value = account.is_vertical_nav_collapsed;
    isVerticalNavSemiDark.value = account.is_vertical_nav_semi_dark;
    lightPrimaryColor.value = account.light_primary_color;
    lightSecondaryColor.value = account.light_secondary_color;
    darkPrimaryColor.value = account.dark_primary_color;
    darkSecondaryColor.value = account.dark_secondary_color;
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <template v-if="accountStore.loading">
      <VOverlay
        :model-value="accountStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VForm ref="refFormEditAccount" @submit.prevent>
      <VCard :title="$t('account_info')">
        <VCardText>
          <VRow>
            <VCol cols="12">
              <VFileInput
                v-model="logoFile"
                accept="image/*"
                :label="$t('logo')"
                hide-details
              />
            </VCol>

            <VCol cols="12">
              <VImg
                v-if="previewSrc"
                :key="previewSrc"
                :src="previewSrc"
                max-height="120"
                class="mt-2 rounded"
                cover
              />
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <label
                :for="'account-status-select'"
                class="d-block text-body-2 font-weight-medium mb-1"
              >
                {{ $t('content_width') }}:
              </label>
              <VSelect
                :items="itemsContentWidth"
                item-title="value"
                item-value="value"
                v-model="contentWidth"
                dense
                variant="outlined"
                hide-details
                style="min-width: 200px"
              />
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <label
                :for="'account-status-select'"
                class="d-block text-body-2 font-weight-medium mb-1"
              >
                {{ $t('content_layout_nav') }}:
              </label>
              <VSelect
                :items="itemsContentLayoutNav"
                item-title="value"
                item-value="value"
                v-model="contentLayoutNav"
                dense
                variant="outlined"
                hide-details
                style="min-width: 200px"
              />
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <label
                :for="'account-status-select'"
                class="d-block text-body-2 font-weight-medium mb-1"
              >
                {{ $t('default_locale') }}:
              </label>
              <VSelect
                :items="itemsLanguage"
                item-title="title"
                item-value="value"
                v-model="defaultLocale"
                dense
                variant="outlined"
                hide-details
                style="min-width: 200px"
              />
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <label
                :for="'account-status-select'"
                class="d-block text-body-2 font-weight-medium mb-1"
              >
                {{ $t('skin') }}:
              </label>
              <VSelect
                :items="itemsSkin"
                item-title="value"
                item-value="value"
                v-model="skin"
                dense
                variant="outlined"
                hide-details
                style="min-width: 200px"
              />
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <label
                :for="'account-status-select'"
                class="d-block text-body-2 font-weight-medium mb-1"
              >
                {{ $t('navbar') }}:
              </label>
              <VSelect
                :items="itemsNavbar"
                item-title="value"
                item-value="value"
                v-model="navbar"
                dense
                variant="outlined"
                hide-details
                style="min-width: 200px"
              />
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <label
                :for="'account-status-select'"
                class="d-block text-body-2 font-weight-medium mb-1"
              >
                {{ $t('footer') }}:
              </label>
              <VSelect
                :items="itemsFooter"
                item-title="value"
                item-value="value"
                v-model="footer"
                dense
                variant="outlined"
                hide-details
                style="min-width: 200px"
              />
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <div class="d-flex align-center">
                <div class="d-flex align-center gap-2">
                  <label for="color-picker" class="mb-0 fw-semibold"
                    >{{ $t('light_primary_color') }}:</label
                  >
                  <span class="color-value">{{
                    lightPrimaryColor?.toUpperCase()
                  }}</span>
                </div>
                <div class="flex-grow-1"></div>
                <div class="d-flex align-center gap-2">
                  <input
                    type="color"
                    v-model="lightPrimaryColor"
                    class="color-input"
                    aria-label="seletor de cor"
                  />
                  <div
                    class="swatch-large"
                    :style="{ backgroundColor: lightPrimaryColor || '' }"
                    aria-label="preview da cor"
                  ></div>
                </div>
              </div>
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <div class="d-flex align-center">
                <div class="d-flex align-center gap-2">
                  <label for="color-picker" class="mb-0 fw-semibold"
                    >{{ $t('light_secondary_color') }}:</label
                  >
                  <span class="color-value">{{
                    lightSecondaryColor?.toUpperCase()
                  }}</span>
                </div>
                <div class="flex-grow-1"></div>
                <div class="d-flex align-center gap-2">
                  <input
                    type="color"
                    v-model="lightSecondaryColor"
                    class="color-input"
                    aria-label="seletor de cor"
                  />
                  <div
                    class="swatch-large"
                    :style="{ backgroundColor: lightSecondaryColor || '' }"
                    aria-label="preview da cor"
                  ></div>
                </div>
              </div>
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <div class="d-flex align-center">
                <div class="d-flex align-center gap-2">
                  <label for="color-picker" class="mb-0 fw-semibold"
                    >{{ $t('dark_primary_color') }}:</label
                  >
                  <span class="color-value">{{
                    darkPrimaryColor?.toUpperCase()
                  }}</span>
                </div>
                <div class="flex-grow-1"></div>
                <div class="d-flex align-center gap-2">
                  <input
                    type="color"
                    v-model="darkPrimaryColor"
                    class="color-input"
                    aria-label="seletor de cor"
                  />
                  <div
                    class="swatch-large"
                    :style="{ backgroundColor: darkPrimaryColor || '' }"
                    aria-label="preview da cor"
                  ></div>
                </div>
              </div>
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <div class="d-flex align-center">
                <div class="d-flex align-center gap-2">
                  <label for="color-picker" class="mb-0 fw-semibold"
                    >{{ $t('dark_secondary_color') }}:</label
                  >
                  <span class="color-value">{{
                    darkSecondaryColor?.toUpperCase()
                  }}</span>
                </div>
                <div class="flex-grow-1"></div>
                <div class="d-flex align-center gap-2">
                  <input
                    type="color"
                    v-model="darkSecondaryColor"
                    class="color-input"
                    aria-label="seletor de cor"
                  />
                  <div
                    class="swatch-large"
                    :style="{ backgroundColor: darkSecondaryColor || '' }"
                    aria-label="preview da cor"
                  ></div>
                </div>
              </div>
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <VRow no-gutters>
                <VCheckbox
                  v-model="isVerticalNavCollapsed"
                  :label="t('is_vertical_nav_collapsed')"
                />
              </VRow>
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <VRow no-gutters>
                <VCheckbox
                  v-model="isVerticalNavSemiDark"
                  :label="t('is_vertical_nav_semi_dark')"
                />
              </VRow>
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <template v-if="hasAccountInfo">
            <VBtn color="primary" @click="updateAccountInfo">
              {{ $t('update') }}
            </VBtn>
          </template>

          <template v-else>
            <VBtn color="primary" @click="addAccountInfo">
              {{ $t('add') }}
            </VBtn>
          </template>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
