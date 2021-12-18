import { InfoResponse, GameState, MoveResponse, Game, Board } from "./types"
import { Coord, SnakeCell, Board2d, Moves, MoveNeighbors, BoardCell, Battlesnake, MoveWithEval, KissOfDeathState, KissOfMurderState, KissStates } from "./classes"
import { logToFile, moveSnake, checkForSnakesHealthAndWalls, updateGameStateAfterMove, findMoveNeighbors, findKissDeathMoves, findKissMurderMoves, kissDecider, checkForHealth, cloneGameState, getRandomInt, getDefaultMove, snakeToString, getAvailableMoves, determineKissStates, determineKissStateForDirection } from "./util"
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
// replace all lets with consts where appropriate
// change tsconfig to noImplicitAny: true

function decideMove(gameState: GameState, myself: Battlesnake, board2d: Board2d, startTime: number, lookahead?: number, _priorKissOfDeathState?: KissOfDeathState, _priorKissOfMurderState?: KissOfMurderState) : MoveWithEval {
  let availableMoves = getAvailableMoves(gameState, myself, board2d).validMoves()

  let priorKissOfDeathState: KissOfDeathState = _priorKissOfDeathState === undefined ? KissOfDeathState.kissOfDeathNo : _priorKissOfDeathState
  let priorKissOfMurderState: KissOfMurderState = _priorKissOfMurderState === undefined ? KissOfMurderState.kissOfMurderNo : _priorKissOfMurderState

  let evalThisState: number = evaluate(gameState, myself, priorKissOfDeathState, priorKissOfMurderState, false)

  let kissStatesThisState: KissStates = determineKissStates(gameState, myself, board2d)

  if (availableMoves.length < 1) { // if there are still no available moves, return an direction & the evaluation for this state
    return new MoveWithEval(undefined, evalThisState)
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

      let kissStates = determineKissStateForDirection(move, kissStatesThisState) // this can be calculated independently of snakes moving, as it's dependent on gameState, not newGameState

      if (newSelf.id === newGameState.you.id) { // only move snakes for self snake, otherwise we recurse all over the place
        // move all snakes on board - newSelf according to availableMoves, otherSnakes according to their own _move result
        let moveSnakes : { [key: string]: MoveWithEval} = {} // array of snake IDs & the MoveWithEval each snake having that ID wishes to move in
        otherSnakes.forEach(function mvsnk(snake) { // before evaluating myself snake's next move, get the moves of each other snake as if it moved the way I would
          moveSnakes[snake.id] = decideMove(newGameState, snake, board2d, startTime) // decide best move for other snakes according to current data
          //moveSnakes[snake.id] = _move(newGameState, startTime, snake)
        })
        
        moveSnake(newGameState, newSelf, newBoard2d, move) // move newSelf to available move
        // determine kiss states before moving other snakes - we want to see what our neighbors would look like after we moved somewhere, which we won't see if we've already moved our neighbors
        //kissStates = determineKissStateForDirection(move, kissStatesThisState)

        otherSnakes.forEach(function mvsnk(snake) { // move each of the snakes at the same time, without updating gameState until each has moved
          if (moveSnakes[snake.id]) {
            moveSnake(newGameState, snake, board2d, moveSnakes[snake.id].direction)
          }
        })
        updateGameStateAfterMove(newGameState) // update gameState after moving all snakes
      } else { // for other snakes, still need to be able to move self to a new position to evaluate it
        moveSnake(newGameState, newSelf, newBoard2d, move) // move newSelf to available move
        //kissStates = determineKissStateForDirection(move, kissStatesThisState)
        updateGameStateAfterMove(newGameState) // update gameState after moving newSelf
      }
      
      let evalState: MoveWithEval
      if ((newSelf.id === newGameState.you.id) && (lookahead !== undefined) && (lookahead > 0)) { // don't run evaluate at this level, run it at the next level
        let moveAhead = decideMove(newGameState, newSelf, newBoard2d, startTime, lookahead - 1, kissStates.kissOfDeathState, kissStates.kissOfMurderState) // This is the recursive case!!!
        if (moveAhead !== undefined) { // if looking ahead does not result in undefined, set the evaluation to the lookahead evaluation
          evalState = moveAhead
        } else { // looking ahead resulted in a state that we don't want to consider, evaluate this state instead
          evalState = new MoveWithEval(move, evaluate(newGameState, newSelf, kissStates.kissOfDeathState, kissStates.kissOfMurderState, (newSelf.health < 10)))
        }
      } else { // base case, just run the eval
        evalState = new MoveWithEval(move, evaluate(newGameState, newSelf, kissStates.kissOfDeathState, kissStates.kissOfMurderState, (newSelf.health < 10)))
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
    } else { // if newSelf isn't defined, I have died, evaluate the state without me
      bestMove.direction = move
      bestMove.score = evaluate(newGameState, newSelf, KissOfDeathState.kissOfDeathNo, KissOfMurderState.kissOfMurderNo, false)
    }
  })

  if (bestMove.score !== undefined) {
    bestMove.score = bestMove.score + evalThisState
  } else {
    bestMove.score = evalThisState
  }
  return bestMove
}

export function move(gameState: GameState): MoveResponse {
  let timeBeginning = Date.now()
  let board2d = new Board2d(gameState.board)
  let chosenMove: MoveWithEval = decideMove(gameState, gameState.you, board2d, timeBeginning, 2)
  let chosenMoveDirection : string = chosenMove.direction ? chosenMove.direction : getDefaultMove(gameState, gameState.you) // if decideMove has somehow not decided up on a move, get a default direction to go in
  return {move: chosenMoveDirection}
}