import type { CompactTrackPacket, ImpactEvent, ThreatLevel, TrackType } from "../server/domain/types.js";

export const BINARY_MAGIC = 0x4559; // "EY" in ASCII
export const PROTOCOL_VERSION = 1;

export const MSG_SNAPSHOT = 0x00;
export const MSG_DELTA = 0x01;
export const MSG_IMPACTS = 0x02;
export const MSG_RESYNC = 0x08;
export const MSG_HEARTBEAT = 0x09;

export const clamp = (val: number, min: number, max: number): number => {
  if (Number.isNaN(val) || !Number.isFinite(val)) return min;
  return Math.min(max, Math.max(min, val));
};

export const sanitizeHeading = (heading: number): number => {
  if (Number.isNaN(heading) || !Number.isFinite(heading)) return 0;
  const norm = ((heading % 360) + 360) % 360;
  return Math.min(359.9, Math.max(0, Math.round(norm * 10) / 10));
};

export const FLAG_COORDS = 1 << 0;      // 0x0001: lat, lon (2x Int32 microdegrees)
export const FLAG_HEADING = 1 << 1;     // 0x0002: heading (Uint16, deg * 10)
export const FLAG_SPEED = 1 << 2;       // 0x0004: speed (Uint16, m/s * 10)
export const FLAG_ALTITUDE = 1 << 3;    // 0x0008: altitude (Int16, meters)
export const FLAG_CONFIDENCE = 1 << 4;  // 0x0010: confidence (Uint8, 0..100)
export const FLAG_UNCERTAINTY = 1 << 5; // 0x0020: uncertaintyRadius (Uint16, meters)
export const FLAG_THREAT = 1 << 6;      // 0x0040: threatLevel (Uint8, 0..3)
export const FLAG_MODEL = 1 << 7;       // 0x0080: model (string)
export const FLAG_CALLSIGN = 1 << 8;    // 0x0100: callsign (string)
export const FLAG_TIMESTAMP = 1 << 9;   // 0x0200: timestamp (Int16 offset from base)
export const FLAG_TYPE = 1 << 10;       // 0x0400: type (Uint8)

export const TRACK_TYPES: TrackType[] = [
  "unknown",
  "aircraft",
  "helicopter",
  "uav",
  "munition",
  "bomb",
  "fpv",
  "thermal"
];

export const THREAT_LEVELS: ThreatLevel[] = ["low", "medium", "high", "critical"];

const trackTypeToCode = (t: string): number => {
  const idx = TRACK_TYPES.indexOf(t as TrackType);
  return idx >= 0 ? idx : 0;
};

const codeToTrackType = (code: number): TrackType => {
  return TRACK_TYPES[code] ?? "unknown";
};

const threatLevelToCode = (l?: ThreatLevel): number => {
  if (!l) return 0;
  const idx = THREAT_LEVELS.indexOf(l);
  return idx >= 0 ? idx : 0;
};

const codeToThreatLevel = (code: number): ThreatLevel => {
  return THREAT_LEVELS[code] ?? "low";
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface DecodedDeltaPacket {
  kind: typeof MSG_DELTA | typeof MSG_SNAPSHOT;
  timestamp: number;
  seq: number;
  tracks: CompactTrackPacket[];
  removedIds: string[];
}

export interface DecodedImpactsPacket {
  kind: typeof MSG_IMPACTS;
  timestamp: number;
  events: ImpactEvent[];
}

export class BinaryWriter {
  private buffer: Uint8Array;
  private view: DataView;
  private offset = 0;

  constructor(initialCapacity = 4096) {
    this.buffer = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buffer.buffer);
  }

  private ensureCapacity(bytesNeeded: number) {
    if (this.offset + bytesNeeded <= this.buffer.length) return;
    let newCap = Math.max(this.buffer.length * 2, this.offset + bytesNeeded + 1024);
    const newBuf = new Uint8Array(newCap);
    newBuf.set(this.buffer);
    this.buffer = newBuf;
    this.view = new DataView(this.buffer.buffer);
  }

  writeUint8(val: number) {
    this.ensureCapacity(1);
    this.view.setUint8(this.offset, val);
    this.offset += 1;
  }

  writeUint16(val: number) {
    this.ensureCapacity(2);
    this.view.setUint16(this.offset, val, true);
    this.offset += 2;
  }

  writeInt16(val: number) {
    this.ensureCapacity(2);
    this.view.setInt16(this.offset, val, true);
    this.offset += 2;
  }

  writeUint32(val: number) {
    this.ensureCapacity(4);
    this.view.setUint32(this.offset, val, true);
    this.offset += 4;
  }

  writeInt32(val: number) {
    this.ensureCapacity(4);
    this.view.setInt32(this.offset, val, true);
    this.offset += 4;
  }

  writeFloat64(val: number) {
    this.ensureCapacity(8);
    this.view.setFloat64(this.offset, val, true);
    this.offset += 8;
  }

  writeString(str: string) {
    const encoded = textEncoder.encode(str);
    const len = Math.min(255, encoded.length);
    this.writeUint8(len);
    this.ensureCapacity(len);
    this.buffer.set(encoded.subarray(0, len), this.offset);
    this.offset += len;
  }

  getBuffer(): Uint8Array {
    return this.buffer.subarray(0, this.offset);
  }
}

export class BinaryReader {
  private view: DataView;
  private bytes: Uint8Array;
  private offset = 0;

  constructor(buffer: ArrayBuffer | ArrayBufferView) {
    if (ArrayBuffer.isView(buffer)) {
      this.bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } else {
      this.bytes = new Uint8Array(buffer);
      this.view = new DataView(buffer);
    }
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  readUint8(): number {
    const val = this.view.getUint8(this.offset);
    this.offset += 1;
    return val;
  }

  readUint16(): number {
    const val = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return val;
  }

  readInt16(): number {
    const val = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return val;
  }

  readUint32(): number {
    const val = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return val;
  }

  readInt32(): number {
    const val = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return val;
  }

  readFloat64(): number {
    const val = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return val;
  }

  readString(): string {
    const len = this.readUint8();
    if (len === 0) return "";
    const slice = this.bytes.subarray(this.offset, this.offset + len);
    this.offset += len;
    return textDecoder.decode(slice);
  }
}

/**
 * Encodes full snapshot of active tracks into binary buffer.
 */
export const encodeBinarySnapshot = (
  tracks: CompactTrackPacket[],
  seq: number,
  timestamp = Date.now()
): Uint8Array => {
  const w = new BinaryWriter(128 + tracks.length * 32);
  w.writeUint16(BINARY_MAGIC);
  w.writeUint8(PROTOCOL_VERSION);
  w.writeUint8(MSG_SNAPSHOT);
  w.writeUint32(seq);
  w.writeFloat64(timestamp);
  w.writeUint16(tracks.length);

  for (const t of tracks) {
    const [
      id,
      type,
      lat,
      lon,
      heading,
      speed,
      tStamp,
      confidence = 0.8,
      uncertaintyRadius = 0,
      threatLevel = "low",
      altitude = 0,
      model = "",
      callsign = ""
    ] = t;

    w.writeString(id);
    w.writeUint8(trackTypeToCode(type));

    // Quantize: Microdegrees Int32 with bounds clamping
    w.writeInt32(Math.round(clamp(lat, -90, 90) * 1_000_000));
    w.writeInt32(Math.round(clamp(lon, -180, 180) * 1_000_000));

    // Heading: Uint16 (0.1 deg, normalized to 0–359.9)
    w.writeUint16(Math.round(sanitizeHeading(heading) * 10));

    // Speed: Uint16 (0.1 m/s, clamped to 0–6553.5 m/s)
    w.writeUint16(Math.round(clamp(speed, 0, 6553.5) * 10));

    // Altitude: Int16 meters (clamped to -1000..32767m)
    w.writeInt16(Math.round(clamp(altitude, -1000, 32767)));

    // Confidence: Uint8 (0..100)
    w.writeUint8(Math.round(clamp(confidence, 0, 1) * 100));

    // Uncertainty radius: Uint16 meters (0..65535)
    w.writeUint16(Math.round(clamp(uncertaintyRadius, 0, 65535)));

    // Threat level: Uint8
    w.writeUint8(threatLevelToCode(threatLevel));

    // Relative timestamp: Int16 offset from base timestamp
    const dt = Math.round(clamp(tStamp - timestamp, -32768, 32767));
    w.writeInt16(dt);

    w.writeString(model);
    w.writeString(callsign);
  }

  return w.getBuffer();
};

/**
 * Encodes delta update of tracks with field bitmasks and removed IDs.
 */
export const encodeBinaryDelta = (
  tracks: CompactTrackPacket[],
  removedIds: string[],
  seq: number,
  timestamp = Date.now(),
  previousTracksMap?: Map<string, CompactTrackPacket>
): Uint8Array => {
  const w = new BinaryWriter(128 + tracks.length * 24 + removedIds.length * 16);
  w.writeUint16(BINARY_MAGIC);
  w.writeUint8(PROTOCOL_VERSION);
  w.writeUint8(MSG_DELTA);
  w.writeUint32(seq);
  w.writeFloat64(timestamp);

  // Tracks count
  w.writeUint16(tracks.length);

  for (const t of tracks) {
    const [
      id,
      type,
      lat,
      lon,
      heading,
      speed,
      tStamp,
      confidence = 0.8,
      uncertaintyRadius = 0,
      threatLevel = "low",
      altitude = 0,
      model = "",
      callsign = ""
    ] = t;

    w.writeString(id);

    const prev = previousTracksMap?.get(id);
    let bitmask = 0;

    if (!prev) {
      // All fields present for new track
      bitmask = 0xffff;
    } else {
      const latChanged = Math.abs(prev[2] - lat) > 0.000001;
      const lonChanged = Math.abs(prev[3] - lon) > 0.000001;
      if (latChanged || lonChanged) bitmask |= FLAG_COORDS;

      if (Math.abs(prev[4] - heading) > 0.1) bitmask |= FLAG_HEADING;
      if (Math.abs(prev[5] - speed) > 0.1) bitmask |= FLAG_SPEED;
      if (Math.abs((prev[10] ?? 0) - altitude) > 1) bitmask |= FLAG_ALTITUDE;
      if (Math.abs((prev[7] ?? 0.8) - confidence) > 0.02) bitmask |= FLAG_CONFIDENCE;
      if (Math.abs((prev[8] ?? 0) - uncertaintyRadius) > 5) bitmask |= FLAG_UNCERTAINTY;
      if (prev[9] !== threatLevel) bitmask |= FLAG_THREAT;
      if (prev[11] !== model) bitmask |= FLAG_MODEL;
      if (prev[12] !== callsign) bitmask |= FLAG_CALLSIGN;
      if (prev[1] !== type) bitmask |= FLAG_TYPE;
      if (Math.abs(prev[6] - tStamp) > 200) bitmask |= FLAG_TIMESTAMP;

      // Always write coords if nothing else flagged to ensure continuous motion
      if (bitmask === 0) bitmask = FLAG_COORDS;
    }

    w.writeUint16(bitmask);

    if (bitmask & FLAG_TYPE) {
      w.writeUint8(trackTypeToCode(type));
    }

    if (bitmask & FLAG_COORDS) {
      w.writeInt32(Math.round(clamp(lat, -90, 90) * 1_000_000));
      w.writeInt32(Math.round(clamp(lon, -180, 180) * 1_000_000));
    }

    if (bitmask & FLAG_HEADING) {
      w.writeUint16(Math.round(sanitizeHeading(heading) * 10));
    }

    if (bitmask & FLAG_SPEED) {
      w.writeUint16(Math.round(clamp(speed, 0, 6553.5) * 10));
    }

    if (bitmask & FLAG_ALTITUDE) {
      w.writeInt16(Math.round(clamp(altitude, -1000, 32767)));
    }

    if (bitmask & FLAG_CONFIDENCE) {
      w.writeUint8(Math.round(clamp(confidence, 0, 1) * 100));
    }

    if (bitmask & FLAG_UNCERTAINTY) {
      w.writeUint16(Math.round(clamp(uncertaintyRadius, 0, 65535)));
    }

    if (bitmask & FLAG_THREAT) {
      w.writeUint8(threatLevelToCode(threatLevel));
    }

    if (bitmask & FLAG_TIMESTAMP) {
      const dt = Math.round(clamp(tStamp - timestamp, -32768, 32767));
      w.writeInt16(dt);
    }

    if (bitmask & FLAG_MODEL) {
      w.writeString(model);
    }

    if (bitmask & FLAG_CALLSIGN) {
      w.writeString(callsign);
    }
  }

  // Removed IDs
  w.writeUint16(removedIds.length);
  for (const rid of removedIds) {
    w.writeString(rid);
  }

  return w.getBuffer();
};

/**
 * Decodes a binary packet (either Snapshot or Delta).
 */
export const decodeBinaryTracks = (
  data: ArrayBuffer | ArrayBufferView,
  existingTracksMap?: Map<string, CompactTrackPacket>
): DecodedDeltaPacket => {
  const r = new BinaryReader(data);
  const magic = r.readUint16();
  if (magic !== BINARY_MAGIC) {
    throw new Error(`Invalid binary packet magic: 0x${magic.toString(16)}`);
  }

  const version = r.readUint8();
  if (version !== PROTOCOL_VERSION) {
    throw new Error(`Incompatible binary protocol version: ${version} (expected ${PROTOCOL_VERSION})`);
  }

  const kind = r.readUint8() as typeof MSG_DELTA | typeof MSG_SNAPSHOT;
  const seq = r.readUint32();
  const baseTimestamp = r.readFloat64();
  const trackCount = r.readUint16();

  const tracks: CompactTrackPacket[] = [];

  if (kind === MSG_SNAPSHOT) {
    for (let i = 0; i < trackCount; i++) {
      const id = r.readString();
      const type = codeToTrackType(r.readUint8());
      const lat = clamp(r.readInt32() / 1_000_000, -90, 90);
      const lon = clamp(r.readInt32() / 1_000_000, -180, 180);
      const heading = sanitizeHeading(r.readUint16() / 10);
      const speed = clamp(r.readUint16() / 10, 0, 6553.5);
      const altitude = clamp(r.readInt16(), -1000, 32767);
      const confidence = clamp(r.readUint8() / 100, 0, 1);
      const uncertaintyRadius = clamp(r.readUint16(), 0, 65535);
      const threatLevel = codeToThreatLevel(r.readUint8());
      const dt = r.readInt16();
      const timestamp = baseTimestamp + dt;
      const model = r.readString();
      const callsign = r.readString();

      tracks.push([
        id,
        type,
        lat,
        lon,
        heading,
        speed,
        timestamp,
        confidence,
        uncertaintyRadius,
        threatLevel,
        altitude,
        model,
        callsign
      ]);
    }

    return {
      kind: MSG_SNAPSHOT,
      seq,
      timestamp: baseTimestamp,
      tracks,
      removedIds: []
    };
  }

  // Kind == MSG_DELTA
  for (let i = 0; i < trackCount; i++) {
    const id = r.readString();
    const bitmask = r.readUint16();

    const existing = existingTracksMap?.get(id);

    let type = existing ? existing[1] : "unknown";
    let lat = existing ? existing[2] : 0;
    let lon = existing ? existing[3] : 0;
    let heading = existing ? existing[4] : 0;
    let speed = existing ? existing[5] : 0;
    let timestamp = existing ? existing[6] : baseTimestamp;
    let confidence = existing ? existing[7] : 0.8;
    let uncertaintyRadius = existing ? existing[8] : 0;
    let threatLevel = existing ? existing[9] : "low";
    let altitude = existing ? existing[10] : 0;
    let model = existing ? existing[11] : "";
    let callsign = existing ? existing[12] : "";

    if (bitmask & FLAG_TYPE) {
      type = codeToTrackType(r.readUint8());
    }

    if (bitmask & FLAG_COORDS) {
      lat = clamp(r.readInt32() / 1_000_000, -90, 90);
      lon = clamp(r.readInt32() / 1_000_000, -180, 180);
    }

    if (bitmask & FLAG_HEADING) {
      heading = sanitizeHeading(r.readUint16() / 10);
    }

    if (bitmask & FLAG_SPEED) {
      speed = clamp(r.readUint16() / 10, 0, 6553.5);
    }

    if (bitmask & FLAG_ALTITUDE) {
      altitude = clamp(r.readInt16(), -1000, 32767);
    }

    if (bitmask & FLAG_CONFIDENCE) {
      confidence = clamp(r.readUint8() / 100, 0, 1);
    }

    if (bitmask & FLAG_UNCERTAINTY) {
      uncertaintyRadius = clamp(r.readUint16(), 0, 65535);
    }

    if (bitmask & FLAG_THREAT) {
      threatLevel = codeToThreatLevel(r.readUint8());
    }

    if (bitmask & FLAG_TIMESTAMP) {
      const dt = r.readInt16();
      timestamp = baseTimestamp + dt;
    } else {
      timestamp = baseTimestamp;
    }

    if (bitmask & FLAG_MODEL) {
      model = r.readString();
    }

    if (bitmask & FLAG_CALLSIGN) {
      callsign = r.readString();
    }

    tracks.push([
      id,
      type,
      lat,
      lon,
      heading,
      speed,
      timestamp,
      confidence,
      uncertaintyRadius,
      threatLevel,
      altitude,
      model,
      callsign
    ]);
  }

  const removedCount = r.readUint16();
  const removedIds: string[] = [];
  for (let i = 0; i < removedCount; i++) {
    removedIds.push(r.readString());
  }

  return {
    kind: MSG_DELTA,
    seq,
    timestamp: baseTimestamp,
    tracks,
    removedIds
  };
};

/**
 * Encodes impact events into binary buffer.
 */
export const encodeBinaryImpacts = (
  events: ImpactEvent[],
  timestamp = Date.now()
): Uint8Array => {
  const w = new BinaryWriter(64 + events.length * 48);
  w.writeUint16(BINARY_MAGIC);
  w.writeUint8(PROTOCOL_VERSION);
  w.writeUint8(MSG_IMPACTS);
  w.writeFloat64(timestamp);
  w.writeUint16(events.length);

  for (const e of events) {
    w.writeString(e.id);
    w.writeUint8(e.type === "intercept" ? 1 : 0);
    w.writeInt32(Math.round(clamp(e.lat, -90, 90) * 1_000_000));
    w.writeInt32(Math.round(clamp(e.lon, -180, 180) * 1_000_000));
    w.writeFloat64(e.timestamp);
    w.writeString(e.targetModel || "");
    w.writeUint8(trackTypeToCode(e.targetType));
    w.writeString(e.region || "");
    w.writeString(e.details || "");
  }

  return w.getBuffer();
};

/**
 * Decodes impact events from binary buffer.
 */
export const decodeBinaryImpacts = (
  data: ArrayBuffer | ArrayBufferView
): DecodedImpactsPacket => {
  const r = new BinaryReader(data);
  const magic = r.readUint16();
  if (magic !== BINARY_MAGIC) {
    throw new Error(`Invalid binary impacts magic: 0x${magic.toString(16)}`);
  }

  const version = r.readUint8();
  if (version !== PROTOCOL_VERSION) {
    throw new Error(`Incompatible binary protocol version: ${version} (expected ${PROTOCOL_VERSION})`);
  }

  const kind = r.readUint8() as typeof MSG_IMPACTS;
  const timestamp = r.readFloat64();
  const count = r.readUint16();

  const events: ImpactEvent[] = [];
  for (let i = 0; i < count; i++) {
    const id = r.readString();
    const type = r.readUint8() === 1 ? "intercept" : "impact";
    const lat = clamp(r.readInt32() / 1_000_000, -90, 90);
    const lon = clamp(r.readInt32() / 1_000_000, -180, 180);
    const eventTime = r.readFloat64();
    const targetModel = r.readString();
    const targetType = codeToTrackType(r.readUint8());
    const region = r.readString();
    const details = r.readString();

    events.push({
      id,
      type,
      lat,
      lon,
      timestamp: eventTime,
      targetModel,
      targetType,
      region,
      details: details || undefined
    });
  }

  return {
    kind: MSG_IMPACTS,
    timestamp,
    events
  };
};
