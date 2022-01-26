import { GameState } from "./types"
import { Direction, Battlesnake, Board2d, Moves, Coord, KissOfDeathState, KissOfMurderState, HazardWalls, KissStatesForEvaluate } from "./classes"
import { createWriteStream } from "fs"
import { findMoveNeighbors, findKissDeathMoves, findKissMurderMoves, calculateFoodSearchDepth, findFood, snakeLengthDelta, snakeHasEaten, kissDecider, isCutoff, isHazardCutoff, isAdjacentToHazard, calculateCenterWithHazard, getAvailableMoves, isCorner, isOnHorizontalWall, isOnVerticalWall, cloneGameState, isSandwich, isFaceoff, createGameDataId, calculateReachableCells } from "./util"
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

  // addresses an edge case where tie score is wildly higher due food immediacy bonuses. That score is not representative of a neutral state.
  if (newSnakeSelf.health === newSnakeOther.health && newSnakeSelf.health === 100) {
    newSnakeSelf.health = 90 // less health than max - lookahead
    newSnakeOther.health = newSnakeSelf.health
  }

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
  let isOriginalSnake: boolean = _myself !== undefined && _myself.id === gameState.you.id // true if _myself's id matches the original you of the game
  let otherSnakeHealth: number = 0
  otherSnakes.forEach(snake => {
    otherSnakeHealth = otherSnakeHealth + snake.health
  })

  const board2d = new Board2d(gameState, true)
  const hazardDamage = gameState.game.ruleset.settings.hazardDamagePerTurn
  const snakeDelta = myself !== undefined ? snakeLengthDelta(myself, gameState.board) : -1
  const isDuel: boolean = (gameState.board.snakes.length === 2) && (myself !== undefined) // don't consider duels I'm not a part of
  const isSolo: boolean = gameState.game.ruleset.name === "solo"

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
  const evalBase: number = 500
  const evalNoMe: number = -1500 // no me is the worst possible state, give a very bad score
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
  
  const evalHealthBase = 75 // evalHealth tiers should differ in severity based on how hungry I am
  const evalHealthStep = 3
  const evalHealthTierDifference = 10

  const evalHealthOthersnakeStep = -2 // penalty for each point of health otherSnakes have
  const evalHealthOthersnakeDuelStep = -3
  const evalHealthEnemyThreshold = 50 // enemy health at which we try harder to starve other snakes out

  const evalLengthMult = isSolo? -20 : 15 // larger values result in more food prioritization. Negative preference towards length in solo
  let evalLengthMaxDelta: number = 6 // largest size difference that evaluation continues rewarding

  const evalPriorKissOfDeathCertainty = isOriginalSnake? -800 : 0 // otherSnakes can pick again, let them evaluate this without fear of death

  let evalPriorKissOfDeathCertaintyMutual: number
  if (isDuel || gameState.board.snakes.length === 0) { // if it's a duel (or it was a duel before we rushed into eachother), we don't want to penalize snake for moving here if it's the best tile
    evalPriorKissOfDeathCertaintyMutual = 0
  } else if (!isOriginalSnake && priorKissStates.predator?.id === gameState.you.id) {
    evalPriorKissOfDeathCertaintyMutual = 100 // tell otherSnakes to kamikaze into me so that my snake is less inclined to go there - they can always rechoose if this forces us into the same square
  } else { // it's not a duel & it's original snake or another snake not vs me, give penalty for seeking a tile that likely wouldn't kill me, but might
    evalPriorKissOfDeathCertaintyMutual = -400
  }
  //const evalPriorKissOfDeathCertaintyMutual = isDuel? 0 : -50 // in a duel, this is a tie, consider it neutrally. In a non-duel, the otherSnake won't want to do this, so only small penalty for risking it
  const evalPriorKissOfDeathMaybe = isOriginalSnake? -400 : 0 // this cell is a 50/50. otherSnakes can pick again, let them evaluate this without fear of death
  
  let evalPriorKissOfDeathMaybeMutual: number
  if (isDuel || gameState.board.snakes.length === 0) { // if it's a duel (or it was a duel before we rushed into eachother), we don't want to penalize snake for moving here if it's the best tile
    evalPriorKissOfDeathMaybeMutual = 0
  } else if (!isOriginalSnake && priorKissStates.predator?.id === gameState.you.id) {
    evalPriorKissOfDeathMaybeMutual = 75 // tell otherSnakes to kamikaze into me so that my snake is less inclined to go there - they can always rechoose if this forces us into the same square
  } else { // it's not a duel & it's original snake or another snake not vs me, give penalty for seeking a tile that likely wouldn't kill me, but might. Smaller penalty than certainty, as it's more uncertain
    evalPriorKissOfDeathMaybeMutual = -300
  }
  
  const evalPriorKissOfDeath3To1Avoidance = 0
  const evalPriorKissOfDeath3To2Avoidance = evalPriorKissOfDeath3To1Avoidance
  const evalPriorKissOfDeath2To1Avoidance = evalPriorKissOfDeath3To1Avoidance
  const evalPriorKissOfDeathNo = 0

  const evalPriorKissOfMurderCertainty = 80 // this state is strongly likely to have killed a snake
  const evalPriorKissOfMurderMaybe = 40 // this state had a 50/50 chance of having killed a snake
  const evalPriorKissOfMurderFaceoff = 75 // this state had an unlikely chance of having killed a snake, but it means we closed the distance on a faceoff, which is great
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
  let evalFoodVal = 2

  if (gameState.turn < 3) {
    evalFoodVal = 50 // simply, should always want to get the starting food
  } else if (isDuel && otherSnakeHealth < evalHealthEnemyThreshold) { // care a bit more about food to try to starve the other snake out
    evalFoodVal = 3
  } else if (isDuel && snakeDelta < -4) { // care a bit less about food due to already being substantially smaller
    evalFoodVal = 1
  } else if (snakeDelta < 1) { // care a bit more about food to try to regain the length advantage
    evalFoodVal = 3
  } else if (isSolo) {
    evalFoodVal = 0.3 // very small nudge towards food, even when starving
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
  const evalVoronoiDeltaBonus = isDuel? 75 : 50
  const evalVoronoiOtherSnakeDivider = 3

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

  // penalize spaces that ARE hazard
  let myCell = board2d.getCell(myself.head)
  if (myCell !== undefined && myCell.hazard) {
    buildLogString(`hazard space penalty, add ${evalHazardPenalty}`)
    evaluation = evaluation + evalHazardPenalty
  }

  // penalize or rewards spaces next to hazard, near when hazard will soon appear
  if (isAdjacentToHazard(myself.head, hazardWalls, gameState)) {
    buildLogString(`hazard wall penalty, add ${evalHazardWallPenalty}`)
    evaluation = evaluation + evalHazardWallPenalty
  }

  let wantToEat: boolean = true // condition for whether we currently want food
  let safeToEat: boolean = true // condition for whether it was safe to eat a food in our current cell

  // turn off food seeking if dueling, healthy, opponent is in hazard, & I'm not - hazard walling
  if (isDuel && hazardDamage > 0) {
    let opponentCell = board2d.getCell(otherSnakes[0].head)
    if (opponentCell?.hazard && myself.health > 20 && !(myCell?.hazard)) {
      if (snakeDelta > 0) { // still need to try to stay larger than otherSnakes. If wall fails, could come out of our gambit in a bad spot if we neglected food
        wantToEat = false
      }
    }
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

    buildLogString(`Health penalty for opponents, adding ${otherSnakeHealthPenalty}`)
    evaluation = evaluation + otherSnakeHealthPenalty
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
  if (deathStates.includes(priorKissStates.deathState)) { // eating this food had a likelihood of causing my death, that's not safe
    safeToEat = false
  }

  let delta = snakeDelta
  // general snake length metric. More long more good
  if (snakeHasEaten(myself) && !safeToEat) { // if it just ate & it's not safe to eat, don't reward it for the new extra length
    delta = snakeDelta - 1
  }

  if (isSolo) { // Penalize solo snake for being larger
    let penalty: number = myself.length * evalLengthMult // straight penalty for each length I am larger
    buildLogString(`snake delta reward, add ${penalty}`)
    evaluation = evaluation + penalty
  } else if (delta < 0) { // I am smaller than otherSnakes, give penalty accordingly.
    let penalty: number = delta * evalLengthMult // straight penalty for each length I am smaller than otherSnakes
    buildLogString(`snake delta reward, add ${penalty}`)
    evaluation = evaluation + penalty
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
    buildLogString(`snake delta reward, add ${award}`)
    evaluation = evaluation + award
  } else { // I am same length as otherSnakes, give penalty/reward accordingly
    if (otherSnakes.length > 1) { // small penalty for being the same length as otherSnakes in a non-duel
      buildLogString(`snake delta penalty, add ${-evalLengthMult}`)
      evaluation = evaluation - evalLengthMult
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
  let healthEval: number = determineHealthEval(myself, hazardDamage, evalHealthStep, evalHealthTierDifference, evalHealthBase, evalNoMe)
  buildLogString(`Health eval for myself, adding ${healthEval}`)
  evaluation = evaluation + healthEval

  if (isSolo && myself.health > 7) { // don't need to eat in solo mode until starving
    wantToEat = false
  } else if (isSolo && snakeHasEaten(myself, lookahead)) {
    wantToEat = true // need solo snake to not penalize itself in subsequent turns after eating
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

  let reachableCells = calculateReachableCells(gameState, board2d)

  let voronoiDelta: number = 0
  const voronoiMyself: number = reachableCells[myself.id]
  let voronoiLargest: number = 0
  otherSnakes.forEach(snake => { // find largest voronoi value amongst otherSnakes
    let voronoiOtherSnake: number | undefined = reachableCells[snake.id]
    if (voronoiOtherSnake !== undefined && voronoiOtherSnake > voronoiLargest) {
      voronoiLargest = voronoiOtherSnake
    }
  })
  voronoiDelta = voronoiMyself - voronoiLargest

  let voronoiReward: number
  if (voronoiMyself < evalVoronoiBaseGood) {
    let howBad: number = (evalVoronoiBaseGood - voronoiMyself) * evalVoronoiNegativeStep
    // so if negative step is -100, base good is 9, & voronoiMyself is 5, that makes for (9 - 5) * -100 = -400
    howBad = howBad < evalVoronoiNegativeMax? evalVoronoiNegativeMax : howBad
    voronoiReward = howBad
  } else if (voronoiMyself > evalVoronoiBaseGood) {
    let howGood: number = (voronoiMyself - evalVoronoiBaseGood) * evalVoronoiPositiveStep
    // so if positive step is 20, base good is 9, & voronoiMyself is 15, that makes for (15 - 9) * 20 = 120
    howGood = howGood > evalVoronoiPositiveMax? evalVoronoiPositiveMax : howGood // don't let howGood exceed the maximum
    voronoiReward = howGood
  } else {
    voronoiReward = evalVoronoiBase
  }
  buildLogString(`Voronoi bonus for self, adding ${voronoiReward}`)

  if (isDuel) { // give stronger & more specific rewards for board control in duel
    let voronoiOtherSnake: number = reachableCells[otherSnakes[0].id]
    let ratio = voronoiMyself / voronoiOtherSnake
    let reward: number = 0
    if (ratio > 1) { // give varying rewards depending on how much more board control I have
      if (ratio < 2) { // if my reachable cells are less than double that of otherSnake
        reward = evalVoronoiDeltaBonus // just a 50 reward
      } else if (ratio < 3) { // if my reachable cells are less than triple that of otherSnake
        reward = evalVoronoiDeltaBonus * 2 // 100 reward
      } else { // my reachable cells are more than triple that of otherSnake
        reward = evalVoronoiDeltaBonus * 4 // 200 reward
      }
    }
    voronoiReward = voronoiReward + reward
    buildLogString(`Voronoi bonus for having largest Voronoi, adding ${reward}`)
  } else {
    if (voronoiDelta > 0) { // reward for having better board control
      voronoiReward = voronoiReward + evalVoronoiDeltaBonus
      buildLogString(`Voronoi bonus for having largest Voronoi, adding ${evalVoronoiDeltaBonus}`)
    }
  }

  // more minmaxing - tells otherSnakes to reward positions that trap originalSnake
  if (!isOriginalSnake && originalSnake) {
    let originalSnakeVoronoi: number | undefined = reachableCells[originalSnake.id]
    if (originalSnakeVoronoi !== undefined) {
      if (originalSnakeVoronoi < evalVoronoiBaseGood) {
        let howBad: number = (evalVoronoiBaseGood - originalSnakeVoronoi) * evalVoronoiNegativeStep
        howBad = howBad < evalVoronoiNegativeMax? evalVoronoiNegativeMax : howBad
        howBad = howBad / evalVoronoiOtherSnakeDivider // reward for mitigating otherSnake Voronoi should be lesser than reward for chasing own
        voronoiReward = voronoiReward - howBad // will be double negative, hence actually adding
        buildLogString(`Voronoi bonus for limiting originalSnake Voronoi, adding ${-howBad}`)
      }
    }
  } else if (!isSolo && gameState.board.snakes.length === 1) { // add max otherSnake reward for last snake so as not to encourage it to keep snakes alive for that sweet reward
    let lastVoronoiReward: number = -(evalVoronoiNegativeMax / evalVoronoiOtherSnakeDivider) // this will be negative, so negate it to make it a reward
    voronoiReward = voronoiReward + lastVoronoiReward
    buildLogString(`Voronoi bonus for being the last snake in a non-solo, adding ${lastVoronoiReward}`)
  }

  if (gameState.turn > 1) { // don't calculate on early turns, just get early food
    buildLogString(`Voronoi bonus, adding ${voronoiReward}`)
    evaluation = evaluation + voronoiReward
  }

  buildLogString(`final evaluation: ${evaluation}`)
//   logToFile(evalWriteStream, `eval log: ${logString}
// `)
  return evaluation
}