import { InfoResponse, GameState, MoveResponse, Game, Board } from "./types"
import { Coord, SnakeCell, Board2d, Moves, MoveNeighbors, BoardCell, Battlesnake } from "./classes"
import { logToFile, getRandomInt, snakeHasEaten, coordsEqual, getDistance, getCoordAfterMove, getSurroundingCells, isKingOfTheSnakes, getLongestSnake, snakeToString, coordToString, cloneGameState, moveSnake, checkForSnakesAndWalls } from "./util"

import { createWriteStream } from 'fs';
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

// the big one. This function evaluates the state of the board & spits out a number indicating how good it is for input snake, higher numbers being better
// 1000: last snake alive, best possible state
// 0: snake is dead, worst possible state
export function evaluate(gameState: GameState, meSnake: Battlesnake) : number {
  const myself = gameState.board.snakes.find(function findMe(snake) { return snake.id === meSnake.id})
  let evaluation = 500
  if (!(myself instanceof Battlesnake)) {
    return 0 // if mySnake is not still in the game board, it's dead. This is a bad evaluation.
  }
  const otherSnakes: Battlesnake[] = gameState.board.snakes.filter(function filterMeOut(snake) { return snake.id !== meSnake.id})
  if (otherSnakes.length === 0) {
    evaluation = evaluation + 1000 // it's great if no other snakes exist, but solo games are still a thing. Give it a high score to indicate superiority to games with other snakes still in it, but continue evaluating so solo games can still evaluate scores
  }
  const board2d = new Board2d(gameState.board)

  // give walls a penalty, & corners a double penalty
  if (myself.head.x === 0) {
    evaluation = evaluation - 100
  } else if (myself.head.x === (gameState.board.width - 1)) {
    evaluation = evaluation - 100
  }
  if (myself.head.y === 0) {
    evaluation = evaluation - 100
  } else if (myself.head.y === (gameState.board.height - 1)) {
    evaluation = evaluation - 100
  }

  // in addition to wall/corner penalty, give a bonus to being closer to center
  const centerX = gameState.board.width / 2
  const centerY = gameState.board.height / 2

  const xDiff = Math.abs(myself.head.x - centerX)
  const yDiff = Math.abs(myself.head.y - centerY)
  if (xDiff < 2) {
    evaluation = evaluation + 5
  } else if (xDiff < 6) {
    evaluation = evaluation + 2
  }
  if (yDiff < 4) {
    evaluation = evaluation + 5
  } else if (yDiff < 6) {
    evaluation = evaluation + 2
  }
  
  // give bonuses & penalties based on how many technically 'valid' moves remain after removing walls & other snake cells
  const possibleMoves = new Moves(true, true, true, true)
  checkForSnakesAndWalls(myself, board2d, possibleMoves)

  switch(possibleMoves.validMoves().length) {
    case 0:
      evaluation = 1 // with no valid moves left, this state is just a notch above death
      break
    case 1:
      evaluation = evaluation - 50 // with only one valid move, this is a bad, but not unsalvageable, state
      break
    case 2:
      evaluation = evaluation + 30 // two valid moves is pretty good
      break
    case 3:
      evaluation = evaluation + 200 // three valid moves is great
      break
    default: // case 4, should only be possible on turn 1 when length is 1
      evaluation = evaluation + 500
      break
  }

  logToFile(consoleWriteStream, `eval for ${meSnake.name} at (${meSnake.head.x},${meSnake.head.y}): ${evaluation}`)
  return evaluation
}

// avoid walls or corners
// start looking ahead!
// adjust prioritization logic based on results
// replace random movement entirely
// flesh out priorities more
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

    //let tempCell = new Coord(0, 0)
    // console.log(`Turn: ${gameState.turn}`)
    // board2d.logBoard()

    const priorities : { [key: string]: number } = {
      kill: 0,
      food: 1,
      openSpace: 2, // prioritize center, or look around for neighbor snakes?
      coolPatterns: 3, // chasing tail
      health: 4
    }

    const timeout = gameState.game.timeout
    const myLatency = myself.latency
    const turn = gameState.turn
    
    const timeBeginning = Date.now()

    // checks how much time has elapsed since beginning of move function,
    // returns true if more than 50ms exists after latency
    function checkTime() : boolean {
      let timeCurrent : number = Date.now(),
          timeElapsed : number = timeCurrent - timeBeginning,
          _myLatency : number = myLatency ? parseInt(myLatency, 10) : 200, // assume a high latency when no value exists, either on first run or after timeout
          timeLeft = timeout - timeElapsed - _myLatency
      console.log("turn: %d. Elapsed time: %d; latency: %d; time left: %d", turn, timeElapsed, _myLatency, timeLeft)
      return timeLeft > 50
    }

    //logToFile(consoleWriteStream, `myTail: ${coordToString(myTail)}`)
    //logToFile(consoleWriteStream, `myHead: ${coordToString(myHead)}`)

    function getBodyWithoutTail(body: Coord[]): Coord[] {
      return body.slice(0, -1)
    }

    // return true if board has food at the provided coordinate
    function hasFood(coord: Coord, board2d: Board2d) : boolean {
      let cell = board2d.getCell(coord)
      if (cell instanceof BoardCell) {
        return cell.food
      } else {
        return false
      }
    }

    checkForSnakesAndWalls(myself, board2d, possibleMoves)

    function findMoveNeighbors(me: Battlesnake, board2d: Board2d, moves: Moves) : MoveNeighbors {
      let myHead = me.head
      let kissMoves : MoveNeighbors = new MoveNeighbors(me)
      if (moves.up) {
        let newCoord : Coord = new Coord(myHead.x, myHead.y + 1)
        kissMoves.upNeighbors = getSurroundingCells(newCoord, board2d, "down")    
      }

      if (moves.down) {
        let newCoord : Coord = new Coord(myHead.x, myHead.y - 1)
        kissMoves.downNeighbors = getSurroundingCells(newCoord, board2d, "up")
      }

      if (moves.right) {
        let newCoord : Coord = new Coord(myHead.x + 1, myHead.y)
        kissMoves.rightNeighbors = getSurroundingCells(newCoord, board2d, "left")
      }

      if (moves.left) {
        let newCoord : Coord = new Coord(myHead.x - 1, myHead.y)
        kissMoves.leftNeighbors = getSurroundingCells(newCoord, board2d, "right")
      }
      //logToFile(consoleWriteStream, `findMoveNeighbors for snake at (${me.head.x},${me.head.y}): upLength, downLength, leftLength, rightLength: ${kissMoves.upNeighbors.length}, ${kissMoves.downNeighbors.length}, ${kissMoves.leftNeighbors.length}, ${kissMoves.rightNeighbors.length}`)
      return kissMoves
    }

    function findKissMurderMoves(me: Battlesnake, board2d: Board2d, kissMoves: MoveNeighbors) : string[] {
      let murderMoves : string[] = []
      if (kissMoves.huntingAtUp()) {
        murderMoves.push("up")
      }
      if (kissMoves.huntingAtDown()) {
        murderMoves.push("down")
      }
      if (kissMoves.huntingAtLeft()) {
        murderMoves.push("left")
      }
      if (kissMoves.huntingAtRight()) {
        murderMoves.push("right")
      }
      return murderMoves
    }

    function findKissDeathMoves(me: Battlesnake, board2d: Board2d, kissMoves: MoveNeighbors) : string[] {
      let deathMoves : string[] = []
      if (kissMoves.huntedAtUp()) {
        deathMoves.push("up")
      }
      if (kissMoves.huntedAtDown()) {
        deathMoves.push("down")
      }
      if (kissMoves.huntedAtLeft()) {
        deathMoves.push("left")
      }
      if (kissMoves.huntedAtRight()) {
        deathMoves.push("right")
      }
      return deathMoves
    }
    
    let moveNeighbors = findMoveNeighbors(myself, board2d, possibleMoves)
    let kissOfMurderMoves = findKissMurderMoves(myself, board2d, moveNeighbors)
    let kissOfDeathMoves = findKissDeathMoves(myself, board2d, moveNeighbors)
    //logToFile(consoleWriteStream, `kissOfMurderMoves: ${kissOfMurderMoves.toString()}`)
    //logToFile(consoleWriteStream, `kissOfDeathMoves: ${kissOfDeathMoves.toString()}`)

    // given a set of deathMoves that lead us into possibly being eaten,
    // killMoves that lead us into possibly eating another snake,
    // and moves, which is our actual move decision array
    function kissDecider(deathMoves : string[], killMoves : string[], moves: Moves) {
      // first look through dangerous moves
      switch(deathMoves.length) {
        case 1: // if one move results in a kissOfDeath, eliminate that
        //logToFile(consoleWriteStream, `for snake at (${myself.head.x},${myself.head.y}), deathMoves: ${deathMoves.toString()}`)
          if (moves.hasOtherMoves(deathMoves[0])) {
            logToFile(consoleWriteStream, `for snake at (${myself.head.x},${myself.head.y}), disabling move ${deathMoves[0]} due to threat of kiss of death`)
            moves.disableMove(deathMoves[0])
          }
          break
        case 2: // if two moves result in a kiss of death, eliminate them if a third move is still valid, otherwise, don't eliminate either
          if (moves.validMoves().length === 3) {
            logToFile(consoleWriteStream, `for snake at (${myself.head.x},${myself.head.y}), disabling moves ${deathMoves[0]}, ${deathMoves[1]} due to threat of kiss of death & viable alternative`)
            moves.disableMove(deathMoves[0])
            moves.disableMove(deathMoves[1])
          }
          break
        case 3: // if all three moves may cause my demise, try to choose which one is least deadly
          // in this scenario, at least two snakes must be involved in order to cut off all of my options. Assuming that a murder snake will murder if it can, we want to eliminate any move option that is the only one that snake can reach
          let huntingChanceDirections : Moves = moveNeighbors.huntingChanceDirections()
          let huntedDirections = huntingChanceDirections.invalidMoves()
          if (huntedDirections.length !== 3) { // don't bother disabling anything if they all seem like certain death - maybe we'll get lucky & a snake won't take the free kill. It is a clusterfuck at this point, after all
            huntedDirections.forEach(function disableDir(dir) {
              moves.disableMove(dir)
            })
          }
          break
        default: // case 0
          break
      }

      // second priority is looking for chances to eliminate another snake
      if (killMoves.length > 0) {
        logToFile(consoleWriteStream, `for snake at (${myself.head.x},${myself.head.y}), killMoves: ${killMoves.toString()}`)
        let idx = getRandomInt(0, killMoves.length) // TODO: choose the smartest kill index
        logToFile(consoleWriteStream, `for snake at (${myself.head.x},${myself.head.y}), moving towards ${killMoves[idx]} to try to take a snake`)
        moves.disableOtherMoves(killMoves[idx])
      }
    }

    kissDecider(kissOfDeathMoves, kissOfMurderMoves, possibleMoves)

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
        depth = 8
      } else if (me.health < 20) {
        depth = 6
      } else if (me.health < 30) {
        depth = 5
      } else if (me.health < 40) {
        depth = 4
      } else if (me.health < 50) {
        depth = 3
      }

      if (gameState.turn < 20) { // prioritize food slightly more earlier in game
        depth = depth > 6 ? depth : 6
      }

      if (snakeKing&& me.health > 10) {
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

    // alternative to random movement, will return move that brings it closer to the midpoint of the map
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

    function getRandomMove(moves: string[]) : string {
      let randomMove : string = moves[getRandomInt(0, moves.length)]
      //logToFile(consoleWriteStream, `of available moves ${moves.toString()}, choosing random move ${randomMove}`)
      return randomMove
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
          evalState = evaluate(newGameState, newGameState.you)
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

      // if (myself.length < 15) { // shorter snakes can afford to skirt the edges better
      //   return getRandomMove(moves)
      // } else {
      //   return moveTowardsCenter(myHead, gameState.board, moves)
      // }
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
