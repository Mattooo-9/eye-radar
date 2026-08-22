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

export class KalmanFilter2D {
  private state?: KalmanState;

  constructor(
    private readonly processNoise = 2.5,
    private readonly measurementNoise = 18
  ) {}

  reset(): void {
    this.state = undefined;
  }

  update(
    timestamp: number,
    measurementLat: number,
    measurementLon: number
  ): { lat: number; lon: number; velocityLat: number; velocityLon: number } {
    if (!this.state) {
      this.state = {
        x: [measurementLat, measurementLon, 0, 0],
        p: identity4().map((row) => row.map((value) => value * 100)),
        timestamp
      };

      return {
        lat: measurementLat,
        lon: measurementLon,
        velocityLat: 0,
        velocityLon: 0
      };
    }

    const dt = Math.max((timestamp - this.state.timestamp) / 1000, 0.25);
    const f = [
      [1, 0, dt, 0],
      [0, 1, 0, dt],
      [0, 0, 1, 0],
      [0, 0, 0, 1]
    ];

    const q = [
      [this.processNoise * dt, 0, 0, 0],
      [0, this.processNoise * dt, 0, 0],
      [0, 0, this.processNoise, 0],
      [0, 0, 0, this.processNoise]
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

    return {
      lat: correctedX[0],
      lon: correctedX[1],
      velocityLat: correctedX[2],
      velocityLon: correctedX[3]
    };
  }
}
