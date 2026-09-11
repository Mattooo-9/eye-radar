import {
  decodeBinaryTracks,
  decodeBinaryImpacts,
  BINARY_MAGIC
} from "../../common/binaryCodec.js";
import type { CompactTrackPacket } from "../../server/domain/types.js";

interface WorkerScope {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent) => void) | null;
}
const ctx: WorkerScope = self as unknown as WorkerScope;

const tracksMap = new Map<string, CompactTrackPacket>();
let lastSequence = 0;

ctx.onmessage = (event: MessageEvent) => {
  const { type, buffer, payload } = event.data;

  if (type === "RESET") {
    tracksMap.clear();
    lastSequence = 0;
    return;
  }

  if (type === "PROCESS_BINARY" && buffer instanceof ArrayBuffer) {
    try {
      const decoded = decodeBinaryTracks(buffer, tracksMap);

      // Check sequence gap (resync needed if missed >= 2 packets)
      if (lastSequence > 0 && decoded.seq > lastSequence + 2) {
        ctx.postMessage({
          type: "RESYNC_NEEDED",
          expectedSeq: lastSequence + 1,
          receivedSeq: decoded.seq
        });
      }
      lastSequence = decoded.seq;

      // Update internal track map with delta/snapshot
      if (decoded.kind === 0x00) {
        // Snapshot: replace map
        tracksMap.clear();
        for (const t of decoded.tracks) {
          tracksMap.set(t[0], t);
        }
      } else {
        // Delta: merge changes
        for (const t of decoded.tracks) {
          tracksMap.set(t[0], t);
        }
        for (const rid of decoded.removedIds) {
          tracksMap.delete(rid);
        }
      }

      // Convert active tracks map to flat array
      const allTracks = Array.from(tracksMap.values());

      ctx.postMessage({
        type: "TRACKS_UPDATED",
        tracks: allTracks,
        seq: decoded.seq,
        timestamp: decoded.timestamp,
        removedIds: decoded.removedIds
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Incompatible binary protocol version") || message.includes("Invalid binary packet")) {
        ctx.postMessage({
          type: "RESYNC_NEEDED",
          expectedSeq: 0
        });
      }
      ctx.postMessage({
        type: "ERROR",
        message
      });
    }
    return;
  }

  if (type === "PROCESS_IMPACTS" && buffer instanceof ArrayBuffer) {
    try {
      const decoded = decodeBinaryImpacts(buffer);
      ctx.postMessage({
        type: "IMPACTS_UPDATED",
        events: decoded.events,
        timestamp: decoded.timestamp
      });
    } catch (err) {
      ctx.postMessage({
        type: "ERROR",
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }
};
