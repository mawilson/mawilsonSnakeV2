import { WriteStream } from 'fs';
import { Board } from "./types"
import { Coord, Battlesnake, BoardCell, Board2d, Moves } from "./classes"

export function logToFile(file: WriteStream, str: string) {
  console.log(str)
  file.write(`${str}
  `)
}

export function getRandomInt(min: number, max: number) : number {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min) + min); //The maximum is exclusive and the minimum is inclusive
}

export function coordsEqual(c1: Coord, c2: Coord): boolean {
    return (c1.x === c2.x && c1.y === c2.y)
  }

export function logCoord(coord: Coord, file: WriteStream, descriptor: string) : void {
  logToFile(file, `${descriptor}: (${coord.x},${coord.y})`)
}

// returns true if snake health is max, indicating it ate this turn
export function snakeHasEaten(snake: Battlesnake) : boolean {
  //logToFile(`snakeHasEaten: snake at (${snake.head.x},${snake.head.y}) length: ${snake.length}; body length: ${snake.body.length}; snake health: ${snake.health}`)
  return (snake.health === 100 && snake.length > 1)
}

// returns minimum number of moves between input coordinates
export function getDistance(c1: Coord, c2: Coord) : number {
  return Math.abs(c1.x - c2.x) + Math.abs(c1.y - c2.y)
}

export function getCoordAfterMove(coord: Coord, move: string) : Coord {
  let newPosition : Coord = new Coord(coord.x, coord.y)
  switch (move) {
    case "up":
      newPosition.y = newPosition.y + 1
      break;
    case "down":
      newPosition.y = newPosition.y - 1
      break;
    case "left":
      newPosition.x = newPosition.x - 1
      break
    default: // case "right":
      newPosition.x = newPosition.x + 1
      break
  }
  return newPosition
}

export function getSurroundingCells(coord : Coord, board2d: Board2d, directionFrom: string) : BoardCell[] {
  let surroundingCells : BoardCell[] = []
  if (directionFrom !== "left") {
    let newCell = board2d.getCell(new Coord(coord.x - 1, coord.y))
    if (newCell instanceof BoardCell) {
      surroundingCells.push(newCell)
    }
  }
  if (directionFrom !== "right") {
    let newCell = board2d.getCell(new Coord(coord.x + 1, coord.y))
    if (newCell instanceof BoardCell) {
      surroundingCells.push(newCell)
    }
  }
  if (directionFrom !== "down") {
    let newCell = board2d.getCell(new Coord(coord.x, coord.y - 1))
    if (newCell instanceof BoardCell) {
      surroundingCells.push(newCell)
    }
  }
  if (directionFrom !== "up") {
    let newCell = board2d.getCell(new Coord(coord.x, coord.y + 1))
    if (newCell instanceof BoardCell) {
      surroundingCells.push(newCell)
    }
  }

  //logToFile(consoleWriteStream, `cells surrounding (${coord.x},${coord.y}) for ${me.id}`)
  //surroundingCells.forEach(cell => cell.logSelf(me.id))

  return surroundingCells
}

export function isKingOfTheSnakes(me: Battlesnake, board: Board) {
  let kingOfTheSnakes = true
  if (board.snakes.length === 0) { // what is a king without a kingdom?
    return false
  } else {
    board.snakes.forEach(function isSnakeBigger(snake) {
      if (me.length - snake.length < 2) { // if any snake is within 2 lengths of me, I am not fat enough to deprioritize food
        kingOfTheSnakes = false
      }
    })
  }
  return kingOfTheSnakes
}

// finds the longest snake on the board and, in the event of a tie, returns hte one closest to me
export function getLongestSnake(me: Battlesnake, snakes: Battlesnake[]) : Battlesnake | undefined {
  let longestSnake : Battlesnake | undefined = undefined
  let len : number = 0
  let distToMe : number = 0

  snakes.forEach(function findLongestSnake(snake) {
    if (snake.length > len) {
      len = snake.length
      longestSnake = snake
      distToMe = getDistance(me.head, snake.head)
    } else if (snake.length === len) {
      let newDistToMe = getDistance(me.head, snake.head)
      if (newDistToMe < distToMe) { // if it's a tie & this one is closer
        longestSnake = snake
        distToMe = newDistToMe
      }
    }
  })
  return longestSnake
}

export function moveDisabler(moves: Moves, moveToDisable: string) {
  switch (moveToDisable) {
    case "":
      break
    case "up":
      moves.up = false
      break
    case "down":
      moves.down = false
      break
    case "left":
      moves.left = false
      break
    default: //case "right":
      moves.right = false
      break
  }
}