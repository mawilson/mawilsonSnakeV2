import { GameState } from "./types"
import { Direction, Battlesnake, Board2d, Moves, Coord, KissOfDeathState, KissOfMurderState, HazardWalls, KissStatesForEvaluate, EvaluationResult } from "./classes"
import { createWriteStream } from "fs"
import { findMoveNeighbors, findKissDeathMoves, findKissMurderMoves, calculateFoodSearchDepth, findFood, snakeLengthDelta, snakeHasEaten, kissDecider, isCutoff, isHazardCutoff, isAdjacentToHazard, calculateCenterWithHazard, getAvailableMoves, isCorner, isOnHorizontalWall, isOnVerticalWall, cloneGameState, createGameDataId, calculateReachableCells, getSnakeDirection, getDistance, gameStateIsWrapped, gameStateIsSolo, logToFile } from "./util"
import { gameData, isDevelopment } from "./logic"

let evalWriteStream = createWriteStream("consoleLogs_eval.txt", {
  encoding: "utf8"
})

// constants used in other files
export const evalNoMe: number = -1500 // no me is the worst possible state, give a very bad score

const evalBase: number = 500
const evalDefaultTieValue: number = 460 // the value I had evalNoSnakes at when I wrote this function. A generic 'good' eval state
const evalTieFactor: number = -50 // penalty for a tie state. Tweak this to tweak Jaguar's Duel Tie preference - smaller means fewer ties, larger means more. 0 is neutral.

// for a given snake, hazard damage, health step, & health tier difference, return an evaluation score for this snake's health
function determineHealthEval(snake: Battlesnake, hazardDamage: number, healthStep: number, healthTierDifference: number, healthBase: number, starvationPenalty: number): number {
  const validHazardTurns = snake.health / (hazardDamage + 1)
  const evalHealthStarved = starvationPenalty // there is never a circumstance where starving is good, even other snake bodies are better than this
  const evalHealth7 = healthBase // evalHealth tiers should differ in severity based on how hungry I am
  const evalHealth6 = evalHealth7 - healthTierDifference // 75 - 10 = 65
  const evalHealth5 = evalHealth6 - healthTierDifference - (healthStep * 1) // 65 - 10 - (1 * 1) = 54
  const evalHealth4 = evalHealth5 - healthTierDifference - (healthStep * 2) // 54 - 10 - (1 * 2) = 42
  const evalHealth3 = evalHealth4 - healthTierDifference - (healthStep * 3) // 42 - 10 - (1 * 3) = 29
  const evalHealth2 = evalHealth3 - healthTierDifference - (healthStep * 4) // 29 - 10 - (1 * 4) = 15
  const evalHealth1 = evalHealth2 - healthTierDifference - (healthStep * 5) // 15 - 10 - (1 * 5) = 0
  const evalHealth0 = -200 // this needs to be a steep penalty, else may choose never to eat
  let evaluation: number = 0

  if (snake.health <= 0) {
    evaluation = evaluation + evalHealthStarved
  } else if (hazardDamage <= 5 && snake.health < 10) { // in a non-hazard game, we still need to prioritize food at some point
    evaluation = evaluation + evalHealth0
  } else if (validHazardTurns > 6) {
    evaluation = evaluation + evalHealth7
  } else if (validHazardTurns > 5) {
    evaluation = evaluation + evalHealth6
  } else if (validHazardTurns > 4) {
    evaluation = evaluation + evalHealth5
  } else if (validHazardTurns > 3) {
    evaluation = evaluation + evalHealth4
  } else if (validHazardTurns > 2) {
    evaluation = evaluation + evalHealth3     
  } else if (validHazardTurns > 1) {
    evaluation = evaluation + evalHealth2 
  } else if (validHazardTurns > 0) {
    evaluation = evaluation + evalHealth0
  } else {
    evaluation = evaluation + evalHealth0
  }

  return evaluation
}

// helper function to determine a good 'average' evaluate score, for use in determining whether a tie is better or worse than that
// can either take a board where both snakes have already died, or a board where both snakes may soon die. Boards with neither 0 nor 2 snakes return a default value
export function determineEvalNoSnakes(gameState: GameState, myself: Battlesnake, tieSnake: Battlesnake | undefined): EvaluationResult {
  const thisGameData = gameData? gameData[gameState.game.id + gameState.you.id] : undefined
  const hazardWalls: HazardWalls = thisGameData !== undefined? thisGameData.hazardWalls : new HazardWalls()
  const centers = calculateCenterWithHazard(gameState, hazardWalls)

  let newGameState = cloneGameState(gameState)
  newGameState.board.food = [] // remove food for neutrality

  // try to position snakes at neutral, non-kiss positions on game board, ideally out of hazard
  let leftSnakeX = centers.centerX - 2
  let leftSnakeY = centers.centerY
  let rightSnakeX = centers.centerX + 2
  let rightSnakeY = centers.centerY
  if (leftSnakeX < 0) { // if there wasn't room to move leftSnakeX two left, move it back to center
    leftSnakeX = centers.centerX
  }
  if (rightSnakeX >= gameState.board.width) { // likewise, if there wasn't room to move rightSnakeX two right, move it back to center
    rightSnakeX = centers.centerX
  }
  if (leftSnakeX === rightSnakeX) { // if leftSnakeX & rightSnakeX are now equal, move leftSnakeX one to the left
    leftSnakeX = leftSnakeX - 1
  }
  if (leftSnakeX < 0) { // if there still wasn't room to move leftSnakeX one left, give up
    let result: EvaluationResult = new EvaluationResult(gameState.you)
    result.tieValue = evalDefaultTieValue + evalTieFactor
    return result
  }

  let leftSnakeBody = []
  let rightSnakeBody = []
  let newSnakeSelf: Battlesnake
  let newSnakeOther: Battlesnake

  if (tieSnake === undefined) { // we weren't sure who the tieSnake was, use a clone of myself instead
    for (let i: number = 0; i < myself.length; i++) {
      leftSnakeBody.push({x: leftSnakeX, y: leftSnakeY})
      rightSnakeBody.push({x: rightSnakeX, y: rightSnakeY})
    }
    newSnakeSelf = new Battlesnake(myself.id, myself.name, myself.health, leftSnakeBody, myself.latency, myself.shout, myself.squad) // create new me, identical other than body
    newSnakeOther = new Battlesnake(myself.id + "_clone", myself.name + "_clone", myself.health, rightSnakeBody, myself.latency, myself.shout, myself.squad) // create clone of me nearby, with different ID & name
  } else {
    for (let i: number = 0; i < myself.length; i++) {
      leftSnakeBody.push({x: leftSnakeX, y: leftSnakeY})
    }
    newSnakeSelf = new Battlesnake(myself.id, myself.name, myself.health, leftSnakeBody, myself.latency, myself.shout, myself.squad) // create new me, identical other than body
    for (let j: number = 0; j < tieSnake.length; j++) {
      rightSnakeBody.push({x: rightSnakeX, y: rightSnakeY})
    }
    newSnakeOther = new Battlesnake(tieSnake.id, tieSnake.name, tieSnake.health, rightSnakeBody, tieSnake.latency, tieSnake.shout, tieSnake.squad) // create new otherSnake, identical other than body
  }

  if (newGameState.board.snakes.length === 2) { // want to determine what evalNoSnakes would be were both of these snakes to die at once
    newGameState.board.snakes = [] // first, remove them - will add them back later at 'neutral' positions
  }

  newGameState.board.snakes.push(newSnakeSelf)
  newGameState.board.snakes.push(newSnakeOther)

  // addresses an edge case where tie score is wildly higher due food immediacy bonuses. That score is not representative of a neutral state.
  if (newSnakeSelf.health === newSnakeOther.health && newSnakeSelf.health === 100) {
    newSnakeSelf.health = 99 // don't give full reward for eating, otherwise evalNoSnakes would be way too high
    newSnakeOther.health = newSnakeSelf.health
  }

  let evaluation = evaluate(newGameState, newSnakeSelf, new KissStatesForEvaluate(KissOfDeathState.kissOfDeathNo, KissOfMurderState.kissOfMurderNo))
  evaluation.tieValue = evalTieFactor // want to make a tie slightly worse than an average state. Still good, but don't want it overriding other, better states
  return evaluation
}

// the big one. This function evaluates the state of the board & spits out a number indicating how good it is for input snake, higher numbers being better
export function evaluate(gameState: GameState, _myself: Battlesnake, priorKissStates: KissStatesForEvaluate) : EvaluationResult {
  let myself: Battlesnake | undefined
  let otherSnakes: Battlesnake[] = []
  let originalSnake: Battlesnake | undefined

  gameState.board.snakes.forEach(function processSnakes(snake) { // process all snakes in one go rather than multiple separate filters/finds
    if (snake.id === gameState.you.id) { // if snake ID matches gameState.you.id, this is the original snake
      originalSnake = snake
    }
    if (_myself !== undefined && _myself.id === snake.id) { // if meSnake was provided & the IDs match, this snake is myself
      myself = snake
    } else { // if meSnake was undefined or this snake's ID doesn't match meSnake, this is an otherSnake
      otherSnakes.push(snake)
    }
  })
  let isOriginalSnake: boolean = _myself !== undefined && _myself.id === gameState.you.id // true if _myself's id matches the original you of the game
  let otherSnakeHealth: number = 0
  otherSnakes.forEach(snake => {
    otherSnakeHealth = otherSnakeHealth + snake.health
  })

  const hazardDamage = gameState.game.ruleset.settings.hazardDamagePerTurn
  const hazardFrequency = gameState.game.ruleset.settings.royale.shrinkEveryNTurns
  const isWrapped = gameStateIsWrapped(gameState)
  const snakeDelta = myself !== undefined ? snakeLengthDelta(myself, gameState) : -1
  const isDuel: boolean = (gameState.board.snakes.length === 2) && (myself !== undefined) // don't consider duels I'm not a part of
  const isSolo: boolean = gameStateIsSolo(gameState)
  const haveWon: boolean = !isSolo && otherSnakes.length === 0 // cannot win in a solo game. Otherwise, have won when no snakes remain.

  const thisGameData = gameData? gameData[createGameDataId(gameState)] : undefined
  const lookahead: number = thisGameData !== undefined && isOriginalSnake? thisGameData.lookahead : 0 // originalSnake uses gameData lookahead, otherSnakes use 0
  const hazardWalls: HazardWalls = thisGameData !== undefined? thisGameData.hazardWalls : new HazardWalls()

  // returns the evaluation value associated with the given kissOfDeathState
  function getPriorKissOfDeathValue(kissOfDeathState: KissOfDeathState): number {
    switch (kissOfDeathState) {
      case KissOfDeathState.kissOfDeathCertainty:
        return evalPriorKissOfDeathCertainty
      case KissOfDeathState.kissOfDeathCertaintyMutual:
        return evalPriorKissOfDeathCertaintyMutual
      case KissOfDeathState.kissOfDeathMaybe:
        return evalPriorKissOfDeathMaybe
      case KissOfDeathState.kissOfDeathMaybeMutual:
        return evalPriorKissOfDeathMaybeMutual
      case KissOfDeathState.kissOfDeath3To1Avoidance:
        return evalPriorKissOfDeath3To1Avoidance
      case KissOfDeathState.kissOfDeath3To2Avoidance:
        return evalPriorKissOfDeath3To2Avoidance
      case KissOfDeathState.kissOfDeath2To1Avoidance:
        return evalPriorKissOfDeath2To1Avoidance
      case KissOfDeathState.kissOfDeathNo:
        return evalPriorKissOfDeathNo
      default:
        return 0
    }
  }

  // returns the evaluation value associated with the given kissOfMurderState
  function getPriorKissOfMurderValue(kissOfMurderState: KissOfMurderState): number {
    switch (kissOfMurderState) {
      case KissOfMurderState.kissOfMurderCertainty:
        evalHazardPenalty = 0 // do not penalize certain kill for being in hazard
        return evalPriorKissOfMurderCertainty
      case KissOfMurderState.kissOfMurderMaybe:
        return evalPriorKissOfMurderMaybe
      case KissOfMurderState.kissOfMurderFaceoff:
        evalHazardPenalty = 0 // do not penalize closing the faceoff for being in hazard
        return evalPriorKissOfMurderFaceoff
      case KissOfMurderState.kissOfMurderAvoidance:
        return evalPriorKissOfMurderAvoidance
      case KissOfMurderState.kissOfMurderNo:
      default:
        return 0
    }
  }

  // values to tweak
  const evalNoMeCertainty: number = 200 // value that being murdered is better than starving. Still highly likely, but slightly less likely than straight starvation
  let evalHazardWallPenalty: number = 0 // no penalty for most turns - we know exactly when they're gonna show up
  if (gameState.turn % hazardFrequency === 0) { // turn 25, & increments of 25
    evalHazardWallPenalty = -8
  } else if (((gameState.turn + 1) % hazardFrequency) === 0) { // turn 24, & increments of 25
    evalHazardWallPenalty = -4
  } else if (((gameState.turn + 1) % hazardFrequency) > (hazardFrequency - 4)) {// turns 21, 22, 23, & increments of 25
    evalHazardWallPenalty = -2
  }
  let evalHazardPenalty: number = -(hazardDamage + 5) // in addition to health considerations & hazard wall calqs, make it slightly worse in general to hang around inside of the sauce
  // TODO: Evaluate removing or neutering the Moves metric & see how it performs
  
  const evalHealthBase = 75 // evalHealth tiers should differ in severity based on how hungry I am
  const evalHealthStep = 3
  const evalHealthTierDifference = 10

  const evalHealthOthersnakeStep = -2 // penalty for each point of health otherSnakes have
  const evalHealthOthersnakeDuelStep = -3
  const evalHealthEnemyThreshold = 50 // enemy health at which we try harder to starve other snakes out

  const evalLengthMult = isSolo? -20 : 20 // larger values result in more food prioritization. Negative preference towards length in solo
  let evalLengthMaxDelta: number = 6 // largest size difference that evaluation continues rewarding

  const evalPriorKissOfDeathCertainty = isOriginalSnake? -800 : 0 // otherSnakes can pick again, let them evaluate this without fear of death

  let evalPriorKissOfDeathCertaintyMutual: number
  if (isDuel || gameState.board.snakes.length === 0) { // if it's a duel (or it was a duel before we rushed into eachother), we don't want to penalize snake for moving here if it's the best tile
    evalPriorKissOfDeathCertaintyMutual = 0
  } else if (!isOriginalSnake && priorKissStates.predator?.id === gameState.you.id) {
    evalPriorKissOfDeathCertaintyMutual = 100 // tell otherSnakes to kamikaze into me so that my snake is less inclined to go there - they can always rechoose if this forces us into the same square
  } else { // it's not a duel & it's original snake or another snake not vs me, give penalty for seeking a tile that likely wouldn't kill me, but might
    evalPriorKissOfDeathCertaintyMutual = -500
  }
  //const evalPriorKissOfDeathCertaintyMutual = isDuel? 0 : -50 // in a duel, this is a tie, consider it neutrally. In a non-duel, the otherSnake won't want to do this, so only small penalty for risking it
  const evalPriorKissOfDeathMaybe = isOriginalSnake? -400 : 0 // this cell is a 50/50. otherSnakes can pick again, let them evaluate this without fear of death
  
  let evalPriorKissOfDeathMaybeMutual: number
  if (isDuel || gameState.board.snakes.length === 0) { // if it's a duel (or it was a duel before we rushed into eachother), we don't want to penalize snake for moving here if it's the best tile
    evalPriorKissOfDeathMaybeMutual = 0
  } else if (!isOriginalSnake && priorKissStates.predator?.id === gameState.you.id) {
    evalPriorKissOfDeathMaybeMutual = 75 // tell otherSnakes to kamikaze into me so that my snake is less inclined to go there - they can always rechoose if this forces us into the same square
  } else { // it's not a duel & it's original snake or another snake not vs me, give penalty for seeking a tile that likely wouldn't kill me, but might. Smaller penalty than certainty, as it's more uncertain
    evalPriorKissOfDeathMaybeMutual = -400
  }
  
  const evalPriorKissOfDeath3To1Avoidance = 0
  const evalPriorKissOfDeath3To2Avoidance = evalPriorKissOfDeath3To1Avoidance
  const evalPriorKissOfDeath2To1Avoidance = evalPriorKissOfDeath3To1Avoidance
  const evalPriorKissOfDeathNo = 0

  const evalPriorKissOfMurderCertainty = 80 // this state is strongly likely to have killed a snake
  const evalPriorKissOfMurderMaybe = 40 // this state had a 50/50 chance of having killed a snake
  let evalPriorKissOfMurderFaceoff = 75 // this state had an unlikely chance of having killed a snake, but it means we closed the distance on a faceoff, which is great
  if (!isWrapped && priorKissStates.prey !== undefined) { // cannot cutoff in a wrapped game
    let preyHead = priorKissStates.prey.head
    let preyIsOnWall: boolean = isOnHorizontalWall(gameState.board, preyHead) || isOnVerticalWall(gameState.board, preyHead)
    if (preyIsOnWall) {
      if (isDuel) {
        evalPriorKissOfMurderFaceoff = evalPriorKissOfMurderFaceoff + 75 // this is actually a cutoff!
      } else {
        evalPriorKissOfMurderFaceoff = evalPriorKissOfMurderFaceoff + 45 // this is actually a cutoff!
      }
    }
  }
  
  let evalPriorKissOfMurderAvoidance = 15 // this state may have killed a snake, but they did have an escape route (3to2, 3to1, or 2to1 avoidance).
  const evalPriorKissOfMurderSelfBonus = 80 // the bonus we give to otherSnakes for attempting to kill me. Need to assume they will try in general or we'll take unnecessary risks

  const evalKissOfDeathCertainty = -400 // everywhere seems like certain death
  let evalKissOfDeathCertaintyMutual: number
  if (isDuel || gameState.board.snakes.length === 0) { // if it's a duel (or it was a duel before we rushed into eachother), we don't want to penalize snake for moving here if it's the best tile
    evalKissOfDeathCertaintyMutual = 0
  } else if (!isOriginalSnake && priorKissStates.predator?.id === gameState.you.id) {
    evalKissOfDeathCertaintyMutual = 25 // tell otherSnakes to kamikaze into me so that my snake is less inclined to go there - they can always rechoose if this forces us into the same square
  } else { // it's not a duel & it's original snake or another snake not vs me, give penalty for seeking a tile that likely would kill me
    evalKissOfDeathCertaintyMutual = -200
  }
  const evalKissOfDeathMaybe: number = -200 // a 50/50 on whether we will be kissed to death next turn
  let evalKissOfDeathMaybeMutual: number
  if (isDuel || gameState.board.snakes.length === 0) { // if it's a duel (or it was a duel before we rushed into eachother), we don't want to penalize snake for moving here if it's the best tile
    evalKissOfDeathMaybeMutual = 0
  } else if (!isOriginalSnake && priorKissStates.predator?.id === gameState.you.id) {
    evalKissOfDeathMaybeMutual = 15 // tell otherSnakes to kamikaze into me so that my snake is less inclined to go there - they can always rechoose if this forces us into the same square
  } else { // it's not a duel & it's original snake or another snake not vs me, give penalty for seeking a tile that likely would kill me
    evalKissOfDeathMaybeMutual = -150
  }

  const evalKissOfDeathAvoidance = 0

  const evalKissOfDeathNo = 0
  const evalKissOfMurderCertainty = 50 // we can kill a snake, this is probably a good thing
  const evalKissOfMurderMaybe = 25 // we can kill a snake, but it's a 50/50
  const evalKissOfMurderFaceoff = 35 // we can kill a snake, they have an escape route, but we can easily give chase
  const evalKissOfMurderAvoidance = 10 // we can kill a snake, but they have an escape route (3to2, 3to1, or 2to1 avoidance)
  const evalKissOfMurderSelfBonus = 30 // bonus given to otherSnakes for attempting to get close enough to kill me

  const evalCutoffHazardReward = isDuel? 75 : 25
  const evalCutoffHazardPenalty = -60

  let evalFoodVal = 2
  if (gameState.turn < 3) {
    evalFoodVal = 50 // simply, should always want to get the starting food
  } else if (isDuel && otherSnakeHealth < evalHealthEnemyThreshold) { // care a bit more about food to try to starve the other snake out
    evalFoodVal = 3
  } else if (isDuel && snakeDelta < -4) { // care a bit less about food due to already being substantially smaller
    evalFoodVal = 1
  } else if (snakeDelta < 1) { // care a bit more about food to try to regain the length advantage
    evalFoodVal = 3
  }
  const evalFoodStep = 1
  const evalEatingMultiplier = 5 // this is effectively Jaguar's 'hunger' immediacy - multiplies food factor directly after eating

  // Voronoi values
  const evalVoronoiNegativeStep = -100
  const evalVoronoiNegativeMax = -600
  const evalVoronoiPositiveStep = 20
  const evalVoronoiPositiveMax = 100
  const evalVoronoiBaseGood = 9
  const evalVoronoiBase = 0
  const evalVoronoiDeltaBonus = (isDuel || haveWon)? 75 : 50
  const evalVoronoiDeltaMax = 600

  const evalSoloTailChase = 50 // reward for being exactly one away from tail when in solo
  const evalSoloCenter = -1

  const evalWrappedOtherSnake1Move = 150

  let evaluationResult: EvaluationResult = new EvaluationResult(_myself)

  if (gameState.board.snakes.length === 0) {
    return determineEvalNoSnakes(gameState, _myself, priorKissStates.predator) // if no snakes are left, I am dead, but so are the others. It's better than just me being dead, at least
  }
  if (myself === undefined) {
    if (_myself !== undefined && _myself.health <= 0) { // if I starved, return evalNoMe, this is certain death
      evaluationResult.noMe = evalNoMe
      return evaluationResult
    } else if (priorKissStates.deathState !== KissOfDeathState.kissOfDeathNo) {
      if (isOriginalSnake && [KissOfDeathState.kissOfDeathCertainty, KissOfDeathState.kissOfDeathCertaintyMutual].includes(priorKissStates.deathState)) {
        evaluationResult.noMe = evalNoMe + evalNoMeCertainty
        return evaluationResult // I am dead here if another snake chooses to kill me, but it's not a 100% sure thing
      } else {
        evaluationResult.priorKissOfDeath = getPriorKissOfDeathValue(priorKissStates.deathState)
        return evaluationResult // Return the kissofDeath value that got me here (if applicable). This represents an uncertain death - though bad, it's not as bad as, say, starvation, which is a certainty.
      }
    } else { // other deaths, such as death by snake body, are also a certainty
      evaluationResult.noMe = evalNoMe
      return evaluationResult
    }
  }

  evaluationResult.base = evalBase // important to do this after the instant-returns above because we don't want the base included in those values
  const board2d = new Board2d(gameState, true) // important to do this after the instant-returns above because it's expensive

  // penalize spaces that ARE hazard
  let myCell = board2d.getCell(myself.head)
  if (myCell !== undefined && myCell.hazard) {
    evaluationResult.hazard = evalHazardPenalty
  }

  let wantToEat: boolean = true // condition for whether we currently want food
  let safeToEat: boolean = true // condition for whether it was safe to eat a food in our current cell

  // hazard walling
  if (isDuel && hazardDamage > 0 && !isWrapped) {
    let opponentCell = board2d.getCell(otherSnakes[0].head)
    if (opponentCell?.hazard && myself.health > 20 && !(myCell?.hazard)) {
      evalFoodVal = 1 // seek food less while building hazard walls, but don't stop
    }
  }

  if (isAdjacentToHazard(myself.head, hazardWalls, gameState)) {
    evaluationResult.hazardWall = evalHazardWallPenalty
  }

  if (!isSolo) { // don't need to calculate otherSnake health penalty in game without otherSnakes
    let otherSnakeHealthPenalty: number = 0
    let otherSnakesSortedByHealth: Battlesnake[] = otherSnakes.sort((a: Battlesnake, b: Battlesnake) => { // sorts by health in descending order
      return b.health - a.health
    })
    otherSnakesSortedByHealth.forEach((snake, idx) => {
      if (idx === 0) { // give the largest remaining snake a larger penalty for health - better to try to starve the largest snake
        otherSnakeHealthPenalty = otherSnakeHealthPenalty + snake.health * evalHealthOthersnakeDuelStep // largest remaining snake gets
      } else { // give remaining snakes a smaller penalty for health
        otherSnakeHealthPenalty = otherSnakeHealthPenalty + snake.health * evalHealthOthersnakeStep
      }
    })

    evaluationResult.otherSnakeHealth = otherSnakeHealthPenalty
  }

  let moves: Moves = getAvailableMoves(gameState, myself, board2d)

  // look for kiss of death & murder cells in this current configuration
  let moveNeighbors = findMoveNeighbors(gameState, myself, board2d, moves)
  let kissOfMurderMoves = findKissMurderMoves(moveNeighbors)
  let kissOfDeathMoves = findKissDeathMoves(moveNeighbors)

  let kissStates = kissDecider(gameState, myself, moveNeighbors, kissOfDeathMoves, kissOfMurderMoves, moves, board2d)

  if (kissStates.canTauntDeath(moves)) { // baitsnake time!
    evaluationResult.kissOfDeath = evalKissOfDeathAvoidance
  } else if (kissStates.canAvoidPossibleDeath(moves)) { // death is avoidable for at least one possible move
    evaluationResult.kissOfDeath = evalKissOfDeathNo
  } else if (kissStates.canAvoidCertainDeath(moves)) { // death has a chance of being avoidable for at least one possible move
    // this is a bit of a mess. Basically: get the predator who has a chance of cells to kill me at (huntingChanceDirections call) rather than the ones who can only do so in one cell
    let smallestPredator: Battlesnake | undefined = moveNeighbors.getSmallestPredator(moveNeighbors.huntingChanceDirections())
    if (smallestPredator !== undefined && smallestPredator.length === myself.length) {
      evaluationResult.kissOfDeath = evalKissOfDeathMaybeMutual
    } else {
      evaluationResult.kissOfDeath = evalKissOfDeathMaybe
    }
  } else {
    let smallestPredator: Battlesnake | undefined = moveNeighbors.getSmallestPredator(moves)
    if (smallestPredator !== undefined && smallestPredator.length === myself.length) {
      evaluationResult.kissOfDeath = evalKissOfDeathCertaintyMutual
    } else {
      evaluationResult.kissOfDeath = evalKissOfDeathCertainty
    }
  }

  if (kissStates.canCommitCertainMurder(moves)) {
    evaluationResult.kissOfMurder = evalKissOfMurderCertainty
  } else if (kissStates.canCommitPossibleMurder(moves)) {
    evaluationResult.kissOfMurder = evalKissOfMurderMaybe
  } else if (kissStates.canCommitFaceoffMurder(moves)) {
    evaluationResult.kissOfMurder = evalKissOfMurderFaceoff
  } else if (kissStates.canCommitUnlikelyMurder(moves)) {
    // try to determine if this is a cutoff, & if so, give the evalKissOfMurderFaceoff reward instead, to encourage closing the gap in a cutoff situation
    let myDir = getSnakeDirection(gameState, myself)
    let myPrey: Battlesnake | undefined
    let wasCutoff: boolean = false
    switch (myDir) {
      case Direction.Up:
      case Direction.Down:
        myPrey = moveNeighbors.getPrey(myDir)
        if (!isWrapped && myPrey !== undefined && isOnHorizontalWall(gameState.board, myPrey.head)) {
          evaluationResult.kissOfMurder = evalKissOfMurderFaceoff
          wasCutoff = true
        }
        break
      case Direction.Left:
      case Direction.Right:
        myPrey = moveNeighbors.getPrey(myDir)
        if (!isWrapped && myPrey !== undefined && isOnVerticalWall(gameState.board, myPrey.head)) {
          evaluationResult.kissOfMurder = evalKissOfMurderFaceoff
          wasCutoff = true
        }
        break
      default:
        break
    }
    if (!wasCutoff) {
      evaluationResult.kissOfMurder = evalKissOfMurderAvoidance
    }
  } // no kisses of murder nearby, not bothering to set value

  let canCutoffHazardSnake: boolean = otherSnakes.some(function findSnakeToCutOff(snake) { // returns true if myself can cut off any otherSnake with hazard
    return isHazardCutoff(gameState, myself, snake, board2d, hazardWalls) // returns true if myself can cut snake off with hazard
  })
  if (canCutoffHazardSnake) {
    evalPriorKissOfMurderAvoidance = evalPriorKissOfMurderAvoidance < 35? 35 : evalPriorKissOfMurderAvoidance // if the kiss of murder that the other snake avoided led it into a hazard cutoff, this is not a murder we want to avoid
    evaluationResult.cutoffHazard = evalCutoffHazardReward
  }

  if (!canCutoffHazardSnake) {
    let canBeCutoffHazardBySnake: boolean = otherSnakes.some(function findSnakeToBeCutOffBy(snake) { // returns true if any otherSnake can hazard cut myself off
      return isHazardCutoff(gameState, snake, myself, board2d, hazardWalls) // returns true if snake can hazard cut myself off
    })
    if (canBeCutoffHazardBySnake) {
      evaluationResult.cutoffHazard = evalCutoffHazardPenalty
    }
  }
  
  let priorKissOfDeathValue = getPriorKissOfDeathValue(priorKissStates.deathState)
  evaluationResult.priorKissOfDeath = priorKissOfDeathValue

  let priorKissOfMurderValue = getPriorKissOfMurderValue(priorKissStates.murderState)
  evaluationResult.priorKissOfMurder = priorKissOfMurderValue

  // if this state's murder prey was my snake & it's not a duel, give a reward so I assume other snakes are out to get me
  if (!isOriginalSnake && priorKissStates.prey !== undefined && priorKissStates.prey.id === gameState.you.id) {
    evaluationResult.priorKissOfMurderSelfBonus = evalPriorKissOfMurderSelfBonus
  }

  // as above, give a little bonus to otherSnakes to being able to kill originalSnake in this state
  if (!isOriginalSnake && originalSnake && moveNeighbors.preyExists(originalSnake)) {
    evaluationResult.kissOfMurderSelfBonus = evalKissOfMurderSelfBonus
  }

  let reachableCells = calculateReachableCells(gameState, board2d)
  const voronoiMyself: number = reachableCells[myself.id]

  const foodSearchDepth = calculateFoodSearchDepth(gameState, myself, board2d)
  const nearbyFood = findFood(foodSearchDepth, gameState.board.food, myself.head, gameState)
  let foodToHunt : Coord[] = []

  let deathStates = [KissOfDeathState.kissOfDeathCertainty, KissOfDeathState.kissOfDeathCertaintyMutual, KissOfDeathState.kissOfDeathMaybe, KissOfDeathState.kissOfDeathMaybeMutual]
  if (hazardDamage > 0 && (myself.health < (1 + (hazardDamage + 1) * 2))) { // if hazard damage exists & two turns of it would kill me, want food
    wantToEat = true
  } else if (isWrapped) {
    evalFoodVal = 0.5 // wrapped food inclination is small
  } else if (snakeDelta > 6) { // If I am more than 6 bigger, want food less
    evalFoodVal = 1
  }
  if (deathStates.includes(priorKissStates.deathState)) { // eating this food had a likelihood of causing my death, that's not safe
    safeToEat = false
  } else if (voronoiMyself < 3) { // eating this food puts me into a box I likely can't get out of, that's not safe
    safeToEat = false
    wantToEat = false // also shouldn't reward this snake for being closer to food, it put itself in a situation where it won't reach said food to do so
  }

  let delta = snakeDelta
  // general snake length metric. More long more good
  if (snakeHasEaten(myself) && !safeToEat) { // if it just ate & it's not safe to eat, don't reward it for the new extra length
    delta = snakeDelta - 1
  }

  if (isSolo) { // Penalize solo snake for being larger
    let penalty: number = myself.length * evalLengthMult // straight penalty for each length I am larger
    evaluationResult.delta = penalty
  } else if (delta < 0) { // I am smaller than otherSnakes, give penalty accordingly.
    let penalty: number = delta * evalLengthMult // straight penalty for each length I am smaller than otherSnakes
    evaluationResult.delta = penalty
  } else if (delta > 0) { // I am larger than otherSnakes, give reward accordingly
    let award: number = 0
    let cap: number = delta > evalLengthMaxDelta? evalLengthMaxDelta : delta // only award snake for up to 'cap' length greater than otherSnakes
    for (let i: number = 1; i <= cap; i++) {
      if (i === 0) {
        award = award + evalLengthMult * 5 // large reward for first positive delta - it's very valuable to be just slightly larger than opponent
      } else if (i === 1) {
        award = award + evalLengthMult * 3 // smaller reward for second positive delta - it's valuable to have that buffer
      } else {
        award = award + evalLengthMult * 1 // smallest reward for subsequent positive deltas
      }
    }
    evaluationResult.delta = award
  } else { // I am same length as otherSnakes, give penalty/reward accordingly
    if (otherSnakes.length > 1) { // small penalty for being the same length as otherSnakes in a non-duel
      evaluationResult.delta = -evalLengthMult
    } // no penalty in duel, we love ties
  }

  if (snakeHasEaten(myself, lookahead) && safeToEat) { // don't reward snake for eating if it got into a cutoff or sandwich situation doing so, or if it risked a kiss of death for the food
    // if snake has eaten recently, add that food back at snake head when calculating food score so as not to penalize it for eating that food
    let depthToAdd = 100 - myself.health // determine depth the food was acquired at by subtracting it from max health of 100
    if (nearbyFood[depthToAdd]) { // should never succeed at depth 0, but may at others
      nearbyFood[depthToAdd].push(myself.head)
    } else {
      nearbyFood[depthToAdd] = [myself.head]
    }
  }

  // health considerations, which are effectively hazard considerations
  if (!isSolo) {
    let healthEval: number = determineHealthEval(myself, hazardDamage, evalHealthStep, evalHealthTierDifference, evalHealthBase, evalNoMe)
    evaluationResult.health = healthEval
  }

  if (isSolo && myself.health > 7) { // don't need to eat in solo mode until starving
    wantToEat = false
  } else if (isSolo && snakeHasEaten(myself, lookahead)) {
    wantToEat = true // need solo snake to not penalize itself in subsequent turns after eating
  } else if (haveWon) {
    wantToEat = true // always want to eat when no other snakes are around to disturb me. Another way to ensure I don't penalize snake for winning.
  }

  if (wantToEat) { // only add food calc if snake wants to eat
    let j = foodSearchDepth + 1 // because we start at depth 0 for food just eaten, j needs to be 1 higher so at foodSearchDepth we're not multiplying by 0
    let foodCalc : number = 0
    for (let i: number = 0; i <= foodSearchDepth; i++) {
      foodToHunt = nearbyFood[i]
      if (foodToHunt && foodToHunt.length > 0) {
        // for each piece of found found at this depth, add some score. Score is higher if the depth i is lower, since j will be higher when i is lower
  
        let foodToHuntLength: number = foodToHunt.length
        if (!isSolo && i === 0) {
          foodToHuntLength = foodToHuntLength * evalEatingMultiplier // give extra weight towards food I have already eaten - another nudge towards eating food earlier
        }
        foodToHunt.forEach(function adjustFoodValues(fud) {
          if (isCorner(gameState.board, fud)) {
            foodToHuntLength = foodToHuntLength - 0.8 // corner food is worth 0.2 that of normal food
          }
          let foodCell = board2d.getCell(fud)
          if (foodCell && foodCell.hazard) {
            foodToHuntLength = foodToHuntLength - 0.4 // hazard food is worth 0.6 that of normal food
          }
        })
        let foodCalcStep = 0
        foodCalcStep = evalFoodVal * (evalFoodStep + j) * foodToHuntLength
        //buildLogString(`found ${foodToHunt.length} food at depth ${i}, adding ${foodCalcStep}`)
        foodCalc = foodCalc + foodCalcStep
      }
      j = j - 1
    }

    evaluationResult.food = foodCalc
  }

  if (gameState.turn > 1) { // don't calculate on early turns, just get early food
    let voronoiDelta: number = 0
    let voronoiLargest: number = 0
    otherSnakes.forEach(snake => { // find largest voronoi value amongst otherSnakes
      let voronoiOtherSnake: number | undefined = reachableCells[snake.id]
      if (voronoiOtherSnake !== undefined && voronoiOtherSnake > voronoiLargest) {
        voronoiLargest = voronoiOtherSnake
      }
    })
    voronoiDelta = voronoiMyself - voronoiLargest

    let voronoiSelf: number = 0
    if (voronoiMyself < evalVoronoiBaseGood) {
      let howBad: number = (evalVoronoiBaseGood - voronoiMyself) * evalVoronoiNegativeStep
      // so if negative step is -100, base good is 9, & voronoiMyself is 5, that makes for (9 - 5) * -100 = -400
      howBad = howBad < evalVoronoiNegativeMax? evalVoronoiNegativeMax : howBad
      voronoiSelf = howBad
    } else if (voronoiMyself > evalVoronoiBaseGood) {
      let howGood: number = (voronoiMyself - evalVoronoiBaseGood) * evalVoronoiPositiveStep
      // so if positive step is 20, base good is 9, & voronoiMyself is 15, that makes for (15 - 9) * 20 = 120
      howGood = howGood > evalVoronoiPositiveMax? evalVoronoiPositiveMax : howGood // don't let howGood exceed the maximum
      voronoiSelf = howGood
    } else {
      voronoiSelf = evalVoronoiBase
    }
    evaluationResult.voronoiSelf = voronoiSelf

    let voronoiBoard: number = 0
    if (isDuel) { // give stronger & more specific rewards for board control in duel
      let voronoiOtherSnake: number = reachableCells[otherSnakes[0].id]
      if (voronoiOtherSnake === 0) { voronoiOtherSnake = 1 } // should be impossible, but ensure prevention of divide by zero
      let ratio = voronoiMyself / voronoiOtherSnake
      let reward: number = 0
      if (ratio > 1) { // give varying rewards depending on how much more board control I have
        let ratioTier = Math.floor(ratio) // 1 means I'm less than double, 2 means less than triple, 3 less than quadruple, etc.
        reward = evalVoronoiDeltaBonus * ratioTier // so in steps of 50: 50 for less than double, 100 for less than triple, 150 for less than quadruple, etc.
        reward = reward > evalVoronoiDeltaMax? evalVoronoiDeltaMax : reward
      }
      voronoiBoard = reward
    } else if (haveWon) { // if I've won, add back the best possible reward for board control
      voronoiBoard = evalVoronoiDeltaMax
    } else {
      if (voronoiDelta > 0) { // reward for having better board control
        voronoiBoard = evalVoronoiDeltaBonus
      }
    }
    evaluationResult.voronoiBoard = voronoiBoard

    let voronoiSelfBonus: number = 0
    // more minmaxing - tells otherSnakes to reward positions that trap originalSnake. Value can be as high as reward for self position is low, minmax style.
    if (!isOriginalSnake && originalSnake && !isDuel) { // don't double reward otherSnake for board control when in duel
      let originalSnakeVoronoi: number | undefined = reachableCells[originalSnake.id]
      if (originalSnakeVoronoi !== undefined) {
        if (originalSnakeVoronoi < evalVoronoiBaseGood) {
          let howBad: number = (evalVoronoiBaseGood - originalSnakeVoronoi) * evalVoronoiNegativeStep
          howBad = howBad < evalVoronoiNegativeMax? evalVoronoiNegativeMax : howBad
          howBad = howBad / 2 // award for otherSnakes penalizing me needs to be less than their own award, otherwise Jaguar is too paranoid
          voronoiSelfBonus = voronoiSelfBonus - howBad // will be double negative, hence actually adding
        }
      }
    } else if (!isOriginalSnake && !isSolo && gameState.board.snakes.length === 1) { // add max originalSnake Voronoi reward for last snake so as not to encourage it to keep me alive for that sweet reward
      let lastVoronoiReward: number = -evalVoronoiNegativeMax // this will be negative, so negate it to make it a reward
      voronoiSelfBonus = lastVoronoiReward
    }
    evaluationResult.voronoiSelfBonus = voronoiSelfBonus
  }

  if (isSolo) { // two things matter in a solo game: not starving, & chasing tail at a safe distance. Try to stay in the middle too so as to stay equidistant to food where possible.
    let tailDist = getDistance(myself.body[myself.body.length - 1], myself.head, gameState) // distance from head to tail
    if (tailDist === 2) {
      evaluationResult.tailChase = evalSoloTailChase
    }
    
    let centers = calculateCenterWithHazard(gameState, hazardWalls)
    const xDiff = Math.abs(myself.head.x - centers.centerX)
    const yDiff = Math.abs(myself.head.y - centers.centerY)

    evaluationResult.center = xDiff * evalSoloCenter + yDiff * evalSoloCenter
  }

  if (isWrapped) { 
    if (isDuel) { // in wrapped, limiting otherSnake movement is significantly harder, & railroading them can lead to starvation or a trap somewhere down the road
      let otherSnakeAvailableMoves = getAvailableMoves(gameState, otherSnakes[0], board2d)
      if (otherSnakeAvailableMoves.validMoves().length <= 1) {
        evaluationResult.otherSnakeMoves = evalWrappedOtherSnake1Move
      }
    }
  }

  return evaluationResult
}