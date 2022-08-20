
import { ICoord, IBattlesnake, Board, GameState } from "./types"
import { logToFile, coordsEqual, snakeHasEaten, getSnakeScoreHashKey, getSurroundingCells, gameStateIsWrapped, gameStateIsConstrictor, gameStateIsHazardSpiral, gameStateIsArcadeMaze, gameStateIsSinkhole, createGameDataId, getAvailableMoves, getAvailableMovesHealth, getHazardDamage, getSinkholeNumber } from "./util"
import { gameData } from "./logic"

import { createWriteStream, WriteStream } from 'fs';
let consoleWriteStream = createWriteStream("consoleLogs_classes.txt", {
  encoding: "utf8"
})

export enum Direction {
  Up,
  Down,
  Left,
  Right,
  AlreadyMoved
}

export function directionToString(dir: Direction): string | undefined {
  switch (dir) {
    case Direction.Up:
      return "up"
    case Direction.Down:
      return "down"
    case Direction.Left:
      return "left"
    case Direction.Right:
      return "right"
    case Direction.AlreadyMoved:
      return "alreadyMoved"
    default:
      return undefined
  }
}

export function stringToDirection(str: string): Direction | undefined {
  switch (str) {
    case "up":
      return Direction.Up
    case "down":
      return Direction.Down
    case "left":
      return Direction.Left
    case "right":
      return Direction.Right
    case "alreadyMoved":
      return Direction.AlreadyMoved
    default:
      return undefined
  }
}

export enum KissOfDeathState {
  kissOfDeathNo,
  kissOfDeathMaybe,
  kissOfDeathMaybeMutual,
  kissOfDeathCertainty,
  kissOfDeathCertaintyMutual,
  kissOfDeath3To2Avoidance,
  kissOfDeath3To1Avoidance,
  kissOfDeath2To1Avoidance
}

export enum KissOfMurderState {
  kissOfMurderNo,
  kissOfMurderMaybe,
  kissOfMurderAvoidance,
  kissOfMurderFaceoff,
  kissOfMurderCertainty
}

export enum FoodCountTier {
  zero,
  less4,
  less7,
  lots
}

export enum HazardCountTier {
  zero,
  less31,
  less61,
  lots
}

export class Coord implements ICoord {
  x: number;
  y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  toString() : string {
    return `(${this.x},${this.y})`
  }
}

export class MoveWithEval {
  direction: Direction | undefined
  score: number | undefined
  evaluationResult: EvaluationResult | undefined

  constructor(direction: Direction | undefined, score: number | undefined, evaluationResult?: EvaluationResult) {
    this.direction = direction
    this.score = score
    this.evaluationResult = evaluationResult
  }

  toString() : string {
    if (this.direction === undefined) {
      return `Direction: undefined, score: ${this.score}`
    } else {
      return `Direction: ${directionToString(this.direction)}, score: ${this.score}`
    }
  }
}

export class Battlesnake implements IBattlesnake {
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

  constructor(id: string, name: string, health: number, body: ICoord[], latency: string, shout: string, squad: string) {
    this.id = id;
    this.name = name;
    this.health = health;
    this.body = body;
    this.latency = latency;
    this.head = body[0]
    this.length = body.length
    this.shout = shout;
    this.squad = squad;
  }
}

export class SnakeCell {
  snake: Battlesnake
  bodyIndex: number
  isHead: boolean
  isTail: boolean
  hasEaten: boolean

  constructor(snake: Battlesnake, bodyIndex: number) {
    this.snake = snake
    this.hasEaten = snakeHasEaten(snake)
    this.bodyIndex = bodyIndex
    this.isHead = bodyIndex === 0 // is head if bodyIndex is front of the array
    this.isTail = bodyIndex === (snake.length - 1) // is tail is bodyIndex is end of the array
  }
}

export class VoronoiSnake {
  snake: Battlesnake
  depth: number
  effectiveLength: number
  effectiveHealth: number
  tailOffset: number | undefined

  constructor(snake: Battlesnake, depth: number, effectiveLength: number, effectiveHealth: number, tailOffset: number | undefined) {
    this.snake = snake
    this.depth = depth
    this.effectiveLength = effectiveLength
    this.effectiveHealth = effectiveHealth
    this.tailOffset = tailOffset
  }
}

export class BoardCell {
  snakeCell?: SnakeCell;
  food: boolean;
  hazard: number; // used to be a boolean, but since introducing stacked hazards with sinkhole, now we count the number of hazards per square
  coord: Coord;
  voronoi: {[key: string]: VoronoiSnake} // will populate when calculating VoronoiCells. Most of the time this will be a single snake, but due to ties, can possibly hold multiple
  voronoiDepth: number | undefined

  constructor(_coord: Coord, _food: boolean, _hazard: number, _snakeCell?: SnakeCell) {
    this.snakeCell = _snakeCell;
    this.food = _food;
    this.hazard = _hazard;
    this.coord = _coord;
    this.voronoi = {}
    this.voronoiDepth = undefined
  }

  logSelf(str? : string) : string {
    let ret : string
    if (str !== undefined) {
      ret = `${str}; BoardCell at (${this.coord.x},${this.coord.y}) has snake: ${!!this.snakeCell}; has food: ${this.food}; has hazard: ${this.hazard}`
    } else {
      ret = `BoardCell at (${this.coord.x},${this.coord.y}) has snake: ${!!this.snakeCell}; has food: ${this.food}; has hazard: ${this.hazard}`
    }
    logToFile(consoleWriteStream, ret);
    return ret
  }
}

export class VoronoiResultsSnakeTailOffset {
  tailOffset: number
  voronoiValue: number

  constructor(tailOffset: number, voronoiValue: number) {
    this.tailOffset = tailOffset
    this.voronoiValue = voronoiValue
  }
}

export class VoronoiResultsSnake {
  reachableCells: number
  food: {[key: number] : Coord[]}
  tailOffsets: {[key: string]: {[key: number]: VoronoiResultsSnakeTailOffset[] }} // when occupying a space that used to be a snake, this represents the distance from that snake's tail. Keep track of snake ID whose body we are occupying too.
  // the first key is by snake ID, for grouping by whose body this was. The second key is by depth, for grouping by the depth this body part was found. Finally within is an array, as there can be multiple body parts per depth
  tailChases: number[]
  effectiveHealths: number[]

  constructor() {
    this.reachableCells = 0
    this.food = {}
    this.tailChases = []
    this.effectiveHealths = []
    this.tailOffsets = {}
  }
}

export class VoronoiResults {
  snakeResults: {[key: string]: VoronoiResultsSnake}
  totalReachableCells: number // due to hazard & hazard food penalties, this number will not be equivalent to board dimensions

  constructor() {
    this.snakeResults = {}
    this.totalReachableCells = 0
  }
}

export class Board2d {
  private cells: Array<BoardCell>;
  width: number
  height: number
  hazardDamage: number
  numHazards: number // used to keep track of hazards, particularly in stacked hazard games like sinkhole where we can't just get board.hazards.length
  isWrapped: boolean // needs to be an attribute because getCell uses it after instantiation

  constructor(gameState: GameState, populateVoronoi?: boolean) {
    let board: Board = gameState.board
    let expansionRate: number | undefined = gameState.game.ruleset.settings.royale.shrinkEveryNTurns
    this.width = board.width;
    this.height = board.height;
    this.hazardDamage = getHazardDamage(gameState)
    this.numHazards = 0
    this.isWrapped = gameStateIsWrapped(gameState)
    let isConstrictor: boolean = gameStateIsConstrictor(gameState)
    let isArcadeMaze: boolean = gameStateIsArcadeMaze(gameState)
    let isSinkhole: boolean = gameStateIsSinkhole(gameState)
    let sinkholeLatestSpawnTurn: number | undefined = (isSinkhole && expansionRate !== undefined && gameState.board.height === 11 && gameState.board.width === 11)?
      (2 + expansionRate * 4) : undefined // sinkhole map only works on 11x11 boards, & only if shrink turns are provided
    this.cells = new Array(this.width * this.height);
    let self : Board2d = this

    let isHazardSpiral: boolean = gameStateIsHazardSpiral(gameState)
    let hazardSpiral: HazardSpiral | undefined
    if (isHazardSpiral) {
      let gameDataId = createGameDataId(gameState)
      let thisGameData: GameData | undefined = gameData[gameDataId]
      if (thisGameData) {
        hazardSpiral = thisGameData.hazardSpiral
      }
    }

    let voronoiPoints: BoardCell[] = [] // for Voronoi points, the starting points are each of the snake heads
    let snakePossibleEats: {[key: string]: number} = {} // for Voronoi points, keeps track of times snake may have eaten up until this depth

    function processSnake(inputSnake : Battlesnake) : void {
      for (let idx: number = 0, len: number = inputSnake.body.length; idx < len; idx++) {
        let part: Coord = inputSnake.body[idx]   
        let isHead: boolean = coordsEqual(part, inputSnake.head)
        let newSnakeCell = new SnakeCell(inputSnake, idx)
        let board2dCell = self.getCell(part)
        if (board2dCell) {
          // wild edge case - when repicking a murdered otherSnake, myself has already moved once, possibly onto another snake tail. Need to not replace my head with otherSnake tail.
          if (!(board2dCell.snakeCell !== undefined && board2dCell.snakeCell.snake.id !== newSnakeCell.snake.id && newSnakeCell.isTail)) {
            //logToFile(consoleWriteStream, `wild edge case not replacing snake ${board2dCell.snakeCell.snake.name} at (${part.x},${part.y})`)
            board2dCell.snakeCell = newSnakeCell
          }
          if (isHead && populateVoronoi) {
            board2dCell.voronoi[inputSnake.id] = new VoronoiSnake(inputSnake, 0, inputSnake.length, inputSnake.health, undefined) // as this is a snake head, this is a starting Voronoi point, populate it with inputSnake at depth 0
            board2dCell.voronoiDepth = 0
            voronoiPoints.push(board2dCell)
            snakePossibleEats[inputSnake.id] = 0 // initialize snakePossibleEats. Even if snake has just eaten, that is not a 'possible' eat, it's already reflected in snake length, so this always starts at 0
          }
        }
      }
    }

    board.snakes.forEach(processSnake)

    for (const coord of board.food) {
      let board2dCell = self.getCell(coord);
      if (board2dCell instanceof BoardCell) {
        board2dCell.food = true;
      }
    }

    if (isHazardSpiral) {
      let gameDataId = createGameDataId(gameState)
      let thisGameData = gameData? gameData[gameDataId] : undefined
      if (thisGameData !== undefined) {
        let hazardSpiral = thisGameData.hazardSpiral
        if (hazardSpiral !== undefined) {
          for (let i: number = 0; i < hazardSpiral.width; i++) {
            for (let j: number = 0; j < hazardSpiral.height; j++) {
              let coord = new Coord(i, j)
              let hazardSpiralCell = hazardSpiral.getCell(coord)
              let board2dCell = self.getCell(coord)
              if (hazardSpiralCell !== undefined && board2dCell !== undefined) { // if this coord exists in the HazardSpiral & the Board2d, should add its hazard to Board2d
                if (gameState.turn >= hazardSpiralCell.turnIsHazard) { // if gameState is far enough along, this cell is a hazard
                  this.numHazards = this.numHazards + 1
                  board2dCell.hazard = 1 // hazard spiral doesn't currently support stacked hazards, so can just set to 1 rather than adding together
                }
              }
            }
          }
        } // no need for else, if hazardSpiral is undefined in a hazardSpiral game, that just means there haven't been any hazards yet
      }
    } else if (isSinkhole && sinkholeLatestSpawnTurn !== undefined && expansionRate !== undefined) { // give hardcoded hazards based on gameState turn, if we know we can predict them
      let hazards: Coord[]
      if (gameState.turn >= (2 + expansionRate * 4)) {
        hazards = [{"x":5,"y":5},{"x":4,"y":5},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":6,"y":5},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":3,"y":2},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":3,"y":7},{"x":3,"y":8},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":4,"y":8},{"x":5,"y":2},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":5,"y":8},{"x":6,"y":2},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":6,"y":8},{"x":7,"y":2},{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":7,"y":7},{"x":7,"y":8},{"x":8,"y":3},{"x":8,"y":4},{"x":8,"y":5},{"x":8,"y":6},{"x":8,"y":7},{"x":1,"y":2},{"x":1,"y":3},{"x":1,"y":4},{"x":1,"y":5},{"x":1,"y":6},{"x":1,"y":7},{"x":1,"y":8},{"x":2,"y":1},{"x":2,"y":2},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":2,"y":8},{"x":2,"y":9},{"x":3,"y":1},{"x":3,"y":2},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":3,"y":7},{"x":3,"y":8},{"x":3,"y":9},{"x":4,"y":1},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":4,"y":8},{"x":4,"y":9},{"x":5,"y":1},{"x":5,"y":2},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":5,"y":8},{"x":5,"y":9},{"x":6,"y":1},{"x":6,"y":2},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":6,"y":8},{"x":6,"y":9},{"x":7,"y":1},{"x":7,"y":2},{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":7,"y":7},{"x":7,"y":8},{"x":7,"y":9},{"x":8,"y":1},{"x":8,"y":2},{"x":8,"y":3},{"x":8,"y":4},{"x":8,"y":5},{"x":8,"y":6},{"x":8,"y":7},{"x":8,"y":8},{"x":8,"y":9},{"x":9,"y":2},{"x":9,"y":3},{"x":9,"y":4},{"x":9,"y":5},{"x":9,"y":6},{"x":9,"y":7},{"x":9,"y":8}]
      } else if (gameState.turn >= (2 + expansionRate * 3)) {
        hazards = [{"x":5,"y":5},{"x":4,"y":5},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":6,"y":5},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":3,"y":2},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":3,"y":7},{"x":3,"y":8},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":4,"y":8},{"x":5,"y":2},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":5,"y":8},{"x":6,"y":2},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":6,"y":8},{"x":7,"y":2},{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":7,"y":7},{"x":7,"y":8},{"x":8,"y":3},{"x":8,"y":4},{"x":8,"y":5},{"x":8,"y":6},{"x":8,"y":7}]
      } else if (gameState.turn >= (2 + expansionRate * 2)) {
        hazards = [{"x":5,"y":5},{"x":4,"y":5},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":6,"y":5},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6}]
      } else if (gameState.turn >= (2 + expansionRate)) {
        hazards = [{"x":5,"y":5},{"x":4,"y":5},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":6,"y":5}]
      } else if (gameState.turn >= 2) {
        hazards = [{x: 5, y: 5}]
      } else {
        hazards = []
      }
      for (const coord of hazards) {
        let board2dCell = self.getCell(coord)
        if (board2dCell instanceof BoardCell) {
          if (board2dCell.hazard === 0) { // this is a new hazard, increment number of cells on board that have hazard
            this.numHazards = this.numHazards + 1
          }
          board2dCell.hazard = board2dCell.hazard + 1;
        }
      }
    } else {
      for (const coord of gameState.board.hazards) {
        let board2dCell = self.getCell(coord)
        if (board2dCell instanceof BoardCell) {
          if (board2dCell.hazard === 0) { // this is a new hazard, increment number of cells on board that have hazard
            this.numHazards = this.numHazards + 1
          }
          board2dCell.hazard = board2dCell.hazard + 1;
        }
      }
    }

    // populate Voronoi properties of boardCells

    if (populateVoronoi) {
      let depth: number = 1 // depth 0 is the snake heads, depth 1 is their immediate neighbors, & so on
      let eatDepths: {[key: string]: boolean} = {} // keeps track of whether snake with this ID has eaten at this depth

      while(voronoiPoints.length) { // so long as any voronoiPoints are left, must keep calculating them

        let point = voronoiPoints.shift() // get the top point off the list

        if (point !== undefined) {
          let neighbors = getSurroundingCells(point.coord, self, undefined, isArcadeMaze)
          for (const neighbor of neighbors) { // for each neighbor, update its voronoi array if applicable
            let isNewVoronoiBoardCell: boolean = false // if any VoronoiSnakes are added to this neighbor, set this to true so we can add it to voronoiPoints array
            if (point !== undefined) {
              let voronoiKeys = Object.keys(point.voronoi)

              for (const snakeId of voronoiKeys) { // propagate Voronoi out for each snake at this point. TieSnakes will end up sharing a lot of spaces. 
                let voronoiSnake: VoronoiSnake | undefined = point?.voronoi[snakeId]
                if (voronoiSnake !== undefined) {
                  // in order to allow for tails, cells with snakeCells whose length would have removed the tail by this depth will be allowed

                  let isBodyCell: boolean = false // only true if neighbor contains a snakeCell which has not receded as a tail by this depth
                  let tailOffset: number | undefined = undefined // used to keep track of following otherSnake tail danger
                  if (neighbor.snakeCell !== undefined) {
                    if (isConstrictor) { // every cell in constrictor is effectively a body cell, because it never shrinks
                      isBodyCell = true
                    } else {
                      let effectiveIndex: number
                      if (neighbor.snakeCell.bodyIndex === (neighbor.snakeCell.snake.length - 1) && snakeHasEaten(neighbor.snakeCell.snake)) {
                        effectiveIndex = neighbor.snakeCell.bodyIndex - 1 // this body index was replaced by its successor - decrement it again
                      } else {
                        effectiveIndex = neighbor.snakeCell.bodyIndex
                      }
                      if (neighbor.snakeCell.snake.id === voronoiSnake.snake.id) { // if the snake in this cell is me, I can trust voronoiSnake.effectiveLength
                        tailOffset = voronoiSnake.effectiveLength - effectiveIndex - depth
                        isBodyCell = tailOffset > 0 // tailOffset still valid for possible food spawns, but we can always chase our own tail without fear of food growth
                      } else {
                        let neighborSnakeEffectiveLength: number = neighbor.snakeCell.snake.length + snakePossibleEats[neighbor.snakeCell.snake.id]
                        tailOffset = neighborSnakeEffectiveLength - effectiveIndex - depth
                        isBodyCell = tailOffset > 0
                      }
                    }
                  }
                  // so for a snake of length 5, at the tail, this means: (5 - 4) <= 1, or <= 2, 3, etc. This evaluates to true, which is correct - that's a tail cell, even at depth 1, it's valid
                  // for the same snake of length 5, at index 2 (middle), this is only a tail if on depth 3 or greater - depth 1 is immediate neighbor, depth 2 is turn after that, depth 3 allows two shrinks. (5 - 2) <= 3
                  // for the same snake of length 5, if it may have eaten at depth 1, at index 2 (middle), this is only a tail if on depth 4 or greater. ((5 + 1) - 2) <= 4 

                  if (neighbor.snakeCell === undefined || !isBodyCell) {
                    let neighborVoronoiKeys = Object.keys(neighbor.voronoi)
                    let isHazard: boolean
                    let isHazardDamage: number
                    if (isHazardSpiral && hazardSpiral !== undefined) { // if we're in hazard spiral, hazard can be determined at any depth using HazardSpiral
                      let hazardSpiralCell = hazardSpiral.getCell(neighbor.coord)
                      isHazard = hazardSpiralCell? hazardSpiralCell.turnIsHazard < (gameState.turn + depth) : neighbor.hazard > 0 // gameState turn + depth is effective turn
                      // note this won't consider the turn the hazard appears to be hazard, since it won't damage our snake like it was hazard on that turn
                      isHazardDamage = isHazard? self.hazardDamage : 0
                    } else if (isSinkhole && sinkholeLatestSpawnTurn !== undefined && gameState.turn < sinkholeLatestSpawnTurn) { // only need to predict future spawning sinkholes before latest turn they can spawn
                      let turn: number = gameState.turn + depth
                      let hazardNumber: number = getSinkholeNumber(neighbor.coord, turn, gameState.game.ruleset.settings.royale.shrinkEveryNTurns)
                      isHazard = hazardNumber > 0
                      isHazardDamage = hazardNumber * self.hazardDamage
                    } else {
                      isHazard = neighbor.hazard > 0
                      isHazardDamage = neighbor.hazard * self.hazardDamage
                    }
                    if (!neighborVoronoiKeys.includes(snakeId)) { // if another voronoiPoint has already added this snakeId to this cell, no need to revisit
                      let voronoiSnakeNewEffectiveLength: number = neighbor.food || isConstrictor? voronoiSnake.effectiveLength + 1 : voronoiSnake.effectiveLength
                      if (neighborVoronoiKeys.length === 0) { // if I am the first one to this boardCell, add myself to its voronoi array
                        if (neighbor.food || isConstrictor) { // if it has food, snake cannot starve getting here, no need for effectiveHealth check
                          neighbor.voronoi[snakeId] = new VoronoiSnake(voronoiSnake.snake, depth, voronoiSnake.effectiveLength + 1, 100, tailOffset)
                          neighbor.voronoiDepth = depth
                          eatDepths[snakeId] = true // whether or not this is the first food we could eat at this depth, can just replace it, just so long as we can eat at this depth
                          isNewVoronoiBoardCell = true
                        } else {
                          if (isHazard && voronoiSnake.effectiveHealth > (isHazardDamage + 1)) { // snake will not starve in moving to this cell
                            let effectiveHealth: number = voronoiSnake.effectiveHealth - 1 - isHazardDamage
                            effectiveHealth = effectiveHealth > 100? 100 : effectiveHealth // snake cannot heal to more than 100 health from healing pool
                            neighbor.voronoi[snakeId] = new VoronoiSnake(voronoiSnake.snake, depth, voronoiSnake.effectiveLength, effectiveHealth, tailOffset)
                            neighbor.voronoiDepth = depth
                            isNewVoronoiBoardCell = true
                          } else if (!isHazard && voronoiSnake.effectiveHealth > 1) { // snake will not starve in moving to this cell
                            neighbor.voronoi[snakeId] = new VoronoiSnake(voronoiSnake.snake, depth, voronoiSnake.effectiveLength, (voronoiSnake.effectiveHealth - 1), tailOffset)
                            neighbor.voronoiDepth = depth
                            isNewVoronoiBoardCell = true
                          }
                        }
                      } else if (depth === neighbor.voronoi[neighborVoronoiKeys[0]].depth && (voronoiSnakeNewEffectiveLength > neighbor.voronoi[neighborVoronoiKeys[0]].effectiveLength)) { // else if I am at the same depth as, & larger than the existing snakes in this board cell, remove them, & add myself
                        if (neighbor.food || isConstrictor) { // if it has food, snake cannot starve getting here, no need for effectiveHealth check
                          neighbor.voronoi = {} // clear out old, smaller voronoiSnakes
                          neighbor.voronoi[snakeId] = new VoronoiSnake(voronoiSnake.snake, depth, voronoiSnake.effectiveLength + 1, 100, tailOffset)
                          neighbor.voronoiDepth = depth
                          eatDepths[snakeId] = true // whether or not this is the first food we could eat at this depth, can just replace it, just so long as we can eat at this depth
                          isNewVoronoiBoardCell = true
                        } else {
                          if (isHazard && voronoiSnake.effectiveHealth > (isHazardDamage + 1)) { // snake will not starve in moving to this cell
                            let effectiveHealth: number = voronoiSnake.effectiveHealth - 1 - isHazardDamage
                            effectiveHealth = effectiveHealth > 100? 100 : effectiveHealth // snake cannot heal to more than 100 health from healing pool
                            neighbor.voronoi = {} // clear out old, smaller voronoiSnakes
                            neighbor.voronoi[snakeId] = new VoronoiSnake(voronoiSnake.snake, depth, voronoiSnake.effectiveLength, effectiveHealth, tailOffset)
                            neighbor.voronoiDepth = depth
                            isNewVoronoiBoardCell = true
                          } else if (!isHazard && voronoiSnake.effectiveHealth > 1) { // snake will not starve in moving to this cell
                            neighbor.voronoi = {} // clear out old, smaller voronoiSnakes
                            neighbor.voronoi[snakeId] = new VoronoiSnake(voronoiSnake.snake, depth, voronoiSnake.effectiveLength, (voronoiSnake.effectiveHealth - 1), tailOffset)
                            neighbor.voronoiDepth = depth
                            isNewVoronoiBoardCell = true
                          } // do not clear out old, smaller voronoiSnakes if snake would starve by stealing this cell away
                        }
                      } else if (depth === neighbor.voronoi[neighborVoronoiKeys[0]].depth && voronoiSnakeNewEffectiveLength === neighbor.voronoi[neighborVoronoiKeys[0]].effectiveLength) { // else if I am at the same depth as, & equal to the existing snakes in this board cell, add myself
                        if (neighbor.food || isConstrictor) { // if it has food, snake cannot starve getting here, no need for effectiveHealth check
                          neighbor.voronoi[snakeId] = new VoronoiSnake(voronoiSnake.snake, depth, voronoiSnake.effectiveLength + 1, 100, tailOffset)
                          neighbor.voronoiDepth = depth
                          eatDepths[snakeId] = true // whether or not this is the first food we could eat at this depth, can just replace it, just so long as we can eat at this depth
                          isNewVoronoiBoardCell = true
                        } else {
                          if (isHazard && voronoiSnake.effectiveHealth > (isHazardDamage + 1)) { // snake will not starve in moving to this cell
                            let effectiveHealth: number = voronoiSnake.effectiveHealth - 1 - isHazardDamage
                            effectiveHealth = effectiveHealth > 100? 100 : effectiveHealth // snake cannot heal to more than 100 health from healing pool
                            neighbor.voronoi[snakeId] = new VoronoiSnake(voronoiSnake.snake, depth, voronoiSnake.effectiveLength, effectiveHealth, tailOffset)
                            neighbor.voronoiDepth = depth
                            isNewVoronoiBoardCell = true
                          } else if (!isHazard && voronoiSnake.effectiveHealth > 1) { // snake will not starve in moving to this cell
                            neighbor.voronoi[snakeId] = new VoronoiSnake(voronoiSnake.snake, depth, voronoiSnake.effectiveLength, (voronoiSnake.effectiveHealth - 1), tailOffset)
                            neighbor.voronoiDepth = depth
                            isNewVoronoiBoardCell = true
                          }
                        }
                      } // if no cases pass, this cell is no longer open to me
                    } else { // may want to update the effectiveLength & effectiveHealth of voronoiSnake for myself here
                      if (depth === neighbor.voronoi[snakeId].depth) {
                        let oldLength = neighbor.voronoi[snakeId].effectiveLength
                        let newLength = (neighbor.food || isConstrictor)? voronoiSnake.effectiveLength + 1 : voronoiSnake.effectiveLength
                        if (newLength > oldLength) {
                          neighbor.voronoi[snakeId].effectiveLength = newLength
                        }

                        let oldHealth = neighbor.voronoi[snakeId].effectiveHealth
                        let newHealth: number = (neighbor.food || isConstrictor)? 100 : isHazard? voronoiSnake.effectiveHealth - 1 - isHazardDamage : voronoiSnake.effectiveHealth - 1
                        newHealth = newHealth > 100? 100 : newHealth // snake cannot heal to more than 100 health from healing pool
                        if (newHealth > oldHealth) {
                          neighbor.voronoi[snakeId].effectiveHealth = newHealth
                        }
                      }
                    }
                  }
                }
              }
            }
            if (isNewVoronoiBoardCell) {
              voronoiPoints.push(neighbor)
            }
          }

          // once we've processed all VoronoiPoints at this depth, can move on to the next depth
          if (voronoiPoints[0] !== undefined && voronoiPoints[0].voronoiDepth !== point.voronoiDepth) {
            depth = depth + 1

            // once we're moving on to a new depth, can update snakePossibleEats with the eats that each snake may have done at this depth
            let snakeIds = Object.keys(eatDepths)
            for (const id of snakeIds) {
              if (isConstrictor || eatDepths[id]) { // constrictor snakes always effectively eat, otherwise, check eatDepths to see if snake at at this depth
                snakePossibleEats[id] = snakePossibleEats[id] + 1
              }
            }

            eatDepths = {} // reset eatDepths for new depth
          }
        }
      }
    }
  }

  getCell(coord: Coord) : BoardCell | undefined {
    let x: number = coord.x
    let y: number = coord.y
    if (this.isWrapped) {
      if (x === -1) {
        x = this.width - 1 // wrap from left edge to right edge
      } else if (x === this.width) {
        x = 0 // wrap from right edge to left edge
      }
      if (y === -1) {
        y = this.height - 1 // wrap from bottom edge to top edge
      } else if (y === this.height) {
        y = 0 // wrap from top edge to bottom edge
      }
    }

    let idx = y * this.width + x;

    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return undefined;
    }
    if (!this.cells[idx]) { // if this BoardCell has not yet been instantiated, do so
      this.cells[idx] = new BoardCell(new Coord(x, y), false, 0);
    }
    return this.cells[idx];
  }

  logCell(coord: Coord) : string {
    let cell = this.getCell(coord);
    if (cell) {
      return cell.logSelf();
    } else {
      return `Could not get BoardCell at ${coord}`
    }
  }

  logBoard() : string {
    let ret: string = ""
    for (let i = 0; i < this.width; i++) {
      for (let j = 0; j < this.height; j++) {
        let tempCoord = new Coord(i, j);
        ret = ret + this.logCell(tempCoord);
      }
    }
    return ret
  }

  printBoard() : string {
    let str : string = ""
    for (let j = this.height - 1; j >= 0; j--) {
      for (let i = 0; i < this.width; i++) {
        let tempCell = this.getCell({x: i, y: j})
        if (tempCell) {
          if (i !== 0) {
            str = str + "  "
          }
          if (tempCell.snakeCell instanceof SnakeCell) {
            if (tempCell.snakeCell.isHead) {
              str = str + "h"
            } else if (tempCell.snakeCell.isTail) {
              str = str + "t"
            } else {
              str = str + "s"
            }
          } else if (tempCell.food && tempCell.hazard) {
            str = str + "F"
          } else if (tempCell.food) {
            str = str + "f"
          } else if (tempCell.hazard) {
            str = str + "H"
          } else { // empty cell
            str = str + "x"
          }
        }
      }
      str = str + "\n"
    }
    logToFile(consoleWriteStream, str)
    return str
  }

  printBoardVoronoi(): string {
    let str : string = ""
    for (let j = this.height - 1; j >= 0; j--) {
      for (let i = 0; i < this.width; i++) {
        let tempCell = this.getCell({x: i, y: j})
        if (tempCell) {
          if (i !== 0) {
            str = str + "  "
          }
          let voronoiKeys = Object.keys(tempCell.voronoi)
          if (voronoiKeys.length === 0) {
            str = str + "None " // each cell should be size 5
          } else if (voronoiKeys.length === 1) {
            if (tempCell.voronoi[voronoiKeys[0]].depth > 9) {
              str = str + (tempCell.voronoi[voronoiKeys[0]].snake.name).substring(0, 3) + tempCell.voronoi[voronoiKeys[0]].depth // each cell should be size 5
            } else {
              str = str + (tempCell.voronoi[voronoiKeys[0]].snake.name).substring(0, 4) + tempCell.voronoi[voronoiKeys[0]].depth // each cell should be size 5
            }
          } else {
            if (tempCell.voronoi[voronoiKeys[0]].depth > 9) {
              str = str + "Tie" + tempCell.voronoi[voronoiKeys[0]].depth
            } else {
              str = str + "Tie" + tempCell.voronoi[voronoiKeys[0]].depth + " "
            }
          }
        }
      }
      str = str + "\n"
    }
    logToFile(consoleWriteStream, str)
    return str
  }

  // returns true if a snake exists at coord that is not the inputSnake
  hasSnake(coord: Coord, inputSnake: Battlesnake) : boolean {
    let cell = this.getCell(coord);
    if (cell) {
      return cell.snakeCell ? cell.snakeCell.snake.id === inputSnake.id : false;
    } else {
      return false;
    }
  }
}

// an object representing the left, top, right, & bottom hazard boundaries of a board. Will need adjustment if inverted hazard is ever a thing
export class HazardWalls {
  up: number | undefined = undefined
  down: number | undefined = undefined
  left: number | undefined = undefined
  right: number | undefined = undefined

  constructor(gameState?: GameState) {
    let _this = this

    if (gameState === undefined || gameState.game.map) { // hazard walls don't make sense if a unique hazard map is specified (spiral, scatter)
      this.up = undefined
      this.down = undefined
      this.left = undefined
      this.right = undefined
      return
    }

    const hazardDamage: number = getHazardDamage(gameState)
    if (hazardDamage > 0) { // if hazard does not exist, we can just leave the walls undefined
      let xValues: { [key: number]: number} = {} // need to count up all hazards & determine if walls exist if gameState.board.height number of cells exist at that x value
      let yValues: { [key: number]: number} = {} // likewise, but for board.width at that y value

      let board2d: Board2d = new Board2d(gameState)

      for (let i: number = 0; i< board2d.width; i++) {
        for (let j: number = 0; j < board2d.height; j++) { // iterate through each cell in board2d
          let cell = board2d.getCell({x: i, y: j})
          if (cell !== undefined && cell.hazard) { // if cell exists & has hazard, add its coordinates to the xValues & yValues objects
            if (xValues[i] !== undefined) { // entry exists, increment it
              xValues[i] = xValues[i] + 1
            } else { // entry doesn't yet exist, create it & set to 1
              xValues[i] = 1
            }
            if (yValues[j] !== undefined) {
              yValues[j] = yValues[j] + 1
            } else {
              yValues[j] = 1
            }
          }
        }
      }

      let hasXGap: boolean = false
      for (let i: number = 0; i < gameState.board.width; i++) {
        if (xValues[i] !== undefined && xValues[i] === gameState.board.height) { // there are as many x values at this width as the board is tall - this is a wall
          if (hasXGap) { // have already found the left wall, now finding the right wall
            _this.right = i
            break // don't want to process anything after finding the right wall
          } else { // have not found a gap yet, continue updating the left wall
            _this.left = i
            if (i === gameState.board.width - 1) {
              _this.right = i // hazard runs the entire width, left edge is also right edge
            }
          }
        } else {
          hasXGap = true
        }
      }
      let hasYGap: boolean = false
      for (let j: number = 0; j < gameState.board.height; j++) {
        if (yValues[j] !== undefined && yValues[j] === gameState.board.width) { // there are as many y values at this height as this board is long - this is a wall
          if (hasYGap) { // have already found the down wall, now finding the up wall
            _this.up = j
            break // don't want to process anything after finding the up wall
          } else { // have not found a gap yet, continue updating the down wall
            _this.down = j
            if (j === gameState.board.height - 1) {
              _this.up = j // hazard runs the entire height, bottom edge is also top edge
            }
          }
        } else {
          hasYGap = true
        }
      }
    }
  }
}

class HazardSpiralCell {
  coord: Coord
  turnIsHazard: number

  constructor(coord: Coord, turnIsHazard: number) {
    this.coord = coord
    this.turnIsHazard = turnIsHazard
  }
}

export class HazardSpiral {
  hazardFrequency: number
  height: number
  width: number
  private cells: Array<HazardSpiralCell>
  startingCoord: Coord | undefined
  isWrapped: boolean

  constructor(gameState: GameState, hazardFrequency: number, _startingTurn?: number, _startingCoord?: Coord) {
    this.hazardFrequency = hazardFrequency
    this.height = gameState.board.height
    this.width = gameState.board.width
    this.cells = new Array(this.height * this.width)
    this.isWrapped = gameStateIsWrapped(gameState)
    if (_startingCoord !== undefined) {
      this.startingCoord = _startingCoord
    } else if (gameState.board.hazards.length < 1) {
      return
    } else {
      this.startingCoord = gameState.board.hazards[0]
    }

    let startingTurn: number = _startingTurn !== undefined? _startingTurn : gameState.turn // the turn that the first hazard appeared

    let startingIdx: number = this.getIndex(this.startingCoord.x, this.startingCoord.y)
    let startingCell = new HazardSpiralCell(this.startingCoord, startingTurn)
    this.cells[startingIdx] = startingCell
    let hazardCells: number = 1
    let trueHazardCells: number = 1 // need to distinguish between hazard cells that are off board & those that are on board

    let spiralDirection: Direction = Direction.Up // spiral starts out by going up from the center of the spiral

    let currentCoord: Coord = startingCell.coord

    let fakeCoords: Coord[] = [] // spiral coordinates which don't exist on the game board, but need to be tracked for building spiral
    while (trueHazardCells < (this.height * this.width)) { // keep spiraling until entire board is hazard
      let hazardTurn: number
      let idx: number
      let newCell: HazardSpiralCell
      let adjacentCoord: Coord
      switch(spiralDirection) {
        case Direction.Up:
          currentCoord = new Coord(currentCoord.x, currentCoord.y + 1) // new coord is one above old coord
          adjacentCoord = new Coord(currentCoord.x + 1, currentCoord.y) // coord one to the right
          break
        case Direction.Right:
          currentCoord = new Coord(currentCoord.x + 1, currentCoord.y) // new coord is one right of old coord
          adjacentCoord = new Coord(currentCoord.x, currentCoord.y - 1) // coord one down
          break
        case Direction.Down:
          currentCoord = new Coord(currentCoord.x, currentCoord.y - 1) // new coord is one down of old coord
          adjacentCoord = new Coord(currentCoord.x - 1, currentCoord.y) // coord one left
          break
        default: // Direction.Left:
          currentCoord = new Coord(currentCoord.x - 1, currentCoord.y) // new coord is one left of old coord
          adjacentCoord = new Coord(currentCoord.x, currentCoord.y + 1) // coord one up
          break
      }

      if (this.coordExists(currentCoord)) { // coord exists, add it to HazardSpiral cells
        hazardTurn = startingTurn + this.hazardFrequency * hazardCells // hazardCells has yet to be incremented, so turn 6 for second hazard, turn 9 for third, etc.
        newCell = new HazardSpiralCell(currentCoord, hazardTurn) // new cell exists at newCoord & hazardFrequency turns ahead
        idx = this.getIndex(currentCoord.x, currentCoord.y) // get index in 2d array where this coordinate lives
        this.cells[idx] = newCell // add HazardSpiralCell to 2d cells array
        hazardCells = hazardCells + 1
        trueHazardCells = trueHazardCells + 1 // we've now added currentCell to our cells
      } else { // coord doesn't exist, but still need to add it to fakeCoords & change direction if applicable
        fakeCoords.push(currentCoord) // keep track of hazard coordinate in fakeCoords
        hazardCells = hazardCells + 1 // hazardCell increment for hazardTurn calculation, even though the hazard doesn't exist on game board
      }

      // spiral tightening - change direction if we can
      if (this.canMoveTowardsCoord(adjacentCoord, fakeCoords)) {
        switch (spiralDirection) {
          case Direction.Up:
            spiralDirection = Direction.Right
            break
          case Direction.Right:
            spiralDirection = Direction.Down
            break
          case Direction.Down:
            spiralDirection = Direction.Left
            break
          default: //case Direction.Left:
            spiralDirection = Direction.Up
            break
        }
      }
    }
  }

  // returns true if coord neither exists in fakeCells, nor in this.cells
  canMoveTowardsCoord(adjacentCoord: Coord, fakeCoords: Coord[]): boolean {
    if (this.coordExists(adjacentCoord)) {
      let adjacentCell = this.getCell(adjacentCoord) // cell one to the right, if it exists
      if (adjacentCell === undefined) { // we can move right, thus we should, stop moving up
        return true
      }
    } else {
      let adjacentCoordFakeExists = fakeCoords.some(coord => { // true if adjacentCoord exists in fakeCoords
        return (adjacentCoord.x === coord.x && adjacentCoord.y === coord.y)
      })
      if (!adjacentCoordFakeExists) {
        return true
      }
    }
    return false
  }

  coordExists(coord: Coord) {
    let xExists: boolean = coord.x >= 0 && coord.x < this.width
    let yExists: boolean = coord.y >= 0 && coord.y < this.height
    return xExists && yExists // return true if coordinate exists within board dimensions horizontally & vertically
  }

  getIndex(x: number, y: number): number {
    return y * this.width + x
  }

  getCell(coord: Coord) : HazardSpiralCell | undefined {
    let x: number = coord.x
    let y: number = coord.y
    if (this.isWrapped) {
      if (x === -1) {
        x = this.width - 1 // wrap from left edge to right edge
      } else if (x === this.width) {
        x = 0 // wrap from right edge to left edge
      }
      if (y === -1) {
        y = this.height - 1 // wrap from bottom edge to top edge
      } else if (y === this.height) {
        y = 0 // wrap from top edge to bottom edge
      }
    }

    let idx = this.getIndex(x, y)

    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return undefined;
    }
    return this.cells[idx];
  }

  printSelf() : string {
    let str : string = ""
    for (let j = this.height - 1; j >= 0; j--) {
      for (let i = 0; i < this.width; i++) {
        let tempCell = this.getCell({x: i, y: j})
        if (tempCell) {
          if (i !== 0) {
            str = str + "  "
          }
          str = str + tempCell.turnIsHazard
          if (tempCell.turnIsHazard < 10) {
            str = str + "  "
          } else if (tempCell.turnIsHazard < 100) {
            str = str + " "
          }
        }
      }
      str = str + "\n"
    }
    logToFile(consoleWriteStream, str)
    return str
  }
}

export class Moves {
  up: boolean;
  down: boolean;
  right: boolean;
  left: boolean;

  constructor(up: boolean, down: boolean, right: boolean, left: boolean) {
    this.up = up;
    this.down = down;
    this.right = right;
    this.left = left;
  }

  validMoves() : Direction[] {
    let moves : Direction[] = [];
    if (this.up) {
      moves.push(Direction.Up);
    }
    if (this.down) {
      moves.push(Direction.Down);
    }
    if (this.left) {
      moves.push(Direction.Left);
    }
    if (this.right) {
      moves.push(Direction.Right);
    }
    return moves;
  }

  invalidMoves() : Direction[] {
    let moves : Direction[] = [];
    if (!this.up) {
      moves.push(Direction.Up);
    }
    if (!this.down) {
      moves.push(Direction.Down);
    }
    if (!this.left) {
      moves.push(Direction.Left);
    }
    if (!this.right) {
      moves.push(Direction.Right);
    }
    return moves;
  }

  hasOtherMoves(move: Direction) : boolean {
    switch (move) {
      case Direction.Up:
        return (this.down || this.left || this.right);
      case Direction.Down:
        return (this.up || this.left || this.right);
      case Direction.Left:
        return (this.up || this.down || this.right);
      default: //case Direction.Right:
        return (this.up || this.down || this.left);
    }
  }

  enableMove(move: Direction) : void {
    switch (move) {
      case Direction.Up:
        this.up = true;
        break;
      case Direction.Down:
        this.down = true;
        break;
      case Direction.Left:
        this.left = true;
        break;
      default: // case Direction.Right:
        this.right = true;
        break;
    }
  }

  disableMove(move: Direction) : void {
    switch (move) {
      case Direction.Up:
        this.up = false;
        break;
      case Direction.Down:
        this.down = false;
        break;
      case Direction.Left:
        this.left = false;
        break;
      default: // case Direction.Right:
        this.right = false;
        break;
    }
  }

  disableOtherMoves(move: Direction) : void {
    switch (move) {
      case Direction.Up:
        this.right = false;
        this.left = false;
        this.down = false;
        break;
      case Direction.Down:
        this.up = false;
        this.left = false;
        this.right = false;
        break;
      case Direction.Left:
        this.up = false;
        this.down = false;
        this.right = false;
        break;
      default: // case Direction.Right:
        this.up = false;
        this.down = false;
        this.left = false;
        break;
    }
  }

  toString() : string {
    return `Up: ${this.up}; Down: ${this.down}; Left: ${this.left}; Right: ${this.right}`;
  }
}

export class MoveNeighbors {
  me: Battlesnake;
  upNeighbors: BoardCell[] = [];
  downNeighbors: BoardCell[] = [];
  leftNeighbors: BoardCell[] = [];
  rightNeighbors: BoardCell[] = [];

  huntedAtUp: boolean = false
  huntingAtUp: boolean= false
  huntedAtDown: boolean = false
  huntingAtDown: boolean = false
  huntingAtLeft: boolean = false
  huntedAtLeft: boolean = false
  huntingAtRight: boolean = false
  huntedAtRight: boolean = false

  huntingSnakes : { [key: string]: Moves; } = {}; // object containing snakes trying to eat me. Each key is an id, each value a Moves object. Moves objects represent the moves I WENT TOWARDS, not the place the hunting snake came from. This is so that I can actually do something with the information - namely, disable a move direction if it's the only one a hunting snake can reach
  isDuel: boolean;
  
  upPredator: Battlesnake | undefined = undefined
  downPredator: Battlesnake | undefined = undefined
  leftPredator: Battlesnake | undefined = undefined
  rightPredator: Battlesnake | undefined = undefined

  upPrey: Battlesnake | undefined = undefined
  downPrey: Battlesnake | undefined = undefined
  leftPrey: Battlesnake | undefined = undefined
  rightPrey: Battlesnake | undefined = undefined

  constructor(me: Battlesnake, isDuel: boolean, upNeighbors: BoardCell[] | undefined, downNeighbors: BoardCell[] | undefined, leftNeighbors: BoardCell[] | undefined, rightNeighbors: BoardCell[] | undefined) {
    this.me = me;
    if (upNeighbors) {
      this.upNeighbors = upNeighbors;
    }
    if (downNeighbors) {
      this.downNeighbors = downNeighbors;
    }
    if (leftNeighbors) {
      this.leftNeighbors = leftNeighbors;
    }
    if (rightNeighbors) {
      this.rightNeighbors = rightNeighbors;
    }
    this.upPredator = undefined
    this.downPredator = undefined
    this.leftPredator = undefined
    this.rightPredator = undefined
    this.upPrey = undefined;
    this.downPrey = undefined;
    this.leftPrey = undefined;
    this.rightPrey = undefined;
    this.isDuel = isDuel;

    this.huntedAtUp = this._huntedAtUp()
    this.huntingAtUp = this._huntingAtUp()
    this.huntedAtDown = this._huntedAtDown()
    this.huntingAtDown = this._huntingAtDown()
    this.huntedAtLeft = this._huntedAtLeft()
    this.huntingAtLeft = this._huntingAtLeft()
    this.huntedAtRight = this._huntedAtRight()
    this.huntingAtRight = this._huntingAtRight()
  }

  // always considers ties to be a larger snake. Returns true if the snake in the cell is larger than myself
  isSnakeCellLargerOrTied(cell: BoardCell): boolean {
    if (cell.snakeCell instanceof SnakeCell && cell.snakeCell.isHead && cell.snakeCell.snake.length >= this.me.length) { // if cell has a snake & that snake is larger or tied with me
      return true
    }
    return false // snake either doesn't exist, or isn't larger/tied depending on isDuel
  }

  // returns true if some upNeighbor snake exists of equal or longer length than me
  // also populates huntingSnakes with info about its potential killers & what directions they can come from
  private _huntedAtUp() : boolean {
    let _this = this;
    let biggerSnake : boolean = false
    for (const cell of this.upNeighbors) {
      if (cell.snakeCell instanceof SnakeCell && _this.isSnakeCellLargerOrTied(cell)) {
        biggerSnake = true
        _this.upPredator = cell.snakeCell.snake
        if (_this.huntingSnakes[cell.snakeCell.snake.id]) {
          _this.huntingSnakes[cell.snakeCell.snake.id].up = true;
        } else {
          _this.huntingSnakes[cell.snakeCell.snake.id] = new Moves(true, false, false, false);
        }
      }
    }
    return biggerSnake;
  }
  

  // returns true if upNeighbors exist, but no upNeighbor snake exists of equal or longer length than me
  private _huntingAtUp() : boolean {
    let _this = this;
    let upNeighborSnakes : number = 0
    let biggerSnake : boolean = true
    for (const cell of this.upNeighbors) {
      if (cell.snakeCell instanceof SnakeCell && cell.snakeCell.isHead) {
        upNeighborSnakes = upNeighborSnakes + 1
        if (_this.isSnakeCellLargerOrTied(cell)) {
          biggerSnake = false;
        } else {
          _this.upPrey = cell.snakeCell.snake;
        }
      }
    }
    return upNeighborSnakes === 0 ? false : biggerSnake; // don't go hunting if there aren't any snake heads nearby
  }

  // returns true if some downNeighbor snake exists of equal or longer length than me
  // also populates huntingSnakes with info about its potential killers & what directions they can come from
  private _huntedAtDown() : boolean {
    let _this = this
    let biggerSnake : boolean = false
    for (const cell of this.downNeighbors) {
      if (cell.snakeCell instanceof SnakeCell && _this.isSnakeCellLargerOrTied(cell)) {
        biggerSnake = true
        _this.downPredator = cell.snakeCell.snake
        if (_this.huntingSnakes[cell.snakeCell.snake.id]) {
          _this.huntingSnakes[cell.snakeCell.snake.id].down = true;
        } else {
          _this.huntingSnakes[cell.snakeCell.snake.id] = new Moves(false, true, false, false);
        }
      }
    }
    return biggerSnake;
  }
  
  // returns true if downNeighbors exist, but no downNeighbor snake exists of equal or longer length than me
  private _huntingAtDown() : boolean {
    let _this = this
    let downNeighborSnakes : number = 0
    let biggerSnake : boolean = true

    for (const cell of this.downNeighbors) {
      if (cell.snakeCell instanceof SnakeCell && cell.snakeCell.isHead) {
        downNeighborSnakes = downNeighborSnakes + 1;
        if (_this.isSnakeCellLargerOrTied(cell)) {
          biggerSnake = false;
        } else {
          _this.downPrey = cell.snakeCell.snake;
        }
      }
    }
    return downNeighborSnakes === 0 ? false : biggerSnake; // don't go hunting if there aren't any snake heads nearby
  }

  // returns true if some leftNeighbor snake exists of equal or longer length than me
  // also populates huntingSnakes with info about its potential killers & what directions they can come from
  private _huntedAtLeft() : boolean {
    let _this = this
    let biggerSnake : boolean = false
    for (const cell of this.leftNeighbors) {
      if (cell.snakeCell instanceof SnakeCell && _this.isSnakeCellLargerOrTied(cell)) {
        biggerSnake = true
        _this.leftPredator = cell.snakeCell.snake
        if (_this.huntingSnakes[cell.snakeCell.snake.id]) {
          _this.huntingSnakes[cell.snakeCell.snake.id].left = true;
        } else {
          _this.huntingSnakes[cell.snakeCell.snake.id] = new Moves(false, false, false, true);
        }
      }
    }
    return biggerSnake;
  }
  
  // returns true if leftNeighbors exist, but no leftNeighbor snake exists of equal or longer length than me
  private _huntingAtLeft() : boolean {
    let _this = this
    let leftNeighborSnakes : number = 0
    let biggerSnake : boolean = true
    for (const cell of this.leftNeighbors) {
      if (cell.snakeCell instanceof SnakeCell && cell.snakeCell.isHead) {
        leftNeighborSnakes = leftNeighborSnakes + 1
        if (_this.isSnakeCellLargerOrTied(cell)) {
          biggerSnake = false;
        } else {
          _this.leftPrey = cell.snakeCell.snake;
        }
      }
    }
    return leftNeighborSnakes === 0 ? false : biggerSnake; // don't go hunting if there aren't any snake heads nearby
  }

  // returns true if some rightNeighbor snake exists of equal or longer length than me
  // also populates huntingSnakes with info about its potential killers & what directions they can come from
  private _huntedAtRight() : boolean {
    let _this = this
    let biggerSnake : boolean = false
    for (const cell of this.rightNeighbors) {
      if (cell.snakeCell instanceof SnakeCell && _this.isSnakeCellLargerOrTied(cell)) {
        biggerSnake = true
        _this.rightPredator = cell.snakeCell.snake
        if (_this.huntingSnakes[cell.snakeCell.snake.id]) {
          _this.huntingSnakes[cell.snakeCell.snake.id].right = true;
        } else {
          _this.huntingSnakes[cell.snakeCell.snake.id] = new Moves(false, false, true, false);
        }
      }
    }
    return biggerSnake;
  }
  
  // returns true if rightNeighbors exist, but no rightNeighbor snake exists of equal or longer length than me
  private _huntingAtRight() : boolean {
    let _this = this
    let rightNeighborSnakes : number = 0
    let biggerSnake : boolean = true
    for (const cell of this.rightNeighbors) {
      if (cell.snakeCell instanceof SnakeCell && cell.snakeCell.isHead) {
        rightNeighborSnakes = rightNeighborSnakes + 1;
        if (_this.isSnakeCellLargerOrTied(cell)) {
          biggerSnake = false;
        } else {
          _this.rightPrey = cell.snakeCell.snake;
        }
      }
    }
    return rightNeighborSnakes === 0 ? false : biggerSnake; // don't go hunting if there aren't any snake heads nearby
  }

  // returns Moves where a direction which is a kissOfDeathCertainty is false, otherwise true
  huntingChanceDirections() : Moves {
    let availableMoves = new Moves(true, true, true, true);
    for (const [id, moves] of Object.entries(this.huntingSnakes)) {
      let validMoves = moves.validMoves();
      if (validMoves.length === 1) { // if this is the only move the hunting snake can reach, we assume it will make this move, & thus want to avoid it
        availableMoves.disableMove(validMoves[0]);
      }
    }
    return availableMoves;
  }

  // returns the predator battlesnake from the corresponding direction, if it exists
  getPredator(dir: Direction): Battlesnake | undefined {
    switch (dir) {
      case Direction.Up:
        return this.upPredator
      case Direction.Down:
        return this.downPredator
      case Direction.Right:
        return this.rightPredator
      case Direction.Left:
        return this.leftPredator
      default:
        return undefined
    }
  }
  
  // returns the prey battlesnake from the corresponding direction, if it exists
  getPrey(dir: Direction): Battlesnake | undefined {
    switch (dir) {
      case Direction.Up:
        return this.upPrey
      case Direction.Down:
        return this.downPrey
      case Direction.Right:
        return this.rightPrey
      case Direction.Left:
        return this.leftPrey
      default:
        return undefined
    }
  }

  // for a set of Moves, returns the smallest predator snake, if any, amongst the valid move directions of predators. Ties go to the first found, in up-down-right-left order
  getSmallestPredator(moves: Moves) : Battlesnake | undefined {
    let snake: Battlesnake | undefined = undefined
    if (moves.up && this.upPredator !== undefined) { // if up is a valid move, check its predator
      snake = this.upPredator // snake is not yet defined & downPredator is, assign it to downPredator
    }
    if (moves.down && this.downPredator !== undefined) { // if down is a valid move, check its predator
      if (snake === undefined) {
        snake = this.downPredator // if snake is not yet defined & downPredator is, assign it to downPredator
      } else if (this.downPredator.length < snake.length) { // both snakes are defined, compare lengths & assign downPredator if it's smaller
        snake = this.downPredator
      }
    }
    if (moves.right && this.rightPredator !== undefined) { // if right is a valid move, check its predator
      if (snake === undefined) {
        snake = this.rightPredator // if snake is not yet defined & rightPredator is, assign it to rightPredator
      } else if (this.rightPredator.length < snake.length) { // both snakes are defined, compare lengths & assign rightPredator if it's smaller
        snake = this.rightPredator
      }
    }
    if (moves.left && this.leftPredator !== undefined) { // if left is a valid move, check its predator
      if (snake === undefined) {
        snake = this.leftPredator // if snake is not yet defined & leftPredator is, assign it to leftPredator
      } else if (this.leftPredator.length < snake.length) { // both snakes are defined, compare lengths & assign leftPredator if it's smaller
        snake = this.leftPredator
      }
    }
    return snake
  }

  // looks at all prey & returns true if snake exists in prey more than once, i.e., I can kill that snake from more than one direction. False otherwise.
  isMurderChanceSnake(snake: Battlesnake) : boolean {
    let isPreyFound: boolean = false
    if (this.upPrey !== undefined && this.upPrey.id === snake.id) {
      isPreyFound = true
    }
    if (this.rightPrey !== undefined && this.rightPrey.id === snake.id) {
      if (isPreyFound) { // snake is prey from both up & right, meaning it's a 50/50 kill (still need to check if it has a third available move)
        return true
      }
    }
    if (this.leftPrey !== undefined && this.leftPrey.id === snake.id) {
      if (isPreyFound) { // snake is prey from two of up, right, left, meaning it's a 50/50 kill (still need to check if it has a third available move)
        return true
      }
    }
    if (this.downPrey !== undefined && this.downPrey.id === snake.id) {
      if (isPreyFound) { // snake is prey from two of up, right, left, or down, meaning it's a 50/50 kill (still need to check if it has a third available move)
        return true
      }
    }
    return false
  }

  predatorExists(snake: Battlesnake) : boolean {
    if (this.upPredator && this.upPredator.id === snake.id) {
      return true
    } else if (this.downPredator && this.downPredator.id === snake.id) {
      return true
    } else if (this.leftPredator && this.leftPredator.id === snake.id) {
      return true
    } else if (this.rightPredator && this.rightPredator.id === snake.id) {
      return true
    } else {
      return false
    }
  }

  preyExists(snake: Battlesnake) : boolean {
    if (this.upPrey && this.upPrey.id === snake.id) {
      return true
    } else if (this.downPrey && this.downPrey.id === snake.id) {
      return true
    } else if (this.leftPrey && this.leftPrey.id === snake.id) {
      return true
    } else if (this.rightPrey && this.rightPrey.id === snake.id) {
      return true
    } else {
      return false
    }
  }
}

// valid states for kissOfDeath: kissOfDeathNo, kissOfDeathMaybe, kissOfDeathCertainty, kissOfDeath3To2Avoidance, kissOfDeath3To1Avoidance, kissOfDeath2To1Avoidance
// valid states for kissOfMurder: kissOfMurderNo, kissOfMurderMaybe, kissOfMurderCertainty
export class KissStates {
  kissOfDeathState: {
    up : KissOfDeathState,
    down: KissOfDeathState,
    left: KissOfDeathState,
    right: KissOfDeathState
  };
  kissOfMurderState: {
    up: KissOfMurderState,
    down: KissOfMurderState,
    left: KissOfMurderState,
    right: KissOfMurderState
  };

  constructor() {
    this.kissOfDeathState = {up: KissOfDeathState.kissOfDeathNo, down: KissOfDeathState.kissOfDeathNo, left: KissOfDeathState.kissOfDeathNo, right: KissOfDeathState.kissOfDeathNo};
    this.kissOfMurderState = {up: KissOfMurderState.kissOfMurderNo, down: KissOfMurderState.kissOfMurderNo, left: KissOfMurderState.kissOfMurderNo, right: KissOfMurderState.kissOfMurderNo};
  }

  // given a set of moves, returns true if any of the moves that are true have a state of "kissOfDeathNo" or an avoidance state
  canAvoidPossibleDeath(moves: Moves): boolean {
    // not including kiss of death maybe & certainty mutual, as opposing snakes are likely to avoid this kill, but those are still possible deaths
    let goodStates : KissOfDeathState[] = [KissOfDeathState.kissOfDeathNo, KissOfDeathState.kissOfDeath3To2Avoidance, KissOfDeathState.kissOfDeath3To1Avoidance, KissOfDeathState.kissOfDeath2To1Avoidance]
    if (moves.validMoves().length === 0) {
      return true // snake is doomed, but not due to kisses of death
    } else if (moves.up && goodStates.includes(this.kissOfDeathState.up)) {
      return true
    } else if (moves.down && goodStates.includes(this.kissOfDeathState.down)) {
      return true
    } else if (moves.left && goodStates.includes(this.kissOfDeathState.left)) {
      return true
    } else if (moves.right && goodStates.includes(this.kissOfDeathState.right)) {
      return true
    } else { // all valid options in moves will lead to possible death
      return false
    }
  }

   // given a set of moves, returns true if any of the moves that are true have a kissOfDeathAvoidance state
   canTauntDeath(moves: Moves): boolean {
    // not including kiss of death maybe & certainty mutual, as opposing snakes are likely to avoid this kill, as those are still possible deaths
    let goodStates : KissOfDeathState[] = [KissOfDeathState.kissOfDeath3To2Avoidance, KissOfDeathState.kissOfDeath3To1Avoidance, KissOfDeathState.kissOfDeath2To1Avoidance]
    if (moves.validMoves().length === 0) {
      return false // snake is doomed, but not due to kisses of death
    } else if (moves.up && goodStates.includes(this.kissOfDeathState.up)) {
      return true
    } else if (moves.down && goodStates.includes(this.kissOfDeathState.down)) {
      return true
    } else if (moves.left && goodStates.includes(this.kissOfDeathState.left)) {
      return true
    } else if (moves.right && goodStates.includes(this.kissOfDeathState.right)) {
      return true
    } else { // none of our moves can taunt death
      return false
    }
  }

  // given a set of moves, returns true if any of the moves that are true do not have a state of "kissOfDeathCertainty" or "kissOfDeathCertaintyMutual"
  // deliberate omission of kissOfDeathCertaintyMutual, which is likely to be avoided by predator snakes
  canAvoidCertainDeath(moves: Moves): boolean {
    let badStates: KissOfDeathState[] = [KissOfDeathState.kissOfDeathCertainty, KissOfDeathState.kissOfDeathCertaintyMutual]
    if (moves.validMoves().length === 0) {
      return true // snake is doomed, but not due to kisses of death
    } else if (moves.up && !badStates.includes(this.kissOfDeathState.up)) {
      return true
    } else if (moves.down && !badStates.includes(this.kissOfDeathState.down)) {
      return true
    } else if (moves.left && !badStates.includes(this.kissOfDeathState.left)) {
      return true
    } else if (moves.right && !badStates.includes(this.kissOfDeathState.right)) {
      return true
    } else { // all valid options in moves will lead to certain death
      return false
    }
  }

  canCommitFaceoffMurder(moves: Moves): boolean {
    if (moves.up && this.kissOfMurderState.up === KissOfMurderState.kissOfMurderFaceoff) {
      return true
    } else if (moves.down && this.kissOfMurderState.down === KissOfMurderState.kissOfMurderFaceoff) {
      return true
    } else if (moves.left && this.kissOfMurderState.left === KissOfMurderState.kissOfMurderFaceoff) {
      return true
    } else if (moves.right && this.kissOfMurderState.right === KissOfMurderState.kissOfMurderFaceoff) {
      return true
    } else {
      return false
    }
  }

  // given a set of moves, returns true if any of the moves that are true may be able to kill if their prey chooses not to avoid it
  canCommitUnlikelyMurder(moves: Moves): boolean {
    if (moves.up && this.kissOfMurderState.up === KissOfMurderState.kissOfMurderAvoidance) {
      return true
    } else if (moves.down && this.kissOfMurderState.down === KissOfMurderState.kissOfMurderAvoidance) {
      return true
    } else if (moves.left && this.kissOfMurderState.left === KissOfMurderState.kissOfMurderAvoidance) {
      return true
    } else if (moves.right && this.kissOfMurderState.right === KissOfMurderState.kissOfMurderAvoidance) {
      return true
    } else {
      return false
    }
  }

  // given a set of moves, returns true if any of the moves that are true may be able to kill
  canCommitPossibleMurder(moves: Moves) : boolean {
    let goodStates : KissOfMurderState[] = [KissOfMurderState.kissOfMurderCertainty, KissOfMurderState.kissOfMurderMaybe]
    if (moves.up && goodStates.includes(this.kissOfMurderState.up)) {
      return true
    } else if (moves.down && goodStates.includes(this.kissOfMurderState.down)) {
      return true
    } else if (moves.left && goodStates.includes(this.kissOfMurderState.left)) {
      return true
    } else if (moves.right && goodStates.includes(this.kissOfMurderState.right)) {
      return true
    } else {
      return false
    }
  }

  // given a set of moves, returns true if any of the moves that are true are certain to kill
  canCommitCertainMurder(moves: Moves) : boolean {
    if (moves.up && this.kissOfMurderState.up === KissOfMurderState.kissOfMurderCertainty) {
      return true
    } else if (moves.down && this.kissOfMurderState.down === KissOfMurderState.kissOfMurderCertainty) {
      return true
    } else if (moves.left && this.kissOfMurderState.left === KissOfMurderState.kissOfMurderCertainty) {
      return true
    } else if (moves.right && this.kissOfMurderState.right === KissOfMurderState.kissOfMurderCertainty) {
      return true
    } else {
      return false
    }
  }
}

export class KissStatesForEvaluate {
  deathState: KissOfDeathState
  predator: Battlesnake | undefined
  murderState: KissOfMurderState
  prey: Battlesnake | undefined

  constructor(deathState: KissOfDeathState, murderState: KissOfMurderState, predator?: Battlesnake, prey?: Battlesnake) {
    this.deathState = deathState
    this.murderState = murderState
    if (predator !== undefined) {
      this.predator = predator
    }
    if (prey !== undefined) {
      this.prey = prey
    }
  }
}

export class SnakeScore {
  score: number // the score returned for the best move at this lookahead
  // board variables that contextualize a score
  snakeLength: number
  foodCountTier: FoodCountTier
  hazardCountTier: HazardCountTier
  snakeCount: number
  // game variables that contextualize a score
  depth: number
  version: string // the version of Jaguar this score was generated with
  gameResult: string // SnakeScore won't know this upon creation, it's up to end() to update it properly. Should be 'win', 'loss', 'tie', or 'unknown'

  constructor(score: number, snakeLength: number, foodCountTier: FoodCountTier, hazardCountTier: HazardCountTier, snakeCount: number, depth: number, _version: string) {
    this.score = score
    this.snakeLength = snakeLength
    this.foodCountTier = foodCountTier
    this.hazardCountTier = hazardCountTier
    this.snakeCount = snakeCount
    this.depth = depth // the depth of lookahead this score corresponds with
    this.gameResult = "unknown" // the fourth gameResult - unknown. To be adjusted later once known.
    this.version = _version
  }

  hashKey(): string {
    return getSnakeScoreHashKey(this.snakeLength, this.foodCountTier, this.hazardCountTier, this.snakeCount, this.depth)
  }
}

export class SnakeScoreForMongo {
  score: number
  hashKey: string
  version: string
  gameResult: string

  constructor(score: number, hashKey: string, _version: string, gameResult: string) {
    this.score = score
    this.hashKey = hashKey
    this.version = _version
    this.gameResult = gameResult
  }
}

export class GameData {
  startingGameState: GameState
  hazardWalls: HazardWalls
  hazardSpiral: HazardSpiral | undefined
  lookahead: number
  timesTaken: number[]
  evaluationsForLookaheads: SnakeScore[] // a record of the bestMove.score returned by _decideMove, & some context
  prey: Battlesnake | undefined
  isDuel: boolean
  timeouts: number
  priorDeepeningMoves: MoveWithEval[]
  lastMoveTime: number

  constructor(gameState: GameState) {
    this.startingGameState = gameState
    this.hazardWalls = new HazardWalls(undefined)
    this.hazardSpiral = undefined
    this.lookahead = 0
    this.timesTaken = []
    this.evaluationsForLookaheads = []
    this.prey = undefined
    this.isDuel = false
    this.timeouts = 0
    this.priorDeepeningMoves = []
    this.lastMoveTime = Date.now()
  }
}

export class TimingStats {
  average: number
  max: number
  variance: number
  populationStandardDeviation: number
  gameResult: string

  constructor(average: number, max: number, variance: number, populationStandardDeviation: number, gameResult: string) {
    this.average = average
    this.max = max
    this.variance = variance
    this.populationStandardDeviation = populationStandardDeviation
    this.gameResult = gameResult
  }
}

export class TimingData {
  average: number
  max: number
  populationStandardDeviaton: number
  gameResult: string
  version: string
  amMachineLearning: boolean
  amUsingMachineData: boolean
  timeout: number
  gameMode: string
  isDevelopment: boolean
  source: string
  hazardDamage: number
  map: string
  snakeLength: number
  numTimeouts: number

  constructor(timingStats: TimingStats, amMachineLearning: boolean, amUsingMachineData: boolean, gameResult: string, _version: string, timeout: number, gameMode: string, isDevelopment: boolean, source: string, hazardDamage: number, map: string | undefined, snakeLength: number, numTimeouts: number) {
    this.average = timingStats.average
    this.max = timingStats.max
    this.populationStandardDeviaton = timingStats.populationStandardDeviation
    this.version = _version
    this.amMachineLearning = amMachineLearning
    this.amUsingMachineData = amUsingMachineData
    this.gameResult = gameResult
    this.timeout = timeout
    this.gameMode = gameMode
    this.isDevelopment = isDevelopment
    this.source = source
    this.hazardDamage = hazardDamage
    this.map = map !== undefined? map : ""
    this.snakeLength = snakeLength
    this.numTimeouts = numTimeouts
  }
}

// at this point just for debugging, useful in visualizing the path snake took to making a decision
export class Leaf {
  value: MoveWithEval // the evalState score a state resolved upon
  evaluationResult: EvaluationResult | undefined // the evaluationResult of evalThisState
  children: Leaf[]
  parent: Leaf | undefined
  depth: number

  constructor(value: MoveWithEval, evaluationResult: EvaluationResult | undefined, children: Leaf[], depth: number, parent?: Leaf) {
    this.value = value
    this.evaluationResult = evaluationResult
    this.children = children
    this.depth = depth
    if (parent !== undefined) {
      parent.children.push(this) 
    }
    this.parent = parent
  }
}

export class Tree {
  root: Leaf

  constructor(myself: Battlesnake, root?: Leaf) {
    if (root) {
      this.root = root
    } else {
      this.root = new Leaf(new MoveWithEval(undefined, undefined), new EvaluationResult(myself), [], 0, undefined)
    }
  }

  // breadth-first traversal of Tree
  toString(): string {
    let str: string = ""
    let collection: Leaf[] = [this.root]

    while (collection.length) {
      let leaf = collection.shift()
      if (leaf) {
        str = str + leaf.value.toString() + " " // all leaves should be at least a space apart
        collection.push(...leaf.children)
        if (collection && collection[0] && collection[0].depth !== leaf.depth) { // if next leaf in tree has a depth that is not leaf's depth, add a new line
          str = str + "\nDepth: " + collection[0].depth + "\n"
          if (collection[0].parent) {
            str = str + "Parent: " + collection[0].parent.value.toString() + "; "
          }
        } else if (collection && collection[0] && collection[0].parent !== leaf.parent) { // if next leaf in tree has different parent than leaf's parent, add a line
          str = str + "\n"
          if (collection[0].parent) {
            str = str + "Parent: " + collection[0].parent.value.toString() + "; "
          }
        }
      } else {
        return "there was an undefined leaf in the tree!"
      }
    }
    return str
  }
}

export class EvaluationResult {
  myself: Battlesnake
  base: number = 0
  hazard: number = 0
  hazardWall: number = 0
  kissOfDeath: number = 0
  kissOfMurder: number = 0
  kissOfMurderSelfBonus: number = 0
  cutoffHazard: number = 0
  priorKissOfDeath: number = 0
  priorKissOfMurder: number = 0
  priorKissOfMurderSelfBonus: number = 0
  delta: number = 0
  health: number = 0
  otherSnakeHealth: number = 0
  food: number = 0
  foodEaten: number = 0 // used in duels to reward snake based on how recently it's eaten
  voronoiSelf: number = 0
  voronoiPredator: number = 0
  tailChasePenalty: number = 0 // for chasing other snake tails
  selfMoves: number = 0

  // scores specific to certain game modes (wrapped, solo)
  tailChase: number = 0 // for chasing my own tail
  center: number = 0
  flipFlop: number = 0
  flipFlopTail: number = 0

  // scores related to win, loss & ties
  tieValue: number = 0
  noMe: number = 0
  winValue: number = 0

  constructor(myself: Battlesnake) {
    this.myself = myself
  }

  sum(minimum?: number): number {
    let sum: number = 0
    for (const property in this) {
      let val: any = this[property]
      if (typeof val === "number") { // as of writing only 'myself' is a non-number. For now, any other number in here we want to add to sum.
        sum = sum + val
      }
    }
    if (minimum !== undefined && sum < minimum) { // sum should not be any lower than minimum
      logToFile(consoleWriteStream, `sum of ${sum} was less than minimum of ${minimum}`)
      sum = minimum
    }
    return sum
  }

  toString(): string {
    let str: string = ""
    function buildString(appendStr: string) : void {
      if (str === "") {
        str = appendStr
      } else {
        str = str + "\n" + appendStr
      }
    }

    buildString(`eval snake ${this.myself.name} at (${this.myself.head.x},${this.myself.head.y}))`)

    let thisObj = this
    let props = Object.keys(thisObj) as Array<keyof typeof thisObj>
    props.sort() // order doesn't particularly matter, so long as it's consistent for comparison's sake
    for (const prop of props) {
      let val = thisObj[prop]
      if (typeof val === "number") {
        buildString(`${prop.toString()} score: ${val}`)
      }
    }
    buildString(`total: ${this.sum()}`)

    return str
  }
}