#!/usr/bin/env node
/**
 * Reproducible Protomaps PMTiles v3 extractor for Eye Radar.
 * Extracts a compact z0..z5 Ukraine + theater overview archive from the latest
 * Protomaps public build into public/tiles/ukraine-overview.pmtiles,
 * then verifies header, metadata, and every tile using the official `pmtiles` reader.
 *
 * Data attribution: © OpenStreetMap contributors (ODbL), Protomaps (BSD-3-Clause).
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { PMTiles, Compression, TileType, zxyToTileId } from "pmtiles";

const OUT_PATH = resolve(process.cwd(), "public/tiles/ukraine-overview.pmtiles");
const MAX_ZOOM = Number(process.env.PMTILES_MAX_ZOOM || "5");
const BBOX = { minLon: 20.5, minLat: 43.2, maxLon: 41.8, maxLat: 53.2 };

const lon2x = (lon, z) => Math.max(0, Math.min((1 << z) - 1, Math.floor(((lon + 180) / 360) * (1 << z))));
const lat2y = (lat, z) => {
  const rad = (lat * Math.PI) / 180;
  const n = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
  return Math.max(0, Math.min((1 << z) - 1, Math.floor(n * (1 << z))));
};

const encodeVarint = (n) => {
  const bytes = [];
  let v = BigInt(n);
  while (v >= 0x80n) {
    bytes.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  bytes.push(Number(v));
  return bytes;
};

/** Serialize PMTiles v3 directory entries per official PMTiles v3 spec */
const serializeDirectory = (entries) => {
  const out = [];
  out.push(...encodeVarint(entries.length));

  // 1. Delta-encoded tile IDs
  let lastId = 0;
  for (const e of entries) {
    out.push(...encodeVarint(e.tileId - lastId));
    lastId = e.tileId;
  }
  // 2. Run lengths
  for (const e of entries) {
    out.push(...encodeVarint(e.runLength));
  }
  // 3. Lengths
  for (const e of entries) {
    out.push(...encodeVarint(e.length));
  }
  // 4. Offsets (0 means contiguous with previous tile, otherwise offset + 1)
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (i > 0 && e.offset === entries[i - 1].offset + entries[i - 1].length) {
      out.push(...encodeVarint(0));
    } else {
      out.push(...encodeVarint(e.offset + 1));
    }
  }
  return Buffer.from(out);
};

const buildPmTilesV3 = ({ tiles, metadata, minZoom, maxZoom }) => {
  tiles.sort((a, b) => a.tileId - b.tileId);

  const tileBuffers = [];
  const entries = [];
  let tileOffset = 0;

  for (const t of tiles) {
    const gz = gzipSync(Buffer.from(t.data), { level: 9 });
    entries.push({
      tileId: t.tileId,
      offset: tileOffset,
      length: gz.byteLength,
      runLength: 1
    });
    tileBuffers.push(gz);
    tileOffset += gz.byteLength;
  }

  const rootDirGz = gzipSync(serializeDirectory(entries), { level: 9 });
  const metaGz = gzipSync(Buffer.from(JSON.stringify(metadata), "utf8"), { level: 9 });
  const tileDataBuf = Buffer.concat(tileBuffers);

  const HEADER_SIZE = 127;
  const rootDirOffset = HEADER_SIZE;
  const rootDirLength = rootDirGz.byteLength;
  const metaOffset = rootDirOffset + rootDirLength;
  const metaLength = metaGz.byteLength;
  const leafDirOffset = metaOffset + metaLength;
  const leafDirLength = 0;
  const tileDataOffset = leafDirOffset;
  const tileDataLength = tileDataBuf.byteLength;

  const header = Buffer.alloc(HEADER_SIZE);
  header.write("PMTiles", 0, "ascii");
  header.writeUInt8(3, 7); // spec version 3
  header.writeBigUInt64LE(BigInt(rootDirOffset), 8);
  header.writeBigUInt64LE(BigInt(rootDirLength), 16);
  header.writeBigUInt64LE(BigInt(metaOffset), 24);
  header.writeBigUInt64LE(BigInt(metaLength), 32);
  header.writeBigUInt64LE(BigInt(leafDirOffset), 40);
  header.writeBigUInt64LE(BigInt(leafDirLength), 48);
  header.writeBigUInt64LE(BigInt(tileDataOffset), 56);
  header.writeBigUInt64LE(BigInt(tileDataLength), 64);
  header.writeBigUInt64LE(BigInt(entries.length), 72); // addressed tiles
  header.writeBigUInt64LE(BigInt(entries.length), 80); // tile entries
  header.writeBigUInt64LE(BigInt(entries.length), 88); // tile contents
  header.writeUInt8(1, 96); // clustered = true
  header.writeUInt8(Compression.Gzip, 97); // internal compression
  header.writeUInt8(Compression.Gzip, 98); // tile compression
  header.writeUInt8(TileType.Mvt, 99); // MVT vector tiles
  header.writeUInt8(minZoom, 100);
  header.writeUInt8(maxZoom, 101);
  // Bounds in E7 fixed point (minLon, minLat, maxLon, maxLat)
  header.writeInt32LE(Math.round(-180 * 1e7), 102);
  header.writeInt32LE(Math.round(-85 * 1e7), 106);
  header.writeInt32LE(Math.round(180 * 1e7), 110);
  header.writeInt32LE(Math.round(85 * 1e7), 114);
  // Center zoom + center lon/lat (Kyiv / Ukraine center)
  header.writeUInt8(5, 118);
  header.writeInt32LE(Math.round(31.2 * 1e7), 119);
  header.writeInt32LE(Math.round(48.8 * 1e7), 123);

  return Buffer.concat([header, rootDirGz, metaGz, tileDataBuf]);
};

async function main() {
  const buildsRes = await fetch("https://build-metadata.protomaps.dev/builds.json", {
    signal: AbortSignal.timeout(15_000)
  });
  const builds = await buildsRes.json();
  const latest = builds[builds.length - 1];
  const srcUrl = `https://build.protomaps.com/${latest.key}`;
  console.log(`Extracting z0..z${MAX_ZOOM} Ukraine overview from Protomaps ${latest.key} (v${latest.version})...`);

  const src = new PMTiles(srcUrl);
  const srcMeta = await src.getMetadata();

  const tiles = [];
  for (let z = 0; z <= MAX_ZOOM; z++) {
    const xMin = z <= 1 ? 0 : lon2x(BBOX.minLon, z);
    const xMax = z <= 1 ? (1 << z) - 1 : lon2x(BBOX.maxLon, z);
    const yMin = z <= 1 ? 0 : lat2y(BBOX.maxLat, z);
    const yMax = z <= 1 ? (1 << z) - 1 : lat2y(BBOX.minLat, z);
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        const res = await src.getZxy(z, x, y);
        if (res?.data && res.data.byteLength > 0) {
          tiles.push({ z, x, y, tileId: zxyToTileId(z, x, y), data: new Uint8Array(res.data) });
        }
      }
    }
  }

  const archiveBuf = buildPmTilesV3({
    tiles,
    metadata: {
      ...(typeof srcMeta === "object" && srcMeta ? srcMeta : {}),
      name: "Eye Radar Ukraine Protomaps Overview",
      attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>'
    },
    minZoom: 0,
    maxZoom: MAX_ZOOM
  });

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, archiveBuf);
  console.log(`Wrote ${OUT_PATH} (${(archiveBuf.byteLength / 1024).toFixed(1)} KB, ${tiles.length} tiles)`);

  // Verify round-trip read using official pmtiles reader!
  const fileBytes = readFileSync(OUT_PATH);
  const memSource = {
    getKey: () => OUT_PATH,
    async getBytes(offset, length) {
      const slice = fileBytes.subarray(offset, offset + length);
      return { data: slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) };
    }
  };
  const verified = new PMTiles(memSource);
  const hdr = await verified.getHeader();
  const meta = await verified.getMetadata();
  let okCount = 0;
  for (const t of tiles) {
    const got = await verified.getZxy(t.z, t.x, t.y);
    if (!got?.data || got.data.byteLength !== t.data.byteLength) {
      throw new Error(`Tile verification mismatch at ${t.z}/${t.x}/${t.y}`);
    }
    okCount++;
  }
  console.log(
    `VERIFIED PMTiles v${hdr.specVersion}: ${okCount}/${tiles.length} tiles byte-exact, z${hdr.minZoom}-z${hdr.maxZoom}, layers=${meta?.vector_layers?.length ?? 0}`
  );
}

main().catch((err) => {
  console.error("Extract failed:", err);
  process.exit(1);
});
