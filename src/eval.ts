import { GameState } from "./types"
import { Battlesnake, Board2d, Moves, MoveNeighbors, Coord } from "./classes"
import { createWriteStream } from "fs"
import { checkForSnakesAndWalls, logToFile, getSurroundingCells, findMoveNeighbors, findKissDeathMoves, findKissMurderMoves } from "./util"

let evalWriteStream = createWriteStream("consoleLogs_eval.txt", {
  encoding: "utf8"
})



// the big one. This function evaluates the state of the board & spits out a number indicating how good it is for input snake, higher numbers being better
// 1000: last snake alive, best possible state
// 0: snake is dead, worst possible state
export function evaluate(gameState: GameState, meSnake: Battlesnake, kissOfDeathState: string, kissOfMurderString: string) : number {
  // values to tweak
  const evalBase: number = 500
  const evalNoSnakes: number = 5
  const evalNoMe: number = 0
  const evalSolo: number = 1000
  const evalWallPenalty: number = -50
  const evalCenterMax = 5
  const evalCenterMaxDist = 2
  const evalCenterMin = 2
  const evalCenterMinDist = 4
  const eval0Move = 1
  const eval1Move = 20 // was -50, but I don't think 1 move is actually too bad - I want other considerations to matter between 2 moves & 1
  const eval2Moves = 30
  const eval3Moves = 50
  const eval4Moves = 100
  const evalHasEaten = 80
  const evalHealth7 = 42
  const evalHealth6 = 36
  const evalHealth5 = 30
  const evalHealth4 = 24
  const evalHealth3 = 18
  const evalHealth2 = 12
  const evalHealth1 = 6
  const evalHealth0 = 0
  const evalKissOfDeathCertainty = -100 // everywhere seems like certain death
  const evalKissOfDeathMaybe = -70 // a 50/50 on whether we'll be kissed to death next turn
  const evalKissOfDeath3To1Avoidance = 0
  const evalKissOfDeath3To2Avoidance = 0
  const evalKissOfDeath2To1Avoidance = 0
  const evalKissOfDeathNo = 0

  
  let logString : string = `eval snake ${meSnake.name} at (${meSnake.head.x},${meSnake.head.y} turn ${gameState.turn})`
  function buildLogString(str : string) : void {
    if (logString === "") {
      logString = str
    } else {
      logString = logString + "\n" + str
    }
  }

  if (gameState.board.snakes.length === 0) {
    buildLogString(`no snakes, return ${evalNoSnakes}`)
    return evalNoSnakes // if no snakes are left, I am dead, but so are the others. It's better than just me being dead, at least
  }
  const myself = gameState.board.snakes.find(function findMe(snake) { return snake.id === meSnake.id})
  const otherSnakes: Battlesnake[] = gameState.board.snakes.filter(function filterMeOut(snake) { return snake.id !== meSnake.id})
  const board2d = new Board2d(gameState.board)
  let evaluation = evalBase
  if (!(myself instanceof Battlesnake)) {
    buildLogString(`no myself snake, return ${evalNoMe}`)
    return 0 // if mySnake is not still in the game board, it's dead. This is a bad evaluation.
  }
  if (otherSnakes.length === 0) {
    buildLogString(`no other snakes, add ${evalSolo}`)
    evaluation = evaluation + evalSolo // it's great if no other snakes exist, but solo games are still a thing. Give it a high score to indicate superiority to games with other snakes still in it, but continue evaluating so solo games can still evaluate scores
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
  const centerX = gameState.board.width / 2
  const centerY = gameState.board.height / 2

  const xDiff = Math.abs(myself.head.x - centerX)
  const yDiff = Math.abs(myself.head.y - centerY)
  if (xDiff < evalCenterMaxDist) {
    buildLogString(`xDiff less than ${evalCenterMaxDist}, adding ${evalCenterMax}`)
    evaluation = evaluation + evalCenterMax
  } else if (xDiff < evalCenterMinDist) {
    buildLogString(`xDiff less than ${evalCenterMaxDist}, adding ${evalCenterMin}`)
    evaluation = evaluation + evalCenterMin
  }
  if (yDiff < evalCenterMaxDist) {
    buildLogString(`yDiff less than ${evalCenterMaxDist}, adding ${evalCenterMax}`)
    evaluation = evaluation + evalCenterMax
  } else if (yDiff < evalCenterMinDist) {
    buildLogString(`yDiff less than ${evalCenterMinDist}, adding ${evalCenterMin}`)
    evaluation = evaluation + evalCenterMin
  }
  
  // give bonuses & penalties based on how many technically 'valid' moves remain after removing walls & other snake cells
  const possibleMoves = new Moves(true, true, true, true)
  checkForSnakesAndWalls(myself, board2d, possibleMoves)

  switch(possibleMoves.validMoves().length) {
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

  // health considerations, which are effectively hazard considerations
  if (myself.health === 100) {
    buildLogString(`got food, add ${evalHasEaten}`)
    evaluation = evaluation + evalHasEaten
  } else {
    let hazardDamage = gameState.game.ruleset.settings.hazardDamagePerTurn
    let validHazardTurns = myself.health / hazardDamage
    if (validHazardTurns > 6) {
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

  let moveNeighbors = findMoveNeighbors(myself, board2d, possibleMoves)
  let kissOfMurderMoves = findKissMurderMoves(myself, board2d, moveNeighbors)
  let kissOfDeathMoves = findKissDeathMoves(myself, board2d, moveNeighbors)
  //logToFile(evalWriteStream, `kissOfMurderMoves: ${kissOfMurderMoves.toString()}`)
  //logToFile(evalWriteStream, `kissOfDeathMoves: ${kissOfDeathMoves.toString()}`)

  // TODO: This function evaluates based on nearby kiss of deaths, but I don't know anything about how likely THE CURRENT GAMESTATE resulted in a kiss of death for myself, or for that matter another snake. Evaluate() might need another param or two to indicate this
  let validMoves = possibleMoves.validMoves()
  // switch (kissOfDeathMoves.length) {
  //   case 3: // all three available moves may result in my demise
  //     // in this scenario, at least two snakes must be involved in order to cut off all of my options. Assuming that a murder snake will murder if it can, we want to eliminate any move option that is the only one that snake can reach
  //     let huntingChanceDirections : Moves = moveNeighbors.huntingChanceDirections()
  //     let huntedDirections = huntingChanceDirections.invalidMoves()
  //     if (huntedDirections.length !== 3) { // two of the directions offer us a chance
  //       buildLogString(`KissOfDeathMaybe, adding ${evalKissOfDeathMaybe}`)
  //       evaluation = evaluation + evalKissOfDeathMaybe
  //     } else { // they all seem like certain death - maybe we'll get lucky & a snake won't take the free kill. It is a clusterfuck at this point, after all
  //       buildLogString(`KissOfDeathCertainty, adding ${evalKissOfDeathCertainty}`)
  //       evaluation = evaluation + evalKissOfDeathCertainty
  //     }
  //     break
  //   case 2:
  //     if (validMoves.length === 3) { // in this case, two moves give us a 50/50 kiss of death, but the third is fine. This isn't ideal, but isn't a terrible evaluation
  //       buildLogString(`KissOfDeath3To1Avoidance, adding ${evalKissOfDeath3To1Avoidance}`)
  //       evaluation = evaluation + evalKissOfDeath3To1Avoidance
  //     } else { // this means a 50/50
  //       buildLogString(`KissOfDeathMaybe, adding ${evalKissOfDeathMaybe}`)
  //       evaluation = evaluation + evalKissOfDeathMaybe
  //     }
  //     break
  //   case 1:
  //     if (possibleMoves.hasOtherMoves(kissOfDeathMoves[0])) {
  //       if (validMoves.length === 3) {
  //         buildLogString(`KissOfDeath3To2Avoidance, adding ${evalKissOfDeath3To2Avoidance}`)
  //         evaluation = evaluation + evalKissOfDeath3To2Avoidance
  //       } else { // we know validMoves can't be of length 1, else that would be a kiss cell
  //         buildLogString(`KissOfDeath2To1Avoidance, adding ${evalKissOfDeath2To1Avoidance}`)
  //         evaluation = evaluation + evalKissOfDeath2To1Avoidance
  //       }
  //     }
  //     break
  //   default: // no kissOfDeathMoves nearby, this is good
  //     buildLogString(`No kisses of death nearby, adding ${evalKissOfDeathNo}`)
  //     evaluation = evaluation + evalKissOfDeathNo
  //     break
  // }

  // The only one that really matters is the one indicating 50/50. kissOfDeathCertainty is also bad but likely we're already dead at that point
  switch (kissOfDeathState) {
    case "kissOfDeathCertainty":
      buildLogString(`KissOfDeathCertainty, adding ${evalKissOfDeathCertainty}`)
      evaluation = evaluation + evalKissOfDeathCertainty
      break
    case "kissOfDeathMaybe":
      buildLogString(`KissOfDeathMaybe, adding ${evalKissOfDeathMaybe}`)
      evaluation = evaluation + evalKissOfDeathMaybe
      break
    case "kissOfDeath3To1Avoidance":
      buildLogString(`KissOfDeath3To1Avoidance, adding ${evalKissOfDeath3To1Avoidance}`)
      evaluation = evaluation + evalKissOfDeath3To1Avoidance
      break
    case "kissOfDeath3To2Avoidance":
      buildLogString(`KissOfDeath3To2Avoidance, adding ${evalKissOfDeath3To2Avoidance}`)
      evaluation = evaluation + evalKissOfDeath3To2Avoidance
      break
    case "kissOfDeath2To1Avoidance":
      buildLogString(`KissOfDeath2To1Avoidance, adding ${evalKissOfDeath2To1Avoidance}`)
      evaluation = evaluation + evalKissOfDeath2To1Avoidance
      break
    case "kissOfDeathNo":
      buildLogString(`KissOfDeathNo, adding ${evalKissOfDeathNo}`)
      evaluation = evaluation + evalKissOfDeathNo
      break
    default:
      break
  }

  buildLogString(`final evaluation: ${evaluation}`)
  logToFile(evalWriteStream, `eval log: ${logString}
  `)
  return evaluation
}