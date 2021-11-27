import { WriteStream } from 'fs';
//import { GameState } from "./types"
import { Coord, Battlesnake } from "./classes"

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

