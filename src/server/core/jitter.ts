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
    return packets;
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
      Math.round(point.lat * 1_000_000) / 1_000_000,
      Math.round(point.lon * 1_000_000) / 1_000_000,
      heading,
      speed,
      timestamp,
      packet[7],
      packet[8],
      packet[9],
      packet[10],
      packet[11],
      packet[12]
    ];
  });
};
