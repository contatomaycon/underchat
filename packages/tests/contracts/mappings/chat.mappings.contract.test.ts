import { chatMappings } from '@core/mappings/chat.mappings';

describe('chatMappings official window', () => {
  it('maps the service window UX timestamps explicitly as dates', () => {
    const mapping = chatMappings() as {
      mappings: {
        properties: {
          official_window: {
            properties: Record<string, { type: string }>;
          };
        };
      };
    };

    expect(
      mapping.mappings.properties.official_window.properties
        .service_window_started_at
    ).toEqual({ type: 'date' });
    expect(
      mapping.mappings.properties.official_window.properties
        .service_window_expires_at
    ).toEqual({ type: 'date' });
  });
});
