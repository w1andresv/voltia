import type { TripConditions } from "../../types";

/** Perfil de velocidad (especificación §5.3): lo produce engines/speed y lo consume engines/energy. */
export type DrivingMode = TripConditions["drivingStyle"];

export type LimitingFactor =
  | "speed_limit"
  | "road_class_default"
  | "traffic"
  | "curvature"
  | "acceleration"
  | "deceleration"
  | "stop";

export interface SpeedProfilePoint {
  km: number;
  speedKmh: number;
  targetKmh: number;
  /** Aceleración del tramo [i, i+1], m/s². */
  accelerationMs2: number;
  limitingFactor: LimitingFactor;
}

export interface SpeedProfile {
  points: SpeedProfilePoint[];
  drivingMode: DrivingMode;
  durationMinutes: number;
}
