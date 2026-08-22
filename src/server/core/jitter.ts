import { destinationPoint, haversineMeters } from "../domain/geo.js";
import type { CompactTrackPacket, UserLocation } from "../domain/types.js";

const LOCAL_RADIUS_METERS = 15_000;

const stableNoise = (seed: string): number => {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }

  return ((hash >>> 0) % 10_000) / 10_000;
};

export const applyDynamicJitter = (
  packets: CompactTrackPacket[],
  location?: UserLocation
): CompactTrackPacket[] => {
  if (!location) {
    return packets.map((packet) => {
      const [id, type, lat, lon, heading, speed, timestamp] = packet;
      const distance = 20_000;
      const offset = 2_000 + stableNoise(`${id}:${timestamp}`) * 3_000;
      const direction = heading + 20 + stableNoise(id) * 40;
      const point = destinationPoint(lat, lon, direction, Math.min(offset, distance));
      return [id, type, point.lat, point.lon, heading, speed, timestamp];
    });
  }

  return packets.map((packet) => {
    const [id, type, lat, lon, heading, speed, timestamp] = packet;
    const distance = haversineMeters(location.lat, location.lon, lat, lon);

    if (distance <= LOCAL_RADIUS_METERS) {
      return packet;
    }

    const ratio = Math.min(1, (distance - LOCAL_RADIUS_METERS) / 50_000);
    const amplitude = 400 + ratio * 2_600;
    const offset = amplitude * (0.5 + stableNoise(`${id}:${timestamp}`));
    const direction = heading + 35 + stableNoise(id) * 70;
    const point = destinationPoint(lat, lon, direction, offset);

    return [
      id,
      type,
      Number(point.lat.toFixed(6)),
      Number(point.lon.toFixed(6)),
      heading,
      speed,
      timestamp
    ];
  });
};
