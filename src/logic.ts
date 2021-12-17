import { InfoResponse, GameState, MoveResponse, Game, Board } from "./types"
import { Coord, SnakeCell, Board2d, Moves, MoveNeighbors, BoardCell, Battlesnake, MoveWithEval, KissOfDeathState, KissOfMurderState } from "./classes"
import { logToFile, moveSnake, checkForSnakesHealthAndWalls, updateGameStateAfterMove, findMoveNeighbors, findKissDeathMoves, findKissMurderMoves, kissDecider, checkForHealth, cloneGameState, getRandomInt, getDefaultMove, snakeToString } from "./util"
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

// TODO
// start looking ahead!
// replace all lets with consts where appropriate
// change tsconfig to noImplicitAny: true

function decideMove(gameState: GameState, myself: Battlesnake, board2d: Board2d, startTime: number, lookahead?: number) : MoveWithEval {
  let moves : Moves = new Moves(true, true, true, true)

  checkForSnakesHealthAndWalls(myself, gameState, board2d, moves)
  //logToFile(consoleWriteStream, `possible moves after checkForSnakesAndWalls: ${possibleMoves}`)

  let moveNeighbors = findMoveNeighbors(myself, board2d, moves)
  let kissOfMurderMoves = findKissMurderMoves(myself, board2d, moveNeighbors)
  let kissOfDeathMoves = findKissDeathMoves(myself, board2d, moveNeighbors)
  //logToFile(evalWriteStream, `kissOfMurderMoves: ${kissOfMurderMoves.toString()}`)
  //logToFile(evalWriteStream, `kissOfDeathMoves: ${kissOfDeathMoves.toString()}`)

  let kissStates = kissDecider(gameState, moveNeighbors, kissOfDeathMoves, kissOfMurderMoves, moves, board2d)
  
  let availableMoves : string[] = moves.validMoves()
  //logToFile(consoleWriteStream, `moves after checking for snakes, health, & walls: ${moves}`)
  if (availableMoves.length < 1) { // given no good options, always choose another snake tile. It may die, which would make it a valid space again.
    let snakeMoves : Moves = new Moves(true, true, true, true)
    checkForHealth(myself, gameState, board2d, snakeMoves) // reset available moves to only exclude moves which kill me by wall or health. Snakecells are valid again
    //logToFile(consoleWriteStream, `snakeMoves after checking for just health & walls: ${snakeMoves}`)
    availableMoves = snakeMoves.validMoves()
    //logToFile(consoleWriteStream, `availableMoves after reassignment: ${availableMoves.toString()}`)
  }
  if (availableMoves.length < 1) { // if there are still no available moves, return an undefined score & direction
    return new MoveWithEval(undefined, undefined)
  } 
  // can't skip evaluating even if it's just one move, because we need to know that move's eval score
  //else if (availableMoves.length === 1) {
  //  return {dir: availableMoves[0], eval: undefined}
  //}

  // of the available remaining moves, evaluate the gameState if we took that move, and then choose the move resulting in the highest scoring gameState
  let bestMove : MoveWithEval = new MoveWithEval(undefined, undefined)
  //let bestMove : string | undefined = undefined
  //let bestMoveEval : number | undefined = undefined

  //logToFile(consoleWriteStream, `availableMoves for ${myself.name}: ${availableMoves}`)
  availableMoves.forEach(function evaluateMove(move) {
    let newGameState = cloneGameState(gameState)
    let newBoard2d = new Board2d(newGameState.board)

    let newSelf: Battlesnake | undefined
    newSelf = newGameState.board.snakes.find(function findSnake(snake) {
      return snake.id === myself.id
    })

    if (newSelf instanceof Battlesnake) {
      let otherSnakes: Battlesnake[] = newGameState.board.snakes.filter(function filterMeOut(snake) {
        return newSelf instanceof Battlesnake && (snake.id !== newSelf.id)
      })
      if (newSelf.id === newGameState.you.id) { // only move snakes for self snake, otherwise we recurse all over the place
        // move all snakes on board - newSelf according to availableMoves, otherSnakes according to their own _move result
        let moveSnakes : { [key: string]: MoveWithEval} = {} // array of snake IDs & the MoveWithEval each snake having that ID wishes to move in
        otherSnakes.forEach(function mvsnk(snake) { // before evaluating myself snake's next move, get the moves of each other snake as if it moved the way I would
          moveSnakes[snake.id] = decideMove(newGameState, snake, board2d, startTime) // decide best move for other snakes according to current data
          //moveSnakes[snake.id] = _move(newGameState, startTime, snake)
        })
        otherSnakes.forEach(function mvsnk(snake) { // move each of the snakes at the same time, without updating gameState until each has moved
          if (moveSnakes[snake.id]) {
            moveSnake(newGameState, snake, board2d, moveSnakes[snake.id].direction)
          }
        })
        moveSnake(newGameState, newSelf, newBoard2d, move) // move newSelf to available move
        updateGameStateAfterMove(newGameState) // update gameState after moving all snakes
      } else { // for other snakes, still need to be able to move self to a new position to evaluate it
        moveSnake(newGameState, newSelf, newBoard2d, move) // move newSelf to available move
        updateGameStateAfterMove(newGameState) // update gameState after moving newSelf
      }

      let kissOfDeathState : KissOfDeathState
      let kissOfMurderState : KissOfMurderState
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
      
      let evalState: MoveWithEval // = new MoveWithEval("up", undefined) // no idea why this needs to be defined here
      if ((newSelf.id === newGameState.you.id) && (lookahead !== undefined) && (lookahead > 0)) { // don't run evaluate at this level, run it at the next level
        let moveAhead = _move(newGameState, startTime, newSelf, lookahead - 1) // This is the recursive case!!!
        if (moveAhead !== undefined) { // if looking ahead does not result in undefined, set the evaluation to the lookahead evaluation
          evalState = moveAhead
        } else { // looking ahead resulted in a state that we don't want to consider, evaluate this state instead
          evalState = new MoveWithEval(move, evaluate(newGameState, newSelf, kissOfDeathState, kissOfMurderState, (newSelf.health < 10)))
        }
      } else { // base case, just run the eval
        evalState = new MoveWithEval(move, evaluate(newGameState, newSelf, kissOfDeathState, kissOfMurderState, (newSelf.health < 10)))
      }

      //let evalState: number = evaluate(newGameState, newSelf, kissOfDeathState, kissOfMurderState, (newSelf.health < 10))
      //logToFile(consoleWriteStream, `eval for ${newSelf.name} at (${newSelf.head.x},${newSelf.head.y}): ${evalState}`)
      //logToFile(consoleWriteStream, `prior best move: ${bestMove}, best move eval: ${bestMoveEval}`)
      if (bestMove.score === undefined) { // we don't have a best move yet, assign it to this one (even if its score is also undefined)
        bestMove.direction = move
        bestMove.score = evalState.score
      } else {
        if (evalState.score !== undefined) { // if evalState has a score, we want to compare it to bestMove's score
          if (evalState.score > bestMove.score) { // if evalState represents a better move & score, assign bestMove to it
            //logToFile(consoleWriteStream, `replacing prior best move ${bestMove} with eval ${bestMoveEval} with new move ${move} & eval ${evalState}`)
            bestMove.direction = move
            bestMove.score = evalState.score
          } else if (evalState.score === bestMove.score && getRandomInt(0, 2)) { // in the event of tied evaluations, choose between them at random
            // logToFile(consoleWriteStream, `replacing prior best move ${bestMove} with eval ${bestMoveEval} with new move ${move} & eval ${evalState}`)
            bestMove.direction = move
            bestMove.score = evalState.score
          } // else don't replace bestMove
        } // evalState has no score, & bestMove does, we don't want to replace bestMove with evalState
      }
    }
  })

  return bestMove
}

// optional params indicate base case (so recursion doesn't run indefinitely) & the other snake to run on
// this function will move gameState.you in the best way it knows how, and will ALSO move all other snakes in the game according to the same algorithm
// gameState WILL change after this function runs - each snake on the board will have moved once!
function _move(gameState: GameState, startTime: number, myself: Battlesnake, timesToRun?: number): MoveWithEval {
    
  
  let otherSnakes: Battlesnake[] = gameState.board.snakes.filter(function filterMeOut(snake) { return snake.id !== myself.id})

  let board2d = new Board2d(gameState.board)

  let chosenMove : MoveWithEval = decideMove(gameState, myself, board2d, startTime, timesToRun)

  //checkTime()

  logToFile(consoleWriteStream, `${gameState.game.id} MOVE ${gameState.turn} for ${myself.name}: ${chosenMove}, newCoord: (${myself.head.x},${myself.head.y})`)

  logToFile(consoleWriteStream, `myself: ${snakeToString(myself)}`)
  return chosenMove
}

export function move(gameState: GameState): MoveResponse {
  let timeBeginning = Date.now()
  let chosenMove : MoveWithEval = _move(gameState, timeBeginning, gameState.you, 0)
  let chosenMoveDirection : string = chosenMove.direction ? chosenMove.direction : getDefaultMove(gameState, gameState.you) // if _move has somehow not decided up on a move, get a default direction to go in
  return {move: chosenMoveDirection}
}