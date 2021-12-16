import { InfoResponse, GameState, MoveResponse, Game, Board } from "./types"
import { Coord, SnakeCell, Board2d, Moves, MoveNeighbors, BoardCell, Battlesnake } from "./classes"
import { logToFile, moveSnake, checkForSnakesHealthAndWalls, updateGameStateAfterMove, decideMove } from "./util"
import { evaluate } from "./eval"

import { createWriteStream } from 'fs'
let consoleWriteStream = createWriteStream("consoleLogs_logic.txt", {
  encoding: "utf8"
})

export function info(): InfoResponse {
    console.log("INFO")
    // Jaguar
    const response: InfoResponse = {
        apiversion: "1",
        author: "waryferryman",
        color: "#ff9900", // #ff9900
        head: "tiger-king", //"tiger-king",
        tail: "mystic-moon" //"mystic-moon"
    }

    // Test Snake
    // const response: InfoResponse = {
    //   apiversion: "1",
    //   author: "waryferryman",
    //   color: "#ff9900", // #ff9900
    //   head: "trans-rights-scarf", //"tiger-king",
    //   tail: "comet" //"mystic-moon"
    // }

    return response
}

export function start(gameState: GameState): void {
    console.log(`${gameState.game.id} START`)
}

export function end(gameState: GameState): void {
    console.log(`${gameState.game.id} END\n`)
}

// TODO
// start looking ahead!
// replace all lets with consts where appropriate
// change tsconfig to noImplicitAny: true

// helper function for move recursion
// function _move(gameState: GameState, isBaseCase?: number, otherSelf?: Battlesnake): MoveResponse {

// }

// optional params indicate base case (so recursion doesn't run indefinitely) & the other snake to run on
// this function will move gameState.you in the best way it knows how, and will ALSO move all other snakes in the game according to the same algorithm
// gameState WILL change after this function runs - each snake on the board will have moved once!
export function move(gameState: GameState, isBaseCase?: boolean, otherSelf?: Battlesnake): MoveResponse {
    //logToFile(consoleWriteStream, `turn: ${gameState.turn}`)    
    
    let possibleMoves : Moves = new Moves(true, true, true, true)

    let myself: Battlesnake
    if (typeof otherSelf !== "undefined") {
      myself = otherSelf
    } else {
      myself = gameState.you
    }
    let otherSnakes: Battlesnake[] = gameState.board.snakes.filter(function filterMeOut(snake) { return snake.id !== myself.id})

    let board2d = new Board2d(gameState.board)
    
    let timeBeginning = Date.now()

    checkForSnakesHealthAndWalls(myself, gameState, board2d, possibleMoves)
    //logToFile(consoleWriteStream, `possible moves after checkForSnakesAndWalls: ${possibleMoves}`)

    if (!isBaseCase) { // base case - don't want to run on other snakes
      let moveSnakes : { [key: string]: string} = {} // array of snake IDs & the direction each snake having that ID wishes to move in
      otherSnakes.forEach(function mvsnk(snake) { // before evaluating myself snake's next move, get the moves of each other snake as if it moved the way I would
        moveSnakes[snake.id] = move(gameState, true, snake).move
      })
      otherSnakes.forEach(function mvsnk(snake) { // move each of the snakes at the same time, without updating gameState until each has moved
        if (moveSnakes[snake.id]) {
          moveSnake(gameState, snake, board2d, moveSnakes[snake.id])
        }
      })
      updateGameStateAfterMove(gameState) // after each otherSnake has moved, evaluate the new state
    }

    //const safeMoves = possibleMoves.validMoves()
    let chosenMove : string = decideMove(gameState, possibleMoves, myself, board2d)
    let response: MoveResponse = {
        move: chosenMove
    }
    
    if (!isBaseCase) { // again, base case - don't want to run on other snakes, as they've already moved at this point
      moveSnake(gameState, myself, board2d, chosenMove)
      updateGameStateAfterMove(gameState) // after I have moved, evaluate the new state
    }
    //checkTime()

    logToFile(consoleWriteStream, `${gameState.game.id} MOVE ${gameState.turn}: ${response.move}, newCoord: ${myself.head}`)

    //logToFile(consoleWriteStream, `myself: ${snakeToString(myself)}`)
    return response
}
