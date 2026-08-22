export const serverInstallMappings = () => {
  return {
    mappings: {
      properties: {
        server_id: {
          type: 'keyword',
        },
        event_id: {
          type: 'keyword',
        },
        installation_id: {
          type: 'keyword',
        },
        install_event_type: {
          type: 'keyword',
        },
        install_stage: {
          type: 'keyword',
        },
        install_stage_status: {
          type: 'keyword',
        },
        install_status: {
          type: 'keyword',
        },
        command: {
          type: 'text',
        },
        output: {
          type: 'text',
        },
        date: {
          type: 'date',
        },
      },
    },
  };
};
