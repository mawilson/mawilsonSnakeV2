import { GameState } from "./types"
import { Direction, Battlesnake, Board2d, Moves, MoveNeighbors, Coord, SnakeCell, BoardCell, KissOfDeathState, KissOfMurderState, HazardWalls, KissStatesForEvaluate } from "./classes"
import { createWriteStream } from "fs"
import { checkForSnakesHealthAndWalls, logToFile, getSurroundingCells, findMoveNeighbors, findKissDeathMoves, findKissMurderMoves, calculateFoodSearchDepth, isKingOfTheSnakes, findFood, getLongestSnake, getDistance, snakeLengthDelta, isInOrAdjacentToHazard, snakeToString, snakeHasEaten, getSafeCells, kissDecider, getSnakeDirection, isCutoff, isAdjacentToHazard, calculateCenterWithHazard } from "./util"
import { gameData } from "./logic"

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

// the big one. This function evaluates the state of the board & spits out a number indicating how good it is for input snake, higher numbers being better
// 1000: last snake alive, best possible state
// 0: snake is dead, worst possible state
export function evaluate(gameState: GameState, meSnake: Battlesnake | undefined, priorKissStates: KissStatesForEvaluate) : number {
  const myself : Battlesnake | undefined = meSnake === undefined ? undefined : gameState.board.snakes.find(function findMe(snake) { return snake.id === meSnake.id})
  const otherSnakes: Battlesnake[] = meSnake === undefined ? gameState.board.snakes : gameState.board.snakes.filter(function filterMeOut(snake) { return snake.id !== meSnake.id})
  const board2d = new Board2d(gameState.board)
  const hazardDamage = gameState.game.ruleset.settings.hazardDamagePerTurn
  const snakeDelta = myself !== undefined ? snakeLengthDelta(myself, gameState.board) : -1
  const isDuel: boolean = gameState.board.snakes.length === 2

  const isOriginalSnake = myself !== undefined && myself.id === gameState.you.id // true if snake's id matches the original you of the game
  const lookahead: number = gameData[gameState.game.id] && isOriginalSnake? gameData[gameState.game.id].lookahead : 0 // only originalSnake uses lookahead
  const hazardWalls: HazardWalls = gameData[gameState.game.id]? gameData[gameState.game.id].hazardWalls : new HazardWalls()

  // values to tweak
  const evalBase: number = 500
  const evalNoSnakes: number = 430 // no snakes can be legitimately good. Ties are fine, & if the other snake chickened, we may be better off. 430 is just enough to let 'does not avoid a tie kiss of death if in a duel'
  const evalNoMe: number = -4000 // no me is the worst possible state, give a very bad score
  const evalSnakeCount = -100 // assign penalty based on number of snakes left in gameState
  const evalSolo: number = 4000 // this means we've won. Won't be considered in games that were always solo
  const evalWallPenalty: number = isDuel? -10 : -5 //-25
  const evalHazardWallPenalty: number = -1 // very small penalty, dangerous to hang out along edges where hazard may appear
  const evalHazardPenalty: number = -(hazardDamage) // in addition to health considerations & hazard wall calqs, make it slightly worse in general to hang around inside of the sauce
  // TODO: Evaluate removing or neutering the Moves metric & see how it performs
  const evalCenterDistancePenalty: number = isDuel && isOriginalSnake? -3 : -1 // in a duel, more strongly trend me towards middle, but other snakes
  const eval0Move = -700
  const eval1Move = 0 // was -50, but I don't think 1 move is actually too bad - I want other considerations to matter between 2 moves & 1
  const eval2Moves = isOriginalSnake? 2 : 20 // want this to be higher than the difference then eval1Move & evalWallPenalty, so that we choose wall & 2 move over no wall & 1 move
  const eval3Moves = isOriginalSnake? 4 : 40
  const eval4Moves = isOriginalSnake? 6 : 60
  
  const evalHealthBase = 75 // evalHealth tiers should differ in severity based on how hungry I am
  const evalHealthStep = 3
  const evalHealthTierDifference = 10
  const evalHealthEnemyThreshold = hazardDamage > 0? 50 : 10 // health level at which we start starving out a snake in a duel
  const evalHealthEnemyReward = 50

  let evalHasEaten = evalHealthBase + 50 // should be at least evalHealth7, plus some number for better-ness. Otherwise will prefer to be almost full to full. Also needs to be high enough to overcome food nearby score for the recently eaten food
  const evalLengthMult = 2
  // if (snakeDelta >= 4 && priorKissStates.murderState === KissOfMurderState.kissOfMurderNo) { // usually food is great, but unnecessary growth isn't. Avoid food unless it's part of a kill move
  //   evalHasEaten = -20
  // } else
  if (gameState.board.snakes.length === 1) {
    evalHasEaten = -20 // for solo games, we want to avoid food when we're not starving
  }

  const evalPriorKissOfDeathCertainty = -800 // everywhere seemed like certain death
  const evalPriorKissOfDeathCertaintyMutual = -400 // another snake would have to kamikaze to hit us here, but it's still risky
  const evalPriorKissOfDeathMaybe = -400 // this cell is a 50/50
  const evalPriorKissOfDeathMaybeMutual = -300 // this is less than a 50/50, but still bad. Our predator doesn't want to take this chance either & may avoid this, but may not if it can't
  const evalPriorKissOfDeath3To1Avoidance = 0 // while it's usually good our snake avoided possible death by doing these, we still want a small penalty so the lookahead knows it was bad to even have to consider
  const evalPriorKissOfDeath3To2Avoidance = 0 // this one is better as we at least still had options after avoiding the kiss
  const evalPriorKissOfDeath2To1Avoidance = 0
  const evalPriorKissOfDeathNo = 0
  const evalPriorKissOfMurderCertainty = 80 // this state is strongly likely to have killed a snake
  const evalPriorKissOfMurderMaybe = 40 // this state had a 50/50 chance of having killed a snake
  const evalPriorKissOfMurderAvoidance = isOriginalSnake? -30 : 15 // this state may have killed a snake, but they did have an escape route (3to2, 3to1, or 2to1 avoidance). For myself, avoid this, as this is prone to being baited.
  const evalPriorKissOfMurderSelfBonus = 30

  const evalKissOfDeathCertainty = -400 // everywhere seems like certain death
  const evalKissOfDeathCertaintyMutual = -200 // another snake will have to kamikaze to his us here, but it's still risky
  const evalKissOfDeathMaybe = -200 // a 50/50 on whether we will be kissed to death next turn
  const evalKissOfDeathMaybeMutual = -150 // a bit less than a 50/50, as neither party particularly wants to take this chance
  const evalKissOfDeath3To1Avoidance = 0
  const evalKissOfDeath3To2Avoidance = 0
  const evalKissOfDeath2To1Avoidance = 0
  const evalKissOfDeathNo = 0
  const evalKissOfMurderCertainty = 50 // we can kill a snake, this is probably a good thing
  const evalKissOfMurderMaybe = 25 // we can kill a snake, but it's a 50/50
  const evalKissOfMurderAvoidance = 10 // we can kill a snake, but they have an escape route (3to2, 3to1, or 2to1 avoidance)
  let evalFoodVal = 2

  if (isDuel && otherSnakes[0].health < evalHealthEnemyThreshold) { // care a bit more about food to try to starve the other snake out
    evalFoodVal = 3
  } else if (isDuel && snakeDelta < -4) { // care a bit less about food due to already being substantially smaller
    evalFoodVal = 1
  }
  const evalFoodStep = 1
  const evalKingSnakeStep = -2 // negative means that higher distances from king snake will result in lower score
  const evalCutoffReward = 35
  const evalCutoffPenalty = -75 // while not all snakes will do the cutoff, this is nonetheless a very bad state for us
  const evalCornerProximityPenalty = -300 // shoving oneself in the corner while other snakes are nearby is very bad
  const evalTailChase = -3 // given four directions, two will be closer to tail, two will be further, & closer dirs will always be 2 closer than further dirs
  const evalTailChasePercentage = 35 // below this percentage of safe cells, will begin to incorporate evalTailChase

  let logString: string = myself === undefined ? `eval where my snake is dead, turn ${gameState.turn}` : `eval snake ${myself.name} at (${myself.head.x},${myself.head.y} turn ${gameState.turn})`
  function buildLogString(str : string) : void {
    if (logString === "") {
      logString = str
    } else {
      logString = logString + "\n" + str
    }
  }

  let evaluation = evalBase

  if (gameState.board.snakes.length === 0) {
    return evalNoSnakes // if no snakes are left, I am dead, but so are the others. It's better than just me being dead, at least
  }
  if (myself === undefined) {
    return evalNoMe // if mySnake is not still in the game board, it's dead. This is a bad evaluation.
    //evaluation = evaluation + evalNoMe // if mySnake is not still in the game board, it's dead. This is a bad evaluation.
  }
  if (otherSnakes.length === 0) {
    if (gameState.game.ruleset.name === "solo") { // for solo games, we want to continue evaluating. For non-solo games, we've won, may be able to save evaluation time by returning now
      buildLogString(`no other snakes, add ${evalSolo}`)
      evaluation = evaluation + evalSolo // it's great if no other snakes exist, but solo games are still a thing. Give it a high score to indicate superiority to games with other snakes still in it, but continue evaluating so solo games can still evaluate scores
    } else {
      return evalSolo
    }
  } else {
    buildLogString(`other snakes are in game, multiply their number by evalSnakeCount & add to eval: ${evalSnakeCount} * ${otherSnakes.length}`)
    evaluation = evaluation + (evalSnakeCount * otherSnakes.length)
  }

  // give walls a penalty, & corners a double penalty
  let isOnHorizontalWall: boolean = myself.head.x === 0 || myself.head.x === (gameState.board.width - 1)
  let isOnVerticalWall: boolean = myself.head.y === 0 || myself.head.y === (gameState.board.height - 1)
  let isCorner: boolean = isOnHorizontalWall && isOnVerticalWall
  if (isOnHorizontalWall) {
    buildLogString(`self head on horizontal wall at ${myself.head.x}, add ${evalWallPenalty}`)
    evaluation = evaluation + evalWallPenalty
  }
  if (isOnVerticalWall) {
    buildLogString(`self head y on vertical wall at ${myself.head.y}, add ${evalWallPenalty}`)
    evaluation = evaluation + evalWallPenalty
  }

  // in addition to wall/corner penalty, give a bonus to being closer to center
  const centers = calculateCenterWithHazard(gameState, hazardWalls)
  // const centerX = (gameState.board.width - 1) / 2
  // const centerY = (gameState.board.height - 1) / 2

  const xDiff = Math.abs(myself.head.x - centers.centerX)
  const yDiff = Math.abs(myself.head.y - centers.centerY)

  buildLogString(`adding xDiff ${xDiff * evalCenterDistancePenalty}`)
  evaluation = evaluation + xDiff * evalCenterDistancePenalty
  buildLogString(`adding yDiff ${yDiff * evalCenterDistancePenalty}`)
  evaluation = evaluation + yDiff * evalCenterDistancePenalty
  
  // give bonuses & penalties based on how many technically 'valid' moves remain after removing walls & other snake cells
  const possibleMoves = new Moves(true, true, true, true)

  // health considerations, which are effectively hazard considerations
  if (snakeHasEaten(myself)) {
    buildLogString(`got food, add ${evalHasEaten}`)
    evaluation = evaluation + evalHasEaten
  } else {
    let healthEval: number = determineHealthEval(myself, hazardDamage, evalHealthStep, evalHealthTierDifference, evalHealthBase, evalNoMe)
    buildLogString(`Health eval for myself, adding ${healthEval}`)
    evaluation = evaluation + healthEval
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

  checkForSnakesHealthAndWalls(myself, gameState, board2d, possibleMoves)
  let validMoves : Direction[] = possibleMoves.validMoves()
  let availableMoves : number = validMoves.length

  // look for kiss of death & murder cells in this current configuration
  let moveNeighbors = findMoveNeighbors(gameState, myself, board2d, possibleMoves)
  let kissOfMurderMoves = findKissMurderMoves(myself, board2d, moveNeighbors)
  let kissOfDeathMoves = findKissDeathMoves(myself, board2d, moveNeighbors)

  let kissStates = kissDecider(gameState, myself, moveNeighbors, kissOfDeathMoves, kissOfMurderMoves, possibleMoves, board2d)

  if (kissStates.canAvoidPossibleDeath(possibleMoves)) { // death is avoidable for at least one possible move
    buildLogString(`No kisses of death nearby, adding ${evalKissOfDeathNo}`)
    evaluation = evaluation + evalKissOfDeathNo
  } else if (kissStates.canAvoidCertainDeath(possibleMoves)) { // death has a chance of being avoidable for at least one possible move
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
    let smallestPredator: Battlesnake | undefined = moveNeighbors.getSmallestPredator(possibleMoves)
    if (smallestPredator !== undefined && smallestPredator.length === myself.length) {
      buildLogString(`Only kisses of death nearby, but one is mutual, adding ${evalKissOfDeathCertaintyMutual}`)
      evaluation = evaluation + evalKissOfDeathCertaintyMutual
    } else {
      buildLogString(`Only kisses of death nearby, adding ${evalKissOfDeathCertainty}`)
      evaluation = evaluation + evalKissOfDeathCertainty
    }
  }

  if (kissStates.canCommitCertainMurder(possibleMoves)) {
    buildLogString(`Certain kiss of murder nearby, adding ${evalKissOfMurderCertainty}`)
    evaluation = evaluation + evalKissOfMurderCertainty
  } else if (kissStates.canCommitPossibleMurder(possibleMoves)) {
    buildLogString(`Possible kiss of murder nearby, adding ${evalKissOfMurderMaybe}`)
    evaluation = evaluation + evalKissOfMurderMaybe
  } else if (kissStates.canCommitUnlikelyMurder(possibleMoves)) {
    buildLogString(`Unlikely kiss of murder nearby, adding ${evalKissOfMurderAvoidance}`)
    evaluation = evaluation + evalKissOfMurderAvoidance
  } else {
    buildLogString(`No kisses of murder nearby, adding ${evalKissOfDeathNo}`)
    evaluation = evaluation + evalKissOfDeathNo
  }

  
  // for kisses from the previous move state
  // The only one that really matters is the one indicating 50/50. kissOfDeathCertainty is also bad but likely we're already dead at that point
  switch (priorKissStates.deathState) {
    case KissOfDeathState.kissOfDeathCertainty:
      buildLogString(`KissOfDeathCertainty, adding ${evalPriorKissOfDeathCertainty}`)
      evaluation = evaluation + evalPriorKissOfDeathCertainty
      break
    case KissOfDeathState.kissOfDeathCertaintyMutual:
      buildLogString(`KissOfDeathCertaintyMutual, adding ${evalPriorKissOfDeathCertaintyMutual}`)
      evaluation = evaluation + evalPriorKissOfDeathCertaintyMutual
      break
    case KissOfDeathState.kissOfDeathMaybe:
      buildLogString(`KissOfDeathMaybe, adding ${evalPriorKissOfDeathMaybe}`)
      evaluation = evaluation + evalPriorKissOfDeathMaybe
      break
    case KissOfDeathState.kissOfDeathMaybeMutual:
      buildLogString(`KissOfDeathMaybeMutual, adding ${evalPriorKissOfDeathMaybeMutual}`)
      evaluation = evaluation + evalPriorKissOfDeathMaybeMutual
      break
    case KissOfDeathState.kissOfDeath3To1Avoidance:
      buildLogString(`KissOfDeath3To1Avoidance, adding ${evalPriorKissOfDeath3To1Avoidance}`)
      evaluation = evaluation + evalPriorKissOfDeath3To1Avoidance
      break
    case KissOfDeathState.kissOfDeath3To2Avoidance:
      buildLogString(`KissOfDeath3To2Avoidance, adding ${evalPriorKissOfDeath3To2Avoidance}`)
      evaluation = evaluation + evalPriorKissOfDeath3To2Avoidance
      break
    case KissOfDeathState.kissOfDeath2To1Avoidance:
      buildLogString(`KissOfDeath2To1Avoidance, adding ${evalPriorKissOfDeath2To1Avoidance}`)
      evaluation = evaluation + evalPriorKissOfDeath2To1Avoidance
      break
    case KissOfDeathState.kissOfDeathNo:
      buildLogString(`KissOfDeathNo, adding ${evalPriorKissOfDeathNo}`)
      evaluation = evaluation + evalPriorKissOfDeathNo
      break
    default:
      break
  }

  switch (priorKissStates.murderState) {
    case KissOfMurderState.kissOfMurderCertainty:
      buildLogString(`KissOfMurderCertainty, adding ${evalPriorKissOfMurderCertainty}`)
      evaluation = evaluation + evalPriorKissOfMurderCertainty
      break
    case KissOfMurderState.kissOfMurderMaybe:
      buildLogString(`KissOfMurderMaybe, adding ${evalPriorKissOfMurderMaybe}`)
      evaluation = evaluation + evalPriorKissOfMurderMaybe
      break
    case KissOfMurderState.kissOfMurderAvoidance:
      buildLogString(`KissOfMurderAvoidance, adding ${evalPriorKissOfMurderAvoidance}`)
      evaluation = evaluation + evalPriorKissOfMurderAvoidance
      break
    case KissOfMurderState.kissOfMurderNo:
    default:
      break
  }
  // if this state's murder prey was my snake & it's not a duel, give a reward so I assume other snakes are out to get me
  if (!isDuel && priorKissStates.prey !== undefined && priorKissStates.prey.id === gameState.you.id) {
    buildLogString(`KissOfMurder prey was ${gameState.you.name}, adding ${evalPriorKissOfMurderSelfBonus}`)
    evaluation = evaluation + evalPriorKissOfMurderSelfBonus
  }

  // penalize or rewards spaces next to hazard
  if (isAdjacentToHazard(myself.head, board2d, gameState)) {
    buildLogString(`hazard wall penalty, add ${evalHazardWallPenalty}`)
    evaluation = evaluation + evalHazardWallPenalty
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

  const kingOfTheSnakes = isKingOfTheSnakes(myself, gameState.board)
  let longestSnake = getLongestSnake(myself, otherSnakes)
  if (kingOfTheSnakes) { // want to give slight positive evals towards states closer to longestSnake
    if (!(snakeDelta === 2 && snakeHasEaten(myself, lookahead))) { // only add kingsnake calc if I didn't just become king snake, otherwise will mess with other non king states
      if (longestSnake.id !== myself.id) { // if I am not the longest snake, seek it out
        let kingSnakeCalq = getDistance(myself.head, longestSnake.head) * evalKingSnakeStep // lower distances are better, evalKingSnakeStep should be negative
        buildLogString(`kingSnake seeker, adding ${kingSnakeCalq}`)
        evaluation = evaluation + kingSnakeCalq
      }
    }
  } else if (isKingOfTheSnakes(longestSnake, gameState.board) && !isOriginalSnake) { // for otherSnakes, add a small nudge away from king snakes
    let kingSnakeAvoidCalq = -(getDistance(myself.head, longestSnake.head) * evalKingSnakeStep) // lower distances are worse, multiply by -1 to make this a reward
    buildLogString(`kingSnake avoider, adding ${kingSnakeAvoidCalq}`)
    evaluation = evaluation + kingSnakeAvoidCalq
  }

  const foodSearchDepth = calculateFoodSearchDepth(gameState, myself, board2d, kingOfTheSnakes)
  const nearbyFood = findFood(foodSearchDepth, gameState.board.food, myself.head)
  let foodToHunt : Coord[] = []

  let j = foodSearchDepth
  let foodCalc : number = 0
  for (let i: number = 1; i <= foodSearchDepth; i++) {
    foodToHunt = nearbyFood[i]
    if (snakeHasEaten(myself, lookahead)) {
      // if snake has eaten recently, add that food back when calculating food score so as not to penalize it for eating that food
      if (foodToHunt) {
        foodToHunt.push(myself.head)
      } else {
        foodToHunt = [myself.head]
      }
    }
    if (foodToHunt && foodToHunt.length > 0) {
      // for each piece of found found at this depth, add some score. Score is higher if the depth i is lower, since j will be higher when i is lower
      let foodCalcStep = 0
      foodCalcStep = evalFoodVal * (evalFoodStep + j) * foodToHunt.length
      // if (i === 1) {
      //   foodCalcStep = 2*(evalFoodVal * (evalFoodStep + j) * foodToHunt.length) // food immediately adjacent is twice as valuable, plus some, to other food
      // } else {
      //   foodCalcStep = evalFoodVal * (evalFoodStep + j) * foodToHunt.length
      // }
      buildLogString(`found ${foodToHunt.length} food at depth ${i}, adding ${foodCalcStep}`)
      foodCalc = foodCalc + foodCalcStep
    }
    j = j - 1
  }

  buildLogString(`adding food calc ${foodCalc}`)
  evaluation = evaluation + foodCalc

  let canCutoffSnake: boolean = otherSnakes.some(function findSnakeToCutOff(snake) { // returns true if myself can cut off any otherSnake
    return isCutoff(gameState, myself, snake, board2d) // returns true if myself can cut snake off
  })
  if (canCutoffSnake) {
    buildLogString(`attempting left cutoff, adding ${evalCutoffReward}`)
    evaluation = evaluation + evalCutoffReward
  }

  let canBeCutoffBySnake: boolean = otherSnakes.some(function findSnakeToBeCutOffBy(snake) { // returns true if any otherSnake can cut myself off
    return isCutoff(gameState, snake, myself, board2d) // returns true if snake can cut myself off
  })
  if (canBeCutoffBySnake) {
    buildLogString(`can be cut off, adding ${evalCutoffPenalty}`)
    evaluation = evaluation + evalCutoffPenalty
  }

  if (isCorner) { // corners are bad don't go into them unless totally necessary
    //let closestSnake: Battlesnake | undefined
    let closestSnakeDist: number | undefined

    otherSnakes.forEach(function findClosestSnake(snake) {
      let thisDist = getDistance(snake.head, myself.head)
      if (closestSnakeDist === undefined) {
        //closestSnake = snake
        closestSnakeDist = thisDist
      } else if (closestSnakeDist > thisDist) {
        //closestSnake = snake
        closestSnakeDist = thisDist
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

  if (safeCellPercentage < evalTailChasePercentage || (isDuel && snakeDelta < 0)) {
    let tailDist = getDistance(myself.body[myself.body.length - 1], myself.head) // distance from head to tail
    buildLogString(`chasing tail, adding ${evalTailChase * tailDist}`)
    evaluation = evaluation + (evalTailChase * tailDist)
  }

  buildLogString(`final evaluation: ${evaluation}`)
//   logToFile(evalWriteStream, `eval log: ${logString}
// `)
  return evaluation
}