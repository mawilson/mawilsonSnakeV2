import { GameState } from "./types"
import { Battlesnake, Board2d, Moves, MoveNeighbors, Coord, SnakeCell, BoardCell, KissOfDeathState, KissOfMurderState } from "./classes"
import { createWriteStream } from "fs"
import { checkForSnakesHealthAndWalls, logToFile, getSurroundingCells, findMoveNeighbors, findKissDeathMoves, findKissMurderMoves, calculateFoodSearchDepth, isKingOfTheSnakes, findFood, getLongestSnake, getDistance, snakeLengthDelta, isInOrAdjacentToHazard, snakeToString, snakeHasEaten, getSafeCells, kissDecider, getSnakeDirection } from "./util"

let evalWriteStream = createWriteStream("consoleLogs_eval.txt", {
  encoding: "utf8"
})



// the big one. This function evaluates the state of the board & spits out a number indicating how good it is for input snake, higher numbers being better
// 1000: last snake alive, best possible state
// 0: snake is dead, worst possible state
export function evaluate(gameState: GameState, meSnake: Battlesnake | undefined, kissOfDeathState: KissOfDeathState, kissOfMurderState: KissOfMurderState, wasStarving: boolean) : number {
  const myself : Battlesnake | undefined = meSnake === undefined ? undefined : gameState.board.snakes.find(function findMe(snake) { return snake.id === meSnake.id})
  const otherSnakes: Battlesnake[] = meSnake === undefined ? gameState.board.snakes : gameState.board.snakes.filter(function filterMeOut(snake) { return snake.id !== meSnake.id})
  const board2d = new Board2d(gameState.board)
  
  // values to tweak
  const evalBase: number = 500
  const evalNoSnakes: number = -3000 // no snakes is bad, but not as bad as evalNoMe
  const evalNoMe: number = -4000 // no me is the worst possible state, give a very bad score
  const evalSnakeCount = -100 // assign penalty based on number of snakes left in gameState
  const evalSolo: number = 1000
  const evalWallPenalty: number = -5 //-25
  const evalHazardWallPenalty: number = -3 // small penalty, but hazard walls may turn into hazard at any moment, so don't stay too close
  // TODO: Evaluate removing or neutering the Moves metric & see how it performs
  const eval0Move = -300
  const eval1Move = 0 // was -50, but I don't think 1 move is actually too bad - I want other considerations to matter between 2 moves & 1
  const eval2Moves = 1 // want this to be higher than the difference then eval1Move & evalWallPenalty, so that we choose wall & 2 move over no wall & 1 move
  const eval3Moves = 2
  const eval4Moves = 3
  const snakeLengthDiff: number = myself === undefined ? -1 : snakeLengthDelta(myself, gameState.board)
  const evalHealthStep = 1
  const evalHealthTierDifference = 10
  const evalHealth7 = 75 // evalHealth tiers should differ in severity based on how hungry I am
  const evalHealth6 = evalHealth7 - evalHealthTierDifference // 75 - 10 = 65
  const evalHealth5 = evalHealth6 - evalHealthTierDifference - (evalHealthStep * 1) // 65 - 10 - (1 * 1) = 54
  const evalHealth4 = evalHealth5 - evalHealthTierDifference - (evalHealthStep * 2) // 54 - 10 - (1 * 2) = 42
  const evalHealth3 = evalHealth4 - evalHealthTierDifference - (evalHealthStep * 3) // 42 - 10 - (1 * 3) = 29
  const evalHealth2 = evalHealth3 - evalHealthTierDifference - (evalHealthStep * 4) // 29 - 10 - (1 * 4) = 15
  const evalHealth1 = evalHealth2 - evalHealthTierDifference - (evalHealthStep * 5) // 15 - 10 - (1 * 5) = 0
  const evalHealth0 = -200 // this needs to be a steep penalty, else may choose never to eat
  const evalHealthStarved = -1000 // there is never a circumstance where starving is good, even other snake bodies are better than this
  let evalHasEaten = evalHealth7 + 25 // should be at least evalHealth7, plus some number for better-ness. Otherwise will prefer to be almost full to full. Also needs to be high enough to overcome food nearby score for the recently eaten food
  if (wasStarving) { // starving snakes must get food, but non-starving snake eval scores get high scores from food near them. Use this to offset those high scores
    evalHasEaten = 1000 // food scores can get pretty high!

  } else if (gameState.board.snakes.length === 1 || snakeLengthDiff >= 4) { // usually food is great, but unnecessary growth isn't
    evalHasEaten = -20
  }
  const evalKissOfDeathCertainty = -400 // everywhere seemed like certain death
  const evalKissOfDeathMaybe = -200 // a 50/50 on whether we were kissed to death this turn
  const evalKissOfDeath3To1Avoidance = 0
  const evalKissOfDeath3To2Avoidance = 0
  const evalKissOfDeath2To1Avoidance = 0
  const evalKissOfDeathNo = 0
  const evalKissOfMurderCertainty = 50 // we can kill a snake, this is probably a good thing
  const evalKissOfMurderMaybe = 25 // we can kill a snake, but they have at least one escape route or 50/50
  const evalFoodVal = 2
  const evalFoodStep = 1
  const evalKingSnakeStep = -2 // negative means that higher distances from king snake will result in lower score
  const evalCutoff = 35
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
    buildLogString(`no snakes, return ${evalNoSnakes}`)
    return evalNoSnakes // if no snakes are left, I am dead, but so are the others. It's better than just me being dead, at least
  }
  if (!(myself instanceof Battlesnake)) {
    buildLogString(`no myself snake, add ${evalNoMe}`)
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
  if (myself.health === 100) {
    buildLogString(`got food, add ${evalHasEaten}`)
    evaluation = evaluation + evalHasEaten
  } else {
    let hazardDamage = gameState.game.ruleset.settings.hazardDamagePerTurn
    let validHazardTurns = myself.health / hazardDamage
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
      buildLogString(`Health1, adding ${evalHealth1}`)
      evaluation = evaluation + evalHealth1
    } else {
      buildLogString(`Health0, adding ${evalHealth0}`)
      evaluation = evaluation + evalHealth0
    }
  }

  checkForSnakesHealthAndWalls(myself, gameState, board2d, possibleMoves)
  let validMoves : string[] = possibleMoves.validMoves()
  let availableMoves : number = validMoves.length

  // look for kiss of death & murder cells in this current configuration
  let moveNeighbors = findMoveNeighbors(myself, board2d, possibleMoves)
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
      buildLogString(`KissOfDeathCertainty, adding ${evalKissOfDeathCertainty}`)
      evaluation = evaluation + evalKissOfDeathCertainty
      break
    case KissOfDeathState.kissOfDeathMaybe:
      buildLogString(`KissOfDeathMaybe, adding ${evalKissOfDeathMaybe}`)
      evaluation = evaluation + evalKissOfDeathMaybe
      break
    case KissOfDeathState.kissOfDeath3To1Avoidance:
      buildLogString(`KissOfDeath3To1Avoidance, adding ${evalKissOfDeath3To1Avoidance}`)
      evaluation = evaluation + evalKissOfDeath3To1Avoidance
      break
    case KissOfDeathState.kissOfDeath3To2Avoidance:
      buildLogString(`KissOfDeath3To2Avoidance, adding ${evalKissOfDeath3To2Avoidance}`)
      evaluation = evaluation + evalKissOfDeath3To2Avoidance
      break
    case KissOfDeathState.kissOfDeath2To1Avoidance:
      buildLogString(`KissOfDeath2To1Avoidance, adding ${evalKissOfDeath2To1Avoidance}`)
      evaluation = evaluation + evalKissOfDeath2To1Avoidance
      break
    case KissOfDeathState.kissOfDeathNo:
      buildLogString(`KissOfDeathNo, adding ${evalKissOfDeathNo}`)
      evaluation = evaluation + evalKissOfDeathNo
      break
    default:
      break
  }

  switch (kissOfMurderState) {
    case KissOfMurderState.kissOfMurderCertainty:
      buildLogString(`KissOfMurderCertainty, adding ${evalKissOfMurderCertainty}`)
      evaluation = evaluation + evalKissOfMurderCertainty
      break
    case KissOfMurderState.kissOfMurderMaybe:
      buildLogString(`KissOfMurderMaybe, adding ${evalKissOfMurderMaybe}`)
      evaluation = evaluation + evalKissOfMurderMaybe
      break
    default: // "kissOfMurderNo":
      break
  }

  // penalize spaces next to hazard
  if (isInOrAdjacentToHazard(myself.head, board2d, gameState)) {
    buildLogString(`hazard wall penalty, add ${evalHazardWallPenalty}`)
    evaluation = evaluation + evalHazardWallPenalty
  }

  // if we're sure we're getting a kill, we're also sure that snake is dying, so we can increment our possible moves for evaluation purposes
  availableMoves = kissOfMurderState === KissOfMurderState.kissOfMurderCertainty ? availableMoves + 1 : availableMoves
  switch(availableMoves) {
    case 0:
      buildLogString(`possibleMoves 0, return ${eval0Move}`)
      evaluation = eval0Move // with no valid moves left, this state is just a notch above death
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
    if (!(snakeDelta === 2 && snakeHasEaten(myself))) { // only add kingsnake calc if I didn't just become king snake, otherwise will mess with other non king states
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
    if (foodToHunt && foodToHunt.length > 0) {
      // for each piece of found found at this depth, add some score. Score is higher if the depth i is lower, since j will be higher when i is lower
      let foodCalcStep = 0
      if (i === 1) {
        foodCalcStep = 2*(evalFoodVal * (evalFoodStep + j) * foodToHunt.length) // food immediately adjacent is twice as valuable, plus some, to other food
      } else {
        foodCalcStep = evalFoodVal * (evalFoodStep + j) * foodToHunt.length
      }
      buildLogString(`found ${foodToHunt.length} food at depth ${i}, adding ${foodCalcStep}`)
      foodCalc = foodCalc + foodCalcStep
    }
    j = j - 1
  }
  //if (foodCalc > 145) { foodCalc = 145 } // don't let the food heuristic explode - if it does, being hungry might become better than becoming full, even when dying
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

  // snake cutoff logic!
  otherSnakes.forEach(function isOnEdge(snake) {
    let snakeMoves = new Moves(true, true, true, true)
    checkForSnakesHealthAndWalls(snake, gameState, board2d, snakeMoves)
    //logToFile(evalWriteStream, `investigating ${snakeToString(snake)} for cutoff`)
    if (snake.head.x === 0) { // if they are on the left edge
      //logToFile(evalWriteStream, `snake is at 0`)
      if (myself.head.x === 1 || myself.head.x === 0) { // if I am next to them on the left edge
        //logToFile(evalWriteStream, `myself is at 1`)
        if (myself.head.y >= snake.head.y && getSnakeDirection(snake) === "up") { // if I am above snake, & it is moving up
          //logToFile(evalWriteStream, `myself is above or level with snake, & snake is moving up`)
          let cutoffCell = board2d.getCell({x: 1, y: snake.head.y}) // cell one to the right of snake's head - TODO: Make this snake's NECK after moving otherSnakes prior to evaluate
          //logToFile(evalWriteStream, `cutoffCell snakeCell is myself: ${cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.snake.id === myself.id}`)
          if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.snake.id === myself.id) { // if cutoffCell has me in it
            let myselfIsLonger = myself.length > snake.length // if my snake is longer
            if (myselfIsLonger) {
              let foundFood : number = 0
              for (let i: number = snake.head.y; i < myself.head.y; i++) { // if my snake remains longer after considering food that snake will find on the way
                let cell = board2d.getCell({x: 0, y: i})
                if (cell instanceof BoardCell && cell.food) {
                  foundFood = foundFood + 1
                }
              }
              myselfIsLonger = myself.length > (snake.length + foundFood)
            }
            if (myself.head.x === 0 && myselfIsLonger) { // only consider cutting off on left edge if I am longer
              buildLogString(`attempting up cutoff, adding ${evalCutoff}`)
              evaluation = evaluation + evalCutoff
            } else if (myself.head.x === 1 && !myselfIsLonger) { // only consider cutting off on top edge if I am not longer
              buildLogString(`attempting up cutoff, adding ${evalCutoff}`)
              evaluation = evaluation + evalCutoff
            }
          }
        } else if (myself.head.y <= snake.head.y && getSnakeDirection(snake) === "down") { // if I am below snake, & it is moving down
          let cutoffCell = board2d.getCell({x: 1, y: snake.head.y}) // cell one to the right of snake's head
          if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.snake.id === myself.id) { // if cutoffCell has me in it  
            let myselfIsLonger = myself.length > snake.length // if my snake is longer
            if (myselfIsLonger) {
              let foundFood : number = 0
              for (let i: number = snake.head.y; i > myself.head.y; i--) { // if my snake remains longer after considering food that snake will find on the way
                let cell = board2d.getCell({x: 0, y: i})
                if (cell instanceof BoardCell && cell.food) {
                  foundFood = foundFood + 1
                }
              }
              myselfIsLonger = myself.length > (snake.length + foundFood)
            }
            if (myself.head.x === 0 && myselfIsLonger) { // only consider cutting off on left edge if I am longer
              buildLogString(`attempting down cutoff, adding ${evalCutoff}`)
              evaluation = evaluation + evalCutoff
            } else if (myself.head.x === 1 && !myselfIsLonger) { // only consider cutting off on bottom edge if I am not longer
              buildLogString(`attempting down cutoff, adding ${evalCutoff}`)
              evaluation = evaluation + evalCutoff
            }
          }
        }
      }
    } else if (snake.head.x === (gameState.board.width - 1)) { // if they are on the right edge
      if (myself.head.x === (gameState.board.width - 2) || myself.head.x === (gameState.board.width - 1)) { // if I am next to them on the right edge
        if (myself.head.y >= snake.head.y && getSnakeDirection(snake) === "up") { // if I am above snake, & it is moving up
          let cutoffCell = board2d.getCell({x: (gameState.board.width - 2), y: snake.head.y}) // cell one to the left of snake's head
          if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.snake.id === myself.id) { // if cutoffCell has me in it
            let myselfIsLonger = myself.length > snake.length // if my snake is longer
            if (myselfIsLonger) {
              let foundFood : number = 0
              for (let i: number = snake.head.y; i < myself.head.y; i++) { // if my snake remains longer after considering food that snake will find on the way
                let cell = board2d.getCell({x: (gameState.board.width - 1), y: i})
                if (cell instanceof BoardCell && cell.food) {
                  foundFood = foundFood + 1
                }
              }
              myselfIsLonger = myself.length > (snake.length + foundFood)
            }
            if (myself.head.x === (gameState.board.width - 1) && myselfIsLonger) { // only consider cutting off on right edge if I am longer
              buildLogString(`attempting up cutoff, adding ${evalCutoff}`)
              evaluation = evaluation + evalCutoff
            } else if (myself.head.x === (gameState.board.width - 2) && !myselfIsLonger) { // only consider cutting off on top edge if I am not longer
              buildLogString(`attempting up cutoff, adding ${evalCutoff}`)
              evaluation = evaluation + evalCutoff
            }
          }
        } else if (myself.head.y <= snake.head.y && getSnakeDirection(snake) === "down") { // if I am below snake, & it is moving down
          let cutoffCell = board2d.getCell({x: (gameState.board.width - 2), y: snake.head.y}) // cell one to the left of snake's head
          if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.snake.id === myself.id) { // if cutoffCell has me in it          
            let myselfIsLonger = myself.length > snake.length // if my snake is longer
            if (myselfIsLonger) {
              let foundFood : number = 0
              for (let i: number = snake.head.y; i > myself.head.y; i--) { // if my snake remains longer after considering food that snake will find on the way
                let cell = board2d.getCell({x: (gameState.board.width - 1), y: i})
                if (cell instanceof BoardCell && cell.food) {
                  foundFood = foundFood + 1
                }
              }
              myselfIsLonger = myself.length > (snake.length + foundFood)
            }
            if (myself.head.x === (gameState.board.width - 1) && myselfIsLonger) { // only consider cutting off on right edge if I am longer
              buildLogString(`attempting down cutoff, adding ${evalCutoff}`)
              evaluation = evaluation + evalCutoff
            } else if (myself.head.x === (gameState.board.width - 2) && !myselfIsLonger) { // only consider cutting off on bottom edge if I am not longer
              buildLogString(`attempting down cutoff, adding ${evalCutoff}`)
              evaluation = evaluation + evalCutoff
            }
          }
        }
      }
    } else if (snake.head.y === 0) { // if they are on the bottom edge
      if (myself.head.y === 1 || myself.head.y === 0) { // if I am next to them on the bottom edge
        if (myself.head.x >= snake.head.x && getSnakeDirection(snake) === "right") { // if I am right of snake, & it is moving right
          let cutoffCell = board2d.getCell({x: snake.head.x, y: 1}) // cell one above snake's head
          if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.snake.id === myself.id) { // if cutoffCell has me in it
            let myselfIsLonger = myself.length > snake.length // if my snake is longer
            if (myselfIsLonger) {
              let foundFood : number = 0
              for (let i: number = snake.head.x; i < myself.head.x; i++) { // if my snake remains longer after considering food that snake will find on the way
                let cell = board2d.getCell({x: i, y: 0})
                if (cell instanceof BoardCell && cell.food) {
                  foundFood = foundFood + 1
                }
              }
              myselfIsLonger = myself.length > (snake.length + foundFood)
            }
            if (myself.head.y === 0 && myselfIsLonger) { // only consider cutting off on bottom edge if I am longer
              buildLogString(`attempting right cutoff, adding ${evalCutoff}`)
              evaluation = evaluation + evalCutoff
            } else if (myself.head.y === 1 && !myselfIsLonger) { // only consider cutting off on right edge if I am not longer
              buildLogString(`attempting right cutoff, adding ${evalCutoff}`)
              evaluation = evaluation + evalCutoff
            }
          }
        } else if (myself.head.x <= snake.head.x && getSnakeDirection(snake) === "left") { // if I am left of snake, & it is moving left
          let cutoffCell = board2d.getCell({x: snake.head.x, y: 1}) // cell one above snake's head
          if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.snake.id === myself.id) { // if cutoffCell has me in it       
            let myselfIsLonger = myself.length > snake.length // if my snake is longer
            if (myselfIsLonger) {
              let foundFood : number = 0
              for (let i: number = snake.head.x; i > myself.head.x; i--) { // if my snake remains longer after considering food that snake will find on the way
                let cell = board2d.getCell({x: i, y: 0})
                if (cell instanceof BoardCell && cell.food) {
                  foundFood = foundFood + 1
                }
              }
              myselfIsLonger = myself.length > (snake.length + foundFood)
            }
            if (myself.head.y === 0 && myselfIsLonger) { // only consider cutting off on bottom edge if I am longer
              buildLogString(`attempting left cutoff, adding ${evalCutoff}`)
              evaluation = evaluation + evalCutoff
            } else if (myself.head.y === 1 && !myselfIsLonger) { // only consider cutting off on left edge if I am not longer
              buildLogString(`attempting left cutoff, adding ${evalCutoff}`)
              evaluation = evaluation + evalCutoff
            }
          }
        }
      }
    } else if (snake.head.y === (gameState.board.height - 1)) { // if they are on the top edge
      if (myself.head.y === (gameState.board.height - 2) || myself.head.y === (gameState.board.height - 1)) { // if I am next to them on the bottom edge
        if (myself.head.x >= snake.head.x && getSnakeDirection(snake) === "right") { // if I am right of snake, & it is moving right
          let cutoffCell = board2d.getCell({x: snake.head.x, y: (gameState.board.height - 2)}) // cell one below snake's head
          if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.snake.id === myself.id) { // if cutoffCell has me in it             
            let myselfIsLonger = myself.length > snake.length // if my snake is longer
            if (myselfIsLonger) {
              let foundFood : number = 0
              for (let i: number = snake.head.x; i < myself.head.x; i++) { // if my snake remains longer after considering food that snake will find on the way
                let cell = board2d.getCell({x: i, y: (gameState.board.height - 1)})
                if (cell instanceof BoardCell && cell.food) {
                  foundFood = foundFood + 1
                }
              }
              myselfIsLonger = myself.length > (snake.length + foundFood)
            }
            if (myself.head.y === (gameState.board.height - 1) && myselfIsLonger) { // only consider cutting off on top edge if I am longer
              buildLogString(`attempting right cutoff, adding ${evalCutoff}`)
              evaluation = evaluation + evalCutoff
            } else if (myself.head.y === (gameState.board.height - 2) && !myselfIsLonger) { // only consider cutting off on right edge if I am not longer
              buildLogString(`attempting right cutoff, adding ${evalCutoff}`)
              evaluation = evaluation + evalCutoff
            }
          }
        } else if (myself.head.x <= snake.head.x && getSnakeDirection(snake) === "left") { // if I am left of snake, & it is moving left
          let cutoffCell = board2d.getCell({x: snake.head.x, y: (gameState.board.height - 2)}) // cell one below snake's head
          if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.snake.id === myself.id) { // if cutoffCell has me in it 
            let myselfIsLonger = myself.length > snake.length // if my snake is longer
            if (myselfIsLonger) {
              let foundFood : number = 0
              for (let i: number = snake.head.x; i > myself.head.x; i--) { // if my snake remains longer after considering food that snake will find on the way
                let cell = board2d.getCell({x: i, y: (gameState.board.height - 1)})
                if (cell instanceof BoardCell && cell.food) {
                  foundFood = foundFood + 1
                }
              }
              myselfIsLonger = myself.length > (snake.length + foundFood)
            }
            if (myself.head.y === (gameState.board.height - 1) && myselfIsLonger) { // only consider cutting off on top edge if I am longer
              buildLogString(`attempting right cutoff, adding ${evalCutoff}`)
              evaluation = evaluation + evalCutoff
            } else if (myself.head.y === (gameState.board.height - 2) && !myselfIsLonger) { // only consider cutting off on left edge if I am not longer
              buildLogString(`attempting left cutoff, adding ${evalCutoff}`)
              evaluation = evaluation + evalCutoff
            }
          }
        }
      }
    }
  })

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
  //       case "up":
  //         newCoord = {x: me.head.x, y: me.head.y + 1}
  //         break
  //       case "down":
  //         newCoord = {x: me.head.x, y: me.head.y - 1}
  //         break
  //       case "left":
  //         newCoord = {x: me.head.x + 1, y: me.head.y}
  //         break
  //       default: //case "right":
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
  return evaluation
}