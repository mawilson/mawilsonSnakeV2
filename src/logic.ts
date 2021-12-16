import { InfoResponse, GameState, MoveResponse, Game, Board } from "./types"
import { Coord, SnakeCell, Board2d, Moves, MoveNeighbors, BoardCell, Battlesnake } from "./classes"
import { logToFile, getRandomInt, snakeHasEaten, coordsEqual, getDistance, getCoordAfterMove, getSurroundingCells, isKingOfTheSnakes, getLongestSnake, snakeToString, coordToString, cloneGameState, moveSnake, checkForSnakesHealthAndWalls, checkForHealth, checkTime, findMoveNeighbors, findKissDeathMoves, findKissMurderMoves, getKissOfDeathState, updateGameStateAfterMove, kissDecider } from "./util"
import { evaluate } from "./eval"

import { createWriteStream } from 'fs'
let consoleWriteStream = createWriteStream("consoleLogs_logic.txt", {
  encoding: "utf8"
})

export function info(): InfoResponse {
    console.log("INFO")
    // Jaguar
    // const response: InfoResponse = {
    //     apiversion: "1",
    //     author: "waryferryman",
    //     color: "#ff9900", // #ff9900
    //     head: "tiger-king", //"tiger-king",
    //     tail: "mystic-moon" //"mystic-moon"
    // }

    // Test Snake
    const response: InfoResponse = {
      apiversion: "1",
      author: "waryferryman",
      color: "#ff9900", // #ff9900
      head: "trans-rights-scarf", //"tiger-king",
      tail: "comet" //"mystic-moon"
  }
    return response
}

export function start(gameState: GameState): void {
    console.log(`${gameState.game.id} START`)
}

export function end(gameState: GameState): void {
    console.log(`${gameState.game.id} END\n`)
}

// start looking ahead!
// replace random movement entirely
// replace all lets with consts where appropriate
// change tsconfig to noImplicitAny: true

// optional params indicate base case (so recursion doesn't run indefinitely) & the other snake to run on
export function move(gameState: GameState, isBaseCase?: boolean, otherSelf?: Battlesnake): MoveResponse {
    //logToFile(consoleWriteStream, `turn: ${gameState.turn}`)    
    
    let possibleMoves : Moves = new Moves(true, true, true, true)

    let myself: Battlesnake
    if (typeof otherSelf !== "undefined") {
      myself = otherSelf
    } else {
      myself = gameState.you
    }
    let myHead: Coord = myself.head
    let otherSnakes: Battlesnake[] = gameState.board.snakes.filter(function filterMeOut(snake) { return snake.id !== myself.id})

    let board2d = new Board2d(gameState.board)
    
    let timeBeginning = Date.now()

    //logToFile(consoleWriteStream, `myTail: ${coordToString(myTail)}`)
    //logToFile(consoleWriteStream, `myHead: ${coordToString(myHead)}`)

    checkForSnakesHealthAndWalls(myself, gameState, board2d, possibleMoves)
    //logToFile(consoleWriteStream, `possible moves after checkForSnakesAndWalls: ${possibleMoves}`)

    let moveNeighbors = findMoveNeighbors(myself, board2d, possibleMoves)
    let kissOfMurderMoves = findKissMurderMoves(myself, board2d, moveNeighbors)
    let kissOfDeathMoves = findKissDeathMoves(myself, board2d, moveNeighbors)
    //logToFile(evalWriteStream, `kissOfMurderMoves: ${kissOfMurderMoves.toString()}`)
    //logToFile(evalWriteStream, `kissOfDeathMoves: ${kissOfDeathMoves.toString()}`)

     let kissStates = kissDecider(gameState, moveNeighbors, kissOfDeathMoves, kissOfMurderMoves, possibleMoves, board2d)

    // let kissOfDeathState : string = getKissOfDeathState(moveNeighbors, kissOfDeathMoves, possibleMoves)
    // let kissOfMurderState : string = "kissOfMurderNo"
    
    // Finally, choose a move from the available safe moves.
    // TODO: Step 5 - Select a move to make based on strategy, rather than random.
    
    // This function will determine the movement strategy for available moves. Should take in the board, the snakes, our health, the turn, etc. May want to replace this with lookahead functions later
    function decideMove(gameState: GameState, moves: Moves) : string {
      let availableMoves : string[] = moves.validMoves()
      //logToFile(consoleWriteStream, `moves after checking for snakes, health, & walls: ${moves}`)
      if (availableMoves.length < 1) { // given no good options, always choose another snake tile. It may die, which would make it a valid space again.
        let snakeMoves : Moves = new Moves(true, true, true, true)
        checkForHealth(myself, gameState, board2d, snakeMoves) // reset available moves to only exclude moves which kill me by wall or health. Snakecells are valid again
        //logToFile(consoleWriteStream, `snakeMoves after checking for just health & walls: ${snakeMoves}`)
        availableMoves = snakeMoves.validMoves()
        //logToFile(consoleWriteStream, `availableMoves after reassignment: ${availableMoves.toString()}`)
      }
      if (availableMoves.length < 1) { // if there are still no available moves, this means we're starving no matter what. Choose any direction that isn't a wall
        if (myself.head.x !== 0) { // if we're not on left wall, move left
          return "left"
        } else { // else we are on the left wall, so move right
          return "right"
        }
      } else if (availableMoves.length === 1) {
        return availableMoves[0]
      }

      // of the available remaining moves, evaluate the gameState if we took that move, and then choose the move resulting in the highest scoring gameState
      let bestMove : string | undefined = undefined
      let bestMoveEval : number | undefined = undefined

      //logToFile(consoleWriteStream, `availableMoves for ${myself.name}: ${availableMoves}`)
      availableMoves.forEach(function evaluateMove(move) {
        let newGameState = cloneGameState(gameState)
        let newBoard2d = new Board2d(newGameState.board)

        let newSelf: Battlesnake | undefined
        if (typeof otherSelf !== "undefined") {
          newSelf = newGameState.board.snakes.find(function findSnake(snake) {
            return snake.id === otherSelf.id
          })
        } else {
          newSelf = newGameState.you
        }

        if (newSelf instanceof Battlesnake) {
          moveSnake(newGameState, newSelf, newBoard2d, move)
          updateGameStateAfterMove(newGameState) // update gameState after moving myself
          let kissOfDeathState : string = ""
          let kissOfMurderState : string = ""
          switch (move) {
            case "up":
              kissOfDeathState = kissStates.kissOfDeathState.up
              kissOfMurderState = kissStates.kissOfMurderState.up
              break
            case "down":
              kissOfDeathState = kissStates.kissOfDeathState.down
              kissOfMurderState = kissStates.kissOfMurderState.down
              break
            case "left":
              kissOfDeathState = kissStates.kissOfDeathState.left
              kissOfMurderState = kissStates.kissOfMurderState.left
              break
            default: // case "right":
              kissOfDeathState = kissStates.kissOfDeathState.right
              kissOfMurderState = kissStates.kissOfMurderState.right
              break
          }
          let evalState: number = evaluate(newGameState, newSelf, kissOfDeathState, kissOfMurderState, (myself.health < 10))
          //logToFile(consoleWriteStream, `eval for ${newSelf.name} at (${newSelf.head.x},${newSelf.head.y}): ${evalState}`)
          //logToFile(consoleWriteStream, `prior best move: ${bestMove}, best move eval: ${bestMoveEval}`)
          if (bestMoveEval === undefined || (evalState > bestMoveEval)) {
            //logToFile(consoleWriteStream, `replacing prior best move ${bestMove} with eval ${bestMoveEval} with new move ${move} & eval ${evalState}`)
            bestMove = move
            bestMoveEval = evalState
          } else if ((evalState === bestMoveEval) && getRandomInt(0, 2)) { // in the event of tied evaluations, choose between them at random
            //logToFile(consoleWriteStream, `replacing prior best move ${bestMove} with eval ${bestMoveEval} with new move ${move} & eval ${evalState}`)
            bestMove = move
            bestMoveEval = evalState
          }
        }
      })
      if (bestMove === undefined) {
        logToFile(consoleWriteStream, `bestMove still undefined at end of decideMove, using up as default`)
        bestMove = "up"
      }

      return bestMove
    }

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
    let chosenMove : string = decideMove(gameState, possibleMoves)
    let response: MoveResponse = {
        move: chosenMove
    }
    
    let newCoord = getCoordAfterMove(myHead, chosenMove)

    //checkTime()

    logToFile(consoleWriteStream, `${gameState.game.id} MOVE ${gameState.turn}: ${response.move}, newCoord: ${newCoord}`)

    //logToFile(consoleWriteStream, `myself: ${snakeToString(myself)}`)
    return response
}
