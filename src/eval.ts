import { GameState } from "./types"
import { Direction, Battlesnake, Board2d, Moves, Coord, KissOfDeathState, KissOfMurderState, HazardWalls, KissStatesForEvaluate, EvaluationResult, EffectiveHealthData, VoronoiResultsSnake, VoronoiResults, HealthTier } from "./classes"
import { createWriteStream } from "fs"
import { findMoveNeighbors, findKissDeathMoves, findKissMurderMoves, calculateFoodSearchDepth, findFood, snakeHasEaten, kissDecider, isHazardCutoff, isAdjacentToHazard, calculateCenterWithHazard, getAvailableMoves, isOnHorizontalWall, isOnVerticalWall, createGameDataId, calculateReachableCells, getSnakeDirection, getDistance, gameStateIsRoyale, gameStateIsWrapped, gameStateIsSolo, gameStateIsConstrictor, gameStateIsArcadeMaze, gameStateIsSinkhole, gameStateIsHealingPools, logToFile, determineVoronoiBaseGood, determineVoronoiSelf, determineVoronoiHazardValue, getHazardDamage, isFlip, getFoodModifier, gameStateIsHazardPits, getLongestOtherSnake, gameStateIsIslandsBridges } from "./util"
import { gameData, isDevelopment } from "./logic"

let evalWriteStream = createWriteStream("consoleLogs_eval.txt", {
  encoding: "utf8"
})

// constants used in other files
export const evalHaveWonTurnStep: number = 50

const evalBase: number = 0
const evalTieFactor: number = -50 // penalty for a tie state. Tweak this to tweak Jaguar's Duel Tie preference - smaller means fewer ties, larger means more. 0 is neutral.

const evalHealthOthersnakeStep = -2 // penalty for each point of health otherSnakes have
const evalHealthOthersnakeStarveReward = 50

// Voronoi values
const evalVoronoiNegativeStep = 100
const evalVoronoiPositiveStep = 4.5

const evalVoronoiNegativeStepDuel = 30
const evalVoronoiPreyStepDuel = -30

const evalVoronoiDeltaStepConstrictor = 50
const evalVoronoiDeltaStepDuel = 5

const evalVoronoiPreyStep = 100
const evalVoronoiPreyCutoff = 100

const evalKissOfDeathCertainty = -400 // everywhere seems like certain death
const _evalPriorKissOfDeathCertainty = -800 // this is certain death
const _evalPriorKissOfDeathCertaintyMutual = -500

const evalHealthBase = 75 // evalHealth tiers should differ in severity based on how hungry I am
const evalHealthStepNoHazard: number = 3
const evalHealthStepHazard: number = 6
const evalHealthTierDifference = 10
const evalHealthStarvationPenalty: number = 100 // additional penalty for reaching 0 (or less) health

let evalInitialEatingMultiplier = 5 // this is effectively Jaguar's 'hunger' immediacy - multiplies food factor directly after eating

// helper function that just returns the health tier, doesn't bother with all the knobs to twiddle
export function determineHealthTier(gameState: GameState, snakeHealth: number, haveWon: boolean): HealthTier {
  return determineHealthEval(gameState, snakeHealth, getHazardDamage(gameState), 0, 0, 0, 0, haveWon)
}

// for a given snake, hazard damage, health step, & health tier difference, return an evaluation score for this snake's health
function determineHealthEval(gameState: GameState, _snakeHealth: number, hazardDamage: number, _healthStep: number, healthTierDifference: number, healthBase: number, starvationPenalty: number, haveWon: boolean): HealthTier {
  let healthStep: number
  if (gameStateIsHazardPits(gameState)) {
    healthStep = _healthStep * 2
  } else {
    healthStep = _healthStep
  }
  
  if (hazardDamage >= 100) {
    return determineHealthEvalDeadlyWalls(_snakeHealth, healthBase, starvationPenalty, haveWon)
  } else if (hazardDamage < 0) {
    return determineHealthEvalArcadeMaze(_snakeHealth, healthStep, healthTierDifference, healthBase, starvationPenalty, haveWon)
  } else if (gameStateIsSinkhole(gameState)) {
    return determineHealthEvalSinkhole(_snakeHealth, hazardDamage, healthStep, healthTierDifference, healthBase, starvationPenalty, haveWon)
  }
  const snakeHealth: number = haveWon? 100 : _snakeHealth
  let validHazardTurns = snakeHealth / (hazardDamage + 1)
  const evalHealth7 = healthBase // evalHealth tiers should differ in severity based on how hungry I am
  const evalHealth6 = evalHealth7 - healthTierDifference // 75 - 10 = 65
  const evalHealth5 = evalHealth6 - healthTierDifference - (healthStep * 1) // 65 - 10 - (6 * 1) = 49
  const evalHealth4 = evalHealth5 - healthTierDifference - (healthStep * 2) // 49 - 10 - (6 * 2) = 27
  const evalHealth3 = evalHealth4 - healthTierDifference - (healthStep * 3) // 27 - 10 - (6 * 3) = -1
  const evalHealth2 = evalHealth3 - healthTierDifference - (healthStep * 4) // -1 - 10 - (6 * 4) = -35
  const evalHealth1 = evalHealth2 - healthTierDifference - (healthStep * 5) - 50 // -35 - 10 - (6 * 5) - 50 = -125
  const evalHealth0 = evalHealth1
  const evalHealthStarved = evalHealth0 - starvationPenalty // there is never a circumstance where starving is good, even other snake bodies are better than this
  let evaluation: HealthTier

  let remainder: number = validHazardTurns % 1

  if (snakeHealth <= 0) {
    evaluation = new HealthTier(evalHealthStarved, -1)
  } else if (hazardDamage <= 0 && snakeHealth < 10) { // in a non-hazard game, we still need to prioritize food at some point
    evaluation = new HealthTier(evalHealth0, 0)
  } else if (validHazardTurns > 6) {
    evaluation = new HealthTier(evalHealth7, 7)
  } else if (validHazardTurns > 5) {
    let tierDiff: number = evalHealth7 - evalHealth6
    evaluation = new HealthTier(evalHealth6 + remainder * tierDiff, 6)
  } else if (validHazardTurns > 4) {
    let tierDiff: number = evalHealth6 - evalHealth5
    evaluation = new HealthTier(evalHealth5 + remainder * tierDiff, 5)
  } else if (validHazardTurns > 3) {
    let tierDiff: number = evalHealth5 - evalHealth4
    evaluation = new HealthTier(evalHealth4 + remainder * tierDiff, 4)
  } else if (validHazardTurns > 2) {
    let tierDiff: number = evalHealth4 - evalHealth3
    evaluation = new HealthTier(evalHealth3 + remainder * tierDiff, 3)
  } else if (validHazardTurns > 1) {
    let tierDiff: number = evalHealth3 - evalHealth2
    evaluation = new HealthTier(evalHealth2 + remainder * tierDiff, 2)
  } else { // (validHazardTurns > 0)
    evaluation = new HealthTier(evalHealth1, 1)
  } // validHazardTurns will never be <= 0, as that is starvation & would match the top if

  return evaluation
}

function determineHealthEvalSinkhole(_snakeHealth: number, hazardDamage: number, healthStep: number, healthTierDifference: number, healthBase: number, starvationPenalty: number, haveWon: boolean): HealthTier {
  const snakeHealth: number = haveWon? 100 : _snakeHealth
  let validHazardTurns = snakeHealth / (hazardDamage + 1)
  const evalHealth9 = healthBase // 75
  const evalHealth8 = evalHealth9 - healthTierDifference // 75 - 10 = 65
  const evalHealth7 = evalHealth8 - healthTierDifference - (healthStep * 1) // 65 - 10 - (6 * 1) = 49
  const evalHealth6 = evalHealth7 - healthTierDifference - (healthStep * 2) // 49 - 10 - (6 * 2) = 27
  const evalHealth5 = evalHealth6 - healthTierDifference - (healthStep * 3) // 27 - 10 - (6 * 3) = -1
  const evalHealth4 = evalHealth5 - healthTierDifference - (healthStep * 4) // -1 - 10 - (6 * 4) = -35
  const evalHealth3 = evalHealth4 - healthTierDifference - (healthStep * 5) // -35 - 10 - (6 * 5) = -75
  const evalHealth2 = evalHealth3 - healthTierDifference - (healthStep * 6) // -75 - 10 - (6 * 6) = -121
  const evalHealth1 = evalHealth2 - healthTierDifference - (healthStep * 7) - 50 // -121 - 10 - (6 * 7) - 50 = -223
  const evalHealth0 = evalHealth1
  const evalHealthStarved = evalHealth0 - starvationPenalty // there is never a circumstance where starving is good, even other snake bodies are better than this
  let evaluation: HealthTier

  let remainder: number = validHazardTurns % 1

  if (snakeHealth <= 0) {
    evaluation = new HealthTier(evalHealthStarved, -1)
  } else if (hazardDamage <= 0 && snakeHealth < 10) { // in a non-hazard game, we still need to prioritize food at some point    
    evaluation = new HealthTier(evalHealth0, 0)
  } else if (validHazardTurns > 8) {
    evaluation = new HealthTier(evalHealth9, 9)
  } else if (validHazardTurns > 7) {
    let tierDiff: number = evalHealth9 - evalHealth8
    evaluation = new HealthTier(evalHealth8 + remainder * tierDiff, 8)
  } else if (validHazardTurns > 6) {
    let tierDiff: number = evalHealth8 - evalHealth7
    evaluation = new HealthTier(evalHealth7 + remainder * tierDiff, 7)
  } else if (validHazardTurns > 5) {
    let tierDiff: number = evalHealth7 - evalHealth6
    evaluation = new HealthTier(evalHealth6 + remainder * tierDiff, 6)
  } else if (validHazardTurns > 4) {
    let tierDiff: number = evalHealth6 - evalHealth5
    evaluation = new HealthTier(evalHealth5 + remainder * tierDiff, 5)
  } else if (validHazardTurns > 3) {
    let tierDiff: number = evalHealth5 - evalHealth4
    evaluation = new HealthTier(evalHealth4 + remainder * tierDiff, 4)
  } else if (validHazardTurns > 2) {
    let tierDiff: number = evalHealth4 - evalHealth3
    evaluation = new HealthTier(evalHealth3 + remainder * tierDiff, 3)    
  } else if (validHazardTurns > 1) {
    let tierDiff: number = evalHealth3 - evalHealth2
    evaluation = new HealthTier(evalHealth2 + remainder * tierDiff, 2) 
  } else { // (validHazardTurns > 0)
    evaluation = new HealthTier(evalHealth1, 1)
  } // validHazardTurns will never be <= 0, as that is starvation & would match the top if

  return evaluation
}

// for use in games with max hazard damage, aka walls
function determineHealthEvalArcadeMaze(_snakeHealth: number, healthStep: number, healthTierDifference: number, healthBase: number, starvationPenalty: number, haveWon: boolean): HealthTier {
  const snakeHealth: number = haveWon? 100 : _snakeHealth
  const evalHealth7 = healthBase // evalHealth tiers should differ in severity based on how hungry I am
  const evalHealth6 = evalHealth7 - healthTierDifference // 75 - 10 = 65
  const evalHealth5 = evalHealth6 - healthTierDifference - (healthStep * 1) // 65 - 10 - (6 * 1) = 49
  const evalHealth4 = evalHealth5 - healthTierDifference - (healthStep * 2) // 54 - 10 - (6 * 2) = 27
  const evalHealth3 = evalHealth4 - healthTierDifference - (healthStep * 3) // 42 - 10 - (6 * 3) = -1
  const evalHealth2 = evalHealth3 - healthTierDifference - (healthStep * 4) // 29 - 10 - (6 * 4) = -35
  const evalHealth1 = evalHealth2 - healthTierDifference - (healthStep * 5) - 50 // 15 - 10 - (6 * 5) - 50 = -125
  const evalHealthStarved = evalHealth1 - starvationPenalty // there is never a circumstance where starving is good, even other snake bodies are better than this
  let evaluation: HealthTier

  if (snakeHealth <= 0) {
    evaluation = new HealthTier(evalHealthStarved, -1)
  } else if (snakeHealth > 90) {
    evaluation = new HealthTier(evalHealth7, 7)
  } else if (snakeHealth > 75) {
    evaluation = new HealthTier(evalHealth6, 6)
  } else if (snakeHealth > 60) {
    evaluation = new HealthTier(evalHealth5, 5)
  } else if (snakeHealth > 45) {
    evaluation = new HealthTier(evalHealth4, 4)
  } else if (snakeHealth > 30) {
    evaluation = new HealthTier(evalHealth3, 3)  
  } else if (snakeHealth > 15) {
    evaluation = new HealthTier(evalHealth2, 2)
  } else {
    evaluation = new HealthTier(evalHealth1, 1)
  }

  return evaluation
}

// for use in games with max hazard damage, aka walls
function determineHealthEvalDeadlyWalls(_snakeHealth: number, healthBase: number, starvationPenalty: number, haveWon: boolean): HealthTier {
  const snakeHealth: number = haveWon? 100 : _snakeHealth
  const evalHealth7 = healthBase // evalHealth tiers should differ in severity based on how hungry I am
  const evalHealth1 = 0
  const evalHealthStarved = evalHealth1 - starvationPenalty // there is never a circumstance where starving is good, even other snake bodies are better than this
  let evaluation: HealthTier

  if (snakeHealth <= 0) {
    evaluation = new HealthTier(evalHealthStarved, -1)
  } else if (snakeHealth > 15) {
    evaluation = new HealthTier(evalHealth7, 7)
  } else {
    evaluation = new HealthTier(evalHealth1, 1)
  }

  return evaluation
}

function determineOtherSnakeHealthEval(otherSnakes: Battlesnake[], max?: boolean): number {
  let otherSnakeHealthPenalty: number = 0
  for (const snake of otherSnakes) {
    if (max) {
      otherSnakeHealthPenalty = otherSnakeHealthPenalty + 100 * evalHealthOthersnakeStep
    } else {
      otherSnakeHealthPenalty = otherSnakeHealthPenalty + snake.health * evalHealthOthersnakeStep
    }
  }
  return otherSnakeHealthPenalty
}

function determineOtherSnakeHealthEvalDuel(otherSnake: Battlesnake, max?: boolean): number {
  if (max) {
    return 100 * -1
  } else {
    return otherSnake.health * -1 // otherSnake health penalty is simply its health, negated
  }
}

// constrictor evalNoSnakes is very simple - just Base - otherSnakeHealth
function determineEvalNoSnakesConstrictor(gameState: GameState, myself: Battlesnake): EvaluationResult {
  const thisGameData = gameData? gameData[createGameDataId(gameState)] : undefined
  let evaluationResult = new EvaluationResult(myself)
  evaluationResult.base = evalBase
  let otherSnakeHealthPenalty: number = thisGameData?.startingGameState.board.snakes.length === 2 ? determineOtherSnakeHealthEvalDuel(myself) : determineOtherSnakeHealthEval([myself]) // otherSnake may as well be me, since my health is also maxed out
  evaluationResult.otherSnakeHealth = otherSnakeHealthPenalty
  evaluationResult.tieValue = evalTieFactor; // want to make a tie slightly worse than an average state. Still good, but don't want it overriding other, better states
  return evaluationResult
}

export function getDefaultEvalNoMe(gameState: GameState): EvaluationResult {
  let result: EvaluationResult = new EvaluationResult(gameState.you)
  if (gameStateIsConstrictor(gameState)) {
    result.noMe = -6800
  } else if (gameStateIsArcadeMaze(gameState)) {
    result.noMe = -5850
  } else {
    result.noMe = -3400
  }
  return result
}

// normal evalNoSnakes must distinguish between self & otherSnakes due to difference in how Voronoi is awarded
export function determineEvalNoSnakes(gameState: GameState, myself: Battlesnake, tieSnake: Battlesnake | undefined, eatTurns: number): EvaluationResult {
  if (gameStateIsConstrictor(gameState)) {
    return determineEvalNoSnakesConstrictor(gameState, myself)
  }
  let evaluationResult = new EvaluationResult(myself)
  evaluationResult.base = evalBase
  const hazardDamage: number = getHazardDamage(gameState)
  const evalHealthStep = hazardDamage > 0? evalHealthStepHazard : evalHealthStepNoHazard

  const thisGameData = gameData? gameData[createGameDataId(gameState)] : undefined

  let averageHealth: number = myself.health * (2/3) // health eval is now an average health, which is likely a bit lower than the current health
  evaluationResult.health = determineHealthEval(gameState, averageHealth, hazardDamage, evalHealthStep, evalHealthTierDifference, evalHealthBase, evalHealthStarvationPenalty, false).score
  if (tieSnake) {
    let otherSnakeHealthPenalty: number = thisGameData?.startingGameState.board.snakes.length === 2 ? determineOtherSnakeHealthEvalDuel(tieSnake) : determineOtherSnakeHealthEval([tieSnake])
    evaluationResult.otherSnakeHealth = otherSnakeHealthPenalty
  }
  if (!thisGameData || !thisGameData.isDuel) { // for non-minimax games. Minimax duels can generally consider a Voronoi score of 0 to be a neutral score
    if (gameState.you.id === myself.id) {
      if (hazardDamage > 0) { // hazard Voronoi calqs have smaller totalReachableCells & a healthRatio in wrapped
        let numHazards: number
        if (gameStateIsSinkhole(gameState)) { // sinkhole games or other game modes with stacked hazards must get # of hazards thru board2d
          let board2d: Board2d = new Board2d(gameState, false) // no need for voronoi
          numHazards = board2d.numHazards
        } else { // in non-stacked hazard modes, can simply count hazard array length
          numHazards = gameState.board.hazards.length
        }
        const hazardValue = determineVoronoiHazardValue(gameState, numHazards)
        const boardSize: number = gameState.board.height * gameState.board.width
        const totalReachableCells: number = (boardSize - numHazards) + numHazards * hazardValue
        const myReachableCells: number = totalReachableCells / 2
        const voronoiBaseGood: number = totalReachableCells / 6 // see determineVoronoiBaseGood - in a duel it's the total reachable cells / 6
        let voronoiSelf: number = myReachableCells - voronoiBaseGood // see determineVoronoiSelf - without tail chases, it's just voronoiSelf - voronoiBaseGood
        if (voronoiSelf > 0) { // voronoiSelf is positive, voronoiSelf is a reward
          voronoiSelf = voronoiSelf * evalVoronoiPositiveStep
        } else { // voronoiSelf is 0 or negative, voronoiSelf becomes a penalty
          voronoiSelf = voronoiSelf * evalVoronoiNegativeStep
        }
        if (gameStateIsWrapped(gameState)) {
          const healthRatio = (myself.health / 2) / 100 // say average health is half of current health
          voronoiSelf = voronoiSelf * healthRatio
        }
        evaluationResult.voronoiSelf = voronoiSelf
      } else {
        const totalReachableCells: number = gameState.board.height * gameState.board.width
        const myReachableCells: number = totalReachableCells / 2
        const voronoiBaseGood: number = totalReachableCells / 6 // see determineVoronoiBaseGood - in a duel it's the total reachable cells / 6
        let voronoiSelf: number = myReachableCells - voronoiBaseGood // see determineVoronoiSelf - without tail chases, it's just voronoiSelf - voronoiBaseGood
        if (voronoiSelf > 0) { // voronoiSelf is positive, voronoiSelf is a reward
          voronoiSelf = voronoiSelf * evalVoronoiPositiveStep
        } else { // voronoiSelf is 0 or negative, voronoiSelf becomes a penalty
          voronoiSelf = voronoiSelf * evalVoronoiNegativeStep
        }
        evaluationResult.voronoiSelf = voronoiSelf
      }
    } // otherSnakes in duel use Voronoi delta, & Voronoi scores here should be identical, so can skip that entirely
  }
  evaluationResult.foodEaten = eatTurns * evalInitialEatingMultiplier * 3
  evaluationResult.tieValue = evalTieFactor; // want to make a tie slightly worse than an average state. Still good, but don't want it overriding other, better states
  return evaluationResult
}

export function determineEvalNoMe(_gameState: GameState): EvaluationResult {
  const thisGameData = gameData? gameData[createGameDataId(_gameState)] : undefined
  if (!thisGameData) {
    return getDefaultEvalNoMe(_gameState)
  }

  let gameState: GameState = thisGameData? thisGameData.startingGameState : _gameState

  if (gameStateIsConstrictor(gameState)) {
    return determineEvalNoMeConstrictor(gameState)
  }
  
  let isDuel: boolean = gameState.board.snakes.length === 2

  let voronoiSelf: number
  let othersnakeHealth: number
  let health: number
  let kissOfDeath: number
  let priorKissOfDeath: number
  let hazardDamage: number = getHazardDamage(gameState)

  let totalReachableCells: number = gameState.board.width * gameState.board.height // does not account for hazards, but as a maximum, shouldn't need to
  // NOTE: assumes gameState board hazards array is populated - no longer true for computed hazard maps like spiral, but thus far those maps don't have 100 damage hazards
  // also breaks with stacked hazards, but that also doesn't make sense for hazardDamage >= 100
  if (hazardDamage >= 100) {
    totalReachableCells = totalReachableCells - gameState.board.hazards.length
  }
  if (isDuel) {
    let othersnake: Battlesnake = gameState.board.snakes.find(snake => snake.id !== gameState.you.id)
    voronoiSelf = -(totalReachableCells * evalVoronoiDeltaStepDuel) // smallest possible Voronoi score is delta of entire board, times step
    othersnakeHealth = determineOtherSnakeHealthEvalDuel(othersnake, true)
  } else {
    let voronoiResults = new VoronoiResults()
    voronoiResults.totalReachableCells = totalReachableCells // determineVoronoiBaseGood just needs totalReachableCells defined
    let voronoiBaseGood: number = determineVoronoiBaseGood(gameState, voronoiResults, gameState.board.snakes.length)
    voronoiSelf = -(voronoiBaseGood * evalVoronoiNegativeStep) // smallest possible Voronoi score is full negation of voronoiBaseGood score, times step
    othersnakeHealth = determineOtherSnakeHealthEval(gameState.board.snakes, true)
  }
  kissOfDeath = evalKissOfDeathCertainty // as a minimum value, need to include possibility of this very bad value
  priorKissOfDeath = _evalPriorKissOfDeathCertainty
  let evalHealthStep: number = hazardDamage > 0? evalHealthStepHazard : evalHealthStepNoHazard
  let healthTier: HealthTier = determineHealthEval(gameState, 0, hazardDamage, evalHealthStep, evalHealthTierDifference, evalHealthBase, evalHealthStarvationPenalty, false)
  health = healthTier.score

  let result: EvaluationResult = new EvaluationResult(gameState.you)
  result.voronoiSelf = voronoiSelf
  result.otherSnakeHealth = othersnakeHealth
  result.health = health
  result.kissOfDeath = kissOfDeath
  result.priorKissOfDeath = priorKissOfDeath

  return result
}

function determineEvalNoMeConstrictor(gameState: GameState) : EvaluationResult {
  let othersnakes: Battlesnake[] = []
  let othersnakeHealth: number = -100
  let hazardDamage: number = getHazardDamage(gameState)

  othersnakes = gameState.board.snakes.filter(snake => snake.id !== gameState.you.id) // works for other snakes too since all snake healths are equivalent
  let isDuel: boolean = gameState.board.snakes.length === 2
  let priorKissOfDeath: number
  if (isDuel) {
    othersnakeHealth = determineOtherSnakeHealthEvalDuel(othersnakes[0])
    priorKissOfDeath = 0
  } else {
    othersnakeHealth = determineOtherSnakeHealthEval(othersnakes)
    priorKissOfDeath = _evalPriorKissOfDeathCertaintyMutual 
  }

  let voronoiSelf: number
  let kissOfDeath: number

  let totalReachableCells: number = gameState.board.width * gameState.board.height // does not account for hazards, but as a maximum, shouldn't need to
  // NOTE: assumes gameState board hazards array is populated - no longer true for computed hazard maps like spiral, but thus far those maps don't have 100 damage hazards
  // also breaks with stacked hazards, but that also doesn't make sense for hazardDamage >= 100
  if (hazardDamage >= 100) {
    totalReachableCells = totalReachableCells - gameState.board.hazards.length
  }
  // consider any cell not occupied by a still-living snake to be a reachable cell
  if (gameState.board.snakes.length > 0) {
    totalReachableCells = totalReachableCells - (gameState.board.snakes[0].length * gameState.board.snakes.length)
  }

  voronoiSelf = -(totalReachableCells * evalVoronoiDeltaStepConstrictor) // smallest possible Voronoi score is delta of entire reachable board, times step
  
  kissOfDeath = evalKissOfDeathCertainty // as a minimum value, need to include possibility of this very bad value

  //let total: number = voronoiSelf + othersnakeHealth + kissOfDeath + priorKissOfDeath
  let result: EvaluationResult = new EvaluationResult(gameState.you)
  result.voronoiSelf = voronoiSelf
  result.otherSnakeHealth = othersnakeHealth
  result.kissOfDeath = kissOfDeath
  result.priorKissOfDeath = priorKissOfDeath
  
  return result
}

function determineDeltaScore(delta: number, evalLengthMult: number, evalLengthMaxDelta: number): number {
  if (delta < 0) { // I am smaller than otherSnakes, give penalty accordingly.
    let penalty: number = delta * evalLengthMult // straight penalty for each length I am smaller than otherSnakes
    return penalty
  } else if (delta > 0) { // I am larger than otherSnakes, give reward accordingly
    let award: number = 0
    let cap: number = delta > evalLengthMaxDelta? evalLengthMaxDelta : delta // only award snake for up to 'cap' length greater than otherSnakes
    for (let i: number = 1; i <= cap; i++) {
      if (i === 1) {
        award = award + evalLengthMult * 5 // large reward for first positive delta - it's very valuable to be just slightly larger than opponent
      } else if (i === 2) {
        award = award + evalLengthMult * 3 // smaller reward for second positive delta - it's valuable to have that buffer
      } else {
        award = award + evalLengthMult * 1 // smallest reward for subsequent positive deltas
      }
    }
    return award
  } else {
    return 0
  }
}

// the big one. This function evaluates the state of the board & spits out a number indicating how good it is for input snake, higher numbers being better
export function evaluate(gameState: GameState, _myself: Battlesnake, _priorKissStates?: KissStatesForEvaluate, _eatTurns?: number) : EvaluationResult {
  let myself: Battlesnake | undefined
  let otherSnakes: Battlesnake[] = []
  let originalSnake: Battlesnake | undefined
  let priorKissStates: KissStatesForEvaluate
  if (_priorKissStates) {
    priorKissStates = _priorKissStates 
  } else {
    priorKissStates = new KissStatesForEvaluate(KissOfDeathState.kissOfDeathNo, KissOfMurderState.kissOfMurderNo, undefined, undefined)
  }

  let eatTurns: number = _eatTurns || 0

  let otherSnakeHealth: number = 0
  for (const snake of gameState.board.snakes) { // process all snakes in one go rather than multiple separate filters/finds
    if (snake.id === gameState.you.id) { // if snake ID matches gameState.you.id, this is the original snake
      originalSnake = snake
    }
    if (_myself !== undefined && _myself.id === snake.id) { // if meSnake was provided & the IDs match, this snake is myself
      myself = snake
    } else { // if meSnake was undefined or this snake's ID doesn't match meSnake, this is an otherSnake
      otherSnakes.push(snake)
      otherSnakeHealth = otherSnakeHealth + snake.health
    }
  }
  let isOriginalSnake: boolean = _myself !== undefined && _myself.id === gameState.you.id // true if _myself's id matches the original you of the game

  const hazardDamage: number = getHazardDamage(gameState)
  const hazardFrequency: number = gameState.game.ruleset.settings.royale.shrinkEveryNTurns || 0
  const isRoyale = gameStateIsRoyale(gameState)
  const isWrapped = gameStateIsWrapped(gameState)
  //const isHazardSpiral = gameStateIsHazardSpiral(gameState)
  const isConstrictor = gameStateIsConstrictor(gameState)
  const isArcadeMaze = gameStateIsArcadeMaze(gameState)
  const isHealingPools: boolean = gameStateIsHealingPools(gameState)
  const isHazardPits: boolean = gameStateIsHazardPits(gameState)

  const isSolo: boolean = gameStateIsSolo(gameState)
  const haveWon: boolean = !isSolo && otherSnakes.length === 0 // cannot win in a solo game. Otherwise, have won when no snakes remain.

  const thisGameData = gameData? gameData[createGameDataId(gameState)] : undefined
  let isDuel: boolean = (gameState.board.snakes.length === 2) && (myself !== undefined) // don't consider duels I'm not a part of

  let evalNoMe: number
  let evalNoMeEvaluationResult: EvaluationResult
  if (thisGameData && thisGameData.evalNoMe !== undefined && thisGameData.evalNoMeEvaluationResult !== undefined) {
    evalNoMeEvaluationResult = thisGameData.evalNoMeEvaluationResult
    evalNoMe = thisGameData.evalNoMe
  } else {
    evalNoMeEvaluationResult = getDefaultEvalNoMe(gameState)
    evalNoMe = evalNoMeEvaluationResult.sum()
  }

  const hazardWalls: HazardWalls = thisGameData !== undefined? thisGameData.hazardWalls : new HazardWalls()
  const originalTurn: number = thisGameData !== undefined? thisGameData.startingGameState.turn : gameState.turn

  let preySnake: Battlesnake | undefined = undefined
  if (!isOriginalSnake) {
    preySnake = originalSnake || gameState.you // due to paranoia, assume all otherSnakes are out to get originalSnake
    // if originalSnake has died, use the prior reference in gameState.you
  } // completely remove preySnake from originalSnake calq. Let minimax handle it once it's actually a duel, rather than a MaxN projected duel.

  // returns the evaluation value associated with the given kissOfDeathState
  function getPriorKissOfDeathValue(kissOfDeathState: KissOfDeathState, evalNoMeEvaluationResult: EvaluationResult): number {
    let voronoiSelf: number = evalNoMeEvaluationResult.voronoiSelf // use to give back a priorKissOfDeath value that is relative to an evalNoMe minimum Voronoi score
    switch (kissOfDeathState) {
      case KissOfDeathState.kissOfDeathCertainty:
        if (evalPriorKissOfDeathCertainty < 0 && voronoiSelf < 0) {
          return voronoiSelf * (9/10) // almost full negative for walking into a certain death
        } else {
          return evalPriorKissOfDeathCertainty
        }
      case KissOfDeathState.kissOfDeathCertaintyMutual:
        if (evalPriorKissOfDeathCertaintyMutual < 0 && voronoiSelf < 0) {
          return voronoiSelf * (6/10) // more than half negative for walking into a tie certain death
        } else {
          return evalPriorKissOfDeathCertaintyMutual
        }
      case KissOfDeathState.kissOfDeathMaybe:
        if (evalPriorKissOfDeathMaybe < 0 && voronoiSelf < 0) {
          return voronoiSelf * (5/10) // half negative for walking into a maybe death
        } else {
          return evalPriorKissOfDeathMaybe
        }
      case KissOfDeathState.kissOfDeathMaybeMutual:
        if (evalPriorKissOfDeathMaybeMutual < 0 && voronoiSelf < 0) {
          return voronoiSelf * (5/10) // half negative for walking into a maybe mutual death
        } else {
          return evalPriorKissOfDeathMaybeMutual
        }
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
  const evalNoMeCertaintyMutual: number = 300 // value that being murdered by a tie snake is better than starving. Needs to be more than evalNoMeCertainty
  let evalHazardWallPenalty: number = 0 // no penalty for most turns - we know exactly when they're gonna show up
  if (hazardDamage > 0 && !isWrapped) {
    if (gameState.turn % hazardFrequency === 0) { // turn 25, & increments of 25
      evalHazardWallPenalty = -50
    } else if (((gameState.turn + 1) % hazardFrequency) === 0) { // turn 24, & increments of 25
      evalHazardWallPenalty = -25
    } else if (((gameState.turn + 1) % hazardFrequency) > (hazardFrequency - 4)) {// turns 21, 22, 23, & increments of 25
      evalHazardWallPenalty = -10
    } else {
      if (gameState.turn > originalTurn) { // if this is a lookahead turn, try to account for possibility that hazard has now spawned
        let turnsLookingAhead: number = gameState.turn - originalTurn // we are looking ahead this many turns
        let lastHazardSpawnTurn: number = gameState.turn % hazardFrequency // last hazard spawned this many turns ago
        if (turnsLookingAhead > lastHazardSpawnTurn) { // if I am looking ahead farther than lastHazardSpawnTurn, hazard has spawned that I do not know about, want to heavily penalize plans involving unknown hazard
          evalHazardWallPenalty = -50
        }
      }
    }
  }
  let evalHazardPenalty: number = -(hazardDamage + 5) // in addition to health considerations & hazard wall calqs, make it slightly worse in general to hang around inside of the sauce
  
  const evalHealthStep = hazardDamage > 0? evalHealthStepHazard : evalHealthStepNoHazard

  let evalLengthMult: number // larger values result in more food prioritization. Negative preference towards length in solo
  if (isSolo) {
    evalLengthMult = -20
  } else {
    evalLengthMult = 20
  }
  let evalLengthMaxDelta: number = 6 // largest size difference that evaluation continues rewarding

  const evalPriorKissOfDeathCertainty = isOriginalSnake? _evalPriorKissOfDeathCertainty : 0 // otherSnakes can pick again, let them evaluate this without fear of death

  let evalPriorKissOfDeathCertaintyMutual: number
  if (isDuel || gameState.board.snakes.length === 0) { // if it's a duel (or it was a duel before we rushed into eachother), we don't want to penalize snake for moving here if it's the best tile
    evalPriorKissOfDeathCertaintyMutual = 0
  } else if (!isOriginalSnake && priorKissStates.predator?.id === gameState.you.id) {
    evalPriorKissOfDeathCertaintyMutual = 250 // tell otherSnakes to kamikaze into me so that my snake is less inclined to go there - they can always rechoose if this forces us into the same square
  } else { // it's not a duel & it's original snake or another snake not vs me, give penalty for seeking a tile that likely wouldn't kill me, but might
    evalPriorKissOfDeathCertaintyMutual = _evalPriorKissOfDeathCertaintyMutual
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
  
  let evalPriorKissOfMurderAvoidance: number
  if (!isOriginalSnake && originalSnake && priorKissStates.prey && priorKissStates.prey.id !== originalSnake.id) {
    evalPriorKissOfMurderAvoidance = 0 // don't reward otherSnakes for missing a kill on a snake that wasn't me - I would have let them repick anyway
  } else {
    evalPriorKissOfMurderAvoidance = 15 // this state may have killed a snake, but they did have an escape route (3to2, 3to1, or 2to1 avoidance).
  }
  const evalPriorKissOfMurderSelfBonus = 80 // the bonus we give to otherSnakes for attempting to kill me. Need to assume they will try in general or we'll take unnecessary risks

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

  const evalKissOfDeathNo = 0
  const evalKissOfMurderCertainty = 50 // we can kill a snake, this is probably a good thing
  const evalKissOfMurderMaybe = 25 // we can kill a snake, but it's a 50/50
  const evalKissOfMurderFaceoff = 35 // we can kill a snake, they have an escape route, but we can easily give chase
  const evalKissOfMurderAvoidance = 10 // we can kill a snake, but they have an escape route (3to2, 3to1, or 2to1 avoidance)
  const evalKissOfMurderSelfBonus = 30 // bonus given to otherSnakes for attempting to get close enough to kill me

  const evalCutoffHazardReward = isDuel || haveWon? 75 : 25
  const evalCutoffHazardPenalty = -60

  let evalFoodVal = 3

  const evalSoloTailChase = 50 // reward for being exactly one away from tail when in solo
  const evalSoloCenter = -1

  const evalWrappedFlipFlopStep = 30

  let evaluationResult: EvaluationResult = new EvaluationResult(_myself)

  if (gameState.board.snakes.length === 0) {
    return determineEvalNoSnakes(gameState, _myself, priorKissStates.predator, eatTurns) // if no snakes are left, I am dead, but so are the others. It's better than just me being dead, at least
  }
  if (myself === undefined) {
    if (_myself.health <= 0) { // if I starved, return evalNoMe, this is certain death
      evaluationResult.noMe = evalNoMe
      return evaluationResult
    } else if (priorKissStates.deathState !== KissOfDeathState.kissOfDeathNo) {
      if (isOriginalSnake && [KissOfDeathState.kissOfDeathCertainty, KissOfDeathState.kissOfDeathCertaintyMutual].includes(priorKissStates.deathState)) {
        if (priorKissStates.deathState === KissOfDeathState.kissOfDeathCertainty) {
          evaluationResult.noMe = evalNoMe + evalNoMeCertainty
        } else {
          evaluationResult.noMe = evalNoMe + evalNoMeCertaintyMutual
        }
        return evaluationResult // I am dead here if another snake chooses to kill me, but it's not a 100% sure thing
      } else {
        evaluationResult.priorKissOfDeath = getPriorKissOfDeathValue(priorKissStates.deathState, evalNoMeEvaluationResult)

        let otherSnakesPlusVictim: Battlesnake[]
        if (preySnake && !originalSnake) { // if originalSnake died getting here, add it back for comparison against a state where it wasn't dead
          otherSnakesPlusVictim = otherSnakes.concat(preySnake)
        } else {
          otherSnakesPlusVictim = otherSnakes
        }
        let otherSnakeHealthPenalty: number = determineOtherSnakeHealthEval(otherSnakesPlusVictim)
        evaluationResult.otherSnakeHealth = otherSnakeHealthPenalty
        let longestOtherSnake: Battlesnake | undefined = getLongestOtherSnake(_myself, gameState) || _myself // if board is now just one snake, treat _myself as the longestOtherSnake
        let delta: number
        if (longestOtherSnake) {
          if (priorKissStates.predator && priorKissStates.predator.length > longestOtherSnake.length) { // basically, in the event of a tie, if predator is longest snake, use that
            delta = _myself.length - priorKissStates.predator.length // should be 0 in all cases
          } else {
            delta = _myself.length - longestOtherSnake.length
          }
        } else {
          delta = -evalLengthMaxDelta // give max delta to account for possible eats
        }
        evaluationResult.delta = determineDeltaScore(delta, evalLengthMult, evalLengthMaxDelta) 
        evaluationResult.health = determineHealthEval(gameState, _myself.health, hazardDamage, evalHealthStep, evalHealthTierDifference, evalHealthBase, evalHealthStarvationPenalty, haveWon).score
        
        if (!isOriginalSnake && !originalSnake) { // reward otherSnakes for tie-killing originalSnake
          evaluationResult.base = evalBase
        }
        return evaluationResult // Return the kissofDeath value that got me here (if applicable). This represents an uncertain death - though bad, it's not as bad as, say, starvation, which is a certainty.
      }
    } else { // other deaths, such as death by snake body, are also a certainty
      evaluationResult.noMe = evalNoMe
      return evaluationResult
    }
  }

  evaluationResult.base = evalBase // important to do this after the instant-returns above because we don't want the base included in those values
  let board2d: Board2d
  let calculateVoronoi: boolean
  if (haveWon) {
    board2d = new Board2d(gameState) // don't build the full graph in this case, just build the cheap one & fudge the VoronoiResults
    calculateVoronoi = false
  } else if (isConstrictor) { // constrictor games aren't expensive to compute on any turn, & early turns are very important
    board2d = new Board2d(gameState, true) // important to do this after the instant-returns above because it's expensive
    calculateVoronoi = true
  } else if (originalTurn <= 1) {
    board2d = new Board2d(gameState) // don't build the full graph in this case, just build the cheap one & fudge the VoronoiResults
    calculateVoronoi = false
  } else {
    board2d = new Board2d(gameState, true) // important to do this after the instant-returns above because it's expensive
    calculateVoronoi = true
  }

  // penalize spaces that ARE hazard
  let myCell = board2d.getCell(myself.head.x, myself.head.y)
  if (myCell !== undefined && myCell.hazard > 0 && hazardDamage > 0) {
    evaluationResult.hazard = evalHazardPenalty * myCell.hazard // penalty is multiplied for how many stacks of hazard live here
  }

  let wantToEat: boolean = true // condition for whether we currently want food
  let safeToEat: boolean = true // condition for whether it was safe to eat a food in our current cell

  if (isAdjacentToHazard(myself.head, hazardWalls, gameState)) {
    evaluationResult.hazardWall = evalHazardWallPenalty
  }

  if (!isSolo) { // don't need to calculate otherSnake health penalty in game without otherSnakes
    let otherSnakeHealthPenalty: number = determineOtherSnakeHealthEval(otherSnakes)
    evaluationResult.otherSnakeHealth = otherSnakeHealthPenalty
  }
  
  let moves: Moves = getAvailableMoves(gameState, myself, board2d)

  // look for kiss of death & murder cells in this current configuration
  let moveNeighbors = findMoveNeighbors(gameState, myself, board2d, moves)
  let kissOfMurderMoves = findKissMurderMoves(moveNeighbors)
  let kissOfDeathMoves = findKissDeathMoves(moveNeighbors)

  let kissStates = kissDecider(gameState, myself, moveNeighbors, kissOfDeathMoves, kissOfMurderMoves, moves, board2d)

  if (kissStates.canAvoidPossibleDeath(moves)) { // death is avoidable for at least one possible move
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

  let canBeCutoffHazardBySnake: boolean = false
  if (hazardDamage > 0 && !gameState.game.map && isRoyale) { // hazard cutoffs only make sense in standard hazard maps
    if (haveWon) {
      evaluationResult.cutoffHazard = evalCutoffHazardReward
    } else {
      let canCutoffHazardSnake: boolean = otherSnakes.some(function findSnakeToCutOff(snake) { // returns true if myself can cut off any otherSnake with hazard
        return isHazardCutoff(gameState, myself, snake, board2d, hazardWalls) // returns true if myself can cut snake off with hazard
      })
      if (canCutoffHazardSnake) {
        evalPriorKissOfMurderAvoidance = evalPriorKissOfMurderAvoidance < 35? 35 : evalPriorKissOfMurderAvoidance // if the kiss of murder that the other snake avoided led it into a hazard cutoff, this is not a murder we want to avoid
        evaluationResult.cutoffHazard = evalCutoffHazardReward
      }

      if (!canCutoffHazardSnake) {
        canBeCutoffHazardBySnake = otherSnakes.some(function findSnakeToBeCutOffBy(snake) { // returns true if any otherSnake can hazard cut myself off
          return isHazardCutoff(gameState, snake, myself, board2d, hazardWalls) // returns true if snake can hazard cut myself off
        })
        if (canBeCutoffHazardBySnake) {
          evaluationResult.cutoffHazard = evalCutoffHazardPenalty
        }
      }
    }
  }
  
  let priorKissOfDeathValue = getPriorKissOfDeathValue(priorKissStates.deathState, evalNoMeEvaluationResult)
  if (priorKissOfDeathValue < 0) { // positive kissOfDeath values are rewards for otherSnakes suiciding into originalSnake. This clause prevents us
    evaluationResult.priorKissOfDeath = priorKissOfDeathValue // from also rewarding the other option in a kissOfDeathMaybe that did not kill originalSnake
  }

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

  let foodSearchDepth: number
  if (isConstrictor) {
    foodSearchDepth = 0
  } else if (originalTurn <= 1) {
    foodSearchDepth = 2 // for turns 0 & 1, only want to consider starting food right next to us
  } else {
    foodSearchDepth = calculateFoodSearchDepth(gameState, myself)
  }
  let voronoiResults: VoronoiResults
  if (!calculateVoronoi) { // don't want to build Voronoi graph here, so fudge the VoronoiResults object
    voronoiResults = new VoronoiResults()
    voronoiResults.snakeResults[myself.id] = new VoronoiResultsSnake()
    if (hazardDamage > 0) {
      voronoiResults.snakeResults[myself.id].effectiveHealths = [new EffectiveHealthData(myself.health / 2, 1)] // for health ratio, average health will just be my health over 2
    }
    voronoiResults.snakeResults[myself.id].food = findFood(foodSearchDepth, gameState.board.food, myself.head, gameState) // food finder that doesn't use Voronoi graph
    const hazardValue: number = determineVoronoiHazardValue(gameState, board2d.numHazards)
    const totalReachableCells: number = (gameState.board.height * gameState.board.width - board2d.numHazards) + board2d.numHazards * hazardValue
    voronoiResults.totalReachableCells = totalReachableCells
    voronoiResults.snakeResults[myself.id].reachableCells = totalReachableCells
  } else {
    voronoiResults = calculateReachableCells(gameState, board2d)
  }
  let voronoiResultsSelf: VoronoiResultsSnake = voronoiResults.snakeResults[myself.id]
  let voronoiMyself: number = voronoiResultsSelf.reachableCells
  let nearbyFood: {[key: number]: Coord[]} = voronoiResultsSelf.food
  let foodToHunt : Coord[] = []
  let deathStates = [KissOfDeathState.kissOfDeathCertainty, KissOfDeathState.kissOfDeathCertaintyMutual, KissOfDeathState.kissOfDeathMaybe, KissOfDeathState.kissOfDeathMaybeMutual]
  if (hazardDamage > 0 && (myself.health < (1 + (hazardDamage + 1) * 2))) { // if hazard damage exists & two turns of it would kill me, want food
    wantToEat = true
  }
  // only disqualify deathState moves done by originalSnake, since otherSnakes get to rechoose if they die
  if (isOriginalSnake && deathStates.includes(priorKissStates.deathState)) { // eating this food had a likelihood of causing my death, that's not safe
    safeToEat = false
    wantToEat = false // also shouldn't reward this snake for being closer to food, it put itself in a situation where it won't reach said food to do so
  } else if (voronoiMyself <= 5 || canBeCutoffHazardBySnake) { // eating this food puts me into a box I likely can't get out of, that's not safe
    //TODO: test this with VoronoiBaseGood instead of 5
    safeToEat = false
    wantToEat = false // also shouldn't reward this snake for being closer to food, it put itself in a situation where it won't reach said food to do so
  }

  let selfPossibleLength: number = myself.length // not sure if I want to do this, or just consider myself.length
  let longestSnakePossibleLength: number = 0
  for (const snake of gameState.board.snakes) { // for each snake, find its possible length based on the food it can reach now
    if (!calculateVoronoi) {
      if (snake.id !== myself.id) {
        if (longestSnakePossibleLength < snake.length) {
          longestSnakePossibleLength = snake.length
        }
      }
    } else {
      const totalPossibleEatsKeys: string[] = Object.keys(voronoiResults.snakeResults[snake.id].food)
      if (snake.id === myself.id) {
        selfPossibleLength = selfPossibleLength + totalPossibleEatsKeys.length
      } else {
        const possibleLength: number = snake.length + totalPossibleEatsKeys.length
        if (longestSnakePossibleLength < possibleLength) { // if possibleLength is larger than the largest we've found so far, make it the new longest possible length
          longestSnakePossibleLength = possibleLength
        }
      }
    }
  }
  let delta: number = selfPossibleLength - longestSnakePossibleLength // snake delta is based on possible lengths, not current lengths

  // general snake length metric. More long more good
  if (snakeHasEaten(myself) && !safeToEat) { // if it just ate & it's not safe to eat, don't reward it for the new extra length
    delta = delta - 1
  }

  if (isConstrictor) {
    evalFoodVal = 0
  } else {
    if (haveWon) { // set food val to max so as not to penalize winning states
      evalFoodVal = 4
    } else if (originalTurn <= 1) {
      evalFoodVal = 50 // simply, should always want to get the starting food
    } else if (isDuel && delta < -4) { // care a bit less about food due to already being substantially smaller
      evalFoodVal = 2
    } else if (delta < 1) { // care a bit more about food to try to regain the length advantage
      evalFoodVal = evalFoodVal < 4? 4 : evalFoodVal
    } else if (delta > 6) { // If I am more than 6 bigger, want food less
      evalFoodVal = 2
    }
  }

  if (isSolo) { // Penalize solo snake for being larger
    let penalty: number = myself.length * evalLengthMult // straight penalty for each length I am larger
    evaluationResult.delta = penalty
  } else if (!isConstrictor) { // constrictor snake length is irrelevant
    if (delta === 0) { // small penalty for being the same length as otherSnakes in a non-duel
      evaluationResult.delta = determineDeltaScore(-1, evalLengthMult, evalLengthMaxDelta)
    } else {
      evaluationResult.delta = determineDeltaScore(delta, evalLengthMult, evalLengthMaxDelta)
    }
  }

  let selfAverageHealth: number = myself.health
  // health considerations, which are effectively hazard considerations
  if (!isSolo && !isConstrictor) {
    // hazard pit MaxN in particular doesn't behave well with average health. Not sure what it is
    if (voronoiResultsSelf && !isHazardPits) {
      selfAverageHealth = voronoiResultsSelf.getAverageHealth()
    }
    let healthTier: HealthTier = determineHealthEval(gameState, selfAverageHealth, hazardDamage, evalHealthStep, evalHealthTierDifference, evalHealthBase, evalHealthStarvationPenalty, haveWon)
    evaluationResult.health = healthTier.score
  }

  if (isConstrictor) {
    wantToEat = false // don't need to eat in constrictor
  } else if (isSolo && myself.health > 7) { // don't need to eat in solo mode until starving
    wantToEat = false
  } else if (isSolo && snakeHasEaten(myself)) {
    wantToEat = true // need solo snake to not penalize itself in subsequent turns after eating
  } else if (haveWon) {
    wantToEat = true // always want to eat when no other snakes are around to disturb me. Another way to ensure I don't penalize snake for winning.
  }

  let healthAverageSelf: number | undefined
  // Voronoi stuff
  if (isConstrictor || originalTurn > 1) { // don't calculate on early turns, just get early food
    let useTailChase: boolean = isOriginalSnake
    //let useTailOffset: boolean = isOriginalSnake && gameState.game.ruleset.settings.foodSpawnChance > 2 // healing pools sets food spawn chance very low, tail offset means less
    let useTailOffset: boolean = false

    // function which returns a Voronoi score based on how 'good' or 'bad' voronoiSelf is, adjusted for health scores in wrapped games
    function getVoronoiSelfAdjusted(incomingValue: number) : number {
      let voronoiSelfAdjusted: number
      if (incomingValue > 0) { // voronoiSelf is positive, voronoiSelf is a reward
        voronoiSelfAdjusted = incomingValue * evalVoronoiPositiveStep
      } else { // voronoiSelf is 0 or negative, voronoiSelf becomes a penalty
        voronoiSelfAdjusted = incomingValue * evalVoronoiNegativeStep
      }

      // outcome only improved in wrapped games, went from 54% to 40% in standard royale after implementing this
      if (hazardDamage > 0 && voronoiSelfAdjusted > 0 && isWrapped && voronoiResultsSelf.effectiveHealths.length > 0 && !haveWon) { // health not a major concern in non-royale games. Don't make negative penalties lesser for worse health outcomes
        healthAverageSelf = isConstrictor? 100 : voronoiResultsSelf.getAverageHealth() // is average health of snake in reachable cells
        const healthRatio: number = healthAverageSelf / 100 // is ratio of health average to max health
        voronoiSelfAdjusted = voronoiSelfAdjusted * healthRatio // Voronoi reward is dependent on average health in squares I can cover - makes hazard dives without a plan less glamorous
      }
      return voronoiSelfAdjusted
    }

    let voronoiSelf: number
    let voronoiDeltaStep = isConstrictor? evalVoronoiDeltaStepConstrictor : evalVoronoiDeltaStepDuel
    let voronoiBaseGood: number
    if (thisGameData && isOriginalSnake) {
      voronoiBaseGood = determineVoronoiBaseGood(gameState, voronoiResults, thisGameData.startingGameState.board.snakes.length)
    } else {
      if (!originalSnake) { // starting game state definitely had originalSnake, so add it back for determining voronoiBaseGood
        voronoiBaseGood = determineVoronoiBaseGood(gameState, voronoiResults, gameState.board.snakes.length + 1)
      } else { // if some other snake died we'll have to shrug as we don't have a good way of getting it without using game data
        voronoiBaseGood = determineVoronoiBaseGood(gameState, voronoiResults, gameState.board.snakes.length)
      }
    }
    if (haveWon) {
      voronoiSelf = voronoiResults.totalReachableCells // in the event of winning, consider voronoiSelf to be the max, regardless of the truth.
      evaluationResult.voronoiSelf = voronoiSelf * voronoiDeltaStep
      // predator reward for winning snake
      if (!isOriginalSnake) { // originalSnake doesn't receive predator rewards
        evaluationResult.voronoiPredator = voronoiBaseGood * evalVoronoiNegativeStep // without a cap, this max is effectively the full base good delta times the negative step award
        evaluationResult.otherSnakeHealth = evaluationResult.otherSnakeHealth + evalHealthOthersnakeStarveReward * 3 // need to apply this reward no matter how other snake died
      }
    } else { // use delta & baseGood scores, with tail chase & tail offset taken into account for originalSnake
      if (isConstrictor) {
        let voronoiSelfNoBaseGood: number = determineVoronoiSelf(myself, voronoiResultsSelf, useTailChase, useTailOffset)
        voronoiSelf = voronoiSelfNoBaseGood - voronoiBaseGood

        let voronoiDelta: number = 0
        let voronoiLargest: number = 0
        if (isOriginalSnake) { // originalSnake wants to maximize its Voronoi coverage
          for (const snake of otherSnakes) { // find largest voronoi value amongst otherSnakes
            let voronoiOtherSnake: number | undefined = voronoiResults.snakeResults[snake.id]?.reachableCells
            if (voronoiOtherSnake !== undefined && voronoiOtherSnake > voronoiLargest) {
              voronoiLargest = voronoiOtherSnake
            }
          }
        } else { // otherSnakes want to minimize originalSnakes' Voronoi coverage, paranoid style
          let voronoiOriginalSnake: number | undefined = voronoiResults.snakeResults[gameState.you.id]?.reachableCells
          if (voronoiOriginalSnake !== undefined) {
            voronoiLargest = voronoiOriginalSnake
          }
        }
        voronoiDelta = voronoiSelfNoBaseGood - voronoiLargest // consider Voronoi delta after adjusting for tail & body chases
        let voronoiSelfParanoid: number = voronoiDelta * voronoiDeltaStep

        if (voronoiSelf < 0) { // if & only if voronoiSelf is bad, consider both it & voronoiDelta scores & take the lower of the two
          let voronoiSelfAdjusted: number = getVoronoiSelfAdjusted(voronoiSelf)
          evaluationResult.voronoiSelf = Math.min(voronoiSelfParanoid, voronoiSelfAdjusted)
        } else { // otherwise, only take the voronoiDelta score
          evaluationResult.voronoiSelf = voronoiSelfParanoid
        }
      } else {
        voronoiSelf = determineVoronoiSelf(myself, voronoiResultsSelf, useTailChase, useTailOffset, voronoiBaseGood)
        evaluationResult.voronoiSelf = getVoronoiSelfAdjusted(voronoiSelf)
      }

      let voronoiPredatorBonus: number = 0
      let evalVoronoiNegativeMax = voronoiBaseGood * evalVoronoiNegativeStep // without a cap, this max is effectively the full base good delta times the negative step award

      // tell snake to reward positions to limit preySnake's Voronoi coverage significantly
      if (!isOriginalSnake && originalSnake === undefined) { // add max Voronoi reward for winning snake or otherSnake that has outlasted me so as not to encourage it to keep opponent alive for that sweet reward
        let lastVoronoiReward: number = evalVoronoiNegativeMax / 2 // otherSnake beat me but still needs to beat another snake, haveWon is still false
        voronoiPredatorBonus = lastVoronoiReward
        evaluationResult.otherSnakeHealth = evaluationResult.otherSnakeHealth + evalHealthOthersnakeStarveReward * 3 // need to apply this reward no matter how other snake died
        if (evaluationResult.voronoiSelf < 0) { evaluationResult.voronoiSelf = 0 }
      } else if (preySnake !== undefined) {
        let preySnakeResults: VoronoiResultsSnake = voronoiResults.snakeResults[preySnake.id]
        let preySnakeHealthTier: HealthTier = determineHealthEval(gameState, preySnakeResults.getAverageHealth(), hazardDamage, evalHealthStep, evalHealthTierDifference, evalHealthBase, evalHealthStarvationPenalty, false)

        if (preySnakeResults !== undefined) {
          let preySnakeVoronoi: number = determineVoronoiSelf(preySnake, preySnakeResults, true, false, voronoiBaseGood) // will only reach here for preys of originalSnake, so provide 'true' for tail params
          if ((preySnakeVoronoi < 0 && voronoiSelf > preySnakeVoronoi) || (!isConstrictor && preySnakeVoronoi < -5)) { // don't have predator do a move that gives itself even worse Voronoi coverage than prey
            let howBad: number = -preySnakeVoronoi * evalVoronoiPreyStep // preySnakeVoronoi is negative so need to negate this
            if (isOriginalSnake) {
              howBad = howBad / 2 // don't make Jaguar act too irrationally when pursuing prey, this reward is still less than its pursuit of its own score
            }

            // approximation of cutoff logic to give extra reward for cutting off prey snake
            // for efficiency's sake this doesn't do much of the fancy logic the isCutoff function in utils does. The idea is that if we are already here assigning
            // a prey score, preySnake is likely in a cutoff situation, so we'll simplify the logic & make some assumptions (no check for snake direction, etc.)
            if (!isWrapped) { // cannot cut off in wrapped
              if (preySnake.head.x === 0 && myself.head.x === 1) {
                howBad = howBad + evalVoronoiPreyCutoff
              } else if ((preySnake.head.x === gameState.board.width - 1) && myself.head.x === (gameState.board.width - 2)) {
                howBad = howBad + evalVoronoiPreyCutoff
              } else if (preySnake.head.y === 0 && myself.head.y === 1) {
                howBad = howBad + evalVoronoiPreyCutoff
              } else if ((preySnake.head.y === gameState.board.height - 1) && myself.head.y === (gameState.board.height - 2)) {
                howBad = howBad + evalVoronoiPreyCutoff
              }
            }

            voronoiPredatorBonus = voronoiPredatorBonus + howBad // add how bad preySnake's score is to our own evaluation
            if (evaluationResult.voronoiSelf < 0) { evaluationResult.voronoiSelf = 0 } // null out Voronoi score, our priority is now predator score
          }

          if (preySnakeHealthTier.tier < 2) {
            evaluationResult.otherSnakeHealth = evaluationResult.otherSnakeHealth + evalHealthOthersnakeStarveReward * 3
          } else if (preySnakeHealthTier.tier < 3) {
            evaluationResult.otherSnakeHealth = evaluationResult.otherSnakeHealth + evalHealthOthersnakeStarveReward
          }
        }
      }
      evaluationResult.voronoiPredator = voronoiPredatorBonus
    }
  }

  if (!isConstrictor && snakeHasEaten(myself)) { // reward on the turn eaten
    let evalEatingMultiplier: number = evalInitialEatingMultiplier
    if (isWrapped) { // wrapped eating is less important, deprioritize food when I am already larger
      if (delta > 3) { // if I am 4 or more greater
        evalEatingMultiplier = 1 
      } else if (delta > 2) { // if I am 3 greater
        evalEatingMultiplier = 2
      } else if (delta > 1) { // if I am 2 greater
        evalEatingMultiplier = 3
      }
    } else {
      if (delta > 8) { // if already larger, prioritize eating immediately less
        evalEatingMultiplier = 1
      } else if (delta > 5) {
        evalEatingMultiplier = 1.75
      } else if (delta > 3) {
        evalEatingMultiplier = 2.5
      }
    }
    if (isHealingPools && gameState.board.hazards.length === 0) { // prioritize eating more when starving if healing pools are gone
      if (myself.health < 20) {
        evalEatingMultiplier = evalEatingMultiplier + 1.75
      } else if (myself.health < 30) {
        evalEatingMultiplier = evalEatingMultiplier + 1.25
      } else if (myself.health < 40) {
        evalEatingMultiplier = evalEatingMultiplier + .75
      }
    } else { // prioritize eating more when starving if hazard damage is close to killing me
      if (hazardDamage > myself.health) {
        evalEatingMultiplier = evalEatingMultiplier + 1.25
      } else if ((hazardDamage * 2) > myself.health) {
        evalEatingMultiplier = evalEatingMultiplier + .75
      }
    }
    if (isOriginalSnake) {
      evaluationResult.foodEaten = evalEatingMultiplier
    } else {
      evaluationResult.foodEaten = evalEatingMultiplier * 9 // eatTurns will be at most 1. otherSnakes need an extra bump towards food
    }
  }

  if (wantToEat) { // only add food calc if snake wants to eat
    let j = foodSearchDepth + 1 // because we start at depth 0 for food just eaten, j needs to be 1 higher so at foodSearchDepth we're not multiplying by 0
    let foodCalc : number = 0
    for (let i: number = 0; i <= foodSearchDepth; i++) {
      foodToHunt = nearbyFood[i]
      if (foodToHunt && foodToHunt.length > 0) {
        // for each piece of found found at this depth, add some score. Score is higher if the depth i is lower, since j will be higher when i is lower
  
        let foodToHuntLength: number = foodToHunt.length
        for(const fud of foodToHunt) {
          let foodCell = board2d.getCell(fud.x, fud.y)
          if (foodCell && foodCell.hazard && hazardDamage > 0) {
            foodToHuntLength = foodToHuntLength - 0.4 // hazard food is worth 0.6 that of normal food
          }
        }
        let foodCalcStep = 0
        if (haveWon) { // if I have already won, give max food score - as if I was as close as possible to all food at once
          foodCalcStep = evalFoodVal * (foodSearchDepth + 1) * foodToHuntLength
        } else {
          foodCalcStep = evalFoodVal * j * foodToHuntLength
        }
        //buildLogString(`found ${foodToHunt.length} food at depth ${i}, adding ${foodCalcStep}`)
        foodCalc = foodCalc + foodCalcStep
      }

      j = j - 1
    }

    // if snake has eaten recently, add that food back when calculating food score so as not to penalize it for eating that food
    if (safeToEat) {
      foodCalc += eatTurns * evalFoodVal * (foodSearchDepth + 1) // add food scores at max depth for each food eaten. Note this food cannot be treated as hazard food
    }

    evaluationResult.food = foodCalc
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
  } else if (isWrapped) { // give tiny reward to self for chasing tail exactly, which prevents food from spawning & preventing us from being able to do so
    let tailDist = getDistance(myself.body[myself.body.length - 1], myself.head, gameState)
    if (tailDist === 1) {
      evaluationResult.tailChase = 1
    }
  }

  if (isWrapped && !isConstrictor) { // metric is useful outside of duel but minimax is smarter than it in duel 
    if (haveWon) { // don't penalize snake for winning
      evaluationResult.flipFlop = evalWrappedFlipFlopStep
    } else if (originalTurn > 1) { // ignore this on early turns, just get starting food
      let myselfIsFlip: boolean = isFlip(myself.head)
      let flipOtherSnakes: number = 0
      let flopOtherSnakes: number = 0
      if (delta > 0) { // if I am the largest snake, I want to position myself in the same cell type as the other snakes so that I can kiss them to death
        for (const snake of otherSnakes) {
          if (isFlip(snake.head)) {
            flipOtherSnakes = flipOtherSnakes + 1
          } else {
            flopOtherSnakes = flopOtherSnakes + 1
          }
        }
        if (myselfIsFlip) { // am flip, reward snake for number of smaller flipOtherSnakes in game
          evaluationResult.flipFlop = flipOtherSnakes * evalWrappedFlipFlopStep
        } else { // am flop, reward snake for number of smaller flopOtherSnakes in game
          evaluationResult.flipFlop = flopOtherSnakes * evalWrappedFlipFlopStep
        }
      } else { // if I am not the largest snake, I want to position myself in a different cell type as the other larger/equivalent snakes
        for (const snake of otherSnakes) {
          if (myself && snake.length >= myself.length) {
            if (isFlip(snake.head)) {
              flipOtherSnakes = flipOtherSnakes + 1
            } else {
              flopOtherSnakes = flopOtherSnakes + 1
            }
          }
        }
        if (myselfIsFlip) { // am flip, penalize snake for number of larger flipOtherSnakes in game
          evaluationResult.flipFlop = -flipOtherSnakes * evalWrappedFlipFlopStep
        } else { // am flop, penalize snake for number of larger flopOtherSnakes in game
          evaluationResult.flipFlop = -flopOtherSnakes * evalWrappedFlipFlopStep
        }
      }
    }
  }

  if (isConstrictor) {
    let centers = calculateCenterWithHazard(gameState, hazardWalls)
    const xDiff = Math.abs(myself.head.x - centers.centerX)
    const yDiff = Math.abs(myself.head.y - centers.centerY)

    evaluationResult.center = xDiff * evalSoloCenter + yDiff * evalSoloCenter
  }

  return evaluationResult
}

export function evaluateMinimax(gameState: GameState, eatTurns: number, startingHealthTier: number, _priorKissStates?: KissStatesForEvaluate) : EvaluationResult {
  const isWrapped = gameStateIsWrapped(gameState)
  
  let priorKissStates: KissStatesForEvaluate
  if (_priorKissStates) {
    priorKissStates = _priorKissStates 
  } else {
    priorKissStates = new KissStatesForEvaluate(KissOfDeathState.kissOfDeathNo, KissOfMurderState.kissOfMurderNo, undefined, undefined)
  }
  
  const evalPriorKissOfDeathCertaintyMutual: number = 0 // we don't want to penalize snake for moving here if it's the best tile
  const evalPriorKissOfDeathMaybe = -400 // this cell is a 50/50
  const evalPriorKissOfDeathMaybeMutual: number = 0 // we don't want to penalize snake for moving here if it's the best tile
  
  const evalPriorKissOfDeath3To1Avoidance = 0
  const evalPriorKissOfDeath3To2Avoidance = evalPriorKissOfDeath3To1Avoidance
  const evalPriorKissOfDeath2To1Avoidance = evalPriorKissOfDeath3To1Avoidance
  const evalPriorKissOfDeathNo = 0

  const evalPriorKissOfMurderCertainty = 80 // this state is strongly likely to have killed a snake
  const evalPriorKissOfMurderMaybe = 40 // this state had a 50/50 chance of having killed a snake
  const evalPriorKissOfMurderAvoidance: number = 15 // this state may have killed a snake, but they did have an escape route (3to2, 3to1, or 2to1 avoidance).
  let evalPriorKissOfMurderFaceoff = 75 // this state had an unlikely chance of having killed a snake, but it means we closed the distance on a faceoff, which is great
  if (!isWrapped && priorKissStates.prey !== undefined) { // cannot cutoff in a wrapped game
    let preyHead = priorKissStates.prey.head
    let preyIsOnWall: boolean = isOnHorizontalWall(gameState.board, preyHead) || isOnVerticalWall(gameState.board, preyHead)
    if (preyIsOnWall) {
      evalPriorKissOfMurderFaceoff = evalPriorKissOfMurderFaceoff + 75 // this is actually a cutoff!
    }
  }

  const evalKissOfDeathNo = 0
  const evalKissOfDeathCertaintyMutual: number = 0 // we don't want to penalize snake for moving here if it's the best tile
  const evalKissOfDeathMaybe: number = -200 // a 50/50 on whether we will be kissed to death next turn
  const evalKissOfDeathMaybeMutual: number = 0 // we don't want to penalize snake for moving here if it's the best tile

  const evalKissOfMurderCertainty = 50 // we can kill a snake, this is probably a good thing
  const evalKissOfMurderMaybe = 25 // we can kill a snake, but it's a 50/50
  const evalKissOfMurderFaceoff = 35 // we can kill a snake, they have an escape route, but we can easily give chase
  const evalKissOfMurderAvoidance = 10 // we can kill a snake, but they have an escape route (3to2, 3to1, or 2to1 avoidance)
  
  // returns the evaluation value associated with the given kissOfDeathState
  function getPriorKissOfDeathValue(kissOfDeathState: KissOfDeathState, evalNoMeEvaluationResult: EvaluationResult): number {
    let voronoiSelf: number = evalNoMeEvaluationResult.voronoiSelf // use to give back a priorKissOfDeath value that is relative to an evalNoMe minimum Voronoi score
    switch (kissOfDeathState) {
      case KissOfDeathState.kissOfDeathCertainty:
        if (voronoiSelf < 0) {
          return voronoiSelf * (9/10) // almost full penalty for walking into a certain death
        } else {
          return _evalPriorKissOfDeathCertainty
        }
      case KissOfDeathState.kissOfDeathCertaintyMutual:
        return evalPriorKissOfDeathCertaintyMutual
      case KissOfDeathState.kissOfDeathMaybe:
        if (voronoiSelf < 0) {
          return voronoiSelf * (5/10) // half penalty for walking into a maybe death
        } else {
          return evalPriorKissOfDeathMaybe
        }
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

  let myself: Battlesnake | undefined
  let otherSnake: Battlesnake | undefined
  for (const snake of gameState.board.snakes) {
    if (snake.id === gameState.you.id) { // if snake ID matches gameState.you.id, this is the original snake
      myself = snake
    } else {
      otherSnake = snake
    }
  }
  
  const hazardDamage: number = getHazardDamage(gameState)
  const hazardFrequency: number = gameState.game.ruleset.settings.royale.shrinkEveryNTurns || 0
  const isConstrictor = gameStateIsConstrictor(gameState)
  const isHealingPools: boolean = gameStateIsHealingPools(gameState)
  const isIslandsBridges: boolean = gameStateIsIslandsBridges(gameState)

  const haveWon: boolean = (myself !== undefined) && gameState.board.snakes.length === 1
  const thisGameData = gameData? gameData[createGameDataId(gameState)] : undefined

  let evalNoMeEvaluationResult: EvaluationResult
  let evalNoMe: number
  if (thisGameData && thisGameData.evalNoMe !== undefined && thisGameData.evalNoMeEvaluationResult !== undefined) {
    evalNoMeEvaluationResult = thisGameData.evalNoMeEvaluationResult
    evalNoMe = thisGameData.evalNoMe
  } else {
    evalNoMeEvaluationResult = getDefaultEvalNoMe(gameState)
    evalNoMe = evalNoMeEvaluationResult.sum()
  }

  let evalHealthStep: number = hazardDamage > 0 ? evalHealthStepHazard : evalHealthStepNoHazard

  const hazardWalls: HazardWalls = thisGameData !== undefined? thisGameData.hazardWalls : new HazardWalls()
  const originalTurn: number = thisGameData !== undefined? thisGameData.startingGameState.turn : gameState.turn

  let evaluationResult: EvaluationResult = new EvaluationResult(gameState.you)

  let evalLengthMult: number = 10 // larger values result in more food prioritization. Negative preference towards length in solo
  let evalLengthMaxDelta: number = 6 // largest size difference that evaluation continues rewarding

  let evalFoodVal = 3
  let foodSearchDepth: number
  if (isConstrictor) {
    foodSearchDepth = 0
  } else if (originalTurn <= 1) {
    foodSearchDepth = 2 // for turns 0 & 1, only want to consider starting food right next to us
  } else {
    foodSearchDepth = calculateFoodSearchDepth(gameState, gameState.you)
  }

  if (gameState.board.snakes.length === 0) { // I have tied
    return determineEvalNoSnakes(gameState, gameState.you, priorKissStates.predator, eatTurns) // if no snakes are left, I am dead, but so are the others. It's better than just me being dead, at least
  } else if (myself === undefined) { // I have lost
    if (gameState.you.health <= 0) { // if I starved, return evalNoMe, this is certain death
      evaluationResult.noMe = evalNoMe
      return evaluationResult
    } else if (priorKissStates.deathState !== KissOfDeathState.kissOfDeathNo) { // fudge an evaluation result based on possible death
      evaluationResult.base = evalBase
      const evalNoMeCertainty: number = 200 // value that being murdered is better than starving. Still highly likely, but slightly less likely than straight starvation
      const evalNoMeCertaintyMutual: number = 300 // value that being murdered by a tie snake is better than starving. Needs to be more than evalNoMeCertainty
      if ([KissOfDeathState.kissOfDeathCertainty, KissOfDeathState.kissOfDeathCertaintyMutual].includes(priorKissStates.deathState)) {
        if (priorKissStates.deathState === KissOfDeathState.kissOfDeathCertainty) {
          evaluationResult.noMe = evalNoMe + evalNoMeCertainty
        } else {
          evaluationResult.noMe = evalNoMe + evalNoMeCertaintyMutual // should never reach here, will reach the above if with 0 snakes
        }
        return evaluationResult // I am dead here if another snake chooses to kill me, but it's not a 100% sure thing
      } else {
        evaluationResult.priorKissOfDeath = getPriorKissOfDeathValue(priorKissStates.deathState, evalNoMeEvaluationResult)
        if (otherSnake !== undefined) {
          let otherSnakeHealthPenalty: number = determineOtherSnakeHealthEvalDuel(otherSnake)
          evaluationResult.otherSnakeHealth = otherSnakeHealthPenalty
        }
        evaluationResult.delta = determineDeltaScore(-evalLengthMaxDelta, evalLengthMult, evalLengthMaxDelta) // give max delta to account for possible eats
        evaluationResult.health = determineHealthEval(gameState, gameState.you.health, hazardDamage, evalHealthStep, evalHealthTierDifference, evalHealthBase, evalHealthStarvationPenalty, haveWon).score
        if (thisGameData) { // penalize snake for being in this state less if it had been starving
          let startingHealth: number = thisGameData.startingGameState.you.health
          let startingHealthTier: HealthTier = determineHealthEval(gameState, startingHealth, hazardDamage, evalHealthStep, evalHealthTierDifference, evalHealthBase, evalHealthStarvationPenalty, haveWon)

          if (startingHealthTier.tier < 2) {
            if (eatTurns > 0) {
              evaluationResult.food = evalFoodVal * (foodSearchDepth + 1) // if I had been starving, reward for eating a single food to encourage eating when totally necessary
            }
            evaluationResult.priorKissOfDeath = evaluationResult.priorKissOfDeath / 3
          } else if (startingHealthTier.tier < 3) {
            evaluationResult.priorKissOfDeath = evaluationResult.priorKissOfDeath * (2/3)
          }
        }
        return evaluationResult // Return the kissofDeath value that got me here (if applicable). This represents an uncertain death - though bad, it's not as bad as, say, starvation, which is a certainty.
      }
    } else { // other deaths, such as death by snake body, are also a certainty
      evaluationResult.noMe = evalNoMe
      return evaluationResult
    }
  }

  let evalHazardWallPenalty: number = 0 // no penalty for most turns - we know exactly when they're gonna show up
  if (hazardDamage > 0 && !isWrapped) {
    if (gameState.turn % hazardFrequency === 0) { // turn 25, & increments of 25
      evalHazardWallPenalty = -50
    } else if (((gameState.turn + 1) % hazardFrequency) === 0) { // turn 24, & increments of 25
      evalHazardWallPenalty = -25
    } else if (((gameState.turn + 1) % hazardFrequency) > (hazardFrequency - 4)) {// turns 21, 22, 23, & increments of 25
      evalHazardWallPenalty = -10
    } else {
      if (gameState.turn > originalTurn) { // if this is a lookahead turn, try to account for possibility that hazard has now spawned
        let turnsLookingAhead: number = gameState.turn - originalTurn // we are looking ahead this many turns
        let lastHazardSpawnTurn: number = gameState.turn % hazardFrequency // last hazard spawned this many turns ago
        if (turnsLookingAhead > lastHazardSpawnTurn) { // if I am looking ahead farther than lastHazardSpawnTurn, hazard has spawned that I do not know about, want to heavily penalize plans involving unknown hazard
          evalHazardWallPenalty = -50
        }
      }
    }
  }
  let evalHazardPenalty: number = -(hazardDamage + 5) // in addition to health considerations & hazard wall calqs, make it slightly worse in general to hang around inside of the sauce

  evaluationResult.base = evalBase // important to do this after the instant-returns above because we don't want the base included in those values
  let board2d: Board2d
  let calculateVoronoi: boolean
  if (haveWon) {
    board2d = new Board2d(gameState) // don't build the full graph in this case, just build the cheap one & fudge the VoronoiResults
    calculateVoronoi = false
  } else if (isConstrictor) { // constrictor games aren't expensive to compute on any turn, & early turns are very important
    board2d = new Board2d(gameState, true) // important to do this after the instant-returns above because it's expensive
    calculateVoronoi = true
  } else if (originalTurn <= 1) {
    board2d = new Board2d(gameState) // don't build the full graph in this case, just build the cheap one & fudge the VoronoiResults
    calculateVoronoi = false
  } else {
    board2d = new Board2d(gameState, true) // important to do this after the instant-returns above because it's expensive
    calculateVoronoi = true
  }

  // penalize spaces that ARE hazard
  let myCell = board2d.getCell(myself.head.x, myself.head.y)
  if (myCell !== undefined && myCell.hazard > 0 && hazardDamage > 0) {
    evaluationResult.hazard = evalHazardPenalty * myCell.hazard // penalty is multiplied for how many stacks of hazard live here
  }

  if (isAdjacentToHazard(myself.head, hazardWalls, gameState)) {
    evaluationResult.hazardWall = evalHazardWallPenalty
  }

  if (otherSnake && !isIslandsBridges) { // don't bother penalizing otherSnake health in islands bridges - good luck starving them out anyhow
    let otherSnakeHealthPenalty: number = determineOtherSnakeHealthEvalDuel(otherSnake)
    evaluationResult.otherSnakeHealth = otherSnakeHealthPenalty
  }

  let moves: Moves = getAvailableMoves(gameState, myself, board2d)

  // look for kiss of death & murder cells in this current configuration
  let moveNeighbors = findMoveNeighbors(gameState, myself, board2d, moves)
  let kissOfMurderMoves = findKissMurderMoves(moveNeighbors)
  let kissOfDeathMoves = findKissDeathMoves(moveNeighbors)

  let kissStates = kissDecider(gameState, myself, moveNeighbors, kissOfDeathMoves, kissOfMurderMoves, moves, board2d)

  if (kissStates.canAvoidPossibleDeath(moves)) { // death is avoidable for at least one possible move
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
  
  let priorKissOfDeathValue = getPriorKissOfDeathValue(priorKissStates.deathState, evalNoMeEvaluationResult)
  evaluationResult.priorKissOfDeath = priorKissOfDeathValue

  let priorKissOfMurderValue = getPriorKissOfMurderValue(priorKissStates.murderState)
  evaluationResult.priorKissOfMurder = priorKissOfMurderValue

  let voronoiResults: VoronoiResults
  if (!calculateVoronoi) { // don't want to build Voronoi graph here, so fudge the VoronoiResults object
    voronoiResults = new VoronoiResults()
    voronoiResults.snakeResults[myself.id] = new VoronoiResultsSnake()
    if (hazardDamage > 0) {
      voronoiResults.snakeResults[myself.id].effectiveHealths = [new EffectiveHealthData(myself.health / 2, 1)] // for health ratio, average health will just be my health over 2
    }
    voronoiResults.snakeResults[myself.id].food = findFood(foodSearchDepth, gameState.board.food, myself.head, gameState) // food finder that doesn't use Voronoi graph
    const hazardValue: number = determineVoronoiHazardValue(gameState, board2d.numHazards)
    const totalReachableCells: number = (gameState.board.height * gameState.board.width - board2d.numHazards) + board2d.numHazards * hazardValue
    voronoiResults.totalReachableCells = totalReachableCells
    voronoiResults.snakeResults[myself.id].reachableCells = totalReachableCells
  } else {
    voronoiResults = calculateReachableCells(gameState, board2d)
  }
  let voronoiResultsSelf: VoronoiResultsSnake = voronoiResults.snakeResults[myself.id]
  let nearbyFood: {[key: number]: Coord[]} = voronoiResultsSelf.food
  let foodToHunt : Coord[] = []

  let selfPossibleLength: number = myself.length // not sure if I want to do this, or just consider myself.length
  let longestSnakePossibleLength: number = 0
  if (myself) {
    if (calculateVoronoi) {
      const totalPossibleEatsKeys: string[] = Object.keys(voronoiResults.snakeResults[myself.id].food)
      selfPossibleLength = selfPossibleLength + totalPossibleEatsKeys.length
    }
  }
  if (otherSnake) {
    if (calculateVoronoi) {
      const totalPossibleEatsKeys: string[] = Object.keys(voronoiResults.snakeResults[otherSnake.id].food)
      longestSnakePossibleLength = otherSnake.length + totalPossibleEatsKeys.length
    } else { // no Voronoi data, just use otherSnake length
      longestSnakePossibleLength = otherSnake.length
    }
    
  }
  let delta: number = selfPossibleLength - longestSnakePossibleLength // snake delta is based on possible lengths, not current lengths

  if (isConstrictor) {
    evalFoodVal = 0
  } else {
    if (haveWon) { // set food val to max so as not to penalize winning states
      evalFoodVal = 4
    } else if (originalTurn <= 1) {
      evalFoodVal = 50 // simply, should always want to get the starting food
    } else if (delta < -4) { // care a bit less about food due to already being substantially smaller
      evalFoodVal = 2
    } else if (delta < 1) { // care a bit more about food to try to regain the length advantage
      evalFoodVal = evalFoodVal < 4? 4 : evalFoodVal
    } else if (delta > 6) { // If I am more than 6 bigger, want food less
      if (isIslandsBridges) {
        evalFoodVal = 0
      } else {
        evalFoodVal = 2
      }
    }
  }

  if (!isConstrictor) { // constrictor snake length is irrelevant
    evaluationResult.delta = determineDeltaScore(delta, evalLengthMult, evalLengthMaxDelta)
  }

  let selfAverageHealth: number = voronoiResultsSelf? voronoiResultsSelf.getAverageHealth() : myself.health
  let healthTier: HealthTier | undefined = undefined
  // health considerations, which are effectively hazard considerations
  if (!isConstrictor) {
    healthTier = determineHealthEval(gameState, selfAverageHealth, hazardDamage, evalHealthStep, evalHealthTierDifference, evalHealthBase, evalHealthStarvationPenalty, haveWon)
    evaluationResult.health = healthTier.score
  }

  // Voronoi stuff
  if (isConstrictor || originalTurn > 1) { // don't calculate on early turns, just get early food
    let useTailChase: boolean = true
    let useTailOffset: boolean = false

    // function which returns a Voronoi score based on how 'good' or 'bad' voronoiSelf is, adjusted for health scores in wrapped games
    function getVoronoiSelfAdjusted(incomingValue: number) : number {
      // this function is only called when incomingValue is <= 0, so voronoiSelf is always 0 or negative, voronoiSelf becomes a penalty
      return incomingValue * evalVoronoiNegativeStepDuel
    }

    let voronoiSelf: number
    let voronoiDeltaStep = isConstrictor? evalVoronoiDeltaStepConstrictor : evalVoronoiDeltaStepDuel
    let voronoiScore: number | undefined = undefined
    let voronoiBaseGood = determineVoronoiBaseGood(gameState, voronoiResults, 2)
    if (haveWon) {
      voronoiSelf = voronoiResults.totalReachableCells // in the event of winning, consider voronoiSelf to be the max, regardless of the truth.
      evaluationResult.voronoiSelf = voronoiSelf * voronoiDeltaStep
      evaluationResult.voronoiPredator = voronoiBaseGood * -evalVoronoiPreyStepDuel
    } else if (otherSnake) { // only use delta, with tail chase & tail offset taken into account. otherSnake should always be defined here, else haveWon would have been true
      let voronoiResultsOtherSnake: VoronoiResultsSnake = voronoiResults.snakeResults[otherSnake.id]
      if (voronoiResultsSelf.reachableCells > voronoiResultsOtherSnake.reachableCells) {
        voronoiSelf = determineVoronoiSelf(myself, voronoiResultsSelf, false, useTailOffset)
      } else {
        voronoiSelf = determineVoronoiSelf(myself, voronoiResultsSelf, useTailChase, useTailOffset)
      }
      let otherSnakeVoronoi: number
      if (voronoiResultsSelf.reachableCells < voronoiResultsOtherSnake.reachableCells) { // don't penalize otherSnake for chasing my tail if I am likely to die because of it
        otherSnakeVoronoi = determineVoronoiSelf(otherSnake, voronoiResultsOtherSnake, false, useTailOffset)
      } else {
        otherSnakeVoronoi = determineVoronoiSelf(otherSnake, voronoiResultsOtherSnake, useTailChase, useTailOffset)
      }
      let voronoiDelta: number = (voronoiSelf - otherSnakeVoronoi) * voronoiDeltaStep // consider Voronoi delta after adjusting for tail & body chases
      if (voronoiDelta < 0 && !isConstrictor) { // if delta is bad, consider both how bad the delta is, & how bad the overall score is.
        // A score of 18<->5 is much worse than a score of 60<->30, but pure delta will prioritize the former
        let voronoiSelfMinusBaseGood: number = voronoiSelf - voronoiBaseGood
        if (voronoiSelfMinusBaseGood < 0) { // if voronoiSelf is worse than an arbitrary base 'good' score
          let voronoiSelfAdjusted: number = getVoronoiSelfAdjusted(voronoiSelfMinusBaseGood)
          voronoiScore = Math.min(voronoiSelfAdjusted, voronoiDelta)
        }
      } else if (voronoiDelta > 0 && !isConstrictor) { // if delta is good, & otherSnake Voronoi is bad, give extra reward for pinning it down
        // A score of 18<->14 is worse than a score of 6<->4, by virtue of winning sooner & limiting otherSnakes' ability to come back
        let otherSnakeVoronoiMinusBaseGood: number = otherSnakeVoronoi - voronoiBaseGood
        if (otherSnakeVoronoiMinusBaseGood < 0) { // if otherSnakeVoronoi is worse than a base 'good' score, give additional predator reward
          voronoiScore = voronoiDelta
          evaluationResult.voronoiPredator = otherSnakeVoronoiMinusBaseGood * evalVoronoiPreyStepDuel // small additional award for each level of bad otherSnake is in
        }
      }
      if (voronoiScore === undefined) { // either voronoiDelta was not < 0, or voronoiSelf was not worse than voronoiBaseGood
        voronoiScore = voronoiDelta
      }
      
      evaluationResult.voronoiSelf = voronoiScore
    }
  }

  if (!isConstrictor && (evalFoodVal > 0)) { // only add food calc if snake wants to eat
    let j = foodSearchDepth + 1 // because we start at depth 0 for food just eaten, j needs to be 1 higher so at foodSearchDepth we're not multiplying by 0
    let foodCalc : number = 0
    for (let i: number = 0; i <= foodSearchDepth; i++) {
      foodToHunt = nearbyFood[i]
      if (foodToHunt && foodToHunt.length > 0) {
        // for each piece of found found at this depth, add some score. Score is higher if the depth i is lower, since j will be higher when i is lower
  
        let foodToHuntLength: number = foodToHunt.length
        for(const fud of foodToHunt) {
          let foodCell = board2d.getCell(fud.x, fud.y)
          if (foodCell && foodCell.hazard && hazardDamage > 0) {
            foodToHuntLength = foodToHuntLength - 0.4 // hazard food is worth 0.6 that of normal food
          }
        }
        let foodCalcStep = 0
        if (haveWon) { // if I have already won, give max food score - as if I was as close as possible to all food at once
          foodCalcStep = evalFoodVal * (foodSearchDepth + 1) * foodToHuntLength
        } else {
          foodCalcStep = evalFoodVal * j * foodToHuntLength
        }
        //buildLogString(`found ${foodToHunt.length} food at depth ${i}, adding ${foodCalcStep}`)
        foodCalc = foodCalc + foodCalcStep
      }

      j = j - 1
    }

    // if snake has eaten recently, add that food back when calculating food score so as not to penalize it for eating that food
    foodCalc += eatTurns * evalFoodVal * (foodSearchDepth + 1) // add food scores at max depth for each food eaten. Note this food cannot be treated as hazard food

    evaluationResult.food = foodCalc
  }

  // reduce Voronoi, kiss of death penalties if starving & in need of taking a risk to seek food or board control
  if (startingHealthTier < 2) {
    evaluationResult.kissOfDeath = evaluationResult.kissOfDeath / 3
    evaluationResult.voronoiSelf = evaluationResult.voronoiSelf / 3
  } else if (startingHealthTier < 3) {
    evaluationResult.kissOfDeath = evaluationResult.kissOfDeath * (2/3)
    evaluationResult.voronoiSelf = evaluationResult.voronoiSelf * (2/3)
  }

  let foodCutoffTier: number // below this health tier, will not penalize for seeking food in bad Voronoi states
  if (isHealingPools) {
    foodCutoffTier = 4
  } else {
    foodCutoffTier = 2
  }
  if (evaluationResult.food > 0 && evaluationResult.voronoiSelf < 0 && startingHealthTier >= foodCutoffTier) { // try to penalize duel snake that wanted to eat with somewhat poor Voronoi score
    let foodMult: number = getFoodModifier(evaluationResult.voronoiSelf)
    evaluationResult.food = evaluationResult.food * foodMult
    evaluationResult.foodEaten = evaluationResult.foodEaten * foodMult
  }

  if (isWrapped) { // give tiny reward to self for chasing tail exactly, which prevents food from spawning & preventing us from being able to do so
    let tailDist = getDistance(myself.body[myself.body.length - 1], myself.head, gameState)
    if (tailDist === 1) {
      evaluationResult.tailChase = 1
    }
  }

  return evaluationResult
}

// functions which rely on gameData, thus ruin our ability to cache. Separate them so they can be added after cache lookups

export function evaluateTailChasePenalty(tailChaseTurns: number[], originalTurn: number): number {
  let tailChasePenalty: number = 0
  let turnsIntoLookahead: number
  for (const turn of tailChaseTurns) {
    turnsIntoLookahead = turn -(originalTurn + 1) // ex: original 30, turn 34: 34 - (30 + 1) = 3

    if (turnsIntoLookahead > 2) { // don't penalize snake for tail chasing at depths 0, 1, or 2. 0 is impossible to hurt us, 1 is impossible out of wrapped, & 2 is unlikely
      tailChasePenalty = tailChasePenalty + ((turnsIntoLookahead - 2) * -10) // higher penalty for deeper depths at which we relied on a tail chase
    }
  }
  return tailChasePenalty
}

export function evaluateWinValue(myself: Battlesnake, gameState: GameState, lookahead: number, originalTurn: number): number {
  if (gameState.board.snakes.length === 0) {
    return 0
  }
  const lookaheadDepth: number = gameState.turn - 1 - originalTurn // lookahead begins 2 turns after originalTurn - first turn is 0 lookahead. Note this will be negative for originalTurn
  const turnsOfLookaheadLeft: number = lookahead - lookaheadDepth // how many turns into lookahead we are. Used by minimax to reward winning earlier
  let haveWon: boolean = true
  let haveLost: boolean = true
  for (const snake of gameState.board.snakes) {
    if (snake.id === myself.id) {
      haveLost = false // have not lost if I am still in the game
    } else {
      haveWon = false // have not won if any other snakes are still in the game
    }
  }
  if (haveWon) {
    return turnsOfLookaheadLeft * evalHaveWonTurnStep
  } else if (haveLost) {
    return -turnsOfLookaheadLeft * evalHaveWonTurnStep
  } else {
    return 0
  }
}