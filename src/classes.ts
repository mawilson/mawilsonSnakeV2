import { ICoord, IBattlesnake } from "./types"
import { logToFile } from "./util"

import { createWriteStream, WriteStream } from 'fs';
let consoleWriteStream = createWriteStream("consoleLogs_classes.txt", {
  encoding: "utf8"
})

export class Coord implements ICoord {
  x: number
  y: number

  constructor(x: number, y: number) {
    this.x = x
    this.y = y
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

  constructor(_width: number, _height: number) {
    this.width = _width;
    this.height = _height;
    this.cells = new Array(_width * _height);
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
}

export class MoveNeighbors {
  upNeighbors: BoardCell[] = [];
  downNeighbors: BoardCell[] = [];
  leftNeighbors: BoardCell[] = [];
  rightNeighbors: BoardCell[] = [];

  constructor(upNeighbors?: BoardCell[], downNeighbors?: BoardCell[], leftNeighbors?: BoardCell[], rightNeighbors?: BoardCell[]) {
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
  }

  // returns true if some upNeighbor snake exists of equal or longer length than me
  huntedAtUp(len: number) : boolean {
    let biggerSnake : boolean = false;
    this.upNeighbors.forEach(function checkNeighbors(cell) {
      if (cell.snakeCell instanceof SnakeCell && cell.snakeCell.isHead && cell.snakeCell.snake.length >= len) {
        biggerSnake = true;
      }
    });
    return biggerSnake;
  }
  

  // returns true if upNeighbors exist, but no upNeighbor snake exists of equal or longer length than me
  huntingAtUp(len: number) : boolean {
    let upNeighborSnakes : number = 0
    let biggerSnake : boolean = true;
    this.upNeighbors.forEach(function checkNeighbors(cell) {
      if (cell.snakeCell instanceof SnakeCell && cell.snakeCell.isHead) {
        upNeighborSnakes = upNeighborSnakes + 1;
        if (cell.snakeCell.snake.length >= len) {
          biggerSnake = false;
        }
      }
    });
    return upNeighborSnakes === 0 ? false : biggerSnake; // don't go hunting if there aren't any snake heads nearby
  }

  // returns true if some downNeighbor snake exists of equal or longer length than me
  huntedAtDown(len: number) : boolean {
    let biggerSnake : boolean = false;
    this.downNeighbors.forEach(function checkNeighbors(cell) {
      if (cell.snakeCell instanceof SnakeCell && cell.snakeCell.isHead && cell.snakeCell.snake.length >= len) {
        biggerSnake = true;
      }
    });
    return biggerSnake;
  }
  
  // returns true if downNeighbors exist, but no downNeighbor snake exists of equal or longer length than me
  huntingAtDown(len: number) : boolean {
    let downNeighborSnakes : number = 0
    let biggerSnake : boolean = true;
    this.downNeighbors.forEach(function checkNeighbors(cell) {
      if (cell.snakeCell instanceof SnakeCell && cell.snakeCell.isHead) {
        downNeighborSnakes = downNeighborSnakes + 1;
        if (cell.snakeCell.snake.length >= len) {
          biggerSnake = false;
        }
      }
    });
    return downNeighborSnakes === 0 ? false : biggerSnake; // don't go hunting if there aren't any snake heads nearby
  }

  // returns true if some leftNeighbor snake exists of equal or longer length than me
  huntedAtLeft(len: number) : boolean {
    let biggerSnake : boolean = false;
    this.leftNeighbors.forEach(function checkNeighbors(cell) {
      if (cell.snakeCell instanceof SnakeCell && cell.snakeCell.isHead &&cell.snakeCell.snake.length >= len) {
        biggerSnake = true;
      }
    });
    return biggerSnake;
  }
  
  // returns true if leftNeighbors exist, but no leftNeighbor snake exists of equal or longer length than me
  huntingAtLeft(len: number) : boolean {
    let leftNeighborSnakes : number = 0
    let biggerSnake : boolean = true;
    this.leftNeighbors.forEach(function checkNeighbors(cell) {
      if (cell.snakeCell instanceof SnakeCell && cell.snakeCell.isHead) {
        leftNeighborSnakes = leftNeighborSnakes + 1;
        if (cell.snakeCell.snake.length >= len) {
          biggerSnake = false;
        }
      }
    });
    return leftNeighborSnakes === 0 ? false : biggerSnake; // don't go hunting if there aren't any snake heads nearby
  }

  // returns true if some rightNeighbor snake exists of equal or longer length than me
  huntedAtRight(len: number) : boolean {
    let biggerSnake : boolean = false;
    this.rightNeighbors.forEach(function checkNeighbors(cell) {
      if (cell.snakeCell instanceof SnakeCell && cell.snakeCell.isHead && cell.snakeCell.snake.length >= len) {
        biggerSnake = true;
      }
    });
    return biggerSnake;
  }
  
  // returns true if rightNeighbors exist, but no rightNeighbor snake exists of equal or longer length than me
  huntingAtRight(len: number) : boolean {
    let rightNeighborSnakes : number = 0
    let biggerSnake : boolean = true;
    this.rightNeighbors.forEach(function checkNeighbors(cell) {
      if (cell.snakeCell instanceof SnakeCell && cell.snakeCell.isHead) {
        rightNeighborSnakes = rightNeighborSnakes + 1;
        if (cell.snakeCell.snake.length >= len) {
          biggerSnake = false;
        }
      }
    });
    return rightNeighborSnakes === 0 ? false : biggerSnake; // don't go hunting if there aren't any snake heads nearby
  }
}