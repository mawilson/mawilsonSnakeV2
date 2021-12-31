import { InfoResponse, GameState, MoveResponse, Game, Board } from "./types"
import { Direction, directionToString, Coord, SnakeCell, Board2d, Moves, MoveNeighbors, BoardCell, Battlesnake, MoveWithEval, KissOfDeathState, KissOfMurderState, KissStates, HazardWalls, KissStatesForEvaluate } from "./classes"
import { logToFile, checkTime, moveSnake, checkForSnakesHealthAndWalls, updateGameStateAfterMove, findMoveNeighbors, findKissDeathMoves, findKissMurderMoves, kissDecider, checkForHealth, cloneGameState, getRandomInt, getDefaultMove, snakeToString, getAvailableMoves, determineKissStateForDirection, fakeMoveSnake, lookaheadDeterminator, getCoordAfterMove, coordsEqual } from "./util"
import { evaluate } from "./eval"

import { createWriteStream } from 'fs'
let consoleWriteStream = createWriteStream("consoleLogs_logic.txt", {
  encoding: "utf8"
})

const lookaheadWeight = 0.1
export const isDevelopment: boolean = false
export let gameData: {[key: string]: {hazardWalls: HazardWalls, lookahead: number, timesTaken: number[]}} = {}

export function info(): InfoResponse {
    console.log("INFO")
    let response: InfoResponse
    if (isDevelopment) {
      // Test Snake
      response = {
        apiversion: "1",
        author: "waryferryman",
        color: "#CF5476", // #ff9900
        head: "lantern-fish", // "trans-rights-scarf",
        tail: "fat-rattle", // "comet",
        version: "1.0.0" //
      }
    } else {
      // Jaguar
      response = {
        apiversion: "1",
        author: "waryferryman",
        color: "#ff9900", // #ff9900
        head: "tiger-king", //"tiger-king",
        tail: "mystic-moon", //"mystic-moon",
        version: "1.0.0"
      }
    }

    return response
}

export function start(gameState: GameState): void {
  console.log(`${gameState.game.id} START`)
}

function doSomeStats(timesTaken: number[]): void {
  let averageTime: number = 0
  let highestTime: number = 0

  timesTaken.forEach(function processTimes(time) {
    averageTime = averageTime + time
    highestTime = time > highestTime? time : highestTime
  })
  averageTime = averageTime / timesTaken.length
  let deviations: number[] = []
  timesTaken.forEach(function calculateDeviations(time) {
    let deviation = averageTime - time
    deviation = deviation * deviation
    deviations.push(deviation)
  })
  let variance = deviations.reduce(function sumDeviations(previousValue: number, currentValue: number): number { return previousValue + currentValue }) / timesTaken.length
  let standardDeviation = Math.sqrt(variance)

  logToFile(consoleWriteStream, `of ${timesTaken.length} total times, average time: ${averageTime}; highest time: ${highestTime}; variance: ${variance}; standard deviation: ${standardDeviation}`)

  timesTaken = []
}

export function end(gameState: GameState): void {
  let thisGameData = gameData? gameData[gameState.game.id + gameState.you.id] : undefined
  if (isDevelopment && thisGameData !== undefined && thisGameData.timesTaken !== undefined) {
    doSomeStats(thisGameData.timesTaken)
  }
  if (thisGameData !== undefined) { // clean up game-specific data
    delete gameData[gameState.game.id + gameState.you.id]
  }
  console.log(`${gameState.game.id} END\n`)
}

// TODO
// replace all lets with consts where appropriate
// change tsconfig to noImplicitAny: true

export function decideMove(gameState: GameState, myself: Battlesnake, startTime: number, hazardWalls: HazardWalls, startLookahead: number): MoveWithEval {
  let initialMoveSnakes : { [key: string]: MoveWithEval} | undefined = {} // array of snake IDs & the MoveWithEval each snake having that ID wishes to move in

  // helper function which will return faster if no moves or one move is available
  // only used for the first (lookahead === startLookahead) or last (lookahead = 0) iterations of _decideMove
  function decideMoveCheap(gameState: GameState, myself: Battlesnake, board2d: Board2d, lookahead: number): MoveWithEval {
    let availableMoves = getAvailableMoves(gameState, myself, board2d).validMoves()
    let evalThisState = evaluate(gameState, myself, new KissStatesForEvaluate(KissOfDeathState.kissOfDeathNo, KissOfMurderState.kissOfMurderNo))
    if (availableMoves.length === 0) {
      return new MoveWithEval(getDefaultMove(gameState, myself), evalThisState) // let snake decide now that myself & snakes in kiss situations have already moved
    } else if (availableMoves.length === 1) {
      return new MoveWithEval(availableMoves[0], evalThisState) // let snake decide now that myself & snakes in kiss situations have already moved
    } else {
      return _decideMove(gameState, myself, lookahead) // let snake decide now that myself & snakes in kiss situations have already moved
    } 
  }

  function _decideMove(gameState: GameState, myself: Battlesnake, lookahead?: number, kisses?: KissStatesForEvaluate): MoveWithEval {
    let timeStart: number = 0
    if (isDevelopment) {
      timeStart = Date.now()
    }
    
    let stillHaveTime = checkTime(startTime, gameState) // if this is true, we need to hurry & return a value without doing any more significant calculation
    
    let stateContainsMe: boolean = gameState.board.snakes.some(function findSnake(snake) {
      return snake.id === myself.id
    })
    
    let board2d = new Board2d(gameState.board)

    let priorKissOfDeathState: KissOfDeathState = kisses === undefined ? KissOfDeathState.kissOfDeathNo : kisses.deathState
    let priorKissOfMurderState: KissOfMurderState = kisses === undefined ? KissOfMurderState.kissOfMurderNo : kisses.murderState
    let evaluateKisses = new KissStatesForEvaluate(priorKissOfDeathState, priorKissOfMurderState, kisses?.predator, kisses?.prey)

    let evalThisState: number = evaluate(gameState, myself, evaluateKisses)

    let moves: Moves = getAvailableMoves(gameState, myself, board2d)
    let availableMoves = moves.validMoves()
    let moveNeighbors = findMoveNeighbors(gameState, myself, board2d, moves)
    let kissOfMurderMoves = findKissMurderMoves(myself, board2d, moveNeighbors)
    let kissOfDeathMoves = findKissDeathMoves(myself, board2d, moveNeighbors)
  
    let kissStatesThisState: KissStates = kissDecider(gameState, myself, moveNeighbors, kissOfDeathMoves, kissOfMurderMoves, moves, board2d)

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
    let moveSnakes: { [key: string]: MoveWithEval} = {} // array of snake IDs & the MoveWithEval each snake having that ID wishes to move in
    if (myself.id === gameState.you.id) {
      if (initialMoveSnakes !== undefined) {
        moveSnakes = initialMoveSnakes // prediction for the first moves for otherSnakes with extra lookahead
        initialMoveSnakes = undefined // only want to use this once, afterwards will decideMoves for otherSnakes as normal
      } else {
        let otherSnakes: Battlesnake[] = gameState.board.snakes.filter(function filterMeOut(snake) {
          return snake.id !== gameState.you.id
        })
        otherSnakes.forEach(function mvsnk(snake) { // before evaluating myself snake's next move, get the moves of each other snake as if it moved the way I would
          moveSnakes[snake.id] = decideMoveCheap(gameState, snake, board2d, 1) // decide best move for other snakes according to current data
        })
      }
    }

    availableMoves.forEach(function evaluateMove(move) {
      let newGameState = cloneGameState(gameState)

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
            if (moveSnakes[snake.id]) { // if I have already decided upon this snake's move, see if it dies doing said move
              let newHead = getCoordAfterMove(snake.head, moveSnakes[snake.id].direction)
              let adjustedMove = moveSnakes[snake.id] // don't modify moveSnakes[snake.id], as this is used by other availableMoves loops
              // allow snakes that died to reroll their move
              if (coordsEqual(newHead, newGameState.you.head) && gameState.you.length >= snake.length) { // use self length from before the move, in case this move caused it to grow
                let newMove = decideMoveCheap(newGameState, snake, new Board2d(newGameState.board), 0) // let snake decide again, no lookahead this time
                // note that in this case, otherSnake will end up moving myself again (e.g. myself snake has moved twice), which may result in it choosing badly
                if (newMove.score !== undefined) {
                  if (adjustedMove.score === undefined) {
                    adjustedMove = newMove
                  } else if (newMove.score > adjustedMove.score) { // only use the new decision if it's better than the decision it had previously
                    adjustedMove = newMove // this should only succeed if the new decision doesn't lead to death, & is better than a tie in the event of a tie
                  }
                }
              }
              moveSnake(newGameState, snake, board2d, adjustedMove.direction)
            }
          })
          updateGameStateAfterMove(newGameState) // update gameState after moving all snakes
        } else { // for other snakes, still need to be able to move self to a new position to evaluate it
          moveSnake(newGameState, newSelf, board2d, move) // move newSelf to available move

          // TODO: Figure out a smart way to move otherSnakes' opponents here that doesn't infinitely recurse
          otherSnakes.forEach(function removeTail(snake) { // can't keep asking decideMove how to move them, but we need to at least remove the other snakes' tails without changing their length, or else this otherSnake won't consider tail cells other than its own valid
            let otherSnakeAvailableMoves = getAvailableMoves(newGameState, snake, board2d).validMoves()
            if (otherSnakeAvailableMoves.length === 0) {
              moveSnake(newGameState, snake, board2d, getDefaultMove(newGameState, snake))
            } else if (otherSnakeAvailableMoves.length === 1) {
              moveSnake(newGameState, snake, board2d, otherSnakeAvailableMoves[0])
            } else {
              fakeMoveSnake(snake)
            }
          })

          updateGameStateAfterMove(newGameState) // update gameState after moving newSelf
        }
        
        let evalState: MoveWithEval
        let kissArgs: KissStatesForEvaluate = new KissStatesForEvaluate(kissStates.kissOfDeathState, kissStates.kissOfMurderState, moveNeighbors.getPredator(move), moveNeighbors.getPrey(move))
        if (lookahead !== undefined && lookahead > 0) { // don't run evaluate at this level, run it at the next level
          if (lookahead - 1 === 0) { // may be able to calq the last level of this lookahead more cheaply since it won't look past that
            evalState = decideMoveCheap(newGameState, newSelf, new Board2d(newGameState.board), 0)
          } else {
            evalState = _decideMove(newGameState, newSelf, lookahead - 1, kissArgs) // This is the recursive case!!!
          }
        } else { // base case, just run the eval
          evalState = new MoveWithEval(move, evaluate(newGameState, newSelf, kissArgs))
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

    if (isDevelopment && timeStart !== 0) {
      let timeEnd = Date.now()
      let totalTimeTaken = timeEnd - timeStart
      if (totalTimeTaken > 30) {
        if (lookahead === startLookahead) {
          logToFile(consoleWriteStream, `total time taken calculating _decideMove for ${myself.name} on turn ${gameState.turn} with lookahead ${lookahead}: ${totalTimeTaken}`)
        } else {
          logToFile(consoleWriteStream, `for lookahead ${lookahead}, time taken calculating _decideMove for ${myself.name} on turn ${gameState.turn}: ${totalTimeTaken}`)
        }
      }
    }

    return bestMove
  }

  let board2d: Board2d = new Board2d(gameState.board)
  let availableMoves: Moves = getAvailableMoves(gameState, myself, board2d)
  let validMoves = availableMoves.validMoves()
  // before jumping into recursion, first check to see if I have any choices to make
  if (validMoves.length === 1) { // if I only have one valid move, return that
    return new MoveWithEval(validMoves[0], undefined)
  } else if (validMoves.length === 0) { // if I have no valid moves, return the default move
    return new MoveWithEval(getDefaultMove(gameState, myself), undefined)
  } else { // otherwise, start deciding  
    let timeStart: number = 0
    if (isDevelopment) {
      timeStart = Date.now()
    }
    let otherSnakes: Battlesnake[] = gameState.board.snakes.filter(function filterMeOut(snake) {
      return snake.id !== gameState.you.id
    })
    otherSnakes.forEach(function mvsnk(snake) { // before evaluating myself snake's next move, get the moves of each other snake as if it moved the way I would
      if (initialMoveSnakes === undefined) {
        initialMoveSnakes = {}
      }
      initialMoveSnakes[snake.id] = _decideMove(gameState, snake, 3) // decide best move for other snakes according to current data, with modest lookahead
    })
    if (isDevelopment && timeStart !== 0) {
      let timeEnd = Date.now()
      logToFile(consoleWriteStream, `time taken calculating otherSnakes' first moves for on turn ${gameState.turn}: ${timeEnd - timeStart}`)
    }

    return _decideMove(gameState, myself, startLookahead)
  }
}

export function move(gameState: GameState): MoveResponse {
  let timeBeginning = Date.now()
  let futureSight: number = lookaheadDeterminator(gameState)
  let hazardWalls = new HazardWalls(gameState) // only need to calculate this once

  let thisGameData = gameData? gameData[gameState.game.id + gameState.you.id] : undefined
  if (thisGameData !== undefined) {
    thisGameData.hazardWalls = hazardWalls // replace gameData hazard walls with latest copy
    thisGameData.lookahead = futureSight // replace gameData lookahead with latest copy
  } else {
    if (gameData === undefined) {
      gameData = {}
      gameData[gameState.game.id + gameState.you.id] = {hazardWalls: hazardWalls, lookahead: futureSight, timesTaken: []} // create new gameData object if one does not yet exist
    } else {
      gameData[gameState.game.id + gameState.you.id] = {hazardWalls: hazardWalls, lookahead: futureSight, timesTaken: []} // create new gameData object if one does not yet exist
    }
    thisGameData = gameData[gameState.game.id + gameState.you.id]
  }

  //logToFile(consoleWriteStream, `lookahead turn ${gameState.turn}: ${futureSight}`)
  let chosenMove: MoveWithEval = decideMove(gameState, gameState.you, timeBeginning, hazardWalls, futureSight)
  let chosenMoveDirection : Direction = chosenMove.direction !== undefined ? chosenMove.direction : getDefaultMove(gameState, gameState.you) // if decideMove has somehow not decided up on a move, get a default direction to go in
  
  if (thisGameData !== undefined && isDevelopment) {
    let timeTaken: number = Date.now() - timeBeginning
    let timesTaken = thisGameData.timesTaken
    if (timesTaken !== undefined) {
      if (timesTaken.length >= 50000) {
        timesTaken.splice(0, 1, timeTaken) // remove element 0, add timeTaken to end of array
      } else {
        timesTaken.push(timeTaken)
      }
    } else {
      timesTaken = [timeTaken]
    }
    checkTime(timeBeginning, gameState, true)
  }

  return {move: directionToString(chosenMoveDirection)}
}