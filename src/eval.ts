import { GameState } from "./types"
import { Direction, Battlesnake, Board2d, Moves, MoveNeighbors, Coord, SnakeCell, BoardCell, KissOfDeathState, KissOfMurderState } from "./classes"
import { createWriteStream } from "fs"
import { checkForSnakesHealthAndWalls, logToFile, getSurroundingCells, findMoveNeighbors, findKissDeathMoves, findKissMurderMoves, calculateFoodSearchDepth, isKingOfTheSnakes, findFood, getLongestSnake, getDistance, snakeLengthDelta, isInOrAdjacentToHazard, snakeToString, snakeHasEaten, getSafeCells, kissDecider, getSnakeDirection, isCutoff } from "./util"
import { futureSight } from "./logic"

let evalWriteStream = createWriteStream("consoleLogs_eval.txt", {
  encoding: "utf8"
})



// the big one. This function evaluates the state of the board & spits out a number indicating how good it is for input snake, higher numbers being better
// 1000: last snake alive, best possible state
// 0: snake is dead, worst possible state
export function evaluate(gameState: GameState, meSnake: Battlesnake | undefined, kissOfDeathState: KissOfDeathState, kissOfMurderState: KissOfMurderState, _priorHealth?: number) : number {
  const myself : Battlesnake | undefined = meSnake === undefined ? undefined : gameState.board.snakes.find(function findMe(snake) { return snake.id === meSnake.id})
  const otherSnakes: Battlesnake[] = meSnake === undefined ? gameState.board.snakes : gameState.board.snakes.filter(function filterMeOut(snake) { return snake.id !== meSnake.id})
  const board2d = new Board2d(gameState.board)
  const hazardDamage = gameState.game.ruleset.settings.hazardDamagePerTurn

  const isOriginalSnake = myself !== undefined && myself.id === gameState.you.id // true if snake's id matches the original you of the game

  // values to tweak
  const evalBase: number = 500
  const evalNoSnakes: number = 400 // no snakes can be legitimately good. Ties are fine, & is the other snake chickened, we may be better off. Consider 400 a moderately 'good' move.
  const evalNoMe: number = -4000 // no me is the worst possible state, give a very bad score
  const evalSnakeCount = -100 // assign penalty based on number of snakes left in gameState
  const evalSolo: number = 1000
  const evalWallPenalty: number = -5 //-25
  const evalHazardWallPenalty: number = -3 // small penalty, but hazard walls may turn into hazard at any moment, so don't stay too close
  const evalHazardPenalty: number = -(hazardDamage) // in addition to health considerations & hazard wall calqs, make it slightly worse in general to hang around inside of the sauce
  // TODO: Evaluate removing or neutering the Moves metric & see how it performs
  const eval0Move = -700
  const eval1Move = 0 // was -50, but I don't think 1 move is actually too bad - I want other considerations to matter between 2 moves & 1
  const eval2Moves = isOriginalSnake? 2 : 20 // want this to be higher than the difference then eval1Move & evalWallPenalty, so that we choose wall & 2 move over no wall & 1 move
  const eval3Moves = isOriginalSnake? 4 : 40
  const eval4Moves = isOriginalSnake? 6 : 60
  const snakeLengthDiff: number = myself === undefined ? -1 : snakeLengthDelta(myself, gameState.board)
  const evalHealthStep = 2
  const evalHealthTierDifference = 10
  const evalHealth7 = 75 // evalHealth tiers should differ in severity based on how hungry I am
  const evalHealth6 = evalHealth7 - evalHealthTierDifference // 75 - 10 = 65
  const evalHealth5 = evalHealth6 - evalHealthTierDifference - (evalHealthStep * 1) // 65 - 10 - (1 * 1) = 54
  const evalHealth4 = evalHealth5 - evalHealthTierDifference - (evalHealthStep * 2) // 54 - 10 - (1 * 2) = 42
  const evalHealth3 = evalHealth4 - evalHealthTierDifference - (evalHealthStep * 3) // 42 - 10 - (1 * 3) = 29
  const evalHealth2 = evalHealth3 - evalHealthTierDifference - (evalHealthStep * 4) // 29 - 10 - (1 * 4) = 15
  const evalHealth1 = evalHealth2 - evalHealthTierDifference - (evalHealthStep * 5) // 15 - 10 - (1 * 5) = 0
  const evalHealth0 = -200 // this needs to be a steep penalty, else may choose never to eat
  const evalHealthStarved = evalNoMe // there is never a circumstance where starving is good, even other snake bodies are better than this
  let evalHasEaten = evalHealth7 + 50 // should be at least evalHealth7, plus some number for better-ness. Otherwise will prefer to be almost full to full. Also needs to be high enough to overcome food nearby score for the recently eaten food
  const evalLengthMult = 2
  const starvingHealth = 10 // below this, we are starving
  let priorHealth: number = 0
  if (_priorHealth === undefined && myself !== undefined) {
    priorHealth = myself.health
  } else if (_priorHealth !== undefined) {
    priorHealth = _priorHealth
  }
  if (snakeLengthDiff >= 4 && kissOfMurderState === KissOfMurderState.kissOfMurderNo) { // usually food is great, but unnecessary growth isn't. Avoid food unless it's part of a kill move
    evalHasEaten = -20
  } else if (gameState.board.snakes.length === 1) {
    evalHasEaten = -20 // for solo games, we want to avoid food when we're not starving
  }

  const evalPriorKissOfDeathCertainty = -800 // everywhere seemed like certain death
  const evalPriorKissOfDeathMaybe = -400 // this cell is a 50/50
  const evalPriorKissOfDeath3To1Avoidance = 0
  const evalPriorKissOfDeath3To2Avoidance = 0
  const evalPriorKissOfDeath2To1Avoidance = 0
  const evalPriorKissOfDeathNo = 0
  const evalPriorKissOfMurderCertainty = 80 // we can kill a snake, this is probably a good thing
  const evalPriorKissOfMurderMaybe = 40 // we can kill a snake, but they have at least one escape route or 50/50

  const evalKissOfDeathCertainty = -400 // everywhere seems like certain death
  const evalKissOfDeathMaybe = -200 // a 50/50 on whether we will be kissed to death next turn
  const evalKissOfDeath3To1Avoidance = 0
  const evalKissOfDeath3To2Avoidance = 0
  const evalKissOfDeath2To1Avoidance = 0
  const evalKissOfDeathNo = 0
  const evalKissOfMurderCertainty = 50 // we can kill a snake, this is probably a good thing
  const evalKissOfMurderMaybe = 25 // we can kill a snake, but they have at least one escape route or 50/50
  const evalFoodVal = 2
  const evalFoodStep = 1
  const evalKingSnakeStep = -2 // negative means that higher distances from king snake will result in lower score
  const evalCutoffReward = 35
  const evalCutoffPenalty = -75 // while not all snakes will do the cutoff, this is nonetheless a very bad state for us
  const evalTailChase = -4 // given four directions, two will be closer to tail, two will be further, & closer dirs will always be 2 closer than further dirs
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
    logToFile(evalWriteStream, `no snakes, return ${evalNoSnakes}`)
    return evalNoSnakes // if no snakes are left, I am dead, but so are the others. It's better than just me being dead, at least
  }
  if (!(myself instanceof Battlesnake)) {
    logToFile(evalWriteStream, `no myself snake, return ${evalNoMe}`)
    return evalNoMe // if mySnake is not still in the game board, it's dead. This is a bad evaluation.
    //evaluation = evaluation + evalNoMe // if mySnake is not still in the game board, it's dead. This is a bad evaluation.
  }
  if (otherSnakes.length === 0) {
    buildLogString(`no other snakes, add ${evalSolo}`)
    evaluation = evaluation + evalSolo // it's great if no other snakes exist, but solo games are still a thing. Give it a high score to indicate superiority to games with other snakes still in it, but continue evaluating so solo games can still evaluate scores
  } else {
    buildLogString(`other snakes are in game, multiply their number by evalSnakeCount & add to eval: ${evalSnakeCount} * ${otherSnakes.length}`)
    evaluation = evaluation + (evalSnakeCount * otherSnakes.length)
  }

  // give walls a penalty, & corners a double penalty
  if (myself.head.x === 0) {
    buildLogString(`self head x at 0, add ${evalWallPenalty}`)
    evaluation = evaluation + evalWallPenalty
  } else if (myself.head.x === (gameState.board.width - 1)) {
    buildLogString(`self head x at width ${myself.head.x}, add ${evalWallPenalty}`)
    evaluation = evaluation + evalWallPenalty
  }
  if (myself.head.y === 0) {
    buildLogString(`self head y at 0, add ${evalWallPenalty}`)
    evaluation = evaluation + evalWallPenalty
  } else if (myself.head.y === (gameState.board.height - 1)) {
    buildLogString(`self head y at height ${myself.head.y}, add ${evalWallPenalty}`)
    evaluation = evaluation + evalWallPenalty
  }

  // in addition to wall/corner penalty, give a bonus to being closer to center
  const centerX = (gameState.board.width - 1) / 2
  const centerY = (gameState.board.height - 1) / 2

  const xDiff = -Math.abs(myself.head.x - centerX)
  const yDiff = -Math.abs(myself.head.y - centerY)

  buildLogString(`adding xDiff ${xDiff}`)
  evaluation = evaluation + xDiff
  buildLogString(`adding yDiff ${yDiff}`)
  evaluation = evaluation + yDiff
  
  // give bonuses & penalties based on how many technically 'valid' moves remain after removing walls & other snake cells
  const possibleMoves = new Moves(true, true, true, true)

  // health considerations, which are effectively hazard considerations
  if (snakeHasEaten(myself, futureSight)) { // given a lookahead, try not to penalize snake for eating & then not being so close to food the next two states
    buildLogString(`got food, add ${evalHasEaten}`)
    evaluation = evaluation + evalHasEaten
  } else {
    let validHazardTurns = myself.health / (hazardDamage + 1)
    if (myself.health <= 0) {
      buildLogString(`HealthStarved, adding ${evalHealthStarved}`)
      evaluation = evaluation + evalHealthStarved
    } else if (hazardDamage <= 5 && myself.health < 10) { // in a non-hazard game, we still need to prioritize food at some point
      buildLogString(`Health0, adding ${evalHealth0}`)
      evaluation = evaluation + evalHealth0
    }else if (validHazardTurns > 6) {
      buildLogString(`Health7, adding ${evalHealth7}`)
      evaluation = evaluation + evalHealth7
    } else if (validHazardTurns > 5) {
      buildLogString(`Health6, adding ${evalHealth6}`)
      evaluation = evaluation + evalHealth6
    } else if (validHazardTurns > 4) {
      buildLogString(`Health5, adding ${evalHealth5}`)
      evaluation = evaluation + evalHealth5
    } else if (validHazardTurns > 3) {
      buildLogString(`Health4, adding ${evalHealth4}`)
      evaluation = evaluation + evalHealth4
    } else if (validHazardTurns > 2) {
      buildLogString(`Health3, adding ${evalHealth3}`)
      evaluation = evaluation + evalHealth3     
    } else if (validHazardTurns > 1) {
      buildLogString(`Health2, adding ${evalHealth2}`)
      evaluation = evaluation + evalHealth2 
    } else if (validHazardTurns > 0) {
      buildLogString(`Health1, adding ${evalHealth0}`)
      evaluation = evaluation + evalHealth0
    } else {
      buildLogString(`Health0, adding ${evalHealth0}`)
      evaluation = evaluation + evalHealth0
    }
  }

  checkForSnakesHealthAndWalls(myself, gameState, board2d, possibleMoves)
  let validMoves : Direction[] = possibleMoves.validMoves()
  let availableMoves : number = validMoves.length

  // look for kiss of death & murder cells in this current configuration
  let moveNeighbors = findMoveNeighbors(gameState, myself, board2d, possibleMoves)
  let kissOfMurderMoves = findKissMurderMoves(myself, board2d, moveNeighbors)
  let kissOfDeathMoves = findKissDeathMoves(myself, board2d, moveNeighbors)
  //logToFile(evalWriteStream, `kissOfMurderMoves: ${kissOfMurderMoves.toString()}`)
  //logToFile(evalWriteStream, `kissOfDeathMoves: ${kissOfDeathMoves.toString()}`)

  let kissStates = kissDecider(gameState, moveNeighbors, kissOfDeathMoves, kissOfMurderMoves, possibleMoves, board2d)

  if (kissStates.canAvoidPossibleDeath(possibleMoves)) {
    buildLogString(`No kisses of death nearby, adding ${evalKissOfDeathNo}`)
    evaluation = evaluation + evalKissOfDeathNo
  } else if (kissStates.canAvoidCertainDeath(possibleMoves)) {
    buildLogString(`Need to deal with possible kisses of death nearby, adding ${evalKissOfDeathMaybe}`)
    evaluation = evaluation + evalKissOfDeathMaybe
  } else {
    buildLogString(`Only kisses of death nearby, adding ${evalKissOfDeathCertainty}`)
    evaluation = evaluation + evalKissOfDeathCertainty
  }

  if (kissStates.canCommitCertainMurder(possibleMoves)) {
    buildLogString(`Certain kiss of murder nearby, adding ${evalKissOfMurderCertainty}`)
    evaluation = evaluation + evalKissOfMurderCertainty
  } else if (kissStates.canCommitPossibleMurder(possibleMoves)) {
    buildLogString(`Possible kiss of murder nearby, adding ${evalKissOfMurderMaybe}`)
    evaluation = evaluation + evalKissOfMurderMaybe
  } else {
    buildLogString(`No kisses of murder nearby, adding ${evalKissOfDeathNo}`)
    evaluation = evaluation + evalKissOfDeathNo
  }

  
  // for kisses from the previous move state
  // The only one that really matters is the one indicating 50/50. kissOfDeathCertainty is also bad but likely we're already dead at that point
  switch (kissOfDeathState) {
    case KissOfDeathState.kissOfDeathCertainty:
      buildLogString(`KissOfDeathCertainty, adding ${evalPriorKissOfDeathCertainty}`)
      evaluation = evaluation + evalPriorKissOfDeathCertainty
      break
    case KissOfDeathState.kissOfDeathMaybe:
      buildLogString(`KissOfDeathMaybe, adding ${evalPriorKissOfDeathMaybe}`)
      evaluation = evaluation + evalPriorKissOfDeathMaybe
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

  switch (kissOfMurderState) {
    case KissOfMurderState.kissOfMurderCertainty:
      buildLogString(`KissOfMurderCertainty, adding ${evalPriorKissOfMurderCertainty}`)
      evaluation = evaluation + evalPriorKissOfMurderCertainty
      break
    case KissOfMurderState.kissOfMurderMaybe:
      buildLogString(`KissOfMurderMaybe, adding ${evalPriorKissOfMurderMaybe}`)
      evaluation = evaluation + evalPriorKissOfMurderMaybe
      break
    case KissOfMurderState.kissOfMurderNo:
    default:
      break
  }

  // penalize spaces next to hazard
  if (isInOrAdjacentToHazard(myself.head, board2d, gameState)) {
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
  availableMoves = kissOfMurderState === KissOfMurderState.kissOfMurderCertainty ? availableMoves + 1 : availableMoves
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
  if (kingOfTheSnakes) { // want to give slight positive evals towards states closer to longestSnake
    let longestSnake = getLongestSnake(myself, otherSnakes)
    let snakeDelta = snakeLengthDelta(myself, gameState.board)
    if (!(snakeDelta === 2 && snakeHasEaten(myself, futureSight))) { // only add kingsnake calc if I didn't just become king snake, otherwise will mess with other non king states
      if (longestSnake.id !== myself.id) { // if I am not the longest snake, seek it out
        let kingSnakeCalc = getDistance(myself.head, longestSnake.head) * evalKingSnakeStep // lower distances are better, evalKingSnakeStep should be negative
        buildLogString(`kingSnake seeker, adding ${kingSnakeCalc}`)
        evaluation = evaluation + kingSnakeCalc
      }
    }
  }

  const foodSearchDepth = calculateFoodSearchDepth(gameState, myself, board2d, kingOfTheSnakes)
  const nearbyFood = findFood(foodSearchDepth, gameState.board.food, myself.head)
  let foodToHunt : Coord[] = []

  let j = foodSearchDepth
  let foodCalc : number = 0
  for (let i: number = 1; i <= foodSearchDepth; i++) {
    foodToHunt = nearbyFood[i]
    if (snakeHasEaten(myself, futureSight)) {
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

  // TODO: Get board2d spaces in a 5x5 grid surrounding me, count the number that has no snakes & count the number that has no hazard, & assign a value for more open spaces
  // don't do a grid, do spaces away
  // for xdist: 0, get all coords with ydist 1, 2, 3, 4, 5 away in either direction
  // for xdist: 1, get all coords ydist 1, 2, 3, 4 away in either direction
  // for xdist: 2, get all coords ydist 1, 2, 3 away in either direction
  // for xdist: 3, get all coords ydist 1, 2 away in either direction
  // for xdist: 4, get all coords ydist 1 away in either direction
  // for xdist: 5, none

  //board2d.printBoard()

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

  // only run getescape route when possiblemoves is 1?
  // function _getEscapeRoute(me: Battlesnake, board2d: Board2d, longestRoute: number) : number {
  //   if (longestRoute >= me.length) {
  //     return longestRoute
  //   }
  //   const moves = new Moves(true, true, true, true)
  //   checkForSnakesAndWalls(me, board2d, moves)
  //   const validMoves = moves.validMoves()

  //   possibleMoves.validMoves().forEach(function checkDirection(move) {
  //     let newCoord : Coord
  //     switch (move) {
  //       case Direction.Up:
  //         newCoord = {x: me.head.x, y: me.head.y + 1}
  //         break
  //       case Direction.Down:
  //         newCoord = {x: me.head.x, y: me.head.y - 1}
  //         break
  //       case Direction.Left:
  //         newCoord = {x: me.head.x + 1, y: me.head.y}
  //         break
  //       default: //case Direction.Right:
  //         newCoord = {x: me.head.x - 1, y: me.head.y}
  //         break
  //     }
  //     let newCell = board2d.getCell(newCoord)
  //     if (newCell instanceof BoardCell) {
  //       if (!(newCell.snakeCell instanceof SnakeCell)) { // if we pass this, it's a valid cell

  //       } // else it is a snake cell, it's not a valid cell
  //     } // else it's not a valid cell, must've been out of bounds
  //   })
  // }

  // // calculate the longest I can go without dying, up to my length if possible
  // function getEscapeRoute(me: Battlesnake, gameState: GameState) : number {
  //   let longestRoute : number = 0
  //   let board2d = new Board2d(gameState.board)
  // }

  let safeCells: number = getSafeCells(board2d)
  const numCells: number = board2d.height * board2d.width
  const safeCellPercentage: number = (safeCells * 100) / numCells

  if (safeCellPercentage < evalTailChasePercentage) {
    let tailDist = getDistance(myself.body[myself.body.length - 1], myself.head) // distance from head to tail
    buildLogString(`chasing tail, adding ${evalTailChase * tailDist}`)
    evaluation = evaluation + (evalTailChase * tailDist)
  }

  buildLogString(`final evaluation: ${evaluation}`)
  logToFile(evalWriteStream, `eval log: ${logString}
`)
//   if (myself.id === gameState.you.id) {
//     logToFile(evalWriteStream, `eval log: ${logString}
// `)
//   }
  return evaluation
}