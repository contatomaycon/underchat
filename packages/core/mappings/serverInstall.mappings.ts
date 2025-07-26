export const serverInstallMappings = () => {
  return {
    mappings: {
      properties: {
        server_id: {
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
