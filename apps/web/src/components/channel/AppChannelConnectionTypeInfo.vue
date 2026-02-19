<template>
  <VAlert type="info" variant="tonal" border="start" :icon="false">
    <VAlertTitle class="mb-1">
      {{ $t('channel_connection_type_info_title') }}
    </VAlertTitle>

    <p class="text-body-2 mb-1">
      <span class="font-weight-bold">
        {{ $t('channel_connection_type_info_socket_label') }}
      </span>
      <span class="ms-1">
        {{ $t('channel_connection_type_info_socket_description') }}
      </span>
    </p>

    <p class="text-body-2 mb-1">
      <span class="font-weight-bold">
        {{ $t('channel_connection_type_info_browser_label') }}
      </span>
      <span class="ms-1">
        {{ $t('channel_connection_type_info_browser_description') }}
      </span>
    </p>

    <p class="text-body-2 mb-0">
      {{ $t('channel_connection_type_info_switch') }}
    </p>
  </VAlert>
</template>
