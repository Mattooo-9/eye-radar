let cachedTileUrl: string | null = null;
let lastFetchTime = 0;

export const getLiveWeatherRadarTileUrl = async (): Promise<string | null> => {
  const now = Date.now();
  // Cache for 4 minutes
  if (cachedTileUrl && now - lastFetchTime < 240_000) {
    return cachedTileUrl;
  }

  try {
    const res = await fetch("https://api.rainviewer.com/public/weather-maps.json", {
      signal: AbortSignal.timeout(4500)
    });
    if (res.ok) {
      const data = await res.json();
      const past = data?.radar?.past;
      const host = data?.host || "https://tilecache.rainviewer.com";
      if (Array.isArray(past) && past.length > 0) {
        const latest = past[past.length - 1];
        if (latest?.path) {
          // Color scheme 2 (Universal Blue/Green/Yellow/Orange/Red), smooth 1, snow 1
          cachedTileUrl = `${host}${latest.path}/256/{z}/{x}/{y}/2/1_1.png`;
          lastFetchTime = now;
          return cachedTileUrl;
        }
      }
    }
  } catch {
    // Fallback if offline or timeout
  }

  return cachedTileUrl;
};
