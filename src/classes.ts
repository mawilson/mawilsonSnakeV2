
import { ICoord, IBattlesnake, Board, GameState } from "./types"
import { logToFile, getRelativeDirection, coordsEqual, snakeHasEaten } from "./util"

import { createWriteStream, WriteStream } from 'fs';
let consoleWriteStream = createWriteStream("consoleLogs_classes.txt", {
  encoding: "utf8"
})

export enum Direction {
  Up,
  Down,
  Left,
  Right
}

export function directionToString(dir: Direction | undefined) {
  switch (dir) {
    case Direction.Up:
      return "up"
    case Direction.Down:
      return "down"
    case Direction.Left:
      return "left"
    case Direction.Right:
      return "right"
    default:
      return "undefined"
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
  kissOfMurderCertainty
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

  constructor(direction: Direction | undefined, score: number | undefined) {
    this.direction = direction
    this.score = score
  }

  toString() : string {
    return `Direction: ${directionToString(this.direction)}, score: ${this.score}`
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
  isHead: boolean
  isTail: boolean
  hasEaten: boolean

  constructor(snake: Battlesnake, head: boolean, tail: boolean) {
    this.snake = snake
    this.isHead = head
    this.isTail = tail
    this.hasEaten = snakeHasEaten(snake)
  }
}

export class BoardCell {
  snakeCell?: SnakeCell;
  food: boolean;
  hazard: boolean;
  coord: Coord;

  constructor(_coord: Coord, _food: boolean, _hazard: boolean, _snakeCell?: SnakeCell) {
    this.snakeCell = _snakeCell;
    this.food = _food;
    this.hazard = _hazard;
    this.coord = _coord;
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

export class Board2d {
  private cells: Array<BoardCell>;
  width: number;
  height: number;

  constructor(board: Board) {
    this.width = board.width;
    this.height = board.height;
    this.cells = new Array(this.width * this.height);
    let self : Board2d = this

    function processSnake(inputSnake : Battlesnake) : void {
      inputSnake.body.forEach(function addSnakeCell(part : Coord) : void {
        let newSnakeCell = new SnakeCell(inputSnake, coordsEqual(part, inputSnake.head), coordsEqual(part, inputSnake.body[inputSnake.body.length - 1])),
            board2dCell = self.getCell(part)
        if (board2dCell) {
          board2dCell.snakeCell = newSnakeCell
        }
      })
    }

    //processSnake(you) // not necessary as board.snakes contains self
    board.snakes.forEach(processSnake)

    board.food.forEach(function addFood(coord : Coord) : void {
      let board2dCell = self.getCell(coord);
      if (board2dCell instanceof BoardCell) {
        board2dCell.food = true;
      }
    })

    let _this = this;
    board.hazards.forEach(function addHazard(coord: Coord) : void {
      let board2dCell = self.getCell(coord)
      if (board2dCell instanceof BoardCell) {
        board2dCell.hazard = true;
      }
    })
  }

  getCell(coord: Coord) : BoardCell | undefined {
    let x = coord.x;
    let y = coord.y;
    let idx = y * this.width + x;
    if (coord.x < 0 || coord.x >= this.width || coord.y < 0 || coord.y >= this.height) {
      return undefined;
    }
    if (!this.cells[idx]) { // if this BoardCell has not yet been instantiated, do so
      this.cells[idx] = new BoardCell(new Coord(x, y), false, false);
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
            str = str + "h"
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

    if (gameState === undefined) {
      this.up = undefined
      this.down = undefined
      this.left = undefined
      this.right = undefined
      return
    }

    if (gameState.game.ruleset.settings.hazardDamagePerTurn > 0) { // if hazard does not exist, we can just leave the walls undefined
      let xValues: { [key: number]: number} = {} // need to count up all hazards & determine if walls exist if gameState.board.height number of cells exist at that x value
      let yValues: { [key: number]: number} = {} // likewise, but for board.width at that y value

      let board2d: Board2d = new Board2d(gameState.board)

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
      case Direction.Right:
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
    if (typeof upNeighbors !== "undefined") {
      this.upNeighbors = upNeighbors;
    }
    if (typeof downNeighbors !== "undefined") {
      this.downNeighbors = downNeighbors;
    }
    if (typeof leftNeighbors !== "undefined") {
      this.leftNeighbors = leftNeighbors;
    }
    if (typeof rightNeighbors !== "undefined") {
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

  // considers ties as larger snakes if in a duel. Returns true if the snake in the cell is larger than myself
  isSnakeCellLarger(cell: BoardCell): boolean {
    if (cell.snakeCell instanceof SnakeCell && cell.snakeCell.isHead) { // if cell has a snake
      if (cell.snakeCell.snake.length >= this.me.length && !this.isDuel) { // if that snake is larger or equal than me, & we're not dueling
        return true
      } else if (cell.snakeCell.snake.length > this.me.length && this.isDuel) { // if that snake is larger than me, & we're dueling
        return true
      }
    }
    return false // snake either doesn't exist, or isn't larger/tied depending on isDuel
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
    let _this = this; // forEach function will have its own this, don't muddle them
    let biggerSnake : boolean = false;
    this.upNeighbors.forEach(function checkNeighbors(cell) {
      if (cell.snakeCell instanceof SnakeCell && _this.isSnakeCellLarger(cell)) {
        biggerSnake = true;
        _this.upPredator = cell.snakeCell.snake
        if (_this.huntingSnakes[cell.snakeCell.snake.id]) {
          _this.huntingSnakes[cell.snakeCell.snake.id].up = true;
        } else {
          _this.huntingSnakes[cell.snakeCell.snake.id] = new Moves(true, false, false, false);
        }
      }
    });
    return biggerSnake;
  }
  

  // returns true if upNeighbors exist, but no upNeighbor snake exists of equal or longer length than me
  private _huntingAtUp() : boolean {
    let _this = this; // forEach function will have its own this, don't muddle them
    let upNeighborSnakes : number = 0
    let biggerSnake : boolean = true;
    this.upNeighbors.forEach(function checkNeighbors(cell) {
      if (cell.snakeCell instanceof SnakeCell && cell.snakeCell.isHead) {
        upNeighborSnakes = upNeighborSnakes + 1;
        if (_this.isSnakeCellLargerOrTied(cell)) {
          biggerSnake = false;
        } else {
          _this.upPrey = cell.snakeCell.snake;
        }
      }
    });
    return upNeighborSnakes === 0 ? false : biggerSnake; // don't go hunting if there aren't any snake heads nearby
  }

  // returns true if some downNeighbor snake exists of equal or longer length than me
  // also populates huntingSnakes with info about its potential killers & what directions they can come from
  private _huntedAtDown() : boolean {
    let _this = this; // forEach function will have its own this, don't muddle them
    let biggerSnake : boolean = false;
    this.downNeighbors.forEach(function checkNeighbors(cell) {
      if (cell.snakeCell instanceof SnakeCell && _this.isSnakeCellLarger(cell)) {
        biggerSnake = true;
        _this.downPredator = cell.snakeCell.snake
        if (_this.huntingSnakes[cell.snakeCell.snake.id]) {
          _this.huntingSnakes[cell.snakeCell.snake.id].down = true;
        } else {
          _this.huntingSnakes[cell.snakeCell.snake.id] = new Moves(false, true, false, false);
        }
      }
    });
    return biggerSnake;
  }
  
  // returns true if downNeighbors exist, but no downNeighbor snake exists of equal or longer length than me
  private _huntingAtDown() : boolean {
    let _this = this; // forEach function will have its own this, don't muddle them
    let downNeighborSnakes : number = 0
    let biggerSnake : boolean = true;
    this.downNeighbors.forEach(function checkNeighbors(cell) {
      if (cell.snakeCell instanceof SnakeCell && cell.snakeCell.isHead) {
        downNeighborSnakes = downNeighborSnakes + 1;
        if (_this.isSnakeCellLargerOrTied(cell)) {
          biggerSnake = false;
        } else {
          _this.downPrey = cell.snakeCell.snake;
        }
      }
    });
    return downNeighborSnakes === 0 ? false : biggerSnake; // don't go hunting if there aren't any snake heads nearby
  }

  // returns true if some leftNeighbor snake exists of equal or longer length than me
  // also populates huntingSnakes with info about its potential killers & what directions they can come from
  private _huntedAtLeft() : boolean {
    let _this = this; // forEach function will have its own this, don't muddle them
    let biggerSnake : boolean = false;
    this.leftNeighbors.forEach(function checkNeighbors(cell) {
      if (cell.snakeCell instanceof SnakeCell && _this.isSnakeCellLarger(cell)) {
        biggerSnake = true;
        _this.leftPredator = cell.snakeCell.snake
        if (_this.huntingSnakes[cell.snakeCell.snake.id]) {
          _this.huntingSnakes[cell.snakeCell.snake.id].left = true;
        } else {
          _this.huntingSnakes[cell.snakeCell.snake.id] = new Moves(false, false, false, true);
        }
      }
    });
    return biggerSnake;
  }
  
  // returns true if leftNeighbors exist, but no leftNeighbor snake exists of equal or longer length than me
  private _huntingAtLeft() : boolean {
    let _this = this; // forEach function will have its own this, don't muddle them
    let leftNeighborSnakes : number = 0
    let biggerSnake : boolean = true;
    this.leftNeighbors.forEach(function checkNeighbors(cell) {
      if (cell.snakeCell instanceof SnakeCell && cell.snakeCell.isHead) {
        leftNeighborSnakes = leftNeighborSnakes + 1;
        if (_this.isSnakeCellLargerOrTied(cell)) {
          biggerSnake = false;
        } else {
          _this.leftPrey = cell.snakeCell.snake;
        }
      }
    });
    return leftNeighborSnakes === 0 ? false : biggerSnake; // don't go hunting if there aren't any snake heads nearby
  }

  // returns true if some rightNeighbor snake exists of equal or longer length than me
  // also populates huntingSnakes with info about its potential killers & what directions they can come from
  private _huntedAtRight() : boolean {
    let _this = this; // forEach function will have its own this, don't muddle them
    let biggerSnake : boolean = false;
    this.rightNeighbors.forEach(function checkNeighbors(cell) {
      if (cell.snakeCell instanceof SnakeCell && _this.isSnakeCellLarger(cell)) {
        biggerSnake = true;
        _this.rightPredator = cell.snakeCell.snake
        if (_this.huntingSnakes[cell.snakeCell.snake.id]) {
          _this.huntingSnakes[cell.snakeCell.snake.id].right = true;
        } else {
          _this.huntingSnakes[cell.snakeCell.snake.id] = new Moves(false, false, true, false);
        }
      }
    });
    return biggerSnake;
  }
  
  // returns true if rightNeighbors exist, but no rightNeighbor snake exists of equal or longer length than me
  private _huntingAtRight() : boolean {
    let _this = this; // forEach function will have its own this, don't muddle them
    let rightNeighborSnakes : number = 0
    let biggerSnake : boolean = true;
    this.rightNeighbors.forEach(function checkNeighbors(cell) {
      if (cell.snakeCell instanceof SnakeCell && cell.snakeCell.isHead) {
        rightNeighborSnakes = rightNeighborSnakes + 1;
        if (_this.isSnakeCellLargerOrTied(cell)) {
          biggerSnake = false;
        } else {
          _this.rightPrey = cell.snakeCell.snake;
        }
      }
    });
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
    // not including kiss of death maybe & certainty mutual, as opposing snakes are likely to avoid this kill, as those are still possible deaths
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