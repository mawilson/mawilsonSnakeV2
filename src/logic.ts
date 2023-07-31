export const version: string = "1.7.10" // need to declare this before imports since several imports utilize it

import { InfoResponse, GameState, MoveResponse } from "./types"
import { Direction, directionToString, Board2d, Moves, Battlesnake, MoveWithEval, KissOfDeathState, KissOfMurderState, KissStates, HazardWalls, KissStatesForEvaluate, GameData, TimingData, HazardSpiral, EvaluationResult, Coord, TimingStats, HealthTier, SortInfo } from "./classes"
import { logToFile, checkTime, moveSnake, updateGameStateAfterMove, findMoveNeighbors, findKissDeathMoves, findKissMurderMoves, kissDecider, cloneGameState, getRandomInt, getDefaultMove, getAvailableMoves, determineKissStateForDirection, fakeMoveSnake, getCoordAfterMove, coordsEqual, createLogAndCycle, createGameDataId, calculateTimingData, getFoodCountTier, getHazardCountTier, gameStateIsSolo, gameStateIsHazardSpiral, gameStateIsConstrictor, gameStateIsArcadeMaze, gameStateIsHazardPits, getSuicidalMove, lookaheadDeterminator, lookaheadDeterminatorDeepening, getHazardDamage, floatsEqual, snakeHasEaten, gameStateIsSinkhole, buildGameStateHash, getDistance, isTestLogging, getGameResult } from "./util"
import { evaluate, evaluateMinimax, determineEvalNoSnakes, evalHaveWonTurnStep, determineEvalNoMe, getDefaultEvalNoMe, evaluateTailChasePenalty, evaluateWinValue, determineHealthTier } from "./eval"
import { connectToDatabase, getCollection } from "./db"

import { WriteStream } from 'fs'
let consoleWriteStream: WriteStream = createLogAndCycle("consoleLogs_logic")

import { Collection, MongoClient } from 'mongodb'

const lookaheadWeight = 0.1
export const isDevelopment: boolean = false

export let gameData: {[key: string]: GameData} = {}
export let preySnakeName: string | undefined = undefined

export function info(): InfoResponse {
    console.log("INFO")
    let response: InfoResponse
    if (isDevelopment) { // Chicken in a Biskit
      response = {
        apiversion: "1",
        author: "waryferryman",
        color: "#ee2c2c", // #A06D4A
        head: "chicken", // "replit-mark",
        tail: "ghost", // "rbc-necktie",
        version: version
      }
    } else { // Geriatric Jagwire
      response = {
        apiversion: "1",
        author: "waryferryman",
        color: "#ffe58f", // #ff9900
        head: "glasses", //"tiger-king",
        tail: "freckled", //"mystic-moon",
        version: version
      }
    }

    return response
}

export function start(gameState: GameState) {
  const gameDataId = createGameDataId(gameState)
  gameData[gameDataId] = new GameData(gameState) // move() will update hazardWalls & lookahead accordingly later on.
  console.log(`${gameState.game.id} with game source ${gameState.game.source} START. Now ${Object.keys(gameData).length} running.`)

  if (preySnakeName) { // on game start, check to see if preySnakeName is defined & valid for the upcoming game
    // prey snake should never be myself, which is possible in games with multiple me's
    let preySnake: Battlesnake = gameState.board.snakes.find(snake => (snake.name === preySnakeName) && (snake.id !== gameState.you.id))
    if (!preySnake) {
      preySnakeName = undefined // if preySnake is defined but is not in the game, cannot use it, so reset it
      gameData[gameDataId].preySnakeLives = false
    }
  }
}

export async function end(gameState: GameState): Promise<void> {
  let gameDataId = createGameDataId(gameState)
  let thisGameData = gameData? gameData[gameDataId] : undefined // may be undefined if gameData has already been cleaned up before game ended
  let gameResult = getGameResult(gameState)
  
  const mongoClient: MongoClient = await connectToDatabase() // wait for database connection to be opened up
  let timeStats: TimingStats | undefined
  if (thisGameData && thisGameData.timesTaken && thisGameData.timesTaken.length > 0) {
    timeStats = calculateTimingData(thisGameData.timesTaken)
  } else {
    timeStats = undefined
  }
  let hazardDamage: number = getHazardDamage(gameState)
  let timeouts: number = thisGameData? thisGameData.timeouts : 0
  let averageMaxLookaheadMaxN: number | undefined = undefined
  let averageMaxLookaheadMinimax: number | undefined = undefined

  if (thisGameData) { 
    if (thisGameData.maxLookaheadsMaxN.length > 0) {
      let sum: number = 0
      for (const maxLookahead of thisGameData.maxLookaheadsMaxN) {
        sum += maxLookahead
      }
      averageMaxLookaheadMaxN = sum / thisGameData.maxLookaheadsMaxN.length
    }
    if (thisGameData.maxLookaheadsMinimax.length > 0) {
      let sum: number = 0
      for (const maxLookahead of thisGameData.maxLookaheadsMinimax) {
        sum += maxLookahead
      }
      averageMaxLookaheadMinimax = sum / thisGameData.maxLookaheadsMinimax.length
    }
  }
  if (averageMaxLookaheadMaxN) {
    logToFile(consoleWriteStream, `Average max lookahead MaxN: ${averageMaxLookaheadMaxN}`)
  }
  if (averageMaxLookaheadMinimax) {
    logToFile(consoleWriteStream, `Average max lookahead Minimax: ${averageMaxLookaheadMinimax}`)
  }

  let winningSnakeName: string | undefined
  let preySnakeWon: boolean | undefined = preySnakeName !== undefined ? false : undefined // if preySnakeName is defined, it can win or lose. Set to false here, & true below if it won
  if (gameState.board.snakes.length === 1 && gameResult > 1) { // if somebody other than me won, set preySnakeName to that snake. gameResult > 1 means I neither won, tied, nor solo'd
    winningSnakeName = gameState.board.snakes[0].name
    if (winningSnakeName === preySnakeName) { // if preySnake won, don't overwrite preySnakeName
      logToFile(consoleWriteStream, `${gameState.game.id} saw a preySnake with name ${preySnakeName} win consecutively`)
      preySnakeWon = true
    } else {
      preySnakeName = winningSnakeName
    }
  } else { // if I won or nobody won, clear the previous preySnakeName
    preySnakeName = undefined
  }

  let timeData = new TimingData(timeStats, gameResult, version, gameState.game.timeout, gameState.game.ruleset.name, isDevelopment, gameState.game.source, hazardDamage, gameState.game.map, gameState.you.length, timeouts, averageMaxLookaheadMaxN, averageMaxLookaheadMinimax, preySnakeWon)

  const timingCollection: Collection = await getCollection(mongoClient, "timing")

  await timingCollection.insertOne(timeData)

  await mongoClient.close() // always close your connection out!
  

  if (thisGameData !== undefined) { // clean up game-specific data
    delete gameData[gameDataId]
  }
  console.log(`${gameState.game.id} with game source ${gameState.game.source} END. Still ${Object.keys(gameData).length} games running.\n`)
}

// TODO
// change tsconfig to noImplicitAny: true

export function decideMove(gameState: GameState, myself: Battlesnake, startTime: number, _startLookahead: number, startingBoard2d: Board2d, iterativeDeepening: boolean): MoveWithEval {
  let gameDataString = createGameDataId(gameState)
  let thisGameData: GameData = gameData[gameDataString] || new GameData(gameState) // should always exist from move(), things will be wonky if we have to use a new GameData
  const isTesting: boolean = gameState.game.source === "testing" // currently used to subvert stillHaveTime check when running tests. Remove that to still run stillHaveTime check during tests
  const startLookahead: number = gameState.you.id === myself.id ? _startLookahead : 0 // otherSnakes always use lookahead of 0
  const testLogging: boolean = isTestLogging(isDevelopment, gameState)

  let noMe: number
  if (thisGameData.evalNoMe !== undefined) {
    noMe = thisGameData.evalNoMe
  } else {
    noMe = getDefaultEvalNoMe(gameState).sum()
  }

  function _decideMove(gameState: GameState, myself: Battlesnake, lookahead?: number, kisses?: KissStatesForEvaluate, _otherSnakeMoves?: {[key: string]: Direction}, _eatTurns?: number): MoveWithEval {
    let stillHaveTime = checkTime(startTime, gameState) // if this is true, we need to hurry & return a value without doing any more significant calculation
    if (!stillHaveTime && iterativeDeepening) { return new MoveWithEval(undefined, undefined) } // Iterative deepening will toss this result anyway, may as well leave now
    const originalSnake: boolean = myself.id === gameState.you.id

    let stateContainsMe: boolean = gameState.board.snakes.some(function findSnake(snake) {
      return snake.id === myself.id
    })

    let isDuel: boolean = stateContainsMe && (gameState.board.snakes.length === 2)
    
    let board2d: Board2d
    if (originalSnake && gameState.turn === thisGameData.startingGameState.turn) { // only originalSnake can use startingBoard2d, as otherSnakes may be rechoosing moves here after dying
      board2d = startingBoard2d
    } else {
      board2d = new Board2d(gameState, false)
    }

    let _evalThisState: EvaluationResult | undefined = undefined
    let evalThisState: number | undefined = undefined

    let cachedEvaluationsThisTurn: {[key: string]: number} = thisGameData.cachedEvaluations[gameState.turn]
    let cachedEvaluationsNextTurn: {[key: string]: number} = thisGameData.cachedEvaluations[gameState.turn + 1]

    // non-originalSnakes never need evalThisState (they only care about availableMoves scores, since they can't look ahead)
    if (originalSnake && gameState.turn !== thisGameData.startingGameState.turn) { // originalSnake does not need evalThisState for the initial turn, since that won't be returned to another _decideMove
      let priorKissOfDeathState: KissOfDeathState = kisses === undefined ? KissOfDeathState.kissOfDeathNo : kisses.deathState
      let priorKissOfMurderState: KissOfMurderState = kisses === undefined ? KissOfMurderState.kissOfMurderNo : kisses.murderState
      let evaluateKisses = new KissStatesForEvaluate(priorKissOfDeathState, priorKissOfMurderState, kisses?.predator, kisses?.prey)
      
      let hash: string = buildGameStateHash(gameState, myself, evaluateKisses, _eatTurns || 0, originalSnake, undefined)
      let cache = cachedEvaluationsThisTurn[hash]
      if (cache !== undefined) {
        evalThisState = cache
        // below lines are useful when testing to catch where gameStateHash isn't adequately distinguishing different game states
        // even when not iterative deepening, some tie & death states will hit the cache, but their scores should always be equivalent!!
        // _evalThisState = evaluate(gameState, myself, evaluateKisses, _eatTurns)
        // if (!floatsEqual(cache, _evalThisState.sum())) {
        //   debugger
        // }
      } else {
        _evalThisState = evaluate(gameState, myself, evaluateKisses, _eatTurns)
        evalThisState = _evalThisState.sum(noMe)
        cachedEvaluationsThisTurn[hash] = evalThisState
      }
    }

    let moves: Moves = getAvailableMoves(gameState, myself, board2d)
    let availableMoves = moves.validMoves()

    let finishEvaluatingNow: boolean = false
    if (!isTesting && !stillHaveTime) { // if we need to leave early due to time
      finishEvaluatingNow = true
    } else if (!stateContainsMe) { // if we're dead
      finishEvaluatingNow = true
    } else if (availableMoves.length < 1) { // if there's nowhere left to decide to move
      finishEvaluatingNow = true
    } else if (availableMoves.length === 1) { 
      if (!originalSnake) { // non-original snakes don't look ahead
        finishEvaluatingNow = true
      } else if (lookahead === startLookahead) { // no need to look ahead, just return the only available move with a bogus computed score 
        finishEvaluatingNow = true
      }
    } else if (gameState.game.ruleset.name !== "solo" && gameState.board.snakes.length === 1) { // it's not a solo game, & we're the only one left - we've won
      finishEvaluatingNow = true
    }

    if (finishEvaluatingNow) { // if out of time, myself is dead, all other snakes are dead (not solo), or there are no available moves, return a direction & the evaluation for this state
      if (lookahead !== undefined && evalThisState !== undefined) {
        let newScore: number = 0 // should always at least account for this turn
        if (availableMoves.length < 1 && gameState.board.snakes.length > 1) { // will die in one turn (& haven't won), should apply evalNoMe score to all but this state
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

    let palindromeOtherSnakeMoves: boolean
    if (iterativeDeepening && gameState.board.snakes.length >= 3) {
      if (startLookahead === 0) { // palindrome on startLookahead 0 - otherwise cache entries in future may be misinformed.
        palindromeOtherSnakeMoves = true
      } else if (lookahead !== 0) { // palindrome on iterative deepening turns that aren't the max depth - we should have these move scores in cache
        palindromeOtherSnakeMoves = true
      } else {
        palindromeOtherSnakeMoves = false // don't have cached entries for this (it's the end of the iterativeDeepening for this depth), too expensive to palindrome
      }
    } else { // don't palindrome otherSnakes if not deepening (too expensive, no cache entries) or there's only two snakes on board (me & another)
      palindromeOtherSnakeMoves = false
    }

    let moveNeighbors = findMoveNeighbors(gameState, myself, board2d, moves)
    let kissOfMurderMoves = findKissMurderMoves(moveNeighbors)
    let kissOfDeathMoves = findKissDeathMoves(moveNeighbors)
  
    let kissStatesThisState: KissStates = kissDecider(gameState, myself, moveNeighbors, kissOfDeathMoves, kissOfMurderMoves, moves, board2d)

    let otherSnakeSortInfo: { [key: string]: SortInfo} = {}
    if (originalSnake && !palindromeOtherSnakeMoves) { // no need to bother with sorting if doing palindrome snake moves
      for (const snake of gameState.board.snakes) {
        if (snake.id !== myself.id) { // no need to sort self
          let otherSnakeMoves: Moves = getAvailableMoves(gameState, snake, board2d)
          let otherSnakeMoveNeighbors = findMoveNeighbors(gameState, snake, board2d, otherSnakeMoves)
          let otherSnakeKissOfDeathMoves = findKissDeathMoves(otherSnakeMoveNeighbors, myself.id)
          let canBeMurdered: boolean = otherSnakeKissOfDeathMoves.length > 0 // if any of the snake's moves result in maybe being murdered
          let distanceToMe: number = getDistance(snake.head, myself.head, gameState)
          otherSnakeSortInfo[snake.id] = new SortInfo(distanceToMe, canBeMurdered)
        }
      }
    }

    // of the available remaining moves, evaluate the gameState if we took that move, and then choose the move resulting in the highest scoring gameState
    let bestMove : MoveWithEval = new MoveWithEval(undefined, undefined)

    for (let i: number = 0; i < availableMoves.length; i++) {
      let move: Direction = availableMoves[i]
      if (iterativeDeepening && !checkTime(startTime, gameState)) { return new MoveWithEval(undefined, undefined) }

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

        let eatTurns: number = _eatTurns || 0
        let oldLength: number = otherSnakes.length
        if (originalSnake) { // only move snakes for self snake, otherwise we recurse all over the place
          if (!palindromeOtherSnakeMoves) { // no need to bother with sorting if doing palindrome snake moves
            otherSnakes.sort((a: Battlesnake, b: Battlesnake) => { // sort otherSnakes by length in descending order. This way, smaller snakes wait for larger snakes to move before seeing if they must move to avoid being killed
              let aSortInfo: SortInfo = otherSnakeSortInfo[a.id]
              let bSortInfo: SortInfo = otherSnakeSortInfo[b.id]
              if (aSortInfo && bSortInfo) {
                if (aSortInfo.canBeMurdered || bSortInfo.canBeMurdered) { // if either snake is in danger of a kiss of death, sort by length so the smaller can avoid it
                  return b.length - a.length
                } else { // if neither snake can be murdered, sort them by distance to me, so the closer one with more potential to harm my Voronoi chooses first
                  return aSortInfo.distanceToMe - bSortInfo.distanceToMe
                }
              } else { // if I somehow don't have sort info for either snake, do the default length sort
                return b.length - a.length
              }
            })
          } else {
            // if we are deepening & not on final lookahead, all moves should calculate very quickly because their scores will be cached
            // we can therefore allow all snakes to choose with as much info as possible, by letting them choose again. We lose the performance, but gain accuracy over fakeMoveSnake
            // turn array from [1, 2, 3] into [1, 2, 3, 2, 1]
            for (let i: number = otherSnakes.length - 2; i >= 0; i--) { // start at length -2, go backwards 
              otherSnakes.push(otherSnakes[i])
            }
          }

          let otherSnakeMoves: {[key: string]: Direction} = {[myself.id]: move}
          for (const snake of otherSnakes) {
            const snakeMove: MoveWithEval = _decideMove(gameState, snake, 0, undefined, otherSnakeMoves) // decide best move for other snakes according to current data, & tell them what move I am making
            moveSnakes[snake.id] = snakeMove
            if (snakeMove.direction !== undefined) {
              otherSnakeMoves[snake.id] = snakeMove.direction // tell subsequent snakes about where this snake is moving
            }
          }

          if (palindromeOtherSnakeMoves) {
            otherSnakes.length = oldLength // truncate back so as not to double-process snakes now that decisions have been made
          }

          moveSnake(newGameState, newSelf, board2d, move) // move newSelf to available move after otherSnakes have decided on their moves
          otherSnakeMoves[myself.id] = Direction.AlreadyMoved // myself has now moved

          if (snakeHasEaten(newSelf)) {
            eatTurns += 1
          }

          for (const snake of otherSnakes) { // move each of the snakes at the same time, without updating gameState until each has moved 
            if (moveSnakes[snake.id]) { // if I have already decided upon this snake's move, see if it dies doing said move
              let newHead = getCoordAfterMove(gameState, snake.head, moveSnakes[snake.id].direction)
              let adjustedMove = moveSnakes[snake.id] // don't modify moveSnakes[snake.id], as this is used by other availableMoves loops

              let murderSnakeBeforeMove: Battlesnake | undefined
              let murderSnake: Battlesnake | undefined = newGameState.board.snakes.find(murderSnake => { // check if any snake has murdered this snake, including originalSnake
                if (murderSnake.id === snake.id) { return false } // return false for self
                murderSnakeBeforeMove = gameState.board.snakes.find(priorSnake => { // get murder snake before it had moved
                  return murderSnake !== undefined && priorSnake.id === murderSnake.id
                })
                
                if (murderSnakeBeforeMove !== undefined) {
                  // return true if otherOtherSnake is in the same cell as newHead, & is larger or equal
                  return (coordsEqual(newHead, murderSnake.head) && murderSnakeBeforeMove.length >= snake.length) // snake hasn't moved yet since we're in the process of moving it, can use its length
                } else { // return false for nonexistant snakes
                  return false
                }
              })
              // allow snakes that died to reroll their move
              if (murderSnake !== undefined) {
                let otherSnakeAvailableMoves: Direction[] = getAvailableMoves(gameState, snake, board2d).validMoves()
                let newMove: MoveWithEval
                const otherSnakeAvailableMovesAfterDeath: number = otherSnakeAvailableMoves.length - 1
                switch (otherSnakeAvailableMovesAfterDeath) { // allow otherSnake to choose again if that may make a difference. Available moves length will be one less than before, as we already know the first one resulted in death
                  case 0: // otherSnake has no other options, don't change its move
                    break
                  case 1: // otherSnake has only one other option left. Evaluate it, choose it if it's better than a tie
                  case 2: // otherSnake has more than one other option left (originally had three). Evaluate & choose the best one if they're better than a tie
                    if (otherSnakeAvailableMovesAfterDeath === 1) {
                      if (isDuel && murderSnakeBeforeMove !== undefined && murderSnakeBeforeMove.length === snake.length) {
                        newMove = _decideMove(newGameState, snake, 0, undefined, otherSnakeMoves) // let snake decide again, no lookahead this time, & tell it that myself already moved
                      } else {
                        let newMoveDir: Direction = otherSnakeAvailableMoves[0]
                        if (newMoveDir === adjustedMove.direction) { newMoveDir = otherSnakeAvailableMoves[1] } // hack to avoid looping - there are two elements in this array, & we want the one that isn't what adjustedMove already is
                        newMove = new MoveWithEval(newMoveDir, undefined) // with only one other move available, score only matters in a duel tie
                      }
                    } else {
                      newMove = _decideMove(newGameState, snake, 0, undefined, otherSnakeMoves) // let snake decide again, no lookahead this time, & tell it that myself already moved
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
                        } else if (newMove.score !== undefined && newMove.score > determineEvalNoSnakes(newGameState, snake, murderSnakeBeforeMove, eatTurns).sum(noMe)) { // it is a duel & we would tie, but I have a better option than a tie elsewhere, rechoose
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
              otherSnakeMoves[snake.id] = Direction.AlreadyMoved
            }
          }
          updateGameStateAfterMove(newGameState) // update gameState after moving all snakes
        } else { // for other snakes, still need to be able to move self to a new position to evaluate it
          moveSnake(newGameState, newSelf, board2d, move) // move newSelf to available move
          if (snakeHasEaten(newSelf)) {
            eatTurns += 1
          }

          // TODO: Figure out a smart way to move otherSnakes' opponents here that doesn't infinitely recurse
          for (const snake of otherSnakes) { // can't keep asking decideMove how to move them, but we need to at least remove the other snakes' tails without changing their length, or else this otherSnake won't consider tail cells other than its own valid
            if (_otherSnakeMoves !== undefined && _otherSnakeMoves[snake.id] !== undefined) { // we know exactly what move this snake is making
              moveSnake(newGameState, snake, board2d, _otherSnakeMoves[snake.id])              
            } else {
              let otherSnakeAvailableMoves = getAvailableMoves(newGameState, snake, board2d).validMoves()
              if (otherSnakeAvailableMoves.length === 0) {
                moveSnake(newGameState, snake, board2d, getDefaultMove(newGameState, snake, board2d))
              } else if (otherSnakeAvailableMoves.length === 1) {
                moveSnake(newGameState, snake, board2d, otherSnakeAvailableMoves[0])
              } else {
                fakeMoveSnake(snake)
              }
            }
          }

          updateGameStateAfterMove(newGameState) // update gameState after moving newSelf
        }
        
        let evalState: MoveWithEval
        let evaluationResult: EvaluationResult | undefined = undefined
        let kissArgs: KissStatesForEvaluate | undefined
        if (kissStates.kissOfDeathState === KissOfDeathState.kissOfDeathNo && kissStates.kissOfMurderState === KissOfMurderState.kissOfMurderNo) {
          kissArgs = undefined
        } else {
          kissArgs = new KissStatesForEvaluate(kissStates.kissOfDeathState, kissStates.kissOfMurderState, moveNeighbors.getPredator(move), moveNeighbors.getPrey(move))
        }
        
        if (lookahead !== undefined && lookahead > 0) { // don't run evaluate at this level, run it at the next level
          evalState = _decideMove(newGameState, newSelf, lookahead - 1, kissArgs, undefined, eatTurns) // This is the recursive case!!!
        } else { // base case, just run the eval
          let hash: string = buildGameStateHash(newGameState, newSelf, kissArgs, eatTurns, originalSnake, undefined)
          let sum: number
          let cache = cachedEvaluationsNextTurn[hash]
          if (cache !== undefined) { // look for this gameState in cache
            sum = cache
            // below lines are useful when testing to catch where gameStateHash isn't adequately distinguishing different game states
            // even when not iterative deepening, some tie & death states will hit the cache, but their scores should always be equivalent!!
            // evaluationResult = evaluate(newGameState, newSelf, kissArgs, eatTurns)
            // if (!floatsEqual(cache, evaluationResult.sum())) {
            //   debugger
            // }
          } else { // if not in cache, evaluate, then store in cache
            evaluationResult = evaluate(newGameState, newSelf, kissArgs, eatTurns)
            sum = evaluationResult.sum(noMe)

            cachedEvaluationsNextTurn[hash] = sum // cache this evaluation
          }
          evalState = new MoveWithEval(move, sum)
        }

        if (originalSnake && testLogging && lookahead === startLookahead) {
          logToFile(consoleWriteStream, `move: ${move}\nEvalState score: ${evalState.score}\n`)
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
            } else if (floatsEqual(evalState.score, bestMove.score) && getRandomInt(0, 2)) { // in the event of tied evaluations, choose between them at random
              //logToFile(consoleWriteStream, `replacing prior best move ${bestMove.direction} with eval ${bestMove.score} with new move ${move} & eval ${evalState.score}`)
              bestMove.direction = move
              bestMove.score = evalState.score
            } // else don't replace bestMove
          } // evalState has no score, & bestMove does, we don't want to replace bestMove with evalState
        }
      } // if newSelf isn't defined, I have died, will evaluate the state without me lower down
    }

    // want to weight moves earlier in the lookahead heavier, as they represent more concrete information
    if (lookahead !== undefined && evalThisState !== undefined) {
      let evalWeight : number = 1
      evalWeight = evalWeight + lookaheadWeight * lookahead // so 1 for 0 lookahead, 1.1 for 1, 1.2 for two, etc
      evalThisState = evalThisState * evalWeight
    }

    if (bestMove.score !== undefined) {
      //logToFile(consoleWriteStream, `For snake ${myself.name} at (${myself.head.x},${myself.head.y}), chose best move ${bestMove.direction} with score ${bestMove.score}. Adding evalThisState score ${evalThisState} to return ${bestMove.score + evalThisState}`)
      if (evalThisState !== undefined) { // don't need to add evalThisState if it doesn't exist, which will happen for first move in lookahead or for otherSnakes
        bestMove.score = bestMove.score + evalThisState
      }
    } else {
      //logToFile(consoleWriteStream, `For snake ${myself.name} at (${myself.head.x},${myself.head.y}), no best move, all options are death. Adding & returning evalThisState score ${evalThisState}`)
      bestMove.score = evalThisState
    }

    return bestMove
  }

  // for duels, will only work properly with exactly two snakes
  function _decideMoveMinMax(gameState: GameState, lookahead: number, _tailChaseTurns: number[], kisses?: KissStatesForEvaluate, _alpha?: number, _beta?: number, _eatTurns?: number): MoveWithEval {
    let stillHaveTime = checkTime(startTime, gameState) // if this is true, we need to hurry & return a value without doing any more significant calculation
    if (!stillHaveTime && iterativeDeepening) { return new MoveWithEval(undefined, undefined) } // Iterative deepening will toss this result anyway, may as well leave now

    let stateContainsMe: boolean = false
    let otherSnake: Battlesnake | undefined = undefined
    for (const snake of gameState.board.snakes) {
      if (snake.id === gameState.you.id) {
        stateContainsMe = true
      } else {
        otherSnake = snake
      }
    }

    let startingHealthTier: HealthTier = determineHealthTier(thisGameData.startingGameState, thisGameData.startingGameState.you.health, false)

    let finishEvaluatingNow: boolean = false

    let numMaxPrunes: number = 0
    let numMinPrunes: number = 0

    let board2d: Board2d
    if (gameState.turn === thisGameData.startingGameState.turn) {
      board2d = startingBoard2d
    } else {
      board2d = new Board2d(gameState, false)
    }

    let moves: Moves = getAvailableMoves(gameState, gameState.you, board2d)
    let availableMoves: Direction[] = moves.validMoves()

    let otherSnakeAvailableMoves: Moves
    let otherSnakeValidMoves: Direction[]
  
    let moveNeighbors = findMoveNeighbors(gameState, gameState.you, board2d, moves)
    let kissOfMurderMoves = findKissMurderMoves(moveNeighbors)
    let kissOfDeathMoves = findKissDeathMoves(moveNeighbors)
  
    let kissStatesThisState: KissStates = kissDecider(gameState, gameState.you, moveNeighbors, kissOfDeathMoves, kissOfMurderMoves, moves, board2d)

    let alpha: number | undefined = _alpha || undefined
    let beta: number | undefined = _beta || undefined

    if (!isTesting && !stillHaveTime) { // if we need to leave early due to time
      finishEvaluatingNow = true
    } else if (!stateContainsMe) { // if we're dead
      finishEvaluatingNow = true
    } else {
      if (availableMoves.length < 1) { // if there's nowhere left to decide to move
        finishEvaluatingNow = true
      } else if (availableMoves.length === 1 && lookahead === startLookahead) { // no need to look ahead, just return the only available move with a bogus computed score 
        finishEvaluatingNow = true
      } else if (gameState.board.snakes.length === 1) { // we're the only one left - we've won
        finishEvaluatingNow = true
      }
    }

    let cachedEvaluationsThisTurn: {[key: string]: number} = thisGameData.cachedEvaluations[gameState.turn]

    if (!otherSnake || finishEvaluatingNow) { // if out of time, myself is dead, all other snakes are dead, or there are no available moves, return a direction & the evaluation for this state
      let priorKissOfDeathState: KissOfDeathState = kisses === undefined ? KissOfDeathState.kissOfDeathNo : kisses.deathState
      let priorKissOfMurderState: KissOfMurderState = kisses === undefined ? KissOfMurderState.kissOfMurderNo : kisses.murderState
      let evaluateKisses = new KissStatesForEvaluate(priorKissOfDeathState, priorKissOfMurderState, kisses?.predator, kisses?.prey)
      let _evalThisState: EvaluationResult
      let evalThisState: number

      let defaultDir = availableMoves.length < 1? getDefaultMove(gameState, gameState.you, board2d) : availableMoves[0] // if we ran out of time, we can at least choose one of the availableMoves

      let hash: string = buildGameStateHash(gameState, gameState.you, evaluateKisses, _eatTurns || 0, undefined, startingHealthTier.tier)

      if (availableMoves.length < 1 && otherSnake) { // if I haven't won, will die by next turn, still want to return early to save time but don't want to reward it for still being alive this turn
        // custom build an EvaluationResult here without calling evaluate. Wants noMe provided & winValue provided.
        let evaluationResult: EvaluationResult = new EvaluationResult(gameState.you)

        otherSnakeAvailableMoves = getAvailableMoves(gameState, otherSnake, board2d)
        otherSnakeValidMoves = otherSnakeAvailableMoves.validMoves()

        if (otherSnakeValidMoves.length < 1) { // if other snake also has 0 valid moves, consider this a tie state
          _evalThisState = determineEvalNoSnakes(gameState, gameState.you, otherSnake, _eatTurns || 0)
          evalThisState = _evalThisState.sum()
          cachedEvaluationsThisTurn[hash] = evalThisState
          // after saving in cache, incorporate gameData dependent evaluation components
          _evalThisState.tailChasePenalty = evaluateTailChasePenalty(_tailChaseTurns, thisGameData.startingGameState.turn)
          evalThisState += _evalThisState.tailChasePenalty
          _evalThisState.winValue = evaluateWinValue(gameState.you, gameState, thisGameData.lookahead, thisGameData.startingGameState.turn)
          evalThisState += _evalThisState.winValue
        } else { // otherwise, consider this a loss state
          evaluationResult.noMe = noMe
          evaluationResult.winValue = -evalHaveWonTurnStep * (lookahead + 1) // penalize at lookahead = 0, since ideally we wanted to get one more move in after that
          _evalThisState = evaluationResult
          evalThisState = _evalThisState.sum()
        }  
      } else {
        _evalThisState = evaluateMinimax(gameState, _eatTurns || 0, startingHealthTier.tier, evaluateKisses)
        evalThisState = _evalThisState.sum()
        cachedEvaluationsThisTurn[hash] = evalThisState
        // after saving in cache, incorporate gameData dependent evaluation components
        _evalThisState.tailChasePenalty = evaluateTailChasePenalty(_tailChaseTurns, thisGameData.startingGameState.turn)
        evalThisState += _evalThisState.tailChasePenalty
        _evalThisState.winValue = evaluateWinValue(gameState.you, gameState, thisGameData.lookahead, thisGameData.startingGameState.turn)
        evalThisState += _evalThisState.winValue
      }
    
      return new MoveWithEval(defaultDir, evalThisState, _evalThisState, true)
    }

    otherSnakeAvailableMoves = getAvailableMoves(gameState, otherSnake, board2d)
    otherSnakeValidMoves = otherSnakeAvailableMoves.validMoves()
    let otherSnakeTail: Coord = otherSnake.body[otherSnake.body.length - 1]

    if (otherSnakeValidMoves.length === 0) { // otherSnake must move somewhere, so give it a default move
      otherSnakeValidMoves.push(getDefaultMove(gameState, otherSnake, board2d))
    }

    let bestMove: MoveWithEval = new MoveWithEval(undefined, undefined)

    let newGameStates: {[key: number]: GameState} = {}
    // do what we can in as little time as possible to sort moves on likelihood of good
    if (lookahead === startLookahead && thisGameData.priorDeepeningMoves.length > 1) { // by default order the previous deepening choice first, as it is most likely to be the best option
      thisGameData.priorDeepeningMoves.sort((a: MoveWithEval, b: MoveWithEval) => {
        if (a.direction !== undefined && a.score !== undefined && b.direction !== undefined && b.score !== undefined) {
          if (floatsEqual(a.score, b.score)) { // if element scores are equal, don't change order
            return 0
          } else if (a.score < b.score) { // if b is better than a, put b first
            return 1
          } else { //if (a.score > b.score) // if a is better than b, put a first
            return -1
          }
        } else { // if any of the elements we're trying to sort lack a direction or score, we can't compare them, so don't move them
          return 0
        }
      })
      for (let i: number = 0; i < thisGameData.priorDeepeningMoves.length; i++) {
        let dir = thisGameData.priorDeepeningMoves[i].direction
        if (dir !== undefined) {
          availableMoves[i] = dir
        }
      }
      thisGameData.priorDeepeningMoves = [] // clear this so next level can repopulate it
    } else if (iterativeDeepening) { // can only used cachedEvaluations when iterative deepening, & sorting only matters then
      for (const move of availableMoves) {
        let newGameState: GameState = cloneGameState(gameState)
        let newSelf: Battlesnake = newGameState.you
        moveSnake(newGameState, newSelf, board2d, move)
        newGameStates[move] = newGameState
      }

      availableMoves.sort((moveA: Direction, moveB: Direction): number => {
        let stateA: GameState = newGameStates[moveA]
        let stateB: GameState = newGameStates[moveB]
        let stateAEatTurns: number = _eatTurns || 0
        let stateBEatTurns: number = _eatTurns || 0
        if (snakeHasEaten(stateA.you)) { stateAEatTurns += 1 }
        if (snakeHasEaten(stateB.you)) { stateBEatTurns += 1 }

        let kissStatesA = determineKissStateForDirection(moveA, kissStatesThisState) // this can be calculated independently of snakes moving, as it's dependent on gameState, not newGameState
        let kissArgsA: KissStatesForEvaluate | undefined
        if (kissStatesA.kissOfDeathState === KissOfDeathState.kissOfDeathNo && kissStatesA.kissOfMurderState === KissOfMurderState.kissOfMurderNo) {
          kissArgsA = undefined
        } else {
          kissArgsA = new KissStatesForEvaluate(kissStatesA.kissOfDeathState, kissStatesA.kissOfMurderState, moveNeighbors.getPredator(moveA), moveNeighbors.getPrey(moveA))
        }

        let kissStatesB = determineKissStateForDirection(moveB, kissStatesThisState) // this can be calculated independently of snakes moving, as it's dependent on gameState, not newGameState
        let kissArgsB: KissStatesForEvaluate | undefined
        if (kissStatesB.kissOfDeathState === KissOfDeathState.kissOfDeathNo && kissStatesB.kissOfMurderState === KissOfMurderState.kissOfMurderNo) {
          kissArgsB = undefined
        } else {
          kissArgsB = new KissStatesForEvaluate(kissStatesB.kissOfDeathState, kissStatesB.kissOfMurderState, moveNeighbors.getPredator(moveB), moveNeighbors.getPrey(moveB))
        }

        if (stateA && stateB) {
          let stateAHash: string = buildGameStateHash(stateA, stateA.you, kissArgsA, stateAEatTurns, undefined, startingHealthTier.tier) // skipping kissStates for performance reasons
          let stateBHash: string = buildGameStateHash(stateB, stateB.you, kissArgsB, stateBEatTurns, undefined, startingHealthTier.tier)
          let stateAScore: number = cachedEvaluationsThisTurn[stateAHash]
          let stateBScore: number = cachedEvaluationsThisTurn[stateBHash]
          if (stateAScore !== undefined && stateBScore !== undefined) {
            if (stateAScore > stateBScore) {
              return -1
            } else if (stateAScore < stateBScore) {
              return 1
            }
          } else { // if we don't have cached entries, try a simple, cheap sort
            if (stateA.you.health !== stateB.you.health) {
              return stateB.you.health - stateA.you.health // sorts in descending order of health, so higher health states go first
            } else if (stateA.board.snakes.length !== stateB.board.snakes.length) {
              return stateB.you.length - stateA.you.length // sorts in descending order of length, so higher length states go first
            }
          }
        }
        return 0
      })
    }

    // first, move my snake in each direction it can move
    for (let i: number = 0; i < availableMoves.length; i++) {
      let move: Direction = availableMoves[i]
      if (iterativeDeepening && !checkTime(startTime, gameState)) { return new MoveWithEval(undefined, undefined) }
      let newGameState: GameState = newGameStates[move] || cloneGameState(gameState)
      let newSelf: Battlesnake | undefined,
          newOtherSnake: Battlesnake | undefined
      for (const snake of newGameState.board.snakes) {
        if (snake.id === gameState.you.id) {
          newSelf = snake
        } else {
          newOtherSnake = snake
        }
      }

      let kissStates = determineKissStateForDirection(move, kissStatesThisState) // this can be calculated independently of snakes moving, as it's dependent on gameState, not newGameState
      let kissArgs: KissStatesForEvaluate | undefined
      if (kissStates.kissOfDeathState === KissOfDeathState.kissOfDeathNo && kissStates.kissOfMurderState === KissOfMurderState.kissOfMurderNo) {
        kissArgs = undefined
      } else {
        kissArgs = new KissStatesForEvaluate(kissStates.kissOfDeathState, kissStates.kissOfMurderState, moveNeighbors.getPredator(move), moveNeighbors.getPrey(move))
      }

      let worstOriginalSnakeScore: MoveWithEval = new MoveWithEval(undefined, undefined)
      let eatTurns: number = _eatTurns || 0
      if (newSelf !== undefined && newOtherSnake !== undefined) {
        if (!newGameStates[move]) { // if newGameState came from newGameStates, we have already moved ourself
          moveSnake(newGameState, newSelf, board2d, move)
        }

        if (snakeHasEaten(newSelf)) {
          eatTurns += 1
        }

        let evaluationResult: EvaluationResult | undefined = undefined
        let evalState: MoveWithEval

        let minAlpha: number | undefined = alpha // minAlpha & minBeta are passed along by calling max function, but can't overwrite max's alpha & beta
        let minBeta: number | undefined = beta

        let otherNewGameStates: {[key: number]: GameState} = {}
        if (iterativeDeepening) { // can only use cachedEvaluations when iterative deepening
          for (const move of otherSnakeValidMoves) {
            let otherNewGameState: GameState = cloneGameState(newGameState)
            let newOtherself: Battlesnake = otherNewGameState.board.snakes.find(snake => snake.id !== otherNewGameState.you.id)
            moveSnake(otherNewGameState, newOtherself, board2d, move)
            otherNewGameStates[move] = otherNewGameState
          }
          
          otherSnakeValidMoves.sort((moveA: Direction, moveB: Direction): number => {
            let stateA: GameState = otherNewGameStates[moveA]
            let stateB: GameState = otherNewGameStates[moveB]
            if (stateA && stateB) {
              let stateAHash: string = buildGameStateHash(stateA, stateA.you, kissArgs, eatTurns, undefined, startingHealthTier.tier)
              let stateBHash: string = buildGameStateHash(stateB, stateB.you, kissArgs, eatTurns, undefined, startingHealthTier.tier)
              let stateAScore: number = cachedEvaluationsThisTurn[stateAHash]
              let stateBScore: number = cachedEvaluationsThisTurn[stateBHash]
              if (stateAScore !== undefined && stateBScore !== undefined) {
                if (stateAScore < stateBScore) {
                  return -1
                } else if (stateAScore > stateBScore) {
                  return 1
                }
              } else { // if we don't have cached entries, try a simple, cheap sort
                if (stateA.you.health !== stateB.you.health) {
                  return stateA.you.health - stateB.you.health // sorts in ascending order of health, so lower health states go first
                } else if (stateA.board.snakes.length !== stateB.board.snakes.length) {
                  return stateA.you.length - stateB.you.length // sorts in ascending order of length, so lower length states go first
                }
              }
            }
            return 0
          })
        }

        // then, move otherSnake in each possible direction
        for (let j: number = 0; j < otherSnakeValidMoves.length; j++) {
          let otherMove: Direction = otherSnakeValidMoves[j]
          let otherNewGameState: GameState = otherNewGameStates[otherMove] || cloneGameState(newGameState)
          let newOtherself: Battlesnake | undefined,
              newOriginalSnake: Battlesnake | undefined

          for (const snake of otherNewGameState.board.snakes) {
            if (snake.id === gameState.you.id) {
              newOriginalSnake = snake
            } else {
              newOtherself = snake
            }
          }

          // then, base case & recursive case: if we've hit our lookahead, we want to evaluate each move for newOriginalSnke's score, then choose the worst one for them
          // else, we want to call decideMove again, & move again, & assign that return value to this state's value
          if (newOtherself !== undefined && newOriginalSnake !== undefined) {
            if (!otherNewGameStates[otherMove]) {
              moveSnake(otherNewGameState, newOtherself, board2d, otherMove)
            }
            updateGameStateAfterMove(otherNewGameState)

            let tailChaseTurns: number[] = []
            for (const turn of _tailChaseTurns) {
              tailChaseTurns.push(turn)
            }
            if (coordsEqual(newSelf.head, otherSnakeTail)) { // if newSelf head is at same place as otherSnake tail was in otherNewGameState, add that to tail chase array
              tailChaseTurns.push(otherNewGameState.turn)
            }

            if (lookahead <= 0) { // base case, start returning
              let hashForThem: string = buildGameStateHash(otherNewGameState, otherNewGameState.you, kissArgs, eatTurns, undefined, startingHealthTier.tier)
              let cache = cachedEvaluationsThisTurn[hashForThem]
              if (cache !== undefined) { // usually won't be possible, since furthest lookahead of previous turn will typically still be one less than that of this turn
                evalState = new MoveWithEval(move, cache)
                // below lines are useful when testing to catch where gameStateHash isn't adequately distinguishing different game states
                // even when not iterative deepening, some tie & death states will hit the cache, but their scores should always be equivalent!!
                // evaluationResult = evaluateMinimax(otherNewGameState, eatTurns, startingHealthTier.tier, kissArgs)
                // if (!floatsEqual(cache, evaluationResult.sum())) {
                //   debugger
                // }
              } else {
                evaluationResult = evaluateMinimax(otherNewGameState, eatTurns, startingHealthTier.tier, kissArgs)
                evalState = new MoveWithEval(move, evaluationResult.sum(), evaluationResult)
                if (evalState.score !== undefined) {
                  cachedEvaluationsThisTurn[hashForThem] = evalState.score
                  // after saving in cache, incorporate gameData dependent evaluation components
                  evaluationResult.tailChasePenalty = evaluateTailChasePenalty(_tailChaseTurns, thisGameData.startingGameState.turn)
                  evalState.score += evaluationResult.tailChasePenalty
                  evaluationResult.winValue = evaluateWinValue(otherNewGameState.you, otherNewGameState, thisGameData.lookahead, thisGameData.startingGameState.turn)
                  evalState.score += evaluationResult.winValue
                }
              }
            } else {
              evalState = _decideMoveMinMax(otherNewGameState, lookahead - 1, tailChaseTurns, kissArgs, minAlpha, minBeta, eatTurns)
            }

            // then, determine whether this move is worse than the existing worst move, & if so, replace it
            if (worstOriginalSnakeScore.score === undefined) { // no score yet, just assign it this one
              worstOriginalSnakeScore.direction = otherMove // this represents the move otherSnake takes to minimize originalSnake's score
              worstOriginalSnakeScore.score = evalState.score // while this represents the score of originalSnake in this config
              worstOriginalSnakeScore.evaluationResult = evalState.evaluationResult
            } else {
              if (evalState.score !== undefined) {
                if (evalState.score < worstOriginalSnakeScore.score) {
                  worstOriginalSnakeScore.direction = otherMove
                  worstOriginalSnakeScore.score = evalState.score
                  worstOriginalSnakeScore.evaluationResult = evalState.evaluationResult
                }
              }
            }
            if (minBeta === undefined || (evalState.score !== undefined && evalState.score < minBeta)) { // if min player found a lower beta, assign it
              minBeta = evalState.score
            }
            if (minAlpha !== undefined && minBeta !== undefined && minAlpha >= minBeta) { // if alpha & beta both exist & alpha is better than beta, can prune the rest of this tree
              numMinPrunes = numMinPrunes + 1
              break
            }
          }
        }
      }

      if (worstOriginalSnakeScore.score !== undefined && lookahead <= 0) {
        let hashForMe: string = buildGameStateHash(newGameState, newGameState.you, kissArgs, eatTurns, undefined, startingHealthTier.tier)
        cachedEvaluationsThisTurn[hashForMe] = worstOriginalSnakeScore.score
      }

      if (testLogging && lookahead === startLookahead) {
        logToFile(consoleWriteStream, `move: ${move}\nEvaluation result: ${worstOriginalSnakeScore.evaluationResult?.toString()}\n`)
      }
      if (bestMove.score === undefined) {
        bestMove.direction = move
        bestMove.score = worstOriginalSnakeScore.score
        bestMove.evaluationResult = worstOriginalSnakeScore.evaluationResult
      } else {
        if (worstOriginalSnakeScore.score !== undefined) {
          if (worstOriginalSnakeScore.score > bestMove.score) {
            bestMove.direction = move
            bestMove.score = worstOriginalSnakeScore.score
            bestMove.evaluationResult = worstOriginalSnakeScore.evaluationResult
          }
        }
      }

      if (lookahead === startLookahead) { // save the top-level moves for each startLookahead, for iterative deepening move sorting
        thisGameData.priorDeepeningMoves.push(new MoveWithEval(move, worstOriginalSnakeScore.score))
      }

      if (alpha === undefined || (worstOriginalSnakeScore.score !== undefined && worstOriginalSnakeScore.score > alpha)) { // if max player found a higher alpha, assign it
        alpha = worstOriginalSnakeScore.score
      }
      if (alpha !== undefined && beta !== undefined && alpha >= beta) { // if alpha & beta both exist & alpha is better than beta, can prune the rest of this tree
        numMaxPrunes = numMaxPrunes + 1
        break
      }
    }

    // if (lookahead === startLookahead) {
    //   logToFile(consoleWriteStream, `on turn ${gameState.turn}, max prunes: ${numMaxPrunes}, min prunes: ${numMinPrunes}`)
    // }
    return bestMove
  }

  let availableMoves: Moves = getAvailableMoves(gameState, myself, startingBoard2d)
  let validMoves = availableMoves.validMoves()
  // before jumping into recursion, first check to see if I have any choices to make
  if (validMoves.length === 1) { // if I only have one valid move, return that
    return new MoveWithEval(validMoves[0], undefined, undefined, true)
  } else if (validMoves.length === 0) { // if I have no valid moves, return the default move
    return new MoveWithEval(getDefaultMove(gameState, myself, startingBoard2d), undefined, undefined, true)
  } else { // otherwise, start deciding
    let myselfMove: MoveWithEval
    if (gameState.board.snakes.length === 2) {
      myselfMove = _decideMoveMinMax(gameState, startLookahead, [])
    } else {
      myselfMove = _decideMove(gameState, myself, startLookahead)
    }

    return myselfMove
  }
}

export function move(gameState: GameState): MoveResponse {
  let timeBeginning = Date.now()
  let hazardWalls = new HazardWalls(gameState) // only need to calculate this once
  let thisGameDataId = createGameDataId(gameState)
  let source: string = gameState.game.source
  let board2d: Board2d = new Board2d(gameState, true)

  let testLogging: boolean = isTestLogging(isDevelopment, gameState)

  let thisGameData: GameData
  if (gameData[thisGameDataId]) {
    thisGameData = gameData[thisGameDataId]
  } else { // if for some reason game data for this game doesn't exist yet (happens when testing due to lack of proper start() & end()s, create it & add it to gameData
    thisGameData = new GameData(gameState)
    gameData[thisGameDataId] = thisGameData
  }

  if (preySnakeName && thisGameData.preySnakeLives) { // if we had a prey snake & it was still alive, check to see if it is still alive
    let preySnake: Battlesnake = gameState.board.snakes.find(snake => snake.name === preySnakeName)
    if (!preySnake) {
      thisGameData.preySnakeLives = false // if preySnake no longer exists, or never existed in this game, clear preySnakeName
    }
  }

  let gameDataIds: string[] = Object.keys(gameData)
  let otherLeagueGameRunning: boolean = false
  let otherGameRunning: boolean = false

  for (const id of gameDataIds) {
    if (id !== thisGameDataId) { // don't consider myself when finding other gameDatas
      let otherGameData: GameData = gameData[id]
      let otherGameTimeout: number = otherGameData.startingGameState.game.timeout
      if ((timeBeginning - otherGameData.lastMoveTime) > otherGameTimeout * 1500) { // if other game hasn't returned a move in significantly longer than the timeout, clean it up
        // ideally 1500 will be long enough for an end() request to come, as we want to properly process the ended game. This is a failsafe for if end() never comes, to avoid memory leaks.
        delete gameData[id]
        console.log(`cleaned up game. Still ${Object.keys(gameData).length} games running.\n`)
      } else if ((timeBeginning - otherGameData.lastMoveTime) > otherGameTimeout * 5) { // if other game hasn't returned a move in longer than the timeout, set its stillRunning to false
        gameData[id].stillRunning = false
      } else if (otherGameData.stillRunning) {
        if (otherGameData.startingGameState.game.source === "league") { // if other game is still running & is a league game
          otherLeagueGameRunning = true // true if some other game is currently running with a league source
        }
        otherGameRunning = true
      }
    }
  }

  if (otherLeagueGameRunning && source !== "league") { // if another league game is running, & this game is not a league game, return a suicidal move
    let suicidalMove: Direction = getSuicidalMove(gameState, gameState.you)
    let suicidalMoveStr: string = directionToString(suicidalMove) || "up"
    console.log(`another league game already running, moving towards neck with ${suicidalMoveStr}`)
    delete gameData[thisGameDataId] // clean up game-specific data, helps the league game know that it does in fact have time to think
    return {move: suicidalMoveStr}
  }

  thisGameData.hazardWalls = hazardWalls // replace gameData hazard walls with latest copy
  thisGameData.startingGameState = gameState
  if (gameStateIsHazardSpiral(gameState) && thisGameData.hazardSpiral === undefined && gameState.board.hazards.length === 1) {
    thisGameData.hazardSpiral = new HazardSpiral(gameState, 3)
  }
  thisGameData.isDuel = gameState.board.snakes.length === 2

  thisGameData.evalNoMeEvaluationResult = determineEvalNoMe(gameState)
  thisGameData.evalNoMe = thisGameData.evalNoMeEvaluationResult.sum()

  if (thisGameData.cachedEvaluations[gameState.turn - 1]) { // clear old cachedEvaluations that can no longer be relevant
    delete thisGameData.cachedEvaluations[gameState.turn - 1]
  }

  //logToFile(consoleWriteStream, `lookahead turn ${gameState.turn}: ${futureSight}`)
  
  let chosenMove: MoveWithEval
  let futureSight: number

  // throw provided hazards away - we calculate them programmatically. Saves a smidge of time during cloneGameState
  if (gameStateIsHazardSpiral(gameState) || gameStateIsHazardPits(gameState) || gameStateIsSinkhole(gameState)) {
    gameState.board.hazards = []
  }

  if (!otherGameRunning && gameState.game.source !== "testing") { // if running only one game, do iterative deepening. Don't iteratively deepen when testing
    futureSight = lookaheadDeterminatorDeepening(gameState, board2d)
    thisGameData.lookahead = 0
    thisGameData.cachedEvaluations[gameState.turn] = thisGameData.cachedEvaluations[gameState.turn] || {} // instantiate cached evaluations for base level of lookahead
    thisGameData.cachedEvaluations[gameState.turn + 1] = thisGameData.cachedEvaluations[gameState.turn + 1] || {} // ^^
    if (testLogging) { logToFile(consoleWriteStream, `lookahead: 0\n`) }
    chosenMove = decideMove(gameState, gameState.you, timeBeginning, 0, board2d, true)

    let i: number = 1
    let newMove: MoveWithEval
    while(!chosenMove.instantReturn && checkTime(timeBeginning, gameState) && i <= futureSight) { // while true, keep attempting to get a move with increasing depths
      thisGameData.lookahead = i
      thisGameData.cachedEvaluations[gameState.turn + i + 1] = thisGameData.cachedEvaluations[gameState.turn + i + 1] || {} // instantiate cached evaluations for this level of lookahead
      if (testLogging) { logToFile(consoleWriteStream, `lookahead: ${i}\n`) }
      newMove = decideMove(gameState, gameState.you, timeBeginning, i, board2d, true) // choose another move with increased lookahead depth
      if (checkTime(timeBeginning, gameState)) { 
        chosenMove = newMove // if chosenMove was determined with time to spare, can use it
        i = i + 1
        if (testLogging) { logToFile(consoleWriteStream, '\n') } // for readability, add a line break between deepening evaluationResults
      } else {
        break // ran out of time, exit loop & use chosenMove of the deepest depth we had time for
      } 
    }
    if (!chosenMove.instantReturn && (i < 30)) { // don't bother logging max lookahead if it was an instant return, & don't bother logging turns where no meaningful choices were made
      logToFile(consoleWriteStream, `max lookahead depth for iterative deepening on turn ${gameState.turn}: ${i - 1}`)
      if (thisGameData.isDuel) {
        thisGameData.maxLookaheadsMinimax.push(i - 1)
      } else {
        thisGameData.maxLookaheadsMaxN.push(i - 1)
      }
    }
  } else {
    futureSight = lookaheadDeterminator(gameState, board2d)
    thisGameData.lookahead = futureSight
    for (let i: number = 0; i <= (futureSight + 1); i++) {
      thisGameData.cachedEvaluations[gameState.turn + i] = thisGameData.cachedEvaluations[gameState.turn + i] || {}
    }
    if (testLogging) { logToFile(consoleWriteStream, `lookahead: ${futureSight}\n`) }
    chosenMove = decideMove(gameState, gameState.you, timeBeginning, futureSight, board2d, false)
  }
  
  let chosenMoveDirection : Direction = chosenMove.direction !== undefined ? chosenMove.direction : getDefaultMove(gameState, gameState.you, board2d) // if decideMove has somehow not decided up on a move, get a default direction to go in
  
  let now: number = Date.now()
  let timeTaken: number = now - timeBeginning
  let timesTaken = thisGameData.timesTaken
  timesTaken.push(timeTaken)
  if (timeTaken > gameState.game.timeout) {
    thisGameData.timeouts = thisGameData.timeouts + 1
  }
  thisGameData.priorDeepeningMoves = []
  thisGameData.lastMoveTime = now

  return {move: directionToString(chosenMoveDirection) || "up"} // if somehow we don't have a move at this point, give up
}