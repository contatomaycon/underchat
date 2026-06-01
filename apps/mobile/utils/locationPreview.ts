export type NormalizedLocationCoordinate = {
  latitude: number;
  longitude: number;
};

export function parseLocationCoordinate(value: unknown): number | null {
  if (typeof value === 'string' && value.trim().length === 0) {
    return null;
  }

  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.trim().replace(',', '.'))
        : NaN;

  if (!Number.isFinite(numericValue)) return null;
  return numericValue;
}

export function normalizeLocationCoordinate(
  latitudeValue: unknown,
  longitudeValue: unknown
): NormalizedLocationCoordinate | null {
  const latitude = parseLocationCoordinate(latitudeValue);
  const longitude = parseLocationCoordinate(longitudeValue);

  if (latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90) return null;
  if (longitude < -180 || longitude > 180) return null;

  return {
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
  };
}

function formatPreviewCoordinate(value: number): string {
  return value.toFixed(6);
}

export function buildLocationPreviewCandidates(
  latitudeValue: unknown,
  longitudeValue: unknown
): string[] {
  const coordinate = normalizeLocationCoordinate(latitudeValue, longitudeValue);
  if (!coordinate) return [];

  const lat = formatPreviewCoordinate(coordinate.latitude);
  const lng = formatPreviewCoordinate(coordinate.longitude);
  return [
    `https://static-maps.yandex.ru/1.x/?lang=en-US&ll=${lng},${lat}&z=18&l=map&size=600,340`,
  ];
}

export function buildLocationStaticPreviewUrl(
  latitudeValue: unknown,
  longitudeValue: unknown
): string | null {
  return (
    buildLocationPreviewCandidates(latitudeValue, longitudeValue)[0] ?? null
  );
}
