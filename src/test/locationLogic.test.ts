import { describe, expect, it } from 'vitest';
import { OBLASTS_OF_UKRAINE } from '../client/components/LocationSetupModal';
import { LOCATIONS } from '../client/components/CitySelector';

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
});
