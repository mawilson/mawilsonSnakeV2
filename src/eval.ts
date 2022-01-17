import { GameState } from "./types"
import { Direction, Battlesnake, Board2d, Moves, MoveNeighbors, Coord, SnakeCell, BoardCell, KissOfDeathState, KissOfMurderState, HazardWalls, KissStatesForEvaluate } from "./classes"
import { createWriteStream } from "fs"
import { checkForSnakesHealthAndWalls, logToFile, getSurroundingCells, findMoveNeighbors, findKissDeathMoves, findKissMurderMoves, calculateFoodSearchDepth, isKingOfTheSnakes, findFood, getLongestSnake, getDistance, snakeLengthDelta, snakeToString, snakeHasEaten, getSafeCells, kissDecider, getSnakeDirection, isCutoff, isHazardCutoff, isAdjacentToHazard, calculateCenterWithHazard, getAvailableMoves, isCorner, isOnHorizontalWall, isOnVerticalWall, cloneGameState, isSandwich, isFaceoff, createGameDataId, getNeckDirection } from "./util"
import { gameData, isDevelopment } from "./logic"

let evalWriteStream = createWriteStream("consoleLogs_eval.txt", {
  encoding: "utf8"
})

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
export function determineEvalNoSnakes(gameState: GameState, myself: Battlesnake): number {
  let defaultEvalNoSnakes: number =  460 // the value I had evalNoSnakes at when I wrote this function. A generic 'good' eval state
  if (gameState.board.snakes.length !== 0 && gameState.board.snakes.length !== 2) { // if for some reason we were given a gameState that has neither 2 nor 0 snakes in it, return default value
    return defaultEvalNoSnakes
  }
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
    return defaultEvalNoSnakes
  }

  let leftSnakeBody = []
  let rightSnakeBody = []
  let newSnakeSelf: Battlesnake
  let newSnakeOther: Battlesnake

  switch (newGameState.board.snakes.length) {
    case 0:
      for (let i: number = 0; i < myself.length; i++) {
        leftSnakeBody.push({x: leftSnakeX, y: leftSnakeY})
        rightSnakeBody.push({x: rightSnakeX, y: rightSnakeY})
      }
      newSnakeSelf = new Battlesnake(myself.id, myself.name, myself.health, leftSnakeBody, myself.latency, myself.shout, myself.squad) // create new me, identical other than body
      newSnakeOther = new Battlesnake(myself.id + "_clone", myself.name + "_clone", myself.health, rightSnakeBody, myself.latency, myself.shout, myself.squad) // create clone of me nearby, with different ID & name
      break
    default: // case 2
      let otherSnake: Battlesnake | undefined = newGameState.board.snakes.find(function findSnake(snake) { return snake.id !== myself.id })
      if (otherSnake === undefined) {
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
        for (let j: number = 0; j < otherSnake.length; j++) {
          rightSnakeBody.push({x: rightSnakeX, y: rightSnakeY})
        }
        newSnakeOther = new Battlesnake(otherSnake.id, otherSnake.name, otherSnake.health, rightSnakeBody, otherSnake.latency, otherSnake.shout, otherSnake.squad) // create new otherSnake, identical other than body
      }
      break
  }

  if (newGameState.board.snakes.length === 2) { // want to determine what evalNoSnakes would be were both of these snakes to die at once
    newGameState.board.snakes = [] // first, remove them - will add them back later at 'neutral' positions
  }

  newGameState.board.snakes.push(newSnakeSelf)
  newGameState.board.snakes.push(newSnakeOther)

  let evaluation = evaluate(newGameState, newSnakeSelf, new KissStatesForEvaluate(KissOfDeathState.kissOfDeathNo, KissOfMurderState.kissOfMurderNo))
  evaluation = evaluation - 50 // want to make a tie slightly worse than an average state. Still good, but don't want it overriding other, better states
  return evaluation
}

// the big one. This function evaluates the state of the board & spits out a number indicating how good it is for input snake, higher numbers being better
export function evaluate(gameState: GameState, _myself: Battlesnake | undefined, priorKissStates: KissStatesForEvaluate) : number {
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
  let isOriginalSnake: boolean = myself !== undefined && myself.id === gameState.you.id // true if snake's id matches the original you of the game

  const board2d = new Board2d(gameState.board)
  const hazardDamage = gameState.game.ruleset.settings.hazardDamagePerTurn
  const snakeDelta = myself !== undefined ? snakeLengthDelta(myself, gameState.board) : -1
  const isDuel: boolean = gameState.board.snakes.length === 2
  const isSolo: boolean = gameState.game.ruleset.name === "solo"

  const thisGameData = gameData? gameData[createGameDataId(gameState)] : undefined
  const lookahead: number = thisGameData !== undefined && isOriginalSnake? thisGameData.lookahead : 1 // originalSnake uses gameData lookahead, otherSnakes use 1
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
        evalCenterDistancePenalty = 0 // do not penalize snake for straying from center to pursue a certain kill
        return evalPriorKissOfMurderCertainty
      case KissOfMurderState.kissOfMurderMaybe:
        return evalPriorKissOfMurderMaybe
      case KissOfMurderState.kissOfMurderFaceoff:
        evalHazardPenalty = 0 // do not penalize closing the faceoff for being in hazard
        evalCenterDistancePenalty = 0 // do not penalize snake for straying from center to pursue a faceoff
        return evalPriorKissOfMurderFaceoff
      case KissOfMurderState.kissOfMurderAvoidance:
        return evalPriorKissOfMurderAvoidance
      case KissOfMurderState.kissOfMurderNo:
      default:
        return 0
    }
  }

  // values to tweak
  const evalBase: number = 500
  const evalNoMe: number = -1500 // no me is the worst possible state, give a very bad score
  const evalSnakeCountBase = -200 // base penalty for a single otherSnake left in game
  const evalSnakeCountStep = 30 // reduction in penalty for each snake after the last one. e.g., the 3rd otherSnake penalty is (-200 + 30*3) = -110
  const evalSnakeCountMin = -100 // minimum penalty for a snake to be in game (should at the very least be less than 0)
  const evalSolo: number = 200 // this means we've won. Won't be considered in games that were always solo. Setting to too large a number leads Jaguar to make some wild bets, so only do that if we know exactly what our opponent has done
  const evalWallPenalty: number = isDuel? -10 : -5 //-25
  let evalHazardWallPenalty: number = 0 // no penalty for most turns - we know exactly when they're gonna show up
  if (gameState.turn % 25 === 0) { // turn 25, & increments of 25
    evalHazardWallPenalty = -8
  } else if (((gameState.turn + 1) % 25) === 0) { // turn 24, & increments of 25
    evalHazardWallPenalty = -4
  } else if (((gameState.turn + 1) % 25) > 21) {// turns 21, 22, 23, & increments of 25
    evalHazardWallPenalty = -2
  }
  let evalHazardPenalty: number = -(hazardDamage + 3) // in addition to health considerations & hazard wall calqs, make it slightly worse in general to hang around inside of the sauce
  // TODO: Evaluate removing or neutering the Moves metric & see how it performs
  let evalCenterDistancePenalty: number = isDuel && isOriginalSnake? -3 : -1 // in a duel, more strongly trend me towards middle, but other snakes
  if (isDuel) { // if in a duel, give stronger rewards towards middle for myself, but not other snakes
    if (hazardDamage > 0) { // for games with hazard, it matters a lot to trend away from the edges, in general
      evalCenterDistancePenalty = -4
    } else { // for games without hazard, center matters substantially less
      evalCenterDistancePenalty = -3
    }
  } else {
    if (hazardDamage > 0) { // can't afford to go center as strongly as in a duel, but with hazard, it's still important
      evalCenterDistancePenalty = -3
    } else { // for a non-duel game without hazard, center is almost negligible
      evalCenterDistancePenalty = -1
    }
  }
  const eval0Move = -700
  const eval1Move = 0 // was -50, but I don't think 1 move is actually too bad - I want other considerations to matter between 2 moves & 1
  const eval2Moves = isOriginalSnake? 2 : 20 // want this to be higher than the difference then eval1Move & evalWallPenalty, so that we choose wall & 2 move over no wall & 1 move
  const eval3Moves = isOriginalSnake? 4 : 40
  const eval4Moves = isOriginalSnake? 6 : 60

  const evalOriginalSnake0Move = 200 // for otherSnakes, should evaluate partly based on originalSnake's position
  const evalOriginalSnake1Move = 0
  const evalOriginalSnake2Move = 0
  const evalOriginalSnake3Move = 0
  
  const evalHealthBase = 75 // evalHealth tiers should differ in severity based on how hungry I am
  const evalHealthStep = 3
  const evalHealthTierDifference = 10
  const evalHealthEnemyThreshold = hazardDamage > 0? 50 : 10 // health level at which we start starving out a snake in a duel
  const evalHealthEnemyReward = 50

  const evalHasEatenBonus = 50
  let evalHasEaten = isSolo? -20 : (evalHealthBase + evalHasEatenBonus) // should be at least evalHealth7, plus some number for better-ness. Otherwise will prefer to be almost full to full. Also needs to be high enough to overcome food nearby score for the recently eaten food
  const evalLengthMult = 5 // larger values result in more food prioritization

  const evalPriorKissOfDeathCertainty = -800 // everywhere seemed like certain death
  const evalPriorKissOfDeathCertaintyMutual = 0 // in a duel, this is a tie, consider it neutrally. In a non-duel, the otherSnake won't want to do this, so also neutral
  const evalPriorKissOfDeathMaybe = -400 // this cell is a 50/50
  const evalPriorKissOfDeathMaybeMutual = 0 // in a duel, this is a tie, consider it neutrally. In a non-duel, the otherSnake won't want to do this, so also neutral
  const evalPriorKissOfDeath3To1Avoidance = isOriginalSnake? 20 : 0 // for baitsnake purposes, we love originalSnake moving towards predators, then away
  const evalPriorKissOfDeath3To2Avoidance = evalPriorKissOfDeath3To1Avoidance
  const evalPriorKissOfDeath2To1Avoidance = evalPriorKissOfDeath3To1Avoidance
  const evalPriorKissOfDeathNo = 0

  const evalPriorKissOfMurderCertainty = 80 // this state is strongly likely to have killed a snake
  const evalPriorKissOfMurderMaybe = 40 // this state had a 50/50 chance of having killed a snake
  const evalPriorKissOfMurderFaceoff = 75 // this state had an unlikely chance of having killed a snake, but it means we closed the distance on a faceoff, which is great
  let evalPriorKissOfMurderAvoidance = isOriginalSnake? 0 : 15 // this state may have killed a snake, but they did have an escape route (3to2, 3to1, or 2to1 avoidance). For myself, do not prioritize this, as this is prone to being baited.
  const evalPriorKissOfMurderSelfBonus = 80 // the bonus we give to otherSnakes for attempting to kill me. Need to assume they will try in general or we'll take unnecessary risks

  const evalKissOfDeathCertainty = -400 // everywhere seems like certain death
  const evalKissOfDeathCertaintyMutual = 0 // in a duel, this is a tie, consider it neutrally. In a non-duel, the otherSnake won't want to do this, so also neutral
  const evalKissOfDeathMaybe = -200 // a 50/50 on whether we will be kissed to death next turn
  const evalKissOfDeathMaybeMutual = 0 // in a duel, this is a tie, consider it neutrally. In a non-duel, the otherSnake won't want to do this, so also neutral
  const evalKissOfDeathAvoidance = isOriginalSnake? 10 : 0 // for baitSnake purposes, we love originalSnake moving towards predators, then away

  const evalKissOfDeathNo = 0
  const evalKissOfMurderCertainty = 50 // we can kill a snake, this is probably a good thing
  const evalKissOfMurderMaybe = 25 // we can kill a snake, but it's a 50/50
  const evalKissOfMurderFaceoff = 35 // we can kill a snake, they have an escape route, but we can easily give chase
  const evalKissOfMurderAvoidance = 10 // we can kill a snake, but they have an escape route (3to2, 3to1, or 2to1 avoidance)
  const evalKissOfMurderSelfBonus = 30 // bonus given to otherSnakes for attempting to get close enough to kill me
  let evalFoodVal = 2

  if (isDuel && otherSnakes[0].health < evalHealthEnemyThreshold) { // care a bit more about food to try to starve the other snake out
    evalFoodVal = 3
  } else if (isDuel && snakeDelta < -4) { // care a bit less about food due to already being substantially smaller
    evalFoodVal = 1
  } else if (isDuel && snakeDelta < 1) { // care a bit more about food to try to regain the length advantage
    evalFoodVal = 3
  }
  const evalFoodStep = 1
  const evalKingSnakeStep = -2 // negative means that higher distances from king snake will result in lower score
  const evalHazardSnakeSeekerStep = -3 // negative means that higher distances from hazard snake will result in lower score
  
  let evalCutoffReward = isDuel? 100 : 35 // reward for getting a snake into a cutoff situation. Very strong in duel as it should lead directly to a win
  let evalCutoffHazardReward = isDuel? 75 : 25 // reward for getting a snake into a hazard cutoff situation. Stronger in duel.
  let evalSandwichReward = 20 // reward for getting a snake into a sandwich situation - less than cutoff, as it requires another snake to cooperate & is thus less reliable
  const evalFaceoffReward = 50 // reward for getting a snake into a faceoff. While not as definitive as the above two, it's also not typically a bad thing for a snake to do
  const evalCutoffPenalty = -75 // while not all snakes will do the cutoff, this is nonetheless a very bad state for us
  const evalCutoffHazardPenalty = -60 // while not quite as bad as a standard cutoff, this is nonetheless a very bad state for us
  const evalSandwichPenalty = -50 // as with cutoffs, but sandwiches are less reliable. Even so, a state to avoid
  const evalFaceoffPenalty = -10 // getting faced off is the least troubling of the three, but still problematic
  const evalCornerProximityPenalty = isOriginalSnake? -300 : 0 // shoving oneself in the corner while other snakes are nearby is very bad. Let other snakes do it
  let evalTailChase = -1 // given four directions, two will be closer to tail, two will be further, & closer dirs will always be 2 closer than further dirs
  const evalTailChasePercentage = 35 // below this percentage of safe cells, will begin to incorporate evalTailChase
  const evalEatingMultiplier = 5 // this is effectively Jaguar's 'hunger' immediacy - multiplies food factor directly after eating

  let logString: string = myself === undefined ? `eval where my snake is dead, turn ${gameState.turn}` : `eval snake ${myself.name} at (${myself.head.x},${myself.head.y} turn ${gameState.turn})`
  function buildLogString(str : string) : void {
    if (isDevelopment) {
      if (logString === "") {
        logString = str
      } else {
        logString = logString + "\n" + str
      }
    }
  }

  let evaluation = evalBase

  if (gameState.board.snakes.length === 0) {
    return determineEvalNoSnakes(gameState, gameState.you) // if no snakes are left, I am dead, but so are the others. It's better than just me being dead, at least
  }
  if (myself === undefined) {
    if (_myself !== undefined && _myself.health <= 0) { // if I starved, return evalNoMe, this is certain death
      return evalNoMe
    } else if (priorKissStates.deathState !== KissOfDeathState.kissOfDeathNo) {
      return getPriorKissOfDeathValue(priorKissStates.deathState) // Return the kissofDeath value that got me here (if applicable). This represents an uncertain death - though bad, it's not as bad as, say, starvation, which is a certainty.
    } else { // other deaths, such as death by snake body, are also a certainty
      return evalNoMe
    }
  }
  if (!isSolo && otherSnakes.length === 0) { // if it's not a solo game & there are no snakes left, we've won
    buildLogString(`no other snakes, add ${evalSolo}`)
    evaluation = evaluation + evalSolo // it's great if no other snakes exist, but solo games are still a thing. Give it a high score to indicate superiority to games with other snakes still in it, but continue evaluating so solo games can still evaluate scores
  } else {
    let snakeCountPenalty : number = 0
    for (let i: number = 0; i < otherSnakes.length; i++) {
      let snakePenalty: number = evalSnakeCountBase + evalSnakeCountStep * i
      snakePenalty = snakePenalty > evalSnakeCountMin? evalSnakeCountMin : snakePenalty // snake penalty should never be greater than -100
      snakeCountPenalty = snakeCountPenalty + snakePenalty
    }
    buildLogString(`other snakes are in game, multiply their number by evalSnakeCount & add to eval: ${snakeCountPenalty}`)
    evaluation = evaluation + snakeCountPenalty
  }

  // give walls a penalty, & corners a double penalty
  let isOnHWall: boolean = isOnHorizontalWall(gameState.board, myself.head)
  let isOnVWall: boolean = isOnVerticalWall(gameState.board, myself.head)
  let isHeadOnCorner: boolean = isOnHWall && isOnVWall
  if (isOnHWall) {
    buildLogString(`self head on horizontal wall at ${myself.head.x}, add ${evalWallPenalty}`)
    evaluation = evaluation + evalWallPenalty
  }
  if (isOnVWall) {
    buildLogString(`self head y on vertical wall at ${myself.head.y}, add ${evalWallPenalty}`)
    evaluation = evaluation + evalWallPenalty
  }

  const kingOfTheSnakes = isKingOfTheSnakes(myself, gameState.board)
  let longestSnake = isDuel? otherSnakes[0] : getLongestSnake(myself, otherSnakes) // in a duel, longestSnake other than me is just the other snake

  // should attempt to close the distance between self & duel opponent if they are currently in hazard, in an attempt to wall them off
  if (isDuel && hazardDamage > 0) {
    let opponentCell = board2d.getCell(otherSnakes[0].head)
    if (opponentCell && opponentCell.hazard) {
      if (!isOnHWall && !isOnVWall) { // no sense building hazard walls on the edge of the board
        evalHazardWallPenalty = 5 // if our duel opponent is actually in hazard, it's *better* to sit on the border & try to form a wall
      }
      evalCenterDistancePenalty = 0 // in this particular case, we want our snake to really prioritize walling the other snake off - so turn center metric off
      evalTailChase = 0 // likewise with tail chase metric
      if (snakeDelta > 0) { // still need to try to stay larger than otherSnakes. If wall fails, could come out of our gambit in a bad spot if we neglected food
        evalFoodVal = 0 // turn food metric off too
        evalHazardPenalty = evalHazardPenalty * 2 // we do want to chase the opponent, but do not want to let it lure us into hazard
      }

      let opponentDistanceCalq = getDistance(myself.head, longestSnake.head) * evalHazardSnakeSeekerStep
      buildLogString(`hazard snake seeker, adding ${opponentDistanceCalq}`)
      evaluation = evaluation + opponentDistanceCalq
    }
  }

  // penalize or rewards spaces next to hazard
  if (isAdjacentToHazard(myself.head, hazardWalls, gameState)) {
    buildLogString(`hazard wall penalty, add ${evalHazardWallPenalty}`)
    evaluation = evaluation + evalHazardWallPenalty
  }

  if (isDuel) { // if duelling, pay closer attention to enemy's health in an attempt to starve it out if possible
    if (hazardDamage > 0) {
      // calculate health eval with a lower tier difference & health step, which should result in a smaller variation based on this metric than our own health metric
      // we don't want to base all of our movements on enemy health, just a small nudge if it's vulnerable towards eating its food
      // note the value for starvationPenalty: -evalSolo. Want to give a reward equivalent to the reward for being the last snake if we actually do starve the other snake out.
      let healthEval: number = determineHealthEval(otherSnakes[0], hazardDamage, evalHealthStep - 1, Math.floor(evalHealthTierDifference / 3), evalHealthBase, -evalSolo)
      healthEval = -1 * healthEval // for otherSnake, we want this value to be lower, so need to reward by inverting it
      buildLogString(`Health eval for duel opponent, adding ${healthEval}`)
      evaluation = evaluation + healthEval // should be a positive value, higher for lower enemy snake health values, & very high if the enemy snake starved out
    } else { // if no hazard, starvation is not likely, only try if they're really low
      if (otherSnakes[0].health < evalHealthEnemyThreshold) {
        let healthEval: number = evalHealthEnemyReward // if health threshold is 10, this will be 45 at health 9, 40 at 8, 35 at 7, etc., down to 5 at 1
        buildLogString(`Health eval for non-duel opponent, adding ${healthEval}`)
        evaluation = evaluation + healthEval // should be a positive value to reward Jaguar for keeping his opponent low on health for longer periods of time
      }
    }
  }

  let moves: Moves = getAvailableMoves(gameState, myself, board2d)
  let validMoves : Direction[] = moves.validMoves()
  let availableMoves : number = validMoves.length

  // look for kiss of death & murder cells in this current configuration
  let moveNeighbors = findMoveNeighbors(gameState, myself, board2d, moves)
  let kissOfMurderMoves = findKissMurderMoves(myself, board2d, moveNeighbors)
  let kissOfDeathMoves = findKissDeathMoves(myself, board2d, moveNeighbors)

  let kissStates = kissDecider(gameState, myself, moveNeighbors, kissOfDeathMoves, kissOfMurderMoves, moves, board2d)

  if (kissStates.canTauntDeath(moves)) { // baitsnake time!
    buildLogString(`KissOfDeathAvoidance nearby, taunting death & adding ${evalKissOfDeathAvoidance}`)
    evaluation = evaluation + evalKissOfDeathNo
  } else if (kissStates.canAvoidPossibleDeath(moves)) { // death is avoidable for at least one possible move
    buildLogString(`No kisses of death nearby, adding ${evalKissOfDeathNo}`)
    evaluation = evaluation + evalKissOfDeathNo
  } else if (kissStates.canAvoidCertainDeath(moves)) { // death has a chance of being avoidable for at least one possible move
    // this is a bit of a mess. Basically: get the predator who has a chance of cells to kill me at (huntingChanceDirections call) rather than the ones who can only do so in one cell
    let smallestPredator: Battlesnake | undefined = moveNeighbors.getSmallestPredator(moveNeighbors.huntingChanceDirections())
    if (smallestPredator !== undefined && smallestPredator.length === myself.length) {
      buildLogString(`Need to deal with possible mutual kisses of death nearby, adding ${evalKissOfDeathMaybeMutual}`)
      evaluation = evaluation + evalKissOfDeathMaybe
    } else {
      buildLogString(`Need to deal with possible kisses of death nearby, adding ${evalKissOfDeathMaybe}`)
      evaluation = evaluation + evalKissOfDeathMaybe
    }
  } else {
    let smallestPredator: Battlesnake | undefined = moveNeighbors.getSmallestPredator(moves)
    if (smallestPredator !== undefined && smallestPredator.length === myself.length) {
      buildLogString(`Only kisses of death nearby, but one is mutual, adding ${evalKissOfDeathCertaintyMutual}`)
      evaluation = evaluation + evalKissOfDeathCertaintyMutual
    } else {
      buildLogString(`Only kisses of death nearby, adding ${evalKissOfDeathCertainty}`)
      evaluation = evaluation + evalKissOfDeathCertainty
    }
  }

  if (kissStates.canCommitCertainMurder(moves)) {
    buildLogString(`Certain kiss of murder nearby, adding ${evalKissOfMurderCertainty}`)
    evaluation = evaluation + evalKissOfMurderCertainty
  } else if (kissStates.canCommitPossibleMurder(moves)) {
    buildLogString(`Possible kiss of murder nearby, adding ${evalKissOfMurderMaybe}`)
    evaluation = evaluation + evalKissOfMurderMaybe
  } else if (kissStates.canCommitFaceoffMurder(moves)) {
    buildLogString(`Faceoff kiss of murder nearby, adding ${evalKissOfMurderFaceoff}`)
    evaluation = evaluation + evalKissOfMurderFaceoff
  } else if (kissStates.canCommitUnlikelyMurder(moves)) {
    buildLogString(`Unlikely kiss of murder nearby, adding ${evalKissOfMurderAvoidance}`)
    evaluation = evaluation + evalKissOfMurderAvoidance
  } else {
    buildLogString(`No kisses of murder nearby, adding ${evalKissOfDeathNo}`)
    evaluation = evaluation + evalKissOfDeathNo
  }

  // cutoff, hazard cutoff, sandwhich, faceoff params for & against my snake
  let canCutoffSnake: Battlesnake | undefined = undefined
  let canCutoffHazardSnake: Battlesnake | undefined = undefined
  let canSandwichSnake: Battlesnake | undefined = undefined
  let canFaceoffSnake: boolean = false

  let canBeCutoffBySnake: boolean = false
  let canBeCutoffHazardBySnake: boolean = false
  let canBeSandwichedBySnake: boolean = false
  let canBeFacedOff: boolean = false

  let isInAState: boolean = false // these are all mutually exclusive, so we only want to run all of these calculations if we don't end up matching any of them

  let wantToEat: boolean = true // condition for whether we currently want food
  let safeToEat: boolean = true // condition for whether it was safe to eat a food in our current cell

  // need to calculate cutoffs before priorKisses, as evalPriorKissOfMurderAvoidance can change based on whether this is a cutoff
  canCutoffSnake = otherSnakes.find(function findSnakeToCutOff(snake) { // returns true if myself can cut off any otherSnake
    return isCutoff(gameState, myself, snake, board2d) // returns true if myself can cut snake off
  })
  if (canCutoffSnake) {
    isInAState = true
    evalPriorKissOfMurderAvoidance = 50 // if the kiss of murder that the other snake avoided led it into a cutoff, this is not a murder we want to avoid
    if (!isOriginalSnake && originalSnake && canCutoffSnake.id === originalSnake.id) { // the snake we can cut off is originalSnake, give a bonus
      evalCutoffReward = evalCutoffReward + 50
    }
    buildLogString(`attempting cutoff, adding ${evalCutoffReward}`)
    evaluation = evaluation + evalCutoffReward
  }

  if (!isInAState) {
    canCutoffHazardSnake = otherSnakes.find(function findSnakeToCutOff(snake) { // returns true if myself can cut off any otherSnake with hazard
      return isHazardCutoff(gameState, myself, snake, board2d, hazardWalls) // returns true if myself can cut snake off with hazard
    })
    if (canCutoffHazardSnake) {
      isInAState = true
      evalPriorKissOfMurderAvoidance = evalPriorKissOfMurderAvoidance < 35? 35 : evalPriorKissOfMurderAvoidance // if the kiss of murder that the other snake avoided led it into a hazard cutoff, this is not a murder we want to avoid
      if (!isOriginalSnake && originalSnake && canCutoffHazardSnake.id === originalSnake.id) { // the snake we can cut off is originalSnake, give a bonus
        evalCutoffHazardReward = evalCutoffHazardReward + 50
      }
      buildLogString(`attempting hazard cutoff, adding ${evalCutoffHazardReward}`)
      evaluation = evaluation + evalCutoffHazardReward
    }
  }

  if (!isInAState) {
    canBeCutoffBySnake = otherSnakes.some(function findSnakeToBeCutOffBy(snake) { // returns true if any otherSnake can cut myself off
      return isCutoff(gameState, snake, myself, board2d) // returns true if snake can cut myself off
    })
    if (canBeCutoffBySnake) {
      isInAState = true
      buildLogString(`can be cut off, adding ${evalCutoffPenalty}`)
      evaluation = evaluation + evalCutoffPenalty
    }
  }

  if (!isInAState) {
    canBeCutoffHazardBySnake = otherSnakes.some(function findSnakeToBeCutOffBy(snake) { // returns true if any otherSnake can hazard cut myself off
      return isHazardCutoff(gameState, snake, myself, board2d, hazardWalls) // returns true if snake can hazard cut myself off
    })
    if (canBeCutoffHazardBySnake) {
      isInAState = true
      buildLogString(`can be hazard cut off, adding ${evalCutoffHazardPenalty}`)
      evaluation = evaluation + evalCutoffHazardPenalty
    }
  }

  if (!isInAState) {
    canSandwichSnake = otherSnakes.find(function findSnakeToSandwich(snake) { // returns true if myself can sandwich any otherSnake
      return isSandwich(gameState, myself, snake, board2d)
    })
    if (canSandwichSnake) {
      isInAState = true
      evalPriorKissOfMurderAvoidance = 50 // if the kiss of murder that the other snake avoided led it into a sandwich, this is not a murder we want to avoid
      if (!isOriginalSnake && originalSnake && canSandwichSnake.id === originalSnake.id) { // the snake we can sandwich is originalSnake, give a bonus
        evalSandwichReward = evalSandwichReward + 50
      }
      buildLogString(`attempting sandwich, adding ${evalSandwichReward}`)
      evaluation = evaluation + evalSandwichReward
    }
  }

  if (!isInAState) {
    canBeSandwichedBySnake = otherSnakes.some(function findSnakeToBeSandwichedBy(snake) { // returns true if any otherSnake can sandwich me
      return isSandwich(gameState, snake, myself, board2d) // returns true if snake can sandwich me
    })
    if (canBeSandwichedBySnake) {
      isInAState = true
      buildLogString(`can be sandwiched, adding ${evalSandwichPenalty}`)
      evaluation = evaluation + evalSandwichPenalty
    }
  }

  if (!isInAState) {
    canFaceoffSnake = otherSnakes.some(function findSnakeToFaceoff(snake) { // returns true if myself can faceoff any otherSnake
      return isFaceoff(gameState, myself, snake, board2d)
    })
    if (canFaceoffSnake) {
      isInAState = true
      evalPriorKissOfMurderAvoidance = evalPriorKissOfMurderAvoidance < 25? 25 : evalPriorKissOfMurderAvoidance // if the kiss of murder that the other snake avoided led it into a faceoff, this is not a murder we want to avoid
      buildLogString(`attempting faceoff, adding ${evalFaceoffReward}`)
      evaluation = evaluation + evalFaceoffReward
    }
  }

  if (!isInAState) {
    canBeFacedOff = otherSnakes.some(function findSnakeToBeFacedOffBy(snake) {
      return isFaceoff(gameState, snake, myself, board2d)
    })
    if (canBeFacedOff) {
      isInAState = true
      buildLogString(`can be faced off, adding ${evalFaceoffPenalty}`)
      evaluation = evaluation + evalFaceoffPenalty
    }
  }
  
  let priorKissOfDeathValue = getPriorKissOfDeathValue(priorKissStates.deathState)
  buildLogString(`Prior kiss of death state ${priorKissStates.deathState}, adding ${priorKissOfDeathValue}`)
  evaluation = evaluation + priorKissOfDeathValue

  let priorKissOfMurderValue = getPriorKissOfMurderValue(priorKissStates.murderState)
  buildLogString(`Prior kiss of murder state ${priorKissStates.murderState}, adding ${priorKissOfMurderValue}`)
  evaluation = evaluation + priorKissOfMurderValue

  // if this state's murder prey was my snake & it's not a duel, give a reward so I assume other snakes are out to get me
  if (!isOriginalSnake && priorKissStates.prey !== undefined && priorKissStates.prey.id === gameState.you.id) {
    buildLogString(`prior prey was ${gameState.you.name}, adding ${evalPriorKissOfMurderSelfBonus}`)
    evaluation = evaluation + evalPriorKissOfMurderSelfBonus
  }

  // as above, give a little bonus to otherSnakes to being able to kill originalSnake in this state
  if (!isOriginalSnake && originalSnake && moveNeighbors.preyExists(originalSnake)) {
    buildLogString(`prey includes ${gameState.you.name}, adding ${evalKissOfMurderSelfBonus}`)
    evaluation = evaluation + evalKissOfMurderSelfBonus
  }

  // penalize spaces that ARE hazard
  let myCell = board2d.getCell(myself.head)
  if (myCell !== undefined && myCell.hazard) {
    buildLogString(`hazard space penalty, add ${evalHazardPenalty}`)
    evaluation = evaluation + evalHazardPenalty
  }

  // general snake length metric. More long more good
  buildLogString(`snake length reward, add ${evalLengthMult * myself.length}`)
  evaluation = evaluation + evalLengthMult * myself.length

  // if we're sure we're getting a kill, we're also sure that snake is dying, so we can increment our possible moves for evaluation purposes
  switch(availableMoves) {
    case 0:
      buildLogString(`possibleMoves 0, add ${eval0Move}`)
      evaluation = evaluation + eval0Move // with no valid moves left, this state is just a notch above death
      break
    case 1:
      buildLogString(`possibleMoves 1, add ${eval1Move}`)
      evaluation = evaluation + eval1Move // with only one valid move, this is a bad, but not unsalvageable, state
      break
    case 2:
      buildLogString(`possibleMoves 2, add ${eval2Moves}`)
      evaluation = evaluation + eval2Moves // two valid moves is pretty good
      break
    case 3:
      buildLogString(`possibleMoves 3, add ${eval3Moves}`)
      evaluation = evaluation + eval3Moves // three valid moves is great
      break
    default: // case 4, should only be possible on turn 1 when length is 1
      buildLogString(`possibleMoves 4, add ${eval4Moves}`)
      evaluation = evaluation + eval4Moves
      break
  }

  if (!isOriginalSnake && originalSnake !== undefined) { // for otherSnakes, check out originalSnakes' position in this gameState
    let availableMovesOgSnake = getAvailableMoves(gameState, originalSnake, board2d)
    switch (availableMovesOgSnake.validMoves().length) {
      case 0:
        buildLogString(`ogSnake possibleMoves 0, add ${evalOriginalSnake0Move}`)
        evaluation = evaluation + evalOriginalSnake0Move
        break
      case 1:
        buildLogString(`ogSnake possibleMoves 1, add ${evalOriginalSnake1Move}`)
        evaluation = evaluation + evalOriginalSnake1Move
        break
      case 2:
        buildLogString(`ogSnake possibleMoves 2, add ${evalOriginalSnake2Move}`)
        evaluation = evaluation + evalOriginalSnake2Move
        break
      case 3:
        buildLogString(`ogSnake possibleMoves 3, add ${evalOriginalSnake3Move}`)
        evaluation = evaluation + evalOriginalSnake3Move
        break
    }
  }

  if (kingOfTheSnakes) { // want to give slight positive evals towards states closer to longestSnake
    if (!(snakeDelta === 2 && snakeHasEaten(myself, lookahead))) { // only add kingsnake calc if I didn't just become king snake, otherwise will mess with other non king states
      if (longestSnake.id !== myself.id) { // if I am not the longest snake, seek it out
        let kingSnakeCalq = getDistance(myself.head, longestSnake.head) * evalKingSnakeStep // lower distances are better, evalKingSnakeStep should be negative
        buildLogString(`kingSnake seeker, adding ${kingSnakeCalq}`)
        evaluation = evaluation + kingSnakeCalq
      }
    }
  }

  const foodSearchDepth = calculateFoodSearchDepth(gameState, myself, board2d)
  const nearbyFood = findFood(foodSearchDepth, gameState.board.food, myself.head)
  let foodToHunt : Coord[] = []

  let deathStates = [KissOfDeathState.kissOfDeathCertainty, KissOfDeathState.kissOfDeathCertaintyMutual, KissOfDeathState.kissOfDeathMaybe, KissOfDeathState.kissOfDeathMaybeMutual]
  if (hazardDamage > 0 && (myself.health < (1 + (hazardDamage + 1) * 2))) { // if hazard damage exists & two turns of it would kill me, want food
    wantToEat = true
  } else if (snakeDelta === 6 && !snakeHasEaten(myself, lookahead)) { // If I am exactly 6 bigger & I haven't just eaten, stop wanting food
    wantToEat = false
  } else if (snakeDelta > 6) { // If I am more than 6 bigger, stop wanting food
    wantToEat = false
  }
  if (canBeCutoffBySnake || canBeCutoffHazardBySnake || canBeSandwichedBySnake) { // if snake can be sandwiched or cutoff, it was not safe to eat this food
    safeToEat = false
  } else if (deathStates.includes(priorKissStates.deathState)) { // eating this food had a likelihood of causing my death, that's not safe
    safeToEat = false
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
  if (snakeHasEaten(myself) && safeToEat && wantToEat) { // only reward snake for eating if it was safe to eat & it wanted to eat, otherwise just give it the normal health eval
    buildLogString(`got food, add ${evalHasEaten}`)
    evaluation = evaluation + evalHasEaten
  } else {
    let healthEval: number = determineHealthEval(myself, hazardDamage, evalHealthStep, evalHealthTierDifference, evalHealthBase, evalNoMe)
    buildLogString(`Health eval for myself, adding ${healthEval}`)
    evaluation = evaluation + healthEval
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
            foodToHuntLength = foodToHuntLength - 0.6 // hazard food is worth 0.4 that of normal food
          }
        })
        let foodCalcStep = 0
        foodCalcStep = evalFoodVal * (evalFoodStep + j) * foodToHuntLength
        buildLogString(`found ${foodToHunt.length} food at depth ${i}, adding ${foodCalcStep}`)
        foodCalc = foodCalc + foodCalcStep
      }
      j = j - 1
    }

    buildLogString(`adding food calc ${foodCalc}`)
    evaluation = evaluation + foodCalc
  }

  if (isHeadOnCorner) { // corners are bad don't go into them unless totally necessary
    let closestSnakeDist: number | undefined

    otherSnakes.forEach(function findClosestSnake(snake) {
      if (myself !== undefined) {
        let thisDist = getDistance(snake.head, myself.head)
        if (closestSnakeDist === undefined) {
          closestSnakeDist = thisDist
        } else if (closestSnakeDist > thisDist) {
          closestSnakeDist = thisDist
        }
      }
    })
    if (closestSnakeDist !== undefined && closestSnakeDist < 5) {
      buildLogString(`in a corner with another snake nearby, adding ${evalCornerProximityPenalty}`)
      evaluation = evaluation + evalCornerProximityPenalty
    }
  }

  let safeCells: number = getSafeCells(board2d)
  const numCells: number = board2d.height * board2d.width
  const safeCellPercentage: number = (safeCells * 100) / numCells

  // in addition to wall/corner penalty, give a bonus to being closer to center
  const centers = calculateCenterWithHazard(gameState, hazardWalls)

  const xDiff = Math.abs(myself.head.x - centers.centerX)
  const yDiff = Math.abs(myself.head.y - centers.centerY)

  if (isDuel) { // in a duel, centering should be avoided if we have otherSnake in a bind
    if (canCutoffSnake || canCutoffHazardSnake || canFaceoffSnake) {
      evalCenterDistancePenalty = 0
    }
  }
  buildLogString(`adding xDiff ${xDiff * evalCenterDistancePenalty}`)
  evaluation = evaluation + xDiff * evalCenterDistancePenalty
  buildLogString(`adding yDiff ${yDiff * evalCenterDistancePenalty}`)
  evaluation = evaluation + yDiff * evalCenterDistancePenalty

  if (isDuel && hazardDamage === 0 && myself.length > 20) { // in long-running duels without hazard, chasing one's tail is the best thing you can do barring a kill
    let tailDist = getDistance(myself.body[myself.body.length - 1], myself.head) // distance from head to tail
    if (snakeDelta < 0) {
      evalTailChase = -3 // less strong, want to leave room for food hunting
    } else {
      evalTailChase = -5 // strong pull towards tail
    }
    buildLogString(`chasing tail, adding ${evalTailChase * tailDist}`)
    evaluation = evaluation + (evalTailChase * tailDist)
  } else if (safeCellPercentage < evalTailChasePercentage || (isDuel && snakeDelta < 0)) {
    let tailDist = getDistance(myself.body[myself.body.length - 1], myself.head) // distance from head to tail
    buildLogString(`chasing tail, adding ${evalTailChase * tailDist}`)
    evaluation = evaluation + (evalTailChase * tailDist)
  }

  buildLogString(`final evaluation: ${evaluation}`)
//   logToFile(evalWriteStream, `eval log: ${logString}
// `)
  return evaluation
}