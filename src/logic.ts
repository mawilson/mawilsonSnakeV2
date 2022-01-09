export const version: string = "1.0.4" // need to declare this before imports since several imports utilize it

import { evaluationsForMachineLearning } from "./index"
import { InfoResponse, GameState, MoveResponse, Game, Board, SnakeScoreMongoAggregate } from "./types"
import { Direction, directionToString, Coord, SnakeCell, Board2d, Moves, MoveNeighbors, BoardCell, Battlesnake, MoveWithEval, KissOfDeathState, KissOfMurderState, KissStates, HazardWalls, KissStatesForEvaluate, GameData, SnakeScore, SnakeScoreForMongo, TimingData, FoodCountTier, HazardCountTier } from "./classes"
import { logToFile, checkTime, moveSnake, checkForSnakesHealthAndWalls, updateGameStateAfterMove, findMoveNeighbors, findKissDeathMoves, findKissMurderMoves, kissDecider, checkForHealth, cloneGameState, getRandomInt, getDefaultMove, snakeToString, getAvailableMoves, determineKissStateForDirection, fakeMoveSnake, lookaheadDeterminator, getCoordAfterMove, coordsEqual, createLogAndCycle, createGameDataId, calculateTimingData, calculateCenterWithHazard, getDistance, shuffle, getSnakeScoreHashKey, getSnakeScoreFromHashKey, getFoodCountTier, getHazardCountTier } from "./util"
import { evaluate, determineEvalNoSnakes } from "./eval"
import { connectToDatabase, getCollection, snakeScoreAggregations } from "./db"

import { WriteStream } from 'fs'
let consoleWriteStream: WriteStream = createLogAndCycle("consoleLogs_logic")

import { Collection, MongoClient } from 'mongodb'

const lookaheadWeight = 0.1
export const isDevelopment: boolean = false

// machine learning constants. First determines whether we're gathering data, second determines whether we're using it. Never use it while gathering it.
const amMachineLearning: boolean = true // if true, will not use machine learning thresholds & take shortcuts. Will log its results to database.
export const amUsingMachineData: boolean = true && !amMachineLearning // should never use machine learning data while also collecting it, but also may choose not to use it

export let gameData: {[key: string]: GameData} = {}

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
        version: version
      }
    } else {
      // Jaguar
      response = {
        apiversion: "1",
        author: "waryferryman",
        color: "#ff9900", // #ff9900
        head: "tiger-king", //"tiger-king",
        tail: "mystic-moon", //"mystic-moon",
        version: version
      }
    }

    return response
}

export async function start(gameState: GameState): Promise<void> {
  console.log(`${gameState.game.id} START`)

  const gameDataId = createGameDataId(gameState)
  gameData[gameDataId] = new GameData() // move() will update hazardWalls & lookahead accordingly later on.
}

export async function end(gameState: GameState): Promise<void> {
  let gameDataId = createGameDataId(gameState)
  let thisGameData = gameData? gameData[gameDataId] : undefined

  let isWin = gameState.board.snakes.some(function findMe(snake) { // true if my snake is still in the game, indicating I won
    return snake.id === gameState.you.id
  })
  let isTie = gameState.board.snakes.length === 0
  let gameResult = isWin? "win" : isTie? "tie" : "loss" // it's either a win, a tie, or a loss
  
  if (thisGameData !== undefined) { // if we have gameData, log some of it to our gameData directory
    const mongoClient: MongoClient = await connectToDatabase() // wait for database connection to be opened up
    if (thisGameData.timesTaken && thisGameData.timesTaken.length > 0) {
      let timeStats = calculateTimingData(thisGameData.timesTaken, gameResult)
      let timeData = new TimingData(timeStats, amMachineLearning, amUsingMachineData, gameResult, version)

      const timingCollection: Collection = await getCollection(mongoClient, "timing")

      await timingCollection.insertOne(timeData)
    }

    if (amMachineLearning) { // if I am learning, add the results to the thing
      const snakeScoresCollection: Collection = await getCollection(mongoClient, "snakeScores")

      if (thisGameData.evaluationsForLookaheads && thisGameData.evaluationsForLookaheads.length > 0) {
        let snakeScoresForMongo: SnakeScoreForMongo[] = []
        thisGameData.evaluationsForLookaheads.forEach((snakeScore) => {
          snakeScoresForMongo.push(new SnakeScoreForMongo(snakeScore.score, snakeScore.hashKey(), version, gameResult))
        })
        await snakeScoresCollection.insertMany(snakeScoresForMongo)
      }
    }

    await mongoClient.close() // always close your connection out!
  }

  if (thisGameData !== undefined) { // clean up game-specific data
    delete gameData[gameDataId]
  }
  console.log(`${gameState.game.id} END\n`)
}

// TODO
// change tsconfig to noImplicitAny: true

export function decideMove(gameState: GameState, myself: Battlesnake, startTime: number, hazardWalls: HazardWalls, startLookahead: number): MoveWithEval {
  let gameDataString = createGameDataId(gameState)
  let thisGameData: GameData | undefined = gameData[gameDataString]
  
  let initialMoveSnakes : { [key: string]: MoveWithEval} | undefined = {} // array of snake IDs & the MoveWithEval each snake having that ID wishes to move in
  let movesShortCircuited: number = 0

  const centers = calculateCenterWithHazard(gameState, hazardWalls)
  const center = new Coord(centers.centerX, centers.centerY) // this won't change so long as hazard doesn't, can calq at the root level

  // simple decideMove that merely looks at the snake & its available moves & chooses the one with the highest evaluate score
  // does not move any other snakes, not for use with recursion
  // Score decided upon does not particularly matter for this function, it's just for a direction
  function decideMoveSelfOnly(gameState: GameState, myself: Battlesnake, board2d: Board2d): MoveWithEval {
    let availableMoves = getAvailableMoves(gameState, myself, board2d).validMoves()
    let stillHaveTime = checkTime(startTime, gameState)
    if (availableMoves.length === 1) {
      return new MoveWithEval(availableMoves[0], undefined)
    } else if (availableMoves.length === 0 || !stillHaveTime) {
      return new MoveWithEval(getDefaultMove(gameState, myself, board2d), undefined) // score does not matter for this function
    } else {
      let randomMove = getRandomInt(0, availableMoves.length)
      return new MoveWithEval(availableMoves[randomMove], undefined) // sadly this is the best we can do. Some of the time, it will be okay! Better than fakeMove anyway
    }
  //   } else { // too expensive!!!
  //     // simplified version of _decideMove's evaluateMove code, with no lookahead & no moving of other snakes
  //     let bestMove: MoveWithEval = new MoveWithEval(undefined, undefined)
  //     let board2d = new Board2d(gameState.board)
  //     let moves: Moves = getAvailableMoves(gameState, myself, board2d)
  //     let availableMoves = moves.validMoves()
  //     let moveNeighbors = findMoveNeighbors(gameState, myself, board2d, moves)
  //     let kissOfMurderMoves = findKissMurderMoves(myself, board2d, moveNeighbors)
  //     let kissOfDeathMoves = findKissDeathMoves(myself, board2d, moveNeighbors)
  //     let kissStatesThisState: KissStates = kissDecider(gameState, myself, moveNeighbors, kissOfDeathMoves, kissOfMurderMoves, moves, board2d)

  //     availableMoves.forEach(function evaluateMove(move) {
  //       let newGameState = cloneGameState(gameState)

  //       let newSelf: Battlesnake | undefined
  //       newSelf = newGameState.board.snakes.find(function findSnake(snake) {
  //         return snake.id === myself.id
  //       })

  //       let kissStates = determineKissStateForDirection(move, kissStatesThisState) // this can be calculated independently of snakes moving, as it's dependent on gameState, not newGameState
  //       let kissArgs: KissStatesForEvaluate = new KissStatesForEvaluate(kissStates.kissOfDeathState, kissStates.kissOfMurderState, moveNeighbors.getPredator(move), moveNeighbors.getPrey(move))
  //       let evalState = new MoveWithEval(move, evaluate(newGameState, newSelf, kissArgs))

  //       if (bestMove.score === undefined) { // we don't have a best move yet, assign it to this one (even if its score is also undefined)
  //         bestMove.direction = move
  //         bestMove.score = evalState.score
  //       } else {
  //         if (evalState.score !== undefined) { // if evalState has a score, we want to compare it to bestMove's score
  //           if (evalState.score > bestMove.score) { // if evalState represents a better move & score, assign bestMove to it
  //             //logToFile(consoleWriteStream, `replacing prior best move ${bestMove.direction} with eval ${bestMove.score} with new move ${move} & eval ${evalState.score}`)
  //             bestMove.direction = move
  //             bestMove.score = evalState.score
  //           } else if (evalState.score === bestMove.score && getRandomInt(0, 2)) { // in the event of tied evaluations, choose between them at random
  //             //logToFile(consoleWriteStream, `replacing prior best move ${bestMove.direction} with eval ${bestMove.score} with new move ${move} & eval ${evalState.score}`)
  //             bestMove.direction = move
  //             bestMove.score = evalState.score
  //           } // else don't replace bestMove
  //         } // evalState has no score, & bestMove does, we don't want to replace bestMove with evalState
  //       }
  //     })
  //     return bestMove
  //   }
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
    } else if (availableMoves.length === 1 && lookahead === startLookahead) { // no need to look ahead, just return the only available move with a bogus computed score
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
      let defaultDir = availableMoves.length < 1? getDefaultMove(gameState, myself, board2d) : availableMoves[0] // if we ran out of time, we can at least choose one of the availableMoves
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
          moveSnakes[snake.id] = _decideMove(gameState, snake, 1) // decide best move for other snakes according to current data
        })
      }
    }

    // shuffle availableMoves array, then sort it by distance from center so machineLearning/timeout snake doesn't prefer one direction
    shuffle(availableMoves)
    availableMoves.sort(function sortByDistanceFromCenter (a: Direction, b: Direction): number {
      let aCoord = getCoordAfterMove(myself.head, a)
      let bCoord = getCoordAfterMove(myself.head, b)
      let distFromCenterA = getDistance(aCoord, center)
      let distFromCenterB = getDistance(bCoord, center)

      if (distFromCenterA < distFromCenterB) {
        return -1
      } else if (distFromCenterA > distFromCenterB) {
        return 1
      } else {
        return 0
      }
    })

    let effectiveLookahead = lookahead === undefined? 0 : lookahead
    let foodCountTier = getFoodCountTier(gameState.board.food.length)
    let hazardCountTier = getHazardCountTier(gameState.board.hazards.length)
    let snakeScoreHash = getSnakeScoreHashKey(myself.length, foodCountTier, hazardCountTier, gameState.board.snakes.length, effectiveLookahead)
    let averageMoveScore: number | undefined = evaluationsForMachineLearning[snakeScoreHash]
    let doneEvaluating: boolean = false
    availableMoves.forEach(function evaluateMove(move) {
      if (thisGameData && bestMove && (bestMove.score !== undefined) && amUsingMachineData && myself.id === gameState.you.id) { // machine learning check! Only do for self
        if (averageMoveScore !== undefined && bestMove.score >= averageMoveScore) { // if an average move score exists for this game state
          doneEvaluating = true
        }
      }

      if (doneEvaluating) {
        movesShortCircuited = movesShortCircuited + 1
      } else { // not done evaluating
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
                  let otherSnakeAvailableMoves: Direction[] = getAvailableMoves(newGameState, snake, new Board2d(newGameState.board)).validMoves()
                  switch (otherSnakeAvailableMoves.length) { // allow otherSnake to choose again if that may make a difference
                    case 0: // otherSnake has no other options, don't change its move
                      break
                    case 1: // otherSnake has only one other option left. Evaluate it, choose it if it's better than a tie
                    case 2: // otherSnake has more than one other option left (originally had three). Evaluate & choose the best one if they're better than a tie 
                      let newMove = _decideMove(newGameState, snake, 0) // let snake decide again, no lookahead this time
                      // note that in this case, otherSnake will end up moving myself again (e.g. myself snake has moved twice), which may result in it choosing badly
                      if (newMove.score !== undefined) { // don't choose a move whose score is undefined, can't determine if it's better than what we have
                        if (adjustedMove.score === undefined) { // if for some reason adjustedMove's score was undefined, newMove's score is 'better'
                          adjustedMove = newMove
                        } else { // we should only let the snake choose death if it's a duel, a tie, & the alternative move is worse than a tie
                          if (newGameState.board.snakes.length > 2) { // it's not a duel, a tie is bad no matter what, rechoose
                            adjustedMove = newMove
                          } else if (gameState.you.length > snake.length) { // it is a duel, but I'm smaller, this is a loss, rechoose
                            adjustedMove = newMove
                          } else if (newMove.score > determineEvalNoSnakes(newGameState, snake)) { // it is a duel & we would tie, but I have a better option than a tie elsewhere, rechoose
                            adjustedMove = newMove
                          } // if it fails all three of those, we won't rechoose
                        }
                      }
                      break
                    default: // should not be able to reach here, as myself snake has already cut one of its moves off
                      break
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
                moveSnake(newGameState, snake, board2d, getDefaultMove(newGameState, snake, board2d))
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
            evalState = _decideMove(newGameState, newSelf, lookahead - 1, kissArgs) // This is the recursive case!!!
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
      }
    })

    // need to process this & add to DB before adding evalThisState, becaause evalThisState is normally only added for a given lookahead after examining availableMoves
    let canLearn: boolean = averageMoveScore === undefined // can still learn if we didn't have data for this move
    if ((amMachineLearning || canLearn) && (myself.id === gameState.you.id) && (bestMove.score !== undefined)) { // only add machine learning data for my own moves
      if (thisGameData !== undefined && thisGameData.evaluationsForLookaheads) { // if game data exists, append to it
        let effectiveLookahead: number = lookahead === undefined? 0 : lookahead
        let foodCountTier = getFoodCountTier(gameState.board.food.length)
        let hazardCountTier = getHazardCountTier(gameState.board.hazards.length)
        let newSnakeScore = new SnakeScore(bestMove.score, myself.length, foodCountTier, hazardCountTier, gameState.board.snakes.length, effectiveLookahead, version)
        thisGameData.evaluationsForLookaheads.push(newSnakeScore)
      }
    }

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
    return new MoveWithEval(getDefaultMove(gameState, myself, board2d), undefined)
  } else { // otherwise, start deciding  
    let timeStart: number = 0
    timeStart = Date.now()

    let otherSnakes: Battlesnake[] = gameState.board.snakes.filter(function filterMeOut(snake) {
      return snake.id !== gameState.you.id
    })
    otherSnakes.forEach(function mvsnk(snake) { // before evaluating myself snake's next move, get the moves of each other snake as if it moved the way I would
      if (initialMoveSnakes === undefined) {
        initialMoveSnakes = {}
      }
      let newGameState: GameState = cloneGameState(gameState)
      let newSelf: Battlesnake | undefined
      newSelf = newGameState.board.snakes.find(function findSnake(newGameStateSnake) {
        return snake.id === newGameStateSnake.id
      })
      if (newSelf !== undefined) {
        newGameState.you = newSelf // need to process the snake as though it were myself, since _decideMove behaves radically different for self & otherSnakes
        let otherSnakeLookahead = 3
        if (newGameState.game.timeout < 500) {
          otherSnakeLookahead = 2
        }
        if (otherSnakeLookahead >= startLookahead) {
          otherSnakeLookahead = startLookahead - 1
        }
        if (otherSnakeLookahead < 0) {
          otherSnakeLookahead = 0
        }

        initialMoveSnakes[snake.id] = _decideMove(newGameState, newSelf, otherSnakeLookahead) // decide best move for other snakes according to current data, with modest lookahead
      }
    })
    let timeEnd = Date.now()
    let timeTaken = timeEnd - timeStart
    if (isDevelopment && timeStart !== 0) {
      logToFile(consoleWriteStream, `time taken calculating otherSnakes' first moves for on turn ${gameState.turn}: ${timeTaken}`)
    }

    let myselfMove: MoveWithEval
    if (timeTaken > 30) { // if it took inordinately long to get otherSnakes' starting moves, decrease lookahead for myself by one
      myselfMove = _decideMove(gameState, myself, startLookahead - 1)
    } else {
      myselfMove = _decideMove(gameState, myself, startLookahead)
    }

    if (isDevelopment && amUsingMachineData) { // if I'm using machine learning data, log how many times I took advantage of the data
      logToFile(consoleWriteStream, `Turn ${gameState.turn}: used machine learning to short circuit available moves forEach ${movesShortCircuited} times.`)
    }
    return myselfMove
  }
}

export function move(gameState: GameState): MoveResponse {
  let timeBeginning = Date.now()
  let futureSight: number = lookaheadDeterminator(gameState)
  let hazardWalls = new HazardWalls(gameState) // only need to calculate this once
  let gameDataId = createGameDataId(gameState)

  let thisGameData = gameData? gameData[gameDataId] : undefined
  if (thisGameData !== undefined) {
    thisGameData.hazardWalls = hazardWalls // replace gameData hazard walls with latest copy
    thisGameData.lookahead = futureSight // replace gameData lookahead with latest copy
  } // do not want to create new game data if it does not exist, start() should do that

  //logToFile(consoleWriteStream, `lookahead turn ${gameState.turn}: ${futureSight}`)
  let chosenMove: MoveWithEval = decideMove(gameState, gameState.you, timeBeginning, hazardWalls, futureSight)
  let chosenMoveDirection : Direction = chosenMove.direction !== undefined ? chosenMove.direction : getDefaultMove(gameState, gameState.you, new Board2d(gameState.board)) // if decideMove has somehow not decided up on a move, get a default direction to go in
  
  if (thisGameData !== undefined) {
    let timeTaken: number = Date.now() - timeBeginning
    let timesTaken = thisGameData.timesTaken
    timesTaken.push(timeTaken)
  }

  return {move: directionToString(chosenMoveDirection)}
}