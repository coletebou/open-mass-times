// Great-circle distance and search bounding boxes.

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  /** When minLon > maxLon the box crosses the antimeridian (±180°). */
  minLon: number;
  maxLon: number;
}

/** A box that contains every point within `radiusKm` of (lat, lon). */
export function boundingBox(lat: number, lon: number, radiusKm: number): BoundingBox {
  const dLat = (radiusKm / EARTH_RADIUS_KM) * (180 / Math.PI);
  const minLat = Math.max(-90, lat - dLat);
  const maxLat = Math.min(90, lat + dLat);
  // Near the poles the longitude span blows up; just take every longitude.
  if (minLat <= -89.9 || maxLat >= 89.9) return { minLat, maxLat, minLon: -180, maxLon: 180 };
  const dLon = dLat / Math.cos(toRad(lat));
  if (dLon >= 180) return { minLat, maxLat, minLon: -180, maxLon: 180 };
  const wrap = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;
  return { minLat, maxLat, minLon: wrap(lon - dLon), maxLon: wrap(lon + dLon) };
}
