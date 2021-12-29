import { InfoResponse, GameState, MoveResponse, Game, Board } from "./types"
import { Direction, directionToString, Coord, SnakeCell, Board2d, Moves, MoveNeighbors, BoardCell, Battlesnake, MoveWithEval, KissOfDeathState, KissOfMurderState, KissStates, HazardWalls } from "./classes"
import { logToFile, checkTime, moveSnake, checkForSnakesHealthAndWalls, updateGameStateAfterMove, findMoveNeighbors, findKissDeathMoves, findKissMurderMoves, kissDecider, checkForHealth, cloneGameState, getRandomInt, getDefaultMove, snakeToString, getAvailableMoves, determineKissStates, determineKissStateForDirection, fakeMoveSnake, lookaheadDeterminator, getCoordAfterMove, coordsEqual } from "./util"
import { evaluate } from "./eval"

import { createWriteStream } from 'fs'
let consoleWriteStream = createWriteStream("consoleLogs_logic.txt", {
  encoding: "utf8"
})

// export var futureSight : number = 4 // this can't be global, that's not parallel
const lookaheadWeight = 0.1

export function info(): InfoResponse {
    console.log("INFO")
    // Jaguar
    // const response: InfoResponse = {
    //     apiversion: "1",
    //     author: "waryferryman",
    //     color: "#ff9900", // #ff9900
    //     head: "tiger-king", //"tiger-king",
    //     tail: "mystic-moon", //"mystic-moon",
    //     version: "1.0.0"
    // }

    // Test Snake
    const response: InfoResponse = {
      apiversion: "1",
      author: "waryferryman",
      color: "#CF5476", // #ff9900
      head: "lantern-fish", // "trans-rights-scarf",
      tail: "fat-rattle", // "comet",
      version: "1.0.0" //
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

export function decideMove(gameState: GameState, myself: Battlesnake, startTime: number, hazardWalls: HazardWalls, lookahead?: number, _priorKissOfDeathState?: KissOfDeathState, _priorKissOfMurderState?: KissOfMurderState, priorHealth?: number) : MoveWithEval {
  let stillHaveTime = checkTime(startTime, gameState) // if this is true, we need to hurry & return a value without doing any more significant calculation
  
  let stateContainsMe: boolean = gameState.board.snakes.some(function findSnake(snake) {
    return snake.id === myself.id
  })
  
  let board2d = new Board2d(gameState.board)
  let availableMoves = getAvailableMoves(gameState, myself, board2d).validMoves()

  let priorKissOfDeathState: KissOfDeathState = _priorKissOfDeathState === undefined ? KissOfDeathState.kissOfDeathNo : _priorKissOfDeathState
  let priorKissOfMurderState: KissOfMurderState = _priorKissOfMurderState === undefined ? KissOfMurderState.kissOfMurderNo : _priorKissOfMurderState

  let evalThisState: number = evaluate(gameState, myself, hazardWalls, priorKissOfDeathState, priorKissOfMurderState, lookahead || 0)

  let kissStatesThisState: KissStates = determineKissStates(gameState, myself, board2d)

  let finishEvaluatingNow: boolean = false
  if (!stillHaveTime) { // if we need to leave early due to time
    finishEvaluatingNow = true
  } else if (!stateContainsMe) { // if we're dead
    finishEvaluatingNow = true
  } else if (availableMoves.length < 1) { // if there's nowhere left to decide to move
    finishEvaluatingNow = true
  } else if (gameState.game.ruleset.name !== "solo" && gameState.board.snakes.length === 1) { // it's not a solo game, & we're the only one left - we've won
    finishEvaluatingNow = true
  }

  if (finishEvaluatingNow) { // if out of time, myself is dead, all other snakes are dead (not solo), or there are no available moves, return a direction & the evaluation for this state
    if (lookahead !== undefined) {
      let evalMultiplier: number = 0
      // final result for a lookahead of 4 should look like: evalThisState * (1.0 + 1.1 + 1.2 + 1.3 + 1.4). 4 lookahead means four future moves, plus this one.
      for (let i: number = 0; i <= lookahead; i++) { // need to apply weights for skipped lookahead steps, as well as this one
        evalMultiplier = evalMultiplier + 1 + lookaheadWeight * i
      }
      evalThisState = evalThisState * evalMultiplier // if we were still looking ahead any, want to multiply this return by the # of moves we're skipping.
    }
    let defaultDir = availableMoves.length < 1? getDefaultMove(gameState, myself) : availableMoves[0] // if we ran out of time, we can at least choose one of the availableMoves
    return new MoveWithEval(defaultDir, evalThisState)
  } 

  // of the available remaining moves, evaluate the gameState if we took that move, and then choose the move resulting in the highest scoring gameState
  let bestMove : MoveWithEval = new MoveWithEval(undefined, undefined)

  // can determine each otherSnake's moves just once as it won't differ for each availableMove for myself
  let moveSnakes : { [key: string]: MoveWithEval} = {} // array of snake IDs & the MoveWithEval each snake having that ID wishes to move in
  if (myself.id === gameState.you.id) {
    let otherSnakes: Battlesnake[] = gameState.board.snakes.filter(function filterMeOut(snake) {
      return snake.id !== gameState.you.id
    })
    otherSnakes.forEach(function mvsnk(snake) { // before evaluating myself snake's next move, get the moves of each other snake as if it moved the way I would
      moveSnakes[snake.id] = decideMove(gameState, snake, startTime, hazardWalls) // decide best move for other snakes according to current data
    })
  }

  availableMoves.forEach(function evaluateMove(move) {
    let newGameState = cloneGameState(gameState)
    //let newBoard2d = new Board2d(newGameState.board) // not necessary since it doesn't get updated after moving snakes anyway

    let newSelf: Battlesnake | undefined
    newSelf = newGameState.board.snakes.find(function findSnake(snake) {
      return snake.id === myself.id
    })

    if (newSelf !== undefined) {
      let otherSnakes: Battlesnake[] = newGameState.board.snakes.filter(function filterMeOut(snake) {
        return newSelf !== undefined && (snake.id !== newSelf.id)
      })

      let kissStates = determineKissStateForDirection(move, kissStatesThisState) // this can be calculated independently of snakes moving, as it's dependent on gameState, not newGameState

      if (newSelf.id === newGameState.you.id) { // only move snakes for self snake, otherwise we recurse all over the place        
        moveSnake(newGameState, newSelf, board2d, move) // move newSelf to available move

        otherSnakes.forEach(function mvsnk(snake) { // move each of the snakes at the same time, without updating gameState until each has moved
          if (moveSnakes[snake.id]) {
            let newHead = getCoordAfterMove(snake.head, moveSnakes[snake.id].direction)
            let adjustedMove = moveSnakes[snake.id] // don't modify moveSnakes[snake.id], as this is used by other availableMoves loops
            if (coordsEqual(newHead, newGameState.you.head) && gameState.you.length >= snake.length) { // use self length from before the move, in case this move caused it to grow
              let newMove = decideMove(newGameState, snake, startTime, hazardWalls) // let snake decide again
              if (newMove.score !== undefined) {
                if (adjustedMove.score === undefined) {
                  adjustedMove = newMove
                } else if (newMove.score > adjustedMove.score) { // only use the new decision if it's better than the decision it had previously
                  adjustedMove = newMove // this should only succeed if the new decision doesn't lead to death, & is better than a tie in the event of a tie
                }
              }
              
              // let otherSnakeAvailableMoves = getAvailableMoves(newGameState, snake, board2d)
              // if (newGameState.board.snakes.length === 2 && gameState.you.length === snake.length) { // if it's a tie, only reroll if the reroll is better than a tie! Only for duels, since non-duels means death & there's no way that's better
              //   let newMove = decideMove(newGameState, snake, startTime, hazardWalls)
              // }
              // if (otherSnakeAvailableMoves.validMoves().length > 1) { // force it to decide again unless it's the only thing it can do
              //   adjustedMove = decideMove(newGameState, snake, startTime, hazardWalls) // may be dangerous to put another decideMove in here, but it should be a rare case
              // }
            }
            moveSnake(newGameState, snake, board2d, adjustedMove.direction)
          }
        })
        updateGameStateAfterMove(newGameState) // update gameState after moving all snakes
      } else { // for other snakes, still need to be able to move self to a new position to evaluate it
        moveSnake(newGameState, newSelf, board2d, move) // move newSelf to available move

        // TODO: Figure out a smart way to move otherSnakes' opponents here that doesn't infinitely recurse
        otherSnakes.forEach(function removeTail(snake) { // can't keep asking decideMove how to move them, but we need to at least remove the other snakes' tails without changing their length, or else this otherSnake won't consider tail cells other than its own valid
          fakeMoveSnake(snake)
        })

        updateGameStateAfterMove(newGameState) // update gameState after moving newSelf
      }
      
      let evalState: MoveWithEval
      if ((newSelf.id === newGameState.you.id) && (lookahead !== undefined) && (lookahead > 0)) { // don't run evaluate at this level, run it at the next level
        evalState = decideMove(newGameState, newSelf, startTime, hazardWalls, lookahead - 1, kissStates.kissOfDeathState, kissStates.kissOfMurderState, myself.health) // This is the recursive case!!!
      } else { // base case, just run the eval
        evalState = new MoveWithEval(move, evaluate(newGameState, newSelf, hazardWalls, kissStates.kissOfDeathState, kissStates.kissOfMurderState, lookahead || 0))
      }

      if (bestMove.score === undefined) { // we don't have a best move yet, assign it to this one (even if its score is also undefined)
        bestMove.direction = move
        bestMove.score = evalState.score
      } else {
        if (evalState.score !== undefined) { // if evalState has a score, we want to compare it to bestMove's score
          if (evalState.score > bestMove.score) { // if evalState represents a better move & score, assign bestMove to it
            //logToFile(consoleWriteStream, `replacing prior best move ${bestMove.direction} with eval ${bestMove.score} with new move ${move} & eval ${evalState.score}`)
            bestMove.direction = move
            bestMove.score = evalState.score
          } else if (evalState.score === bestMove.score && getRandomInt(0, 2)) { // in the event of tied evaluations, choose between them at random
            //logToFile(consoleWriteStream, `replacing prior best move ${bestMove.direction} with eval ${bestMove.score} with new move ${move} & eval ${evalState.score}`)
            bestMove.direction = move
            bestMove.score = evalState.score
          } // else don't replace bestMove
        } // evalState has no score, & bestMove does, we don't want to replace bestMove with evalState
      }
    } // if newSelf isn't defined, I have died, will evaluate the state without me lower down
  })

  // want to weight moves earlier in the lookahead heavier, as they represent more concrete information
  if (lookahead !== undefined) {
    let evalWeight : number = 1
    evalWeight = evalWeight + lookaheadWeight * lookahead // so 1 for 0 lookahead, 1.1 for 1, 1.2 for two, etc
    evalThisState = evalThisState * evalWeight
  }

  if (bestMove.score !== undefined) {
    //logToFile(consoleWriteStream, `For snake ${myself.name} at (${myself.head.x},${myself.head.y}), chose best move ${bestMove.direction} with score ${bestMove.score}. Adding evalThisState score ${evalThisState} to return ${bestMove.score + evalThisState}`)
    bestMove.score = bestMove.score + evalThisState
  } else {
    //logToFile(consoleWriteStream, `For snake ${myself.name} at (${myself.head.x},${myself.head.y}), no best move, all options are death. Adding & returning evalThisState score ${evalThisState}`)
    bestMove.score = evalThisState
  }

  return bestMove
}

export function move(gameState: GameState): MoveResponse {
  let timeBeginning = Date.now()
  let futureSight: number = lookaheadDeterminator(gameState)
  let hazardWalls = new HazardWalls(gameState) // only need to calculate this once
  //logToFile(consoleWriteStream, `lookahead turn ${gameState.turn}: ${futureSight}`)
  let chosenMove: MoveWithEval = decideMove(gameState, gameState.you, timeBeginning, hazardWalls, futureSight)
  let chosenMoveDirection : Direction = chosenMove.direction !== undefined ? chosenMove.direction : getDefaultMove(gameState, gameState.you) // if decideMove has somehow not decided up on a move, get a default direction to go in
  return {move: directionToString(chosenMoveDirection)}
}