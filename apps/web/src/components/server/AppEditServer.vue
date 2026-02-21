<script lang="ts" setup>
import { useServerStore } from '@/@webcore/stores/server';
import { EServerWebProtocol } from '@core/common/enums/EServerWebProtocol';
import { EditServerRequest } from '@core/schema/server/editServer/request.schema';
import { VForm } from 'vuetify/components/VForm';

const serverStore = useServerStore();

const props = defineProps<{
  modelValue: boolean;
  serverId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const serverId = toRef(props, 'serverId');

const name = ref<string | null>(null);
const ip = ref<string | null>(null);
const port = ref<number | null>(null);
const username = ref<string | null>(null);
const password = ref<string | null>(null);
const quantityWorkers = ref<number | null>(null);
const webDomain = ref<string | null>(null);
const webPort = ref<number | null>(null);
const webProtocol = ref<EServerWebProtocol.http | EServerWebProtocol.https>(
  EServerWebProtocol.http
);
const proxyEnabled = ref(false);
const proxyHost = ref<string | null>(null);
const proxyPort = ref<number | null>(null);
const proxyUsername = ref<string | null>(null);
const proxyPassword = ref<string | null>(null);

const itemsWebProtocol = ref([
  { value: EServerWebProtocol.http, title: 'HTTP' },
  { value: EServerWebProtocol.https, title: 'HTTPS' },
]);

const refFormEditServer = ref<VForm>();
const isInitializingModal = ref(false);

const updateServer = async () => {
  const validateForm = await refFormEditServer?.value?.validate();
  if (!validateForm?.valid) return;

  if (
    !serverId.value ||
    !name.value ||
    !ip.value ||
    !port.value ||
    !quantityWorkers.value ||
    !webDomain.value ||
    !webPort.value ||
    !webProtocol.value ||
    (proxyEnabled.value && (!proxyHost.value || !proxyPort.value))
  ) {
    return;
  }

  const payload: EditServerRequest = {
    name: name.value,
    ssh_ip: ip.value,
    ssh_port: port.value,
    ssh_username: username.value,
    ssh_password: password.value,
    quantity_workers: quantityWorkers.value,
    web_domain: webDomain.value,
    web_port: webPort.value,
    web_protocol: webProtocol.value,
    proxy_enabled: proxyEnabled.value,
    proxy_host: proxyEnabled.value ? proxyHost.value : null,
    proxy_port: proxyEnabled.value ? proxyPort.value : null,
    proxy_username: proxyEnabled.value ? proxyUsername.value : null,
    proxy_password: proxyEnabled.value ? proxyPassword.value : null,
  };

  const result = await serverStore.updateServer(serverId.value, payload);

  if (result) {
    isVisible.value = false;

    await serverStore.listServers();
  }
};

onMounted(async () => {
  if (!serverId.value) return;

  const server = await serverStore.getServerById(serverId.value);
  if (server) {
    name.value = server.name;
    ip.value = server.ssh.ssh_ip;
    port.value = server.ssh.ssh_port;
    quantityWorkers.value = server.quantity_workers;
    webDomain.value = server.web.web_domain;
    webPort.value = server.web.web_port;
    webProtocol.value = server.web.web_protocol as EServerWebProtocol;
    proxyEnabled.value = server.proxy.enabled;
    proxyHost.value = server.proxy.host;
    proxyPort.value = server.proxy.port;
    username.value = null;
    password.value = null;
    proxyUsername.value = null;
    proxyPassword.value = null;
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <VForm ref="refFormEditServer" @submit.prevent>
      <VCard :title="$t('edit_server')" class="position-relative">
        <VOverlay
          :model-value="isInitializingModal || serverStore.loading"
          class="align-center justify-center"
          contained
        >
          <VProgressCircular color="primary" indeterminate size="64" />
        </VOverlay>
        <VCardText>
          <VRow>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('name') }}:</VLabel>
              <AppTextField
                v-model="name"
                :placeholder="$t('name_server')"
                :rules="[requiredValidator(name, $t('name_required'))]"
              />
            </VCol>

            <VCol cols="12" sm="4" md="4">
              <VLabel class="text-body-2 mb-1">{{ $t('ip') }}:</VLabel>
              <AppTextField
                v-model="ip"
                :placeholder="$t('ip')"
                :rules="[
                  requiredValidator(ip, $t('ip_required')),
                  isValidIP(ip, $t('ip_invalid')),
                ]"
                v-maska="ipMask"
              />
            </VCol>

            <VCol cols="12" sm="4" md="4">
              <VLabel class="text-body-2 mb-1">{{ $t('port') }}:</VLabel>
              <AppTextField
                v-model="port"
                :placeholder="$t('port')"
                :rules="[requiredValidator(port, $t('port_required'))]"
                type="number"
              />
            </VCol>

            <VCol cols="12" sm="4" md="4">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('workers_allowed') }}:</VLabel
              >
              <AppTextField
                v-model="quantityWorkers"
                :placeholder="$t('workers_allowed')"
                :rules="[
                  requiredValidator(
                    quantityWorkers,
                    $t('workers_allowed_required')
                  ),
                ]"
                type="number"
              />
            </VCol>

            <VCol cols="12" sm="4" md="4">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('web_protocol') }}:</VLabel
              >
              <AppSelectSearch
                v-model="webProtocol"
                :items="itemsWebProtocol"
                :placeholder="$t('web_protocol')"
                :clearable="true"
                item-value="value"
                item-title="title"
              />
            </VCol>

            <VCol cols="12" sm="4" md="4">
              <VLabel class="text-body-2 mb-1">{{ $t('web_domain') }}:</VLabel>
              <AppTextField
                v-model="webDomain"
                :placeholder="$t('web_domain')"
                :rules="[
                  requiredValidator(webDomain, $t('web_domain_required')),
                ]"
              />
            </VCol>

            <VCol cols="12" sm="4" md="4">
              <VLabel class="text-body-2 mb-1">{{ $t('web_port') }}:</VLabel>
              <AppTextField
                v-model="webPort"
                :placeholder="$t('web_port')"
                :rules="[requiredValidator(webPort, $t('web_port_required'))]"
                type="number"
              />
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('username') }}:</VLabel>
              <AppTextField v-model="username" :placeholder="$t('username')" />
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('password') }}:</VLabel>
              <AppTextField v-model="password" :placeholder="$t('password')" />
            </VCol>

            <VCol cols="12">
              <VSwitch
                v-model="proxyEnabled"
                :label="$t('enable_proxy')"
                color="primary"
                hide-details
              />
            </VCol>

            <VCol v-if="proxyEnabled" cols="12" sm="6" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('proxy_host') }}:</VLabel>
              <AppTextField
                v-model="proxyHost"
                :placeholder="$t('proxy_host_placeholder')"
                :rules="[
                  requiredValidator(proxyHost, $t('proxy_host_required')),
                ]"
              />
            </VCol>

            <VCol v-if="proxyEnabled" cols="12" sm="6" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('proxy_port') }}:</VLabel>
              <AppTextField
                v-model="proxyPort"
                :placeholder="$t('proxy_port')"
                :rules="[
                  requiredValidator(proxyPort, $t('proxy_port_required')),
                ]"
                type="number"
              />
            </VCol>

            <VCol v-if="proxyEnabled" cols="12" sm="6" md="6">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('proxy_username') }}:</VLabel
              >
              <AppTextField
                v-model="proxyUsername"
                :placeholder="$t('proxy_username')"
              />
            </VCol>

            <VCol v-if="proxyEnabled" cols="12" sm="6" md="6">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('proxy_password') }}:</VLabel
              >
              <AppTextField
                v-model="proxyPassword"
                :placeholder="$t('proxy_password')"
              />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="updateServer"> {{ $t('save') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
