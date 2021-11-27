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

  getCell(coord: Coord) : BoardCell {
    let x = coord.x;
    let y = coord.y;
    let idx = y * this.width + x;
    if (!this.cells[idx]) { // if this BoardCell has not yet been instantiated, do so
      this.cells[idx] = new BoardCell(new Coord(x, y), false, false);
    }
    return this.cells[idx];
  }

  logCell(coord: Coord) : void {
    let cell = this.getCell(coord);
    cell.logSelf();
    // console.log(`board2d at (${coord.x},${coord.y}) food: ${cell.food}`);
    // console.log(`board2d at (${coord.x},${coord.y}) hazard: ${cell.hazard}`);
    // console.log(`board2d at (${coord.x},${coord.y}) has snake: ${cell.snakeCell !== undefined}`);
  }

  logBoard() : void {
    for (let i = 0; i < this.width; i++) {
      for (let j = 0; j < this.height; j++) {
        let tempCoord = new Coord(i, j);
        this.logCell(tempCoord);
      }
    }
  }

  hasSnake(coord: Coord, inputSnake: Battlesnake) : boolean {
    let cell = this.getCell(coord);
    return cell.snakeCell ? cell.snakeCell.snake.id === inputSnake.id : false;
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
}