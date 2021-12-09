import { InfoResponse, GameState, MoveResponse, Game, Board } from "./types"
import { Coord, SnakeCell, Board2d, Moves, MoveNeighbors, BoardCell, Battlesnake } from "./classes"
import { logToFile, getRandomInt, snakeHasEaten, coordsEqual, getDistance, getCoordAfterMove, getSurroundingCells, isKingOfTheSnakes, getLongestSnake, snakeToString, coordToString, cloneGameState, moveSnake, checkForSnakesAndWalls, checkTime, findMoveNeighbors, findKissDeathMoves, findKissMurderMoves, getKissOfDeathState } from "./util"
import { evaluate } from "./eval"

import { createWriteStream } from 'fs'
let consoleWriteStream = createWriteStream("consoleLogs_logic.txt", {
  encoding: "utf8"
})

export function info(): InfoResponse {
    console.log("INFO")
    const response: InfoResponse = {
        apiversion: "1",
        author: "waryferryman",
        color: "#ff9900", // "ff00ff"
        head: "tiger-king", //"bendr",
        tail: "mystic-moon" //"freckled"
    }
    return response
}

export function start(gameState: GameState): void {
    console.log(`${gameState.game.id} START`)
}

export function end(gameState: GameState): void {
    console.log(`${gameState.game.id} END\n`)
}

// given a set of deathMoves that lead us into possibly being eaten,
// killMoves that lead us into possibly eating another snake,
// and moves, which is our actual move decision array
function kissDecider(myself: Battlesnake, moveNeighbors: MoveNeighbors, deathMoves : string[], killMoves : string[], moves: Moves) : {kissOfDeathState: string, kissOfMurderState: string} {
  let validMoves = moves.validMoves()
  let states = {kissOfDeathState: "kissOfDeathNo", kissOfMurderState: "kissOfMurderNo"}
  // first look through dangerous moves
  switch(deathMoves.length) {
    case 1: // if one move results in a kissOfDeath, eliminate that
    //logToFile(evalWriteStream, `for snake at (${myself.head.x},${myself.head.y}), deathMoves: ${deathMoves.toString()}`)
      if (moves.hasOtherMoves(deathMoves[0])) {
        if (validMoves.length === 3) {
          states.kissOfDeathState = "kissOfDeath3To2Avoidance"
        } else { // we know validMoves can't be of length 1, else that would be a kiss cell
          states.kissOfDeathState = "kissOfDeath2To1Avoidance"
        }
        logToFile(consoleWriteStream, `for snake at (${myself.head.x},${myself.head.y}), disabling move ${deathMoves[0]} due to threat of kiss of death`)
        moves.disableMove(deathMoves[0])
      } else {
        states.kissOfDeathState = "kissOfDeathCertainty"
      }
      break
    case 2: // if two moves result in a kiss of death, eliminate them if a third move is still valid, otherwise, don't eliminate either
      if (validMoves.length === 3) { // in this case, two moves give us a 50/50 kiss of death, but the third is fine. This isn't ideal, but isn't a terrible evaluation
        //buildLogString(`KissOfDeath3To1Avoidance, adding ${evalKissOfDeath3To1Avoidance}`)
        states.kissOfDeathState = "kissOfDeath3To1Avoidance"
        logToFile(consoleWriteStream, `for snake at (${myself.head.x},${myself.head.y}), disabling moves ${deathMoves[0]}, ${deathMoves[1]} due to threat of kiss of death & viable alternative`)
        moves.disableMove(deathMoves[0])
        moves.disableMove(deathMoves[1])
      } else { // this means a 50/50
        //buildLogString(`KissOfDeathMaybe, adding ${evalKissOfDeathMaybe}`)
        states.kissOfDeathState = "kissOfDeathMaybe"
      }
      break
    case 3: // if all three moves may cause my demise, try to choose which one is least deadly
      // in this scenario, at least two snakes must be involved in order to cut off all of my options. Assuming that a murder snake will murder if it can, we want to eliminate any move option that is the only one that snake can reach
      let huntingChanceDirections : Moves = moveNeighbors.huntingChanceDirections()
      let huntedDirections = huntingChanceDirections.invalidMoves()
      if (huntedDirections.length !== 3) { // two of the directions offer us a chance
        //buildLogString(`KissOfDeathMaybe, adding ${evalKissOfDeathMaybe}`)
        states.kissOfDeathState = "kissOfDeathMaybe"
        huntedDirections.forEach(function disableDir(dir) {
          logToFile(consoleWriteStream, `for snake at (${myself.head.x},${myself.head.y}), disabling move ${dir} due to threat of kiss of death & viable alternative`)
          moves.disableMove(dir)
        })
      } else { // they all seem like certain death - maybe we'll get lucky & a snake won't take the free kill. It is a clusterfuck at this point, after all
        //buildLogString(`KissOfDeathCertainty, adding ${evalKissOfDeathCertainty}`)
        states.kissOfDeathState = "kissOfDeathCertainty"
      }
      break
    default: // case 0
      states.kissOfDeathState = "kissOfDeathNo"
      break
  }

  // second priority is looking for chances to eliminate another snake
  if (killMoves.length > 0) {
    logToFile(consoleWriteStream, `for snake at (${myself.head.x},${myself.head.y}), killMoves: ${killMoves.toString()}`)
    let idx = getRandomInt(0, killMoves.length) // TODO: choose the smartest kill index
    logToFile(consoleWriteStream, `for snake at (${myself.head.x},${myself.head.y}), moving towards ${killMoves[idx]} to try to take a snake`)
    moves.disableOtherMoves(killMoves[idx])
  }

  return states
}

// start looking ahead!
// adjust prioritization logic based on results
// replace random movement entirely
// hazard support
// fix king snake & aggressive kissing snake logic to be smarter
// replace all lets with consts where appropriate
// change tsconfig to noImplicitAny: true
export function move(gameState: GameState): MoveResponse {
    //logToFile(consoleWriteStream, `turn: ${gameState.turn}`)    
    
    let possibleMoves : Moves = new Moves(true, true, true, true)

    const myself = gameState.you
    const myHead: Coord = myself.head
    const myNeck: Coord = myself.body[1]
    const boardWidth: number = gameState.board.width
    const boardHeight: number = gameState.board.height
    const myBody: Coord[] = myself.body
    const otherSnakes: Battlesnake[] = gameState.board.snakes.filter(function filterMeOut(snake) { return snake.id !== myself.id})
    const myTail: Coord = myBody[myBody.length - 1]
    const snakeBites = gameState.board.food

    const board2d = new Board2d(gameState.board)

    // console.log(`Turn: ${gameState.turn}`)
    // board2d.logBoard()

    const priorities : { [key: string]: number } = {
      kill: 0,
      food: 1,
      openSpace: 2, // prioritize center, or look around for neighbor snakes?
      coolPatterns: 3, // chasing tail
      health: 4
    }
    
    const timeBeginning = Date.now()

    //logToFile(consoleWriteStream, `myTail: ${coordToString(myTail)}`)
    //logToFile(consoleWriteStream, `myHead: ${coordToString(myHead)}`)

    checkForSnakesAndWalls(myself, board2d, possibleMoves)
    //logToFile(consoleWriteStream, `possible moves after checkForSnakesAndWalls: ${possibleMoves}`)

    let moveNeighbors = findMoveNeighbors(myself, board2d, possibleMoves)
    let kissOfMurderMoves = findKissMurderMoves(myself, board2d, moveNeighbors)
    let kissOfDeathMoves = findKissDeathMoves(myself, board2d, moveNeighbors)
    //logToFile(evalWriteStream, `kissOfMurderMoves: ${kissOfMurderMoves.toString()}`)
    //logToFile(evalWriteStream, `kissOfDeathMoves: ${kissOfDeathMoves.toString()}`)

     let kissStates = kissDecider(myself, moveNeighbors, kissOfDeathMoves, kissOfMurderMoves, possibleMoves)

    // let kissOfDeathState : string = getKissOfDeathState(moveNeighbors, kissOfDeathMoves, possibleMoves)
    // let kissOfMurderState : string = "kissOfMurderNo"

    // looks for food within depth moves away from snakeHead
    // returns an object whose keys are distances away, & whose values are food
    // found at that distance
    function findFood(depth: number, food: Coord[], snakeHead : Coord) : { [key: number] : Coord[]} {
      let foundFood: { [key: number]: Coord[] } = {}
      // for (let i: number = 1; i < depth; i++) {
      //   foundFood[i] = []
      // }
      //let foundFood: Coord[] = []
      food.forEach(function addFood(foodUnit) {
        let dist = getDistance(snakeHead, foodUnit)
      
        //logToFile(consoleWriteStream, `findFood dist: ${dist} for foodUnit (${foodUnit.x},${foodUnit.y})`)
        if (dist <= depth) {
          if (!foundFood[dist]) {
            foundFood[dist] = []
          }
          foundFood[dist].push(foodUnit)
        }
      })

      return foundFood
    }

    // navigate snakeHead towards newCoord by disallowing directions that move away from it - so long as that doesn't immediately kill us
    function navigateTowards(snakeHead : Coord, newCoord: Coord, moves: Moves) {
      if (snakeHead.x > newCoord.x) { // snake is right of newCoord, no right
        // don't disallow the only remaining valid route
        if (moves.hasOtherMoves("right")) {
          moves.right = false
        }
      } else if (snakeHead.x < newCoord.x) { // snake is left of newCoord, no left
      // don't disallow the only remaining valid route
        if (moves.hasOtherMoves("left")) {
          moves.left = false
        }
      } else { // snake is in same column as newCoord, don't move left or right
        // don't disallow the only remaining valid routes
        if (moves.up || moves.down) {
          moves.right = false
          moves.left = false
        }
      }
      if (snakeHead.y > newCoord.y) { // snake is above newCoord, no up
      // don't disallow the only remaining valid route
        if (moves.hasOtherMoves("up")) {
          moves.up = false
        }
      } else if (snakeHead.y < newCoord.y) { // snake is below newCoord, no down
      // don't disallow the only remaining valid route
        if (moves.hasOtherMoves("down")) {
          moves.down = false
        }
      } else { // snake is in same row as newCoord, don't move up or down
        // don't disallow the only remaining valid routes
        if (moves.left || moves.right) {
          moves.up = false
          moves.down = false
        }
      }
    }

    function calculateFoodSearchDepth(me: Battlesnake, board2d: Board2d, snakeKing: boolean) : number {
      let depth : number = 3
      if (me.health < 10) { // search for food from farther away if health is lower
        depth = board2d.height + board2d.width
      } else if (me.health < 20) {
        depth = board2d.height - 5
      } else if (me.health < 30) {
        depth = board2d.height - 6
      } else if (me.health < 40) {
        depth = board2d.height - 7
      } else if (me.health < 50) {
        depth = board2d.height - 8
      }

      if (gameState.turn < 20) { // prioritize food slightly more earlier in game
        depth = depth > (board2d.height - 5) ? depth : board2d.height - 5
      }

      if (snakeKing && me.health > 10) {
        depth = 0 // I don't need it
      }

      return depth
    }

    const kingOfTheSnakes = isKingOfTheSnakes(myself, gameState.board)
    const foodSearchDepth = calculateFoodSearchDepth(myself, board2d, kingOfTheSnakes)
    const nearbyFood = findFood(foodSearchDepth, snakeBites, myHead)
    let foodToHunt : Coord[] = []

    for (let i: number = 1; i <= foodSearchDepth; i++) {
      foodToHunt = nearbyFood[i]
      if (foodToHunt && foodToHunt.length > 0) { // the hunt was successful! Don't look any farther
        break
      }
    }

    if (foodToHunt && foodToHunt.length > 0) { // if we've found food nearby, navigate towards one at random
      let foodIndex = getRandomInt(0, foodToHunt.length)
      //logToFile(consoleWriteStream, `food found within ${foodSearchDepth} of head, navigating towards (${foodToHunt[foodIndex].x},${foodToHunt[foodIndex].y})`)
      navigateTowards(myHead, foodToHunt[foodIndex], possibleMoves)
    }

    if (kingOfTheSnakes) {
      //logToFile(consoleWriteStream, `king snake at (${myHead.x},${myHead.y}), looking for other snakes`)
      let longestSnake = getLongestSnake(myself, otherSnakes)
      if (longestSnake.id !== myself.id) { // if I am not the longest snake, seek it out
        logToFile(consoleWriteStream, `king snake at (${myHead.x},${myHead.y}) navigating toward snake at (${longestSnake.head.x},${longestSnake.head.y})`)
        // is it better to go towards the head here, or some other body part?
        navigateTowards(myHead, longestSnake.head, possibleMoves)
      }
    }

    // Finally, choose a move from the available safe moves.
    // TODO: Step 5 - Select a move to make based on strategy, rather than random.

    function moveTowardsCenter(coord: Coord, board: Board, moves: string[]) : string {
      let shortestMove : string = "up",
          shortestDist: number,
          midX = board.width / 2,
          midY = board.height / 2,
          midCoord = new Coord(midX, midY)

      moves.forEach(function checkDistanceFromMiddle(move) {
        let newCoord = getCoordAfterMove(coord, move)
        let d = getDistance(newCoord, midCoord)
        if (!shortestDist || d < shortestDist) {
          shortestDist = d
          shortestMove = move
        } else if (d === shortestDist && getRandomInt(0, 1)) { // given another valid route towards middle, choose it half of the time
          shortestMove = move
        }
      })
      return shortestMove
    }
    
    // This function will determine the movement strategy for available moves. Should take in the board, the snakes, our health, the turn, etc. May want to replace this with lookahead functions later
    function decideMove(gameState: GameState, moves: string[]) : string {
      if (moves.length < 1) {
        return "up"
      }
      if (moves.length === 1) {
        return moves[0]
      }
      //return moveTowardsCenter(myHead, gameState.board, moves)


      // of the available remaining moves, evaluate the gameState if we took that move, and then choose the move resulting in the highest scoring gameState
      let bestMove : string = ""
      let bestMoveEval : number = -1

      moves.forEach(function evaluateMove(move) {
        let newGameState = cloneGameState(gameState)
        let newBoard2d = new Board2d(newGameState.board)
        let evalState = 0

        let moveResult = moveSnake(newGameState, newGameState.you, newBoard2d, move)
        if (moveResult) {
          // TODO: evaluate needs to be ran on a new game state in which opposing snakes have also moved, not just me - & that means it needs to be ran multiple times for multiple different realities
          evalState = evaluate(newGameState, newGameState.you, kissStates.kissOfDeathState, kissStates.kissOfMurderState)
          //logToFile(consoleWriteStream, `eval for ${newGameState.you.name} at (${newGameState.you.head.x},${newGameState.you.head.y}): ${evalState}`)
          if (evalState > bestMoveEval) {
            bestMove = move
            bestMoveEval = evalState
          } else if ((evalState === bestMoveEval) && getRandomInt(0, 1)) { // in the event of tied evaluations, choose between them at random
            bestMove = move
            bestMoveEval = evalState
          }
        } else {
          evalState = 0 // !moveResult indicates we couldn't move there. This indicates a bad place to try to move.
        }
      })

      return bestMove
    }

    const safeMoves = possibleMoves.validMoves()
    const chosenMove : string = decideMove(gameState, safeMoves)
    const response: MoveResponse = {
        move: chosenMove
    }
    
    let newCoord = getCoordAfterMove(myHead, chosenMove)

    //checkTime()

    logToFile(consoleWriteStream, `${gameState.game.id} MOVE ${gameState.turn}: ${response.move}, newCoord: ${newCoord}`)

    //logToFile(consoleWriteStream, `myself: ${snakeToString(myself)}`)
    return response
}
