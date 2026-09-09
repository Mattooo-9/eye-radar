interface KalmanState {
  x: number[];
  p: number[][];
  timestamp: number;
}

const identity4 = (): number[][] => [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1]
];

const multiplyMatrix = (a: number[][], b: number[][]): number[][] =>
  a.map((row) =>
    b[0].map((_, col) => row.reduce((sum, value, index) => sum + value * b[index][col], 0))
  );

const multiplyVector = (matrix: number[][], vector: number[]): number[] =>
  matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));

const transpose = (matrix: number[][]): number[][] =>
  matrix[0].map((_, index) => matrix.map((row) => row[index]));

const subtractMatrix = (a: number[][], b: number[][]): number[][] =>
  a.map((row, rowIndex) => row.map((value, colIndex) => value - b[rowIndex][colIndex]));

const addMatrix = (a: number[][], b: number[][]): number[][] =>
  a.map((row, rowIndex) => row.map((value, colIndex) => value + b[rowIndex][colIndex]));

const invert2 = (matrix: number[][]): number[][] => {
  const [[a, b], [c, d]] = matrix;
  const determinant = a * d - b * c || 1e-9;
  return [
    [d / determinant, -b / determinant],
    [-c / determinant, a / determinant]
  ];
};

export interface FilterResult {
  lat: number;
  lon: number;
  velocityLat: number;
  velocityLon: number;
  uncertaintyRadiusMeters: number;
  covLat: number;
  covLon: number;
}

export class KalmanFilter2D {
  private state?: KalmanState;

  constructor(
    private readonly processNoise = 0.0001,
    private readonly measurementNoise = 0.005
  ) {}

  reset(): void {
    this.state = undefined;
  }

  getState(): KalmanState | undefined {
    return this.state;
  }

  private calculateUncertainty(lat: number, p: number[][]): { radius: number; covLat: number; covLon: number } {
    const covLat = Math.max(0, p[0][0]);
    const covLon = Math.max(0, p[1][1]);
    const stdLatDeg = Math.sqrt(covLat);
    const stdLonDeg = Math.sqrt(covLon);

    const latMeters = stdLatDeg * 111_139;
    const lonMeters = stdLonDeg * 111_139 * Math.cos((lat * Math.PI) / 180);

    const radius = Math.max(200, Math.min(50_000, Math.sqrt(latMeters ** 2 + lonMeters ** 2)));

    return { radius, covLat, covLon };
  }

  predict(timestamp: number): FilterResult | null {
    if (!this.state) {
      return null;
    }

    const dt = Math.max((timestamp - this.state.timestamp) / 1000, 0.1);
    const f = [
      [1, 0, dt, 0],
      [0, 1, 0, dt],
      [0, 0, 1, 0],
      [0, 0, 0, 1]
    ];

    const q = [
      [this.processNoise * (dt ** 3) / 3, 0, this.processNoise * (dt ** 2) / 2, 0],
      [0, this.processNoise * (dt ** 3) / 3, 0, this.processNoise * (dt ** 2) / 2],
      [this.processNoise * (dt ** 2) / 2, 0, this.processNoise * dt, 0],
      [0, this.processNoise * (dt ** 2) / 2, 0, this.processNoise * dt]
    ];

    const predictedX = multiplyVector(f, this.state.x);
    const predictedP = addMatrix(multiplyMatrix(multiplyMatrix(f, this.state.p), transpose(f)), q);

    this.state = { x: predictedX, p: predictedP, timestamp };

    const { radius, covLat, covLon } = this.calculateUncertainty(predictedX[0], predictedP);

    return {
      lat: predictedX[0],
      lon: predictedX[1],
      velocityLat: predictedX[2],
      velocityLon: predictedX[3],
      uncertaintyRadiusMeters: radius,
      covLat,
      covLon
    };
  }

  update(
    timestamp: number,
    measurementLat: number,
    measurementLon: number
  ): FilterResult {
    if (!this.state) {
      const initialP = [
        [0.001, 0, 0, 0],
        [0, 0.001, 0, 0],
        [0, 0, 0.01, 0],
        [0, 0, 0, 0.01]
      ];

      this.state = {
        x: [measurementLat, measurementLon, 0, 0],
        p: initialP,
        timestamp
      };

      const { radius, covLat, covLon } = this.calculateUncertainty(measurementLat, initialP);

      return {
        lat: measurementLat,
        lon: measurementLon,
        velocityLat: 0,
        velocityLon: 0,
        uncertaintyRadiusMeters: radius,
        covLat,
        covLon
      };
    }

    const dt = Math.max((timestamp - this.state.timestamp) / 1000, 0.1);
    const f = [
      [1, 0, dt, 0],
      [0, 1, 0, dt],
      [0, 0, 1, 0],
      [0, 0, 0, 1]
    ];

    const q = [
      [this.processNoise * (dt ** 3) / 3, 0, this.processNoise * (dt ** 2) / 2, 0],
      [0, this.processNoise * (dt ** 3) / 3, 0, this.processNoise * (dt ** 2) / 2],
      [this.processNoise * (dt ** 2) / 2, 0, this.processNoise * dt, 0],
      [0, this.processNoise * (dt ** 2) / 2, 0, this.processNoise * dt]
    ];

    const predictedX = multiplyVector(f, this.state.x);
    const predictedP = addMatrix(multiplyMatrix(multiplyMatrix(f, this.state.p), transpose(f)), q);

    const h = [
      [1, 0, 0, 0],
      [0, 1, 0, 0]
    ];

    const r = [
      [this.measurementNoise, 0],
      [0, this.measurementNoise]
    ];

    const z = [measurementLat, measurementLon];
    const y = z.map((value, index) => value - multiplyVector(h, predictedX)[index]);
    const s = addMatrix(multiplyMatrix(multiplyMatrix(h, predictedP), transpose(h)), r);
    const k = multiplyMatrix(multiplyMatrix(predictedP, transpose(h)), invert2(s));

    const correctedX = predictedX.map(
      (value, rowIndex) => value + k[rowIndex].reduce((sum, factor, index) => sum + factor * y[index], 0)
    );
    const correctedP = multiplyMatrix(
      subtractMatrix(identity4(), multiplyMatrix(k, h)),
      predictedP
    );

    this.state = { x: correctedX, p: correctedP, timestamp };

    const { radius, covLat, covLon } = this.calculateUncertainty(correctedX[0], correctedP);

    return {
      lat: correctedX[0],
      lon: correctedX[1],
      velocityLat: correctedX[2],
      velocityLon: correctedX[3],
      uncertaintyRadiusMeters: radius,
      covLat,
      covLon
    };
  }
}
