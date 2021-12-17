
import { ICoord, IBattlesnake, Board } from "./types"
import { logToFile, getRelativeDirection, coordsEqual } from "./util"

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

export enum KissOfDeathState {
  kissOfDeathNo,
  kissOfDeathMaybe,
  kissOfDeathCertainty,
  kissOfDeath3To2Avoidance,
  kissOfDeath3To1Avoidance,
  kissOfDeath2To1Avoidance
}

export enum KissOfMurderState {
  kissOfMurderNo,
  kissOfMurderMaybe,
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
  direction: string | undefined
  score: number | undefined

  constructor(direction: string | undefined, score: number | undefined) {
    this.direction = direction
    this.score = score
  }

  toString() : string {
    return `Direction: ${this.direction}, score: ${this.score}`
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
  snake: Battlesnake;
  isHead: boolean;
  isTail: boolean;

  constructor(snake: Battlesnake, head: boolean, tail: boolean) {
    this.snake = snake;
    this.isHead = head;
    this.isTail = tail;
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

  logSelf(str? : string) : void {
    logToFile(consoleWriteStream, `${str}; BoardCell at (${this.coord.x},${this.coord.y}) has snake: ${!!this.snakeCell}; has food: ${this.food}; has hazard: ${this.hazard}`);
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

  logCell(coord: Coord) : void {
    let cell = this.getCell(coord);
    if (cell) {
      cell.logSelf();
    }
  }

  logBoard() : void {
    for (let i = 0; i < this.width; i++) {
      for (let j = 0; j < this.height; j++) {
        let tempCoord = new Coord(i, j);
        this.logCell(tempCoord);
      }
    }
  }

  printBoard() : void {
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

  validMoves() : string[] {
    let moves : string[] = [];
    if (this.up) {
      moves.push("up");
    }
    if (this.down) {
      moves.push("down");
    }
    if (this.left) {
      moves.push("left");
    }
    if (this.right) {
      moves.push("right");
    }
    return moves;
  }

  invalidMoves() : string[] {
    let moves : string[] = [];
    if (!this.up) {
      moves.push("up");
    }
    if (!this.down) {
      moves.push("down");
    }
    if (!this.left) {
      moves.push("left");
    }
    if (!this.right) {
      moves.push("right");
    }
    return moves;
  }

  hasOtherMoves(move: string) : boolean {
    switch (move) {
      case "up":
        return (this.down || this.left || this.right);
      case "down":
        return (this.up || this.left || this.right);
      case "left":
        return (this.up || this.down || this.right);
      default: //case "right":
        return (this.up || this.down || this.left);
    }
  }

  enableMove(move: string) : void {
    switch (move) {
      case "up":
        this.up = true;
        break;
      case "down":
        this.down = true;
        break;
      case "left":
        this.left = true;
        break;
      default: // case "right":
        this.right = true;
        break;
    }
  }

  disableMove(move: string) : void {
    switch (move) {
      case "up":
        this.up = false;
        break;
      case "down":
        this.down = false;
        break;
      case "left":
        this.left = false;
        break;
      default: // case "right":
        this.right = false;
        break;
    }
  }

  disableOtherMoves(move: string) : void {
    switch (move) {
      case "up":
        this.right = false;
        this.left = false;
        this.down = false;
        break;
      case "down":
        this.up = false;
        this.left = false;
        this.right = false;
        break;
      case "left":
        this.up = false;
        this.down = false;
        this.right = false;
        break;
      case "right":
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
  huntingSnakes : { [key: string]: Moves; } = {}; // object containing snakes trying to eat me. Each key is an id, each value a Moves object. Moves objects represent the moves I WENT TOWARDS, not the place the hunting snake came from. This is so that I can actually do something with the information - namely, disable a move direction if it's the only one a hunting snake can reach
  
  upPrey: Battlesnake | undefined = undefined
  downPrey: Battlesnake | undefined = undefined
  leftPrey: Battlesnake | undefined = undefined
  rightPrey: Battlesnake | undefined = undefined

  constructor(me: Battlesnake, upNeighbors?: BoardCell[], downNeighbors?: BoardCell[], leftNeighbors?: BoardCell[], rightNeighbors?: BoardCell[]) {
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
    this.upPrey = undefined;
    this.downPrey = undefined;
    this.leftPrey = undefined;
    this.rightPrey = undefined;
  }

  // returns true if some upNeighbor snake exists of equal or longer length than me
  // also populates huntingSnakes with info about its potential killers & what directions they can come from
  huntedAtUp() : boolean {
    let _this = this; // forEach function will have its own this, don't muddle them
    let biggerSnake : boolean = false;
    this.upNeighbors.forEach(function checkNeighbors(cell) {
      if (cell.snakeCell instanceof SnakeCell && cell.snakeCell.isHead && cell.snakeCell.snake.length >= _this.me.length) {
        biggerSnake = true;
        if (_this.huntingSnakes[cell.snakeCell.snake.id]){
          _this.huntingSnakes[cell.snakeCell.snake.id].up = true;
        } else {
          _this.huntingSnakes[cell.snakeCell.snake.id] = new Moves(true, false, false, false);
        }
      }
    });
    return biggerSnake;
  }
  

  // returns true if upNeighbors exist, but no upNeighbor snake exists of equal or longer length than me
  huntingAtUp() : boolean {
    let _this = this; // forEach function will have its own this, don't muddle them
    let upNeighborSnakes : number = 0
    let biggerSnake : boolean = true;
    this.upNeighbors.forEach(function checkNeighbors(cell) {
      if (cell.snakeCell instanceof SnakeCell && cell.snakeCell.isHead) {
        upNeighborSnakes = upNeighborSnakes + 1;
        if (cell.snakeCell.snake.length >= _this.me.length) {
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
  huntedAtDown() : boolean {
    let _this = this; // forEach function will have its own this, don't muddle them
    let biggerSnake : boolean = false;
    this.downNeighbors.forEach(function checkNeighbors(cell) {
      if (cell.snakeCell instanceof SnakeCell && cell.snakeCell.isHead && cell.snakeCell.snake.length >= _this.me.length) {
        biggerSnake = true;
        if (_this.huntingSnakes[cell.snakeCell.snake.id]){
          _this.huntingSnakes[cell.snakeCell.snake.id].down = true;
        } else {
          _this.huntingSnakes[cell.snakeCell.snake.id] = new Moves(false, true, false, false);
        }
      }
    });
    return biggerSnake;
  }
  
  // returns true if downNeighbors exist, but no downNeighbor snake exists of equal or longer length than me
  huntingAtDown() : boolean {
    let _this = this; // forEach function will have its own this, don't muddle them
    let downNeighborSnakes : number = 0
    let biggerSnake : boolean = true;
    this.downNeighbors.forEach(function checkNeighbors(cell) {
      if (cell.snakeCell instanceof SnakeCell && cell.snakeCell.isHead) {
        downNeighborSnakes = downNeighborSnakes + 1;
        if (cell.snakeCell.snake.length >= _this.me.length) {
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
  huntedAtLeft() : boolean {
    let _this = this; // forEach function will have its own this, don't muddle them
    let biggerSnake : boolean = false;
    this.leftNeighbors.forEach(function checkNeighbors(cell) {
      if (cell.snakeCell instanceof SnakeCell && cell.snakeCell.isHead && cell.snakeCell.snake.length >= _this.me.length) {
        biggerSnake = true;
        if (_this.huntingSnakes[cell.snakeCell.snake.id]){
          _this.huntingSnakes[cell.snakeCell.snake.id].left = true;
        } else {
          _this.huntingSnakes[cell.snakeCell.snake.id] = new Moves(false, false, false, true);
        }
      }
    });
    return biggerSnake;
  }
  
  // returns true if leftNeighbors exist, but no leftNeighbor snake exists of equal or longer length than me
  huntingAtLeft() : boolean {
    let _this = this; // forEach function will have its own this, don't muddle them
    let leftNeighborSnakes : number = 0
    let biggerSnake : boolean = true;
    this.leftNeighbors.forEach(function checkNeighbors(cell) {
      if (cell.snakeCell instanceof SnakeCell && cell.snakeCell.isHead) {
        leftNeighborSnakes = leftNeighborSnakes + 1;
        if (cell.snakeCell.snake.length >= _this.me.length) {
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
  huntedAtRight() : boolean {
    let _this = this; // forEach function will have its own this, don't muddle them
    let biggerSnake : boolean = false;
    this.rightNeighbors.forEach(function checkNeighbors(cell) {
      if (cell.snakeCell instanceof SnakeCell && cell.snakeCell.isHead && cell.snakeCell.snake.length >= _this.me.length) {
        biggerSnake = true;
        if (_this.huntingSnakes[cell.snakeCell.snake.id]){
          _this.huntingSnakes[cell.snakeCell.snake.id].right = true;
        } else {
          _this.huntingSnakes[cell.snakeCell.snake.id] = new Moves(false, false, true, false);
        }
      }
    });
    return biggerSnake;
  }
  
  // returns true if rightNeighbors exist, but no rightNeighbor snake exists of equal or longer length than me
  huntingAtRight() : boolean {
    let _this = this; // forEach function will have its own this, don't muddle them
    let rightNeighborSnakes : number = 0
    let biggerSnake : boolean = true;
    this.rightNeighbors.forEach(function checkNeighbors(cell) {
      if (cell.snakeCell instanceof SnakeCell && cell.snakeCell.isHead) {
        rightNeighborSnakes = rightNeighborSnakes + 1;
        if (cell.snakeCell.snake.length >= _this.me.length) {
          biggerSnake = false;
        } else {
          _this.rightPrey = cell.snakeCell.snake;
        }
      }
    });
    return rightNeighborSnakes === 0 ? false : biggerSnake; // don't go hunting if there aren't any snake heads nearby
  }

  huntingChanceDirections() : Moves {
    let availableMoves = new Moves(true, true, true, true);
    for (const [id, moves] of Object.entries(this.huntingSnakes)) {
      let validMoves = moves.validMoves();
      if (validMoves.length === 1) { // if this is the only move the hunting snake can reach, we assume it will make this move, & thus want to avoid it
        availableMoves.disableMove(validMoves[0]);
      }
    }
    //logToFile(consoleWriteStream, `huntingChanceDirections: ${availableMoves}`)
    return availableMoves;
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

  // given a set of moves, returns true if any of the moves that are true have a state of "kissOfDeathNo"
  canAvoidPossibleDeath(moves: Moves): boolean {
    let goodStates : KissOfDeathState[] = [KissOfDeathState.kissOfDeathNo, KissOfDeathState.kissOfDeath3To2Avoidance, KissOfDeathState.kissOfDeath3To1Avoidance, KissOfDeathState.kissOfDeath2To1Avoidance]
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
    } else { // all valid options in moves will lead to possible death
      return false
    }
  }

  // given a set of moves, returns true if any of the moves that are true do not have a state of "kissOfDeathCertainty"
  canAvoidCertainDeath(moves: Moves): boolean {
    if (moves.validMoves().length === 0) {
      return false // snake is doomed, but not due to kisses of death
    } else if (moves.up && this.kissOfDeathState.up !== KissOfDeathState.kissOfDeathCertainty) {
      return true
    } else if (moves.down && this.kissOfDeathState.down !== KissOfDeathState.kissOfDeathCertainty) {
      return true
    } else if (moves.left && this.kissOfDeathState.left !== KissOfDeathState.kissOfDeathCertainty) {
      return true
    } else if (moves.right && this.kissOfDeathState.right !== KissOfDeathState.kissOfDeathCertainty) {
      return true
    } else { // all valid options in moves will lead to certain death
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