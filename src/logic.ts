import { InfoResponse, GameState, MoveResponse, Game, Board } from "./types"
import { Coord, SnakeCell, Board2d, Moves, MoveNeighbors, BoardCell, Battlesnake, MoveWithEval, KissOfDeathState, KissOfMurderState, KissStates } from "./classes"
import { logToFile, moveSnake, checkForSnakesHealthAndWalls, updateGameStateAfterMove, findMoveNeighbors, findKissDeathMoves, findKissMurderMoves, kissDecider, checkForHealth, cloneGameState, getRandomInt, getDefaultMove, snakeToString, getAvailableMoves, determineKissStates, determineKissStateForDirection, fakeMoveSnake } from "./util"
import { evaluate } from "./eval"

import { createWriteStream } from 'fs'
let consoleWriteStream = createWriteStream("consoleLogs_logic.txt", {
  encoding: "utf8"
})

export const futureSight : number = 2

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

export function decideMove(gameState: GameState, myself: Battlesnake, startTime: number, lookahead?: number, _priorKissOfDeathState?: KissOfDeathState, _priorKissOfMurderState?: KissOfMurderState) : MoveWithEval {
  let board2d = new Board2d(gameState.board)
  let availableMoves = getAvailableMoves(gameState, myself, board2d).validMoves()

  let priorKissOfDeathState: KissOfDeathState = _priorKissOfDeathState === undefined ? KissOfDeathState.kissOfDeathNo : _priorKissOfDeathState
  let priorKissOfMurderState: KissOfMurderState = _priorKissOfMurderState === undefined ? KissOfMurderState.kissOfMurderNo : _priorKissOfMurderState

  let evalThisState: number = evaluate(gameState, myself, priorKissOfDeathState, priorKissOfMurderState, false)

  let kissStatesThisState: KissStates = determineKissStates(gameState, myself, board2d)

  if (availableMoves.length < 1) { // if there are no available moves, return an direction & the evaluation for this state
    if (lookahead !== undefined) {
      evalThisState = evalThisState * (lookahead + 1) // if we were still looking ahead any, want to multiply this return by the # of moves we're skipping.
    }
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

  // can determine each otherSnake's moves just once as it won't differ for each availableMove for myself
  let moveSnakes : { [key: string]: MoveWithEval} = {} // array of snake IDs & the MoveWithEval each snake having that ID wishes to move in
  if (myself.id === gameState.you.id) {
    let otherSnakes: Battlesnake[] = gameState.board.snakes.filter(function filterMeOut(snake) {
      return snake.id !== gameState.you.id
    })
    otherSnakes.forEach(function mvsnk(snake) { // before evaluating myself snake's next move, get the moves of each other snake as if it moved the way I would
      moveSnakes[snake.id] = decideMove(gameState, snake, startTime) // decide best move for other snakes according to current data
      //moveSnakes[snake.id] = _move(newGameState, startTime, snake)
    })
  }

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

        // TODO: Figure out a smart way to move otherSnakes' opponents here that doesn't infinitely recurse
        otherSnakes.forEach(function removeTail(snake) { // can't keep asking decideMove how to move them, but we need to at least remove the other snakes' tails without changing their length, or else this otherSnake won't consider tail cells other than its own valid
          fakeMoveSnake(snake)
        })

        updateGameStateAfterMove(newGameState) // update gameState after moving newSelf
      }
      
      let evalState: MoveWithEval
      if ((newSelf.id === newGameState.you.id) && (lookahead !== undefined) && (lookahead > 0)) { // don't run evaluate at this level, run it at the next level
        evalState = decideMove(newGameState, newSelf, startTime, lookahead - 1, kissStates.kissOfDeathState, kissStates.kissOfMurderState) // This is the recursive case!!!
      } else { // base case, just run the eval
        evalState = new MoveWithEval(move, evaluate(newGameState, newSelf, kissStates.kissOfDeathState, kissStates.kissOfMurderState, (newSelf.health < 10)))
      }

      // want to weight moves earlier in the lookahead heavier, as they represent more concrete information
      if (evalState.score !== undefined && lookahead !== undefined) {
        let evalWeight : number = 1
        evalWeight = evalWeight + 0.1 * lookahead // so 1 for 0 lookahead, 1.1 for 1, 1.2 for two, etc
        evalState.score = evalState.score * evalWeight
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
    logToFile(consoleWriteStream, `For snake ${myself.name} at (${myself.head.x},${myself.head.y}), chose best move ${bestMove.direction} with score ${bestMove.score}. Adding evalThisState score ${evalThisState} to return ${bestMove.score + evalThisState}`)
    bestMove.score = bestMove.score + evalThisState
  } else {
    logToFile(consoleWriteStream, `For snake ${myself.name} at (${myself.head.x},${myself.head.y}), no best move, all options are death. Adding & returning evalThisState score ${evalThisState}`)
    bestMove.score = evalThisState
  }
  return bestMove
}

export function move(gameState: GameState): MoveResponse {
  let timeBeginning = Date.now()
  let chosenMove: MoveWithEval = decideMove(gameState, gameState.you, timeBeginning, futureSight)
  let chosenMoveDirection : string = chosenMove.direction ? chosenMove.direction : getDefaultMove(gameState, gameState.you) // if decideMove has somehow not decided up on a move, get a default direction to go in
  return {move: chosenMoveDirection}
}