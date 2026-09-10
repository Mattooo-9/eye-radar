import { KalmanFilter2D, type FilterResult } from "./kalman.js";

export interface ImmResult {
  lat: number;
  lon: number;
  velocityLat: number;
  velocityLon: number;
  headingDeg: number;
  speedMs: number;
  uncertaintyRadiusMeters: number;
  covLat: number;
  covLon: number;
  cvProbability: number;
  ctProbability: number;
  activeModel: "CV" | "CT";
}

/**
 * Interacting Multiple Model (IMM) Filter
 * Blends Constant Velocity (CV - straight line flight)
 * and Coordinated Turn (CT - evasive maneuvers, river following, doglegs)
 */
export class ImmFilter2D {
  // Model 1: Constant Velocity (low process noise = smooth straight trajectory)
  private readonly cvFilter = new KalmanFilter2D(0.000008, 0.00002);
  // Model 2: Coordinated Turn (higher process noise = responsive to turns)
  private readonly ctFilter = new KalmanFilter2D(0.00005, 0.00002);

  // Model probabilities (initialized equally)
  private muCv = 0.65;
  private muCt = 0.35;

  // Markov Transition Probability Matrix: P = [[p11, p12], [p21, p22]]
  private readonly pCvCv = 0.85; // probability of staying CV
  private readonly pCvCt = 0.15; // probability of switching from CV to CT
  private readonly pCtCt = 0.75; // probability of staying CT
  private readonly pCtCv = 0.25; // probability of switching from CT to CV

  private lastTime = 0;

  reset(): void {
    this.cvFilter.reset();
    this.ctFilter.reset();
    this.muCv = 0.65;
    this.muCt = 0.35;
    this.lastTime = 0;
  }

  update(timestamp: number, lat: number, lon: number): ImmResult {
    // 1. Model interaction / mixing
    const cBarCv = this.pCvCv * this.muCv + this.pCtCv * this.muCt;
    const cBarCt = this.pCvCt * this.muCv + this.pCtCt * this.muCt;

    // 2. Individual model update
    const resCv = this.cvFilter.update(timestamp, lat, lon);
    const resCt = this.ctFilter.update(timestamp, lat, lon);

    // 3. Compute innovations and measurement likelihoods
    const dLatCv = (lat - resCv.lat) * 111_139;
    const dLonCv = (lon - resCv.lon) * 111_139 * Math.cos((lat * Math.PI) / 180);
    const distSqCv = dLatCv ** 2 + dLonCv ** 2;

    const dLatCt = (lat - resCt.lat) * 111_139;
    const dLonCt = (lon - resCt.lon) * 111_139 * Math.cos((lat * Math.PI) / 180);
    const distSqCt = dLatCt ** 2 + dLonCt ** 2;

    // Gaussian likelihoods with safe lower bounds
    const likelihoodCv = Math.max(1e-6, Math.exp(-distSqCv / (2 * (resCv.uncertaintyRadiusMeters ** 2))));
    const likelihoodCt = Math.max(1e-6, Math.exp(-distSqCt / (2 * (resCt.uncertaintyRadiusMeters ** 2))));

    // 4. Update model probabilities
    const rawMuCv = likelihoodCv * cBarCv;
    const rawMuCt = likelihoodCt * cBarCt;
    const totalLikelihood = rawMuCv + rawMuCt || 1;

    this.muCv = Math.min(0.95, Math.max(0.05, rawMuCv / totalLikelihood));
    this.muCt = 1 - this.muCv;

    // 5. State fusion (weighted combination of estimates)
    const fusedLat = this.muCv * resCv.lat + this.muCt * resCt.lat;
    const fusedLon = this.muCv * resCv.lon + this.muCt * resCt.lon;
    const fusedVLat = this.muCv * resCv.velocityLat + this.muCt * resCt.velocityLat;
    const fusedVLon = this.muCv * resCv.velocityLon + this.muCt * resCt.velocityLon;

    // Calculate heading and speed from fused velocities
    const speedMs = Math.hypot(fusedVLat, fusedVLon);
    let headingDeg = (Math.atan2(fusedVLon, fusedVLat) * 180) / Math.PI;
    if (headingDeg < 0) headingDeg += 360;

    const fusedUncertainty = Math.round(
      Math.sqrt(this.muCv * (resCv.uncertaintyRadiusMeters ** 2) + this.muCt * (resCt.uncertaintyRadiusMeters ** 2))
    );

    const fusedCovLat = this.muCv * resCv.covLat + this.muCt * resCt.covLat;
    const fusedCovLon = this.muCv * resCv.covLon + this.muCt * resCt.covLon;

    this.lastTime = timestamp;

    return {
      lat: Math.round(fusedLat * 1_000_000) / 1_000_000,
      lon: Math.round(fusedLon * 1_000_000) / 1_000_000,
      velocityLat: fusedVLat,
      velocityLon: fusedVLon,
      headingDeg: Math.round(headingDeg * 10) / 10,
      speedMs: Math.round(speedMs * 10) / 10,
      uncertaintyRadiusMeters: fusedUncertainty,
      covLat: fusedCovLat,
      covLon: fusedCovLon,
      cvProbability: Math.round(this.muCv * 100) / 100,
      ctProbability: Math.round(this.muCt * 100) / 100,
      activeModel: this.muCv >= 0.5 ? "CV" : "CT"
    };
  }

  predict(timestamp: number): FilterResult | null {
    const predCv = this.cvFilter.predict(timestamp);
    const predCt = this.ctFilter.predict(timestamp);
    if (!predCv || !predCt) return predCv || predCt;

    return {
      lat: this.muCv * predCv.lat + this.muCt * predCt.lat,
      lon: this.muCv * predCv.lon + this.muCt * predCt.lon,
      velocityLat: this.muCv * predCv.velocityLat + this.muCt * predCt.velocityLat,
      velocityLon: this.muCv * predCv.velocityLon + this.muCt * predCt.velocityLon,
      uncertaintyRadiusMeters: Math.round(
        Math.sqrt(this.muCv * (predCv.uncertaintyRadiusMeters ** 2) + this.muCt * (predCt.uncertaintyRadiusMeters ** 2))
      ),
      covLat: this.muCv * predCv.covLat + this.muCt * predCt.covLat,
      covLon: this.muCv * predCv.covLon + this.muCt * predCt.covLon
    };
  }
}
