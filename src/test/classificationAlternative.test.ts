import { describe, expect, it } from 'vitest';
import { classifyAerialObject } from '../server/core/classificationEngine';

describe('Classification Engine with Probabilistic Alternatives & Hysteresis', () => {
  it('correctly classifies standard piston Shahed-136 and provides Shahed-238 as alternative', () => {
    const res = classifyAerialObject({
      claimedType: 'uav',
      speedMs: 175 / 3.6, // ~48.6 m/s
      altitudeM: 150,
      headingDeg: 270,
      sources: ['sdr']
    });

    expect(res.resolvedType).toBe('uav');
    expect(res.resolvedModel).toBe('Shahed-136');
    expect(res.propulsion).toBe('piston');
    expect(res.confidence).toBeGreaterThanOrEqual(0.90);
    expect(res.alternative).toBeDefined();
    expect(res.alternative?.model).toContain('Shahed-238');
  });

  it('correctly classifies high-speed turbojet Shahed-238 with high altitude', () => {
    const res = classifyAerialObject({
      claimedType: 'uav',
      speedMs: 420 / 3.6, // ~116.7 m/s
      altitudeM: 1200,
      headingDeg: 290,
      sources: ['sdr']
    });

    expect(res.resolvedType).toBe('uav');
    expect(res.resolvedModel).toBe('Shahed-238 (Jet)');
    expect(res.propulsion).toBe('turbojet');
    expect(res.confidence).toBeGreaterThanOrEqual(0.90);
    expect(res.alternative).toBeDefined();
  });

  it('applies hysteresis in transitional speed band (260 km/h) without sudden flip to jet', () => {
    // 260 km/h at low altitude (150m) without jet acoustic or hint is a Shahed-136 diving or in tailwind
    const res = classifyAerialObject({
      claimedType: 'uav',
      speedMs: 260 / 3.6,
      altitudeM: 150,
      headingDeg: 310,
      sources: ['osint']
    });

    expect(res.resolvedModel).toBe('Shahed-136');
    expect(res.propulsion).toBe('piston');
    expect(res.alternative?.model).toBe('Shahed-238 (Jet)');
    expect(res.alternative?.confidence).toBeGreaterThan(0.5);
  });

  it('returns UNKNOWN for targets with insufficient kinematic velocity (< 35 km/h)', () => {
    const res = classifyAerialObject({
      claimedType: 'unknown',
      speedMs: 20 / 3.6, // ~5.5 m/s (20 km/h)
      altitudeM: 80,
      headingDeg: 0,
      sources: ['osint']
    });

    expect(res.resolvedType).toBe('unknown');
    expect(res.confidence).toBeLessThan(0.6);
    expect(res.alternative).toBeDefined();
  });

  it('correctly distinguishes cruise missiles and glide bombs (KAB)', () => {
    const cruise = classifyAerialObject({
      claimedType: 'munition',
      speedMs: 820 / 3.6,
      altitudeM: 180,
      headingDeg: 240,
      sources: ['sdr']
    });
    expect(cruise.resolvedType).toBe('munition');
    expect(cruise.resolvedModel).toContain('Х-101');
    expect(cruise.alternative?.type).toBe('uav');

    const kab = classifyAerialObject({
      claimedType: 'bomb',
      speedMs: 550 / 3.6,
      altitudeM: 3200,
      headingDeg: 210,
      sources: ['sdr']
    });
    expect(kab.resolvedType).toBe('bomb');
    expect(kab.resolvedModel).toContain('КАБ');
  });
});
