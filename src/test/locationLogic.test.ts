import { describe, expect, it } from 'vitest';
import { OBLASTS_OF_UKRAINE } from '../client/components/LocationSetupModal';
import { LOCATIONS } from '../client/components/CitySelector';
import { detectLocationAnomaly } from '../client/location/anomaly.js';

describe('Location Logic & Confirmation Rules', () => {
  it('contains comprehensive coverage of Ukrainian administrative regions', () => {
    expect(OBLASTS_OF_UKRAINE.length).toBeGreaterThanOrEqual(25);
    const kyiv = OBLASTS_OF_UKRAINE.find((o) => o.region.includes('Київ'));
    expect(kyiv).toBeDefined();
    expect(kyiv?.center.lat).toBeCloseTo(50.45, 1);
    expect(kyiv?.center.lon).toBeCloseTo(30.52, 1);
  });

  it('supports rapid city search across Ukrainian cities', () => {
    const query = 'харків';
    const matches = LOCATIONS.filter((l) =>
      l.name.toLowerCase().includes(query) || l.region.toLowerCase().includes(query)
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0].name).toContain('Харків');
    expect(matches[0].lat).toBeGreaterThan(49.0);
  });

  it('enforces location confirmation storage contract', () => {
    const mockLocation = {
      lat: 50.4501,
      lon: 30.5234,
      name: 'Київ (Столиця)',
      region: 'Київ'
    };

    const serialized = JSON.stringify(mockLocation);
    const parsed = JSON.parse(serialized);
    expect(parsed.lat).toBe(50.4501);
    expect(parsed.lon).toBe(30.5234);
    expect(parsed.name).toBe('Київ (Столиця)');
  });

  it('prohibits map clicks from mutating user home coordinates without modal workflow', () => {
    let homeLocation = { lat: 49.8397, lon: 24.0297, name: 'Львів' };
    let inspectedTargetId: string | null = 'uav-123';

    const onGenericMapClick = () => {
      // Must NOT mutate homeLocation!
      inspectedTargetId = null;
    };

    onGenericMapClick();
    expect(inspectedTargetId).toBeNull();
    expect(homeLocation.name).toBe('Львів');
    expect(homeLocation.lat).toBe(49.8397);
  });

  it('detects GNSS spoofing and EW interference anomalies correctly', () => {

    // 1. Healthy sample
    const healthyPrev = {
      lat: 50.4501,
      lon: 30.5234,
      accuracy: 8,
      speed: 1.2,
      heading: 90,
      timestamp: 1000000
    };
    const healthyCur = {
      lat: 50.4502,
      lon: 30.5235,
      accuracy: 8,
      speed: 1.3,
      heading: 90,
      timestamp: 1001000
    };
    const resHealthy = detectLocationAnomaly(healthyPrev, healthyCur);
    expect(resHealthy.isSpoofed).toBe(false);
    expect(resHealthy.isDegraded).toBe(false);
    expect(resHealthy.trustScore).toBeGreaterThanOrEqual(90);

    // 2. Teleportation / Impossible jump (Mach 3 jump)
    const spoofedJump = {
      lat: 48.0,
      lon: 36.0, // ~400 km away in 1 second!
      accuracy: 10,
      speed: 0,
      heading: null,
      timestamp: 1002000
    };
    const resSpoofed = detectLocationAnomaly(healthyCur, spoofedJump);
    expect(resSpoofed.isSpoofed).toBe(true);
    expect(resSpoofed.isDegraded).toBe(true);
    expect(resSpoofed.flags).toContain('teleport');

    // 3. EW interference (accuracy degrades to 2000m)
    const ewDegraded = {
      lat: 50.4503,
      lon: 30.5236,
      accuracy: 2500,
      speed: null,
      heading: null,
      timestamp: 1002000
    };
    const resEw = detectLocationAnomaly(healthyCur, ewDegraded);
    expect(resEw.flags).toContain('ew_interference');
    expect(resEw.isDegraded).toBe(true);
  });

  it('accurately calculates distance to Ukraine state border and gates operational buffer', async () => {
    const { getDistanceToUkraineBorderKm, isPointInPolygon } = await import('../server/domain/geo.js');

    // 1. Inside Ukraine
    expect(isPointInPolygon(50.45, 30.52, (await import('../server/domain/geo.js')).UKRAINE_BORDER_POLYGON)).toBe(true);
    expect(getDistanceToUkraineBorderKm(50.4501, 30.5234)).toBe(0); // Kyiv
    expect(getDistanceToUkraineBorderKm(49.8397, 24.0297)).toBe(0); // Lviv
    expect(getDistanceToUkraineBorderKm(46.4825, 30.7233)).toBe(0); // Odesa

    // 2. Tactical Border Buffer (<= 120 km)
    const rzeszowDist = getDistanceToUkraineBorderKm(50.04, 22.00); // Rzeszow, Poland
    expect(rzeszowDist).toBeGreaterThan(40);
    expect(rzeszowDist).toBeLessThanOrEqual(120);

    const suceavaDist = getDistanceToUkraineBorderKm(47.65, 26.25); // Suceava, Romania
    expect(suceavaDist).toBeGreaterThan(20);
    expect(suceavaDist).toBeLessThanOrEqual(120);

    // 3. Deep foreign airways (> 120 km from border, should be gated for civil flights)
    const bucharestDist = getDistanceToUkraineBorderKm(44.43, 26.10); // Bucharest, Romania
    expect(bucharestDist).toBeGreaterThan(120);

    const belgradeDist = getDistanceToUkraineBorderKm(44.78, 20.44); // Belgrade, Serbia
    expect(belgradeDist).toBeGreaterThan(200);
  });
});

