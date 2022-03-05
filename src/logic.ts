export const version: string = "1.3.14" // need to declare this before imports since several imports utilize it

import { evaluationsForMachineLearning } from "./index"
import { InfoResponse, GameState, MoveResponse } from "./types"
import { Direction, directionToString, Board2d, Moves, Battlesnake, MoveWithEval, KissOfDeathState, KissOfMurderState, KissStates, HazardWalls, KissStatesForEvaluate, GameData, SnakeScore, SnakeScoreForMongo, TimingData, Tree, Leaf, HazardSpiral, EvaluationResult } from "./classes"
import { logToFile, checkTime, moveSnake, updateGameStateAfterMove, findMoveNeighbors, findKissDeathMoves, findKissMurderMoves, kissDecider, cloneGameState, getRandomInt, getDefaultMove, getAvailableMoves, determineKissStateForDirection, fakeMoveSnake, getCoordAfterMove, coordsEqual, createLogAndCycle, createGameDataId, calculateTimingData, shuffle, getSnakeScoreHashKey, getFoodCountTier, getHazardCountTier, gameStateIsSolo, gameStateIsHazardSpiral, gameStateIsConstrictor, getSuicidalMove, lookaheadDeterminator } from "./util"
import { evaluate, determineEvalNoSnakes, evalNoMeStandard, evalNoMeConstrictor } from "./eval"
import { connectToDatabase, getCollection } from "./db"

import { WriteStream } from 'fs'
let consoleWriteStream: WriteStream = createLogAndCycle("consoleLogs_logic")

import { Collection, MongoClient } from 'mongodb'

const lookaheadWeight = 0.1
export const isDevelopment: boolean = false

// machine learning constants. First determines whether we're gathering data, second determines whether we're using it. Never use it while gathering it.
const amMachineLearning: boolean = false // if true, will not use machine learning thresholds & take shortcuts. Will log its results to database.
export const amUsingMachineData: boolean = false && !amMachineLearning // should never use machine learning data while also collecting it, but also may choose not to use it

export let gameData: {[key: string]: GameData} = {}

export function info(): InfoResponse {
    console.log("INFO")
    let response: InfoResponse
    if (isDevelopment) {
      // Test Snake
      response = {
        apiversion: "1",
        author: "waryferryman",
        color: "#A06D4A", // #CF5476
        head: "replit-mark", // "lantern-fish",
        tail: "rbc-necktie", // "fat-rattle",
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
  const gameDataId = createGameDataId(gameState)
  gameData[gameDataId] = new GameData(gameState.game.source) // move() will update hazardWalls & lookahead accordingly later on.
  console.log(`${gameState.game.id} with game source ${gameState.game.source} START. Now ${Object.keys(gameData).length} running.`)
}

export async function end(gameState: GameState): Promise<void> {
  let gameDataId = createGameDataId(gameState)
  let thisGameData = gameData? gameData[gameDataId] : undefined

  let isWin = gameState.board.snakes.some(function findMe(snake) { // true if my snake is still in the game, indicating I won
    return snake.id === gameState.you.id
  })
  let isTie = gameState.board.snakes.length === 0
  let isSolo = gameStateIsSolo(gameState)
  let gameResult = isSolo? "solo" : isWin? "win" : isTie? "tie" : "loss" // it's either a solo, a win, a tie, or a loss
  
  if (thisGameData !== undefined) { // if we have gameData, log some of it to our gameData directory
    const mongoClient: MongoClient = await connectToDatabase() // wait for database connection to be opened up
    if (thisGameData.timesTaken && thisGameData.timesTaken.length > 0) {
      let timeStats = calculateTimingData(thisGameData.timesTaken, gameResult)
      let timeData = new TimingData(timeStats, amMachineLearning, amUsingMachineData, gameResult, version, gameState.game.timeout, gameState.game.ruleset.name, isDevelopment, gameState.game.source, gameState.game.ruleset.settings.hazardDamagePerTurn)

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
  console.log(`${gameState.game.id} with game source ${gameState.game.source} END. Still ${Object.keys(gameData).length} games running.\n`)
}

// TODO
// change tsconfig to noImplicitAny: true

export function decideMove(gameState: GameState, myself: Battlesnake, startTime: number, startLookahead: number, startingBoard2d: Board2d, iterativeDeepening: boolean): MoveWithEval {
  let gameDataString = createGameDataId(gameState)
  let thisGameData: GameData | undefined = gameData[gameDataString]
  const isTesting: boolean = gameState.game.source === "testing" // currently used to subvert stillHaveTime check when running tests. Remove that to still run stillHaveTime check during tests

  let root: Leaf | undefined = undefined
  let tree: Tree = new Tree(myself)

  let movesShortCircuited: number = 0

  const noMe: number = gameStateIsConstrictor(gameState)? evalNoMeConstrictor : evalNoMeStandard

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

  function _decideMove(gameState: GameState, myself: Battlesnake, lookahead?: number, kisses?: KissStatesForEvaluate, originalSnakeMove?: Direction, parentLeaf?: Leaf): MoveWithEval {
    let timeStart: number = 0
    if (isDevelopment) {
      timeStart = Date.now()
    }
    
    let stillHaveTime = checkTime(startTime, gameState) // if this is true, we need to hurry & return a value without doing any more significant calculation
    if (!stillHaveTime && iterativeDeepening) { return new MoveWithEval(undefined, undefined) } // Iterative deepening will toss this result anyway, may as well leave now

    let stateContainsMe: boolean = gameState.board.snakes.some(function findSnake(snake) {
      return snake.id === myself.id
    })

    let isDuel: boolean = stateContainsMe && (gameState.board.snakes.length === 2)
    
    let board2d: Board2d
    if (lookahead === startLookahead) {
      board2d = startingBoard2d
    } else {
      board2d = new Board2d(gameState, false)
    }

    let priorKissOfDeathState: KissOfDeathState = kisses === undefined ? KissOfDeathState.kissOfDeathNo : kisses.deathState
    let priorKissOfMurderState: KissOfMurderState = kisses === undefined ? KissOfMurderState.kissOfMurderNo : kisses.murderState
    let evaluateKisses = new KissStatesForEvaluate(priorKissOfDeathState, priorKissOfMurderState, kisses?.predator, kisses?.prey)

    let _evalThisState = evaluate(gameState, myself, evaluateKisses)
    let evalThisState: number = _evalThisState.sum(noMe)

    if (isDevelopment) {
      if (myself.id === gameState.you.id && parentLeaf === undefined) { // if tree/root does not yet exist, create it
        root = new Leaf(new MoveWithEval(undefined, evalThisState), _evalThisState, [], 0, undefined)
        tree = new Tree(myself, root)
        parentLeaf = root
      }
    }

    let moves: Moves = getAvailableMoves(gameState, myself, board2d)
    let availableMoves = moves.validMoves()
    let moveNeighbors = findMoveNeighbors(gameState, myself, board2d, moves)
    let kissOfMurderMoves = findKissMurderMoves(moveNeighbors)
    let kissOfDeathMoves = findKissDeathMoves(moveNeighbors)
  
    let kissStatesThisState: KissStates = kissDecider(gameState, myself, moveNeighbors, kissOfDeathMoves, kissOfMurderMoves, moves, board2d)

    let finishEvaluatingNow: boolean = false
    if (!isTesting && !stillHaveTime) { // if we need to leave early due to time
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
        let newScore: number = 0 // should always at least account for this turn
        if (availableMoves.length < 1) { // will die in one turn, should apply evalNoMe score to all but this state
          for (let i: number = lookahead; i >= 0; i--) { // these account for the evalThisState's, but not the final bestMove after the lookaheads
            if (i !== lookahead) {
              newScore = newScore + (noMe * (1 + lookaheadWeight * i)) // if availableMoves length is 0, I will die the turn after this, so use evalNoMe for those turns
            } else {
              newScore = newScore + (evalThisState * (1 + lookaheadWeight * i)) // can use evalThisState for first turn - will be bad but not as bad
            }
          }
          newScore = newScore + noMe // add the final bestMove after the lookaheads, with no lookaheadWeight - which is necessarily death in this case
          evalThisState = newScore
        } else {
          for (let i: number = lookahead; i >= 0; i--) { // these account for the evalThisState's, but not the final bestMove after the lookaheads
            newScore = newScore + (evalThisState * (1 + lookaheadWeight * i))
          }
          newScore = newScore + evalThisState // add the final bestMove after the lookaheads, with no lookaheadWeight
        }
        evalThisState = newScore // if we were still looking ahead any, want to multiply this return by the # of moves we're skipping.
      }
      let defaultDir = availableMoves.length < 1? getDefaultMove(gameState, myself, board2d) : availableMoves[0] // if we ran out of time, we can at least choose one of the availableMoves
      return new MoveWithEval(defaultDir, evalThisState)
    } 

    // of the available remaining moves, evaluate the gameState if we took that move, and then choose the move resulting in the highest scoring gameState
    let bestMove : MoveWithEval = new MoveWithEval(undefined, undefined)    

    // shuffle availableMoves array so machineLearning/timeout snake doesn't prefer one direction
    shuffle(availableMoves)

    let effectiveLookahead = lookahead === undefined? 0 : lookahead
    let foodCountTier = getFoodCountTier(gameState.board.food.length)
    let hazardCountTier = getHazardCountTier(gameState.board.hazards.length)
    let snakeScoreHash = getSnakeScoreHashKey(myself.length, foodCountTier, hazardCountTier, gameState.board.snakes.length, effectiveLookahead)
    let averageMoveScore: number | undefined = evaluationsForMachineLearning[snakeScoreHash]
    let doneEvaluating: boolean = false
    for (let i: number = 0; i < availableMoves.length; i++) {
      let move: Direction = availableMoves[i]
      if (iterativeDeepening && !checkTime(startTime, gameState)) { return new MoveWithEval(undefined, undefined) }
      if (thisGameData && bestMove && (bestMove.score !== undefined) && amUsingMachineData && myself.id === gameState.you.id) { // machine learning check! Only do for self
        if (averageMoveScore !== undefined) { // if an average move score exists for this game state
          if (averageMoveScore > 0 && bestMove.score >= (averageMoveScore * 1.1)) { // if the average move score isn't objectively bad, & bestMove is appreciably better than it
            doneEvaluating = true
          }
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
          let moveSnakes: { [key: string]: MoveWithEval} = {} // array of snake IDs & the MoveWithEval each snake having that ID wishes to move in

          let otherSnakes: Battlesnake[] = newGameState.board.snakes.filter(function filterMeOut(snake) {
            return newSelf !== undefined && (snake.id !== newSelf.id)
          })

          let kissStates = determineKissStateForDirection(move, kissStatesThisState) // this can be calculated independently of snakes moving, as it's dependent on gameState, not newGameState

          if (newSelf.id === newGameState.you.id) { // only move snakes for self snake, otherwise we recurse all over the place        

            otherSnakes.sort((a: Battlesnake, b: Battlesnake) => { // sort otherSnakes by length in descending order. This way, smaller snakes wait for larger snakes to move before seeing if they must move to avoid being killed
              return b.length - a.length
            })

            otherSnakes.forEach(snake => {
              moveSnakes[snake.id] = _decideMove(gameState, snake, 0, undefined, move) // decide best move for other snakes according to current data, & tell them what move I am making
            })

            moveSnake(newGameState, newSelf, board2d, move) // move newSelf to available move after otherSnakes have decided on their moves

            otherSnakes.forEach(function mvsnk(snake) { // move each of the snakes at the same time, without updating gameState until each has moved              
              if (moveSnakes[snake.id]) { // if I have already decided upon this snake's move, see if it dies doing said move
                let newHead = getCoordAfterMove(gameState, snake.head, moveSnakes[snake.id].direction)
                let adjustedMove = moveSnakes[snake.id] // don't modify moveSnakes[snake.id], as this is used by other availableMoves loops

                let murderSnake: Battlesnake | undefined = newGameState.board.snakes.find(murderSnake => { // check if any snake has murdered this snake, including originalSnake
                  let murderSnakeBeforeMove: Battlesnake | undefined = gameState.board.snakes.find(priorSnake => { // get murder snake before it had moved
                    return murderSnake !== undefined && priorSnake.id === murderSnake.id
                  })
                  
                  if (murderSnakeBeforeMove !== undefined && murderSnakeBeforeMove.id !== snake.id) { // don't compare self to self
                    // return true if otherOtherSnake is in the same cell as newHead, & is larger or equal
                    return (coordsEqual(newHead, murderSnake.head) && murderSnakeBeforeMove.length >= snake.length) // snake hasn't moved yet since we're in the process of moving it, can use its length
                  } else { // return false for self
                    return false
                  }
                })
                // allow snakes that died to reroll their move
                if (murderSnake !== undefined) {
                  let otherSnakeAvailableMoves: Direction[] = getAvailableMoves(newGameState, snake, new Board2d(newGameState)).validMoves()
                  let murderSnakeBeforeMove: Battlesnake | undefined = gameState.board.snakes.find(priorSnake => { // get murder snake before it had moved
                    return murderSnake !== undefined && priorSnake.id === murderSnake.id
                  })
                  let newMove: MoveWithEval
                  switch (otherSnakeAvailableMoves.length) { // allow otherSnake to choose again if that may make a difference
                    case 0: // otherSnake has no other options, don't change its move
                      break
                    case 1: // otherSnake has only one other option left. Evaluate it, choose it if it's better than a tie
                    case 2: // otherSnake has more than one other option left (originally had three). Evaluate & choose the best one if they're better than a tie
                      if (otherSnakeAvailableMoves.length === 1) {
                        if (isDuel && murderSnakeBeforeMove !== undefined && murderSnakeBeforeMove.length === snake.length) {
                          newMove = _decideMove(newGameState, snake, 0, undefined, Direction.AlreadyMoved) // let snake decide again, no lookahead this time, & tell it that myself already moved
                        } else {
                          newMove = new MoveWithEval(otherSnakeAvailableMoves[0], undefined) // with only one other move available, score only matters in a duel tie
                        }
                      } else {
                        newMove = _decideMove(newGameState, snake, 0, undefined, Direction.AlreadyMoved) // let snake decide again, no lookahead this time, & tell it that myself already moved
                      }
                      if (adjustedMove.score === undefined) { // if for some reason adjustedMove's score was undefined, newMove's score is 'better'
                        adjustedMove = newMove
                      } else { // we should only let the snake choose death if it's a duel, a tie, & the alternative move is worse than a tie
                        if (murderSnakeBeforeMove !== undefined) { // this should always pass, since murderSnake came from a clone of gameState
                          if (!isDuel) { // it's not a duel
                            if (murderSnakeBeforeMove.length > snake.length) { // if it's not a tie, should choose elsewhere.
                              adjustedMove = newMove
                            } else if (murderSnake.id !== gameState.you.id) { // if it is a tie, don't rechoose if murderSnake was me. Otherwise, rechoose
                              adjustedMove = newMove
                            }
                          } else if (murderSnakeBeforeMove.length > snake.length) { // it is a duel, but I'm smaller, this is a loss, rechoose
                            adjustedMove = newMove
                          } else if (newMove.score !== undefined && newMove.score > (2 * determineEvalNoSnakes(newGameState, snake, murderSnakeBeforeMove).sum(noMe))) { // it is a duel & we would tie, but I have a better option than a tie elsewhere, rechoose. Multiply by 2, since 0 lookahead still means this state, + the state of the chosen bestMove
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
              if (snake.id === newGameState.you.id && originalSnakeMove !== undefined) { // we know exactly what move snake is making if that snake is originalSnake
                moveSnake(newGameState, snake, board2d, originalSnakeMove)              
              } else {
                let otherSnakeAvailableMoves = getAvailableMoves(newGameState, snake, board2d).validMoves()
                if (otherSnakeAvailableMoves.length === 0) {
                  moveSnake(newGameState, snake, board2d, getDefaultMove(newGameState, snake, board2d))
                } else if (otherSnakeAvailableMoves.length === 1) {
                  moveSnake(newGameState, snake, board2d, otherSnakeAvailableMoves[0])
                } else {
                  fakeMoveSnake(gameState, snake)
                }
              }
            })

            updateGameStateAfterMove(newGameState) // update gameState after moving newSelf
          }
          
          let evalState: MoveWithEval
          let evaluationResult: EvaluationResult | undefined = undefined
          let kissArgs: KissStatesForEvaluate = new KissStatesForEvaluate(kissStates.kissOfDeathState, kissStates.kissOfMurderState, moveNeighbors.getPredator(move), moveNeighbors.getPrey(move))
          let thisLeaf: Leaf | undefined = undefined
          if (isDevelopment) {
            if (myself.id === gameState.you.id && lookahead !== undefined) {
              thisLeaf = new Leaf(new MoveWithEval(move, undefined), _evalThisState, [], lookahead, parentLeaf)
            }
          }
          if (lookahead !== undefined && lookahead > 0) { // don't run evaluate at this level, run it at the next level
            if (isDevelopment) {
              evalState = _decideMove(newGameState, newSelf, lookahead - 1, kissArgs, undefined, thisLeaf) // This is the recursive case!!!
            } else {
              evalState = _decideMove(newGameState, newSelf, lookahead - 1, kissArgs) // This is the recursive case!!!
            }
          } else { // base case, just run the eval
            evaluationResult = evaluate(newGameState, newSelf, kissArgs)
            evalState = new MoveWithEval(move, evaluationResult.sum(noMe))
          }
          if (isDevelopment) {
            if (thisLeaf !== undefined) {
              thisLeaf.value = new MoveWithEval(move, evalState.score)
              if (evaluationResult !== undefined) {
                thisLeaf.evaluationResult = evaluationResult
              } else {
                thisLeaf.evaluationResult = _evalThisState
              }
            }
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
    }

    // need to process this & add to DB before adding evalThisState, becaause evalThisState is normally only added for a given lookahead after examining availableMoves
    let canLearn: boolean = averageMoveScore === undefined || averageMoveScore < 0 // can still learn if we didn't have data for this move, or the only data we had was worthless
    if ((amMachineLearning || canLearn) && (myself.id === gameState.you.id) && (bestMove.score !== undefined) && !finishEvaluatingNow) { // only add machine learning data for my own moves, & only consider moves that weren't defaults
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

    // if (isDevelopment && timeStart !== 0) {
    //   let timeEnd = Date.now()
    //   let totalTimeTaken = timeEnd - timeStart
    //   if (totalTimeTaken > 30) {
    //     if (lookahead === startLookahead) {
    //       logToFile(consoleWriteStream, `total time taken calculating _decideMove for ${myself.name} on turn ${gameState.turn} with lookahead ${lookahead}: ${totalTimeTaken}`)
    //     } else {
    //       logToFile(consoleWriteStream, `for lookahead ${lookahead}, time taken calculating _decideMove for ${myself.name} on turn ${gameState.turn}: ${totalTimeTaken}`)
    //     }
    //   }
    // }

    return bestMove
  }

  let availableMoves: Moves = getAvailableMoves(gameState, myself, startingBoard2d)
  let validMoves = availableMoves.validMoves()
  // before jumping into recursion, first check to see if I have any choices to make
  if (validMoves.length === 1) { // if I only have one valid move, return that
    return new MoveWithEval(validMoves[0], undefined)
  } else if (validMoves.length === 0) { // if I have no valid moves, return the default move
    return new MoveWithEval(getDefaultMove(gameState, myself, startingBoard2d), undefined)
  } else { // otherwise, start deciding  
    let myselfMove: MoveWithEval = _decideMove(gameState, myself, startLookahead)

    if (isDevelopment && amUsingMachineData) { // if I'm using machine learning data, log how many times I took advantage of the data
      logToFile(consoleWriteStream, `Turn ${gameState.turn}: used machine learning to short circuit available moves forEach ${movesShortCircuited} times.`)
    }

    // primarily for debug purposes to track what's going on in the tree
    // if (isDevelopment) {
    //   logToFile(consoleWriteStream, tree.toString())
    // }
    return myselfMove
  }
}

export function move(gameState: GameState): MoveResponse {
  let timeBeginning = Date.now()
  let hazardWalls = new HazardWalls(gameState) // only need to calculate this once
  let thisGameDataId = createGameDataId(gameState)
  let source: string = gameState.game.source
  let board2d: Board2d = new Board2d(gameState, true)
  let futureSight: number = lookaheadDeterminator(gameState, board2d)

  let thisGameData: GameData
  if (gameData[thisGameDataId]) {
    thisGameData = gameData[thisGameDataId]
  } else { // if for some reason game data for this game doesn't exist yet (happens when testing due to lack of proper start() & end()s, create it & add it to gameData
    thisGameData = new GameData(source)
    gameData[thisGameDataId] = thisGameData
  }

  let gameDataIds: string[] = Object.keys(gameData)
  let otherLeagueGameRunning: boolean = gameDataIds.some(id => {
    if (id !== thisGameDataId) { // don't consider myself when finding other gameDatas
      let otherGameData: GameData = gameData[id]
      return otherGameData.source === "league" // return true if some other game is currently running with a league source
    }
  })
  if (otherLeagueGameRunning && source !== "league") { // if another league game is running, & this game is not a league game, return a suicidal move
    let suicidalMove: Direction = getSuicidalMove(gameState, gameState.you)
    let suicidalMoveStr: string = directionToString(suicidalMove) || "up"
    console.log(`another league game already running, moving towards neck with ${suicidalMoveStr}`)
    return {move: suicidalMoveStr}
  }

  thisGameData.hazardWalls = hazardWalls // replace gameData hazard walls with latest copy
  thisGameData.lookahead = futureSight // replace gameData lookahead with latest copy
  if (gameStateIsHazardSpiral(gameState) && thisGameData.hazardSpiral === undefined && gameState.board.hazards.length === 1) {
    thisGameData.hazardSpiral = new HazardSpiral(gameState, 3)
  }

  // logic to seek out a prey snake
  if (gameState.turn > 25 && gameState.board.snakes.length > 2) { // now that the game has shaken out some, start predating on the largest snake
    if (thisGameData.prey === undefined) {
      const otherSnakes: Battlesnake[] = gameState.board.snakes.filter(function filterMeOut(snake) {
        return snake.id !== gameState.you.id
      })
      const randomSnakeIdx = getRandomInt(0, otherSnakes.length)

      thisGameData.prey = otherSnakes[randomSnakeIdx]
      //logToFile(consoleWriteStream, `new prey snake ${thisGameData.prey.name}`)
    } else { // thisGameData prey is defined. Check to see if it still lives, & find a new one if not
      let preyAlive: boolean = gameState.board.snakes.some(snake => { return thisGameData.prey !== undefined && snake.id === thisGameData.prey.id })
      if (!preyAlive) {
        const otherSnakes: Battlesnake[] = gameState.board.snakes.filter(function filterMeOut(snake) {
          return snake.id !== gameState.you.id
        })
        const randomSnakeIdx = getRandomInt(0, otherSnakes.length)
  
        thisGameData.prey = otherSnakes[randomSnakeIdx]
        //logToFile(consoleWriteStream, `new prey snake ${thisGameData.prey.name}`)
      }
    }
  }

  //logToFile(consoleWriteStream, `lookahead turn ${gameState.turn}: ${futureSight}`)
  
  let chosenMove: MoveWithEval
  if (gameDataIds.length === 1 && gameState.game.source !== "testing") { // if running only one game, do iterative deepening. Don't iteratively deepen when testing
    chosenMove = decideMove(gameState, gameState.you, timeBeginning, 0, board2d, true)
    if (gameState.turn === 0) {
      futureSight = 0
    } else {
      futureSight = 7
    }

    let i: number = 1
    let newMove: MoveWithEval
    while(checkTime(timeBeginning, gameState) && i <= futureSight) { // while true, keep attempting to get a move with increasing depths
      thisGameData.lookahead = i
      newMove = decideMove(gameState, gameState.you, timeBeginning, i, board2d, true) // choose another move with increased lookahead depth
      if (checkTime(timeBeginning, gameState)) { 
        chosenMove = newMove // if chosenMove was determined with time to spare, can use it
        i = i + 1
      } else {
        break // ran out of time, exit loop & use chosenMove of the deepest depth we had time for
      } 
    }
    logToFile(consoleWriteStream, `max lookahead depth for iterative deepening: ${i - 1}`)
  } else { // if running three or more games at once, do not iteratively deepen, may time out on the basic stuff
    chosenMove = decideMove(gameState, gameState.you, timeBeginning, futureSight, board2d, false)
  }

  let chosenMoveDirection : Direction = chosenMove.direction !== undefined ? chosenMove.direction : getDefaultMove(gameState, gameState.you, board2d) // if decideMove has somehow not decided up on a move, get a default direction to go in
  
  if (thisGameData !== undefined) {
    let timeTaken: number = Date.now() - timeBeginning
    let timesTaken = thisGameData.timesTaken
    timesTaken.push(timeTaken)
  }

  return {move: directionToString(chosenMoveDirection) || "up"} // if somehow we don't have a move at this point, give up
}