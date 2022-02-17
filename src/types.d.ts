// See https://docs.battlesnake.com/references/api for all details and examples.

export interface InfoResponse {
  apiversion: string;
  author?: string;
  color?: string;
  head?: string;
  tail?: string;
  version?: string;
}

export interface MoveResponse {
  move: string;
  shout?: string;
}

export interface RoyaleSettings {
  shrinkEveryNTurns?: number;
}

export interface SquadSettings {
  allowBodyCollisions: boolean;
  sharedElimination: boolean;
  sharedHealth: boolean;
  sharedLength: boolean;
}

export interface RulesetSettings {
  foodSpawnChance: number;
  minimumFood: number;
  hazardDamagePerTurn?: number;
  royale: RoyaleSettings;
  squad: SquadSettings;
  map?: string; // map is not implemented yet, but making this optional should allow us to include it preemptively
  map_author?: string; // as with map, not implemented yet, but should be safe to be optional
}

export interface Ruleset {
  name: string;
  version: string;
  settings: RulesetSettings;
}

export interface Game {
  id: string;
  ruleset: Ruleset;
  timeout: number;
  source: string;
}

export interface ICoord {
  x: number;
  y: number;
}

export interface IBattlesnake {
  id: string;
  name: string;
  health: number;
  body: ICoord[];
  latency: string;
  head: ICoord;
  length: number;

  // Used in non-standard game modes
  shout: string;
  squad: string;
}

export interface Board {
  height: number;
  width: number;
  food: ICoord[];
  snakes: Battlesnake[];

  // Used in non-standard game modes
  hazards: ICoord[];
}

export interface GameState {
  game: Game;
  turn: number;
  board: Board;
  you: Battlesnake;
}

export interface SnakeScoreMongoAggregateId {
  hashKey: string
}

export interface SnakeScoreMongoAggregate {
  _id: SnakeScoreMongoAggregateId;
  averageScore: number;
}
