import { InfoResponse, GameState, MoveResponse, Game, Board } from "./types"
import { Coord, SnakeCell, Board2d, Moves, MoveNeighbors, BoardCell, Battlesnake, KissStates } from "./classes"
import { logToFile, getRandomInt, snakeHasEaten, coordsEqual, getDistance, getCoordAfterMove, getSurroundingCells, isKingOfTheSnakes, getLongestSnake, snakeToString, coordToString, cloneGameState, moveSnake, checkForSnakesHealthAndWalls, checkForHealth, checkTime, findMoveNeighbors, findKissDeathMoves, findKissMurderMoves, getKissOfDeathState, updateGameStateAfterMove } from "./util"
import { evaluate } from "./eval"

import { createWriteStream } from 'fs'
let consoleWriteStream = createWriteStream("consoleLogs_logic.txt", {
  encoding: "utf8"
})

export function info(): InfoResponse {
    console.log("INFO")
    // Jaguar
    // const response: InfoResponse = {
    //     apiversion: "1",
    //     author: "waryferryman",
    //     color: "#ff9900", // #ff9900
    //     head: "tiger-king", //"tiger-king",
    //     tail: "mystic-moon" //"mystic-moon"
    // }

    // Test Snake
    const response: InfoResponse = {
      apiversion: "1",
      author: "waryferryman",
      color: "#ff9900", // #ff9900
      head: "trans-rights-scarf", //"tiger-king",
      tail: "comet" //"mystic-moon"
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
function kissDecider(myself: Battlesnake, gameState: GameState, moveNeighbors: MoveNeighbors, deathMoves : string[], killMoves : string[], moves: Moves, board2d: Board2d) : KissStates {
  let validMoves = moves.validMoves()
  let states = new KissStates()
  function setKissOfDeathDirectionState(dir : string, state: string) : void {
    switch (dir) {
      case "up":
        states.kissOfDeathState.up = state
        break
      case "down":
        states.kissOfDeathState.down = state
        break
      case "left":
        states.kissOfDeathState.left = state
        break
      default: // case "right":
        states.kissOfDeathState.right = state
        break
    }
  }

  function setKissOfMurderDirectionState(dir : string, state: string) : void {
    switch (dir) {
      case "up":
        states.kissOfMurderState.up = state
        break
      case "down":
        states.kissOfMurderState.down = state
        break
      case "left":
        states.kissOfMurderState.left = state
        break
      default: // case "right":
        states.kissOfMurderState.right = state
        break
    }
  }
  
  let huntingChanceDirections : Moves = moveNeighbors.huntingChanceDirections()
  let huntedDirections = huntingChanceDirections.invalidMoves()
  // first look through dangerous moves
  switch(deathMoves.length) {
    case 1: // if one move results in a kissOfDeath, penalize that move in evaluate
    validMoves.forEach(function setMoveState(move: string) {
        if (move === deathMoves[0]) {
          if (huntedDirections.includes(move)) {
            setKissOfDeathDirectionState(move, "kissOfDeathCertainty")
          } else {
            setKissOfDeathDirectionState(move, "kissOfDeathMaybe")
          }
        } else{
          if (validMoves.length === 3) {
            setKissOfDeathDirectionState(move, "kissOfDeath3To2Avoidance")
          } else {
            setKissOfDeathDirectionState(move, "kissOfDeath2To1Avoidance")
          }
        }
      })
      break
    case 2: // if two moves result in a kiss of death, penalize those moves in evaluate
      validMoves.forEach(function setMoveState(move: string) {
        if (move === deathMoves[0] || move === deathMoves[1]) {
          if (huntedDirections.includes(move)) { // this direction spells certain death
            setKissOfDeathDirectionState(move, "kissOfDeathCertainty")
          } else { // this direction spells possible death
            setKissOfDeathDirectionState(move, "kissOfDeathMaybe")
          }
        } else { // this direction does not have any kiss of death cells
          setKissOfDeathDirectionState(move, "kissOfDeath3To1Avoidance")
        }
      })
      break
    case 3: // if all three moves may cause my demise, penalize those moves in evaluate
      validMoves.forEach(function setMoveState(move: string) {
        if (huntedDirections.includes(move)) { // this direction spells certain death
          setKissOfDeathDirectionState(move, "kissOfDeathCertainty")
        } else { // this direction spells possible death
          setKissOfDeathDirectionState(move, "kissOfDeathMaybe")
        }
      })
      break
    default: // case 0
      break // all states are by default kissOfDeathNo
  }

  // TODO: try to add a third tier for murder moves the enemy snake almost certainly won't take
  killMoves.forEach(function determineKillMoveState(move) {
    let preyMoves : Moves = new Moves(true, true, true, true) // do a basic check of prey's surroundings & evaluate how likely this kill is from that
    switch(move) {
      case "up":
        if (typeof moveNeighbors.upPrey !== "undefined") {
          checkForSnakesHealthAndWalls(moveNeighbors.upPrey, gameState, board2d, preyMoves)
          if (preyMoves.validMoves().length === 1) {
            setKissOfMurderDirectionState(move, "kissOfMurderCertainty")
          } else {
            setKissOfMurderDirectionState(move, "kissOfMurderMaybe")
          }
        }
        break
      case "down":
        if (typeof moveNeighbors.downPrey !== "undefined") {
          checkForSnakesHealthAndWalls(moveNeighbors.downPrey, gameState, board2d, preyMoves)
          if (preyMoves.validMoves().length === 1) {
            setKissOfMurderDirectionState(move, "kissOfMurderCertainty")
          } else {
            setKissOfMurderDirectionState(move, "kissOfMurderMaybe")
          }
        }
        break
      case "left":
        if (typeof moveNeighbors.leftPrey !== "undefined") {
          checkForSnakesHealthAndWalls(moveNeighbors.leftPrey, gameState, board2d, preyMoves)
          if (preyMoves.validMoves().length === 1) {
            setKissOfMurderDirectionState(move, "kissOfMurderCertainty")
          } else {
            setKissOfMurderDirectionState(move, "kissOfMurderMaybe")
          }
        }
        break
      default: //case "right":
        if (typeof moveNeighbors.rightPrey !== "undefined") {
          checkForSnakesHealthAndWalls(moveNeighbors.rightPrey, gameState, board2d, preyMoves)
          if (preyMoves.validMoves().length === 1) {
            setKissOfMurderDirectionState(move, "kissOfMurderCertainty")
          } else {
            setKissOfMurderDirectionState(move, "kissOfMurderMaybe")
          }
        }
        break
    }
  })

  // second priority is looking for chances to eliminate another snake
  // if (killMoves.length > 0) {
  //   logToFile(consoleWriteStream, `for snake at (${myself.head.x},${myself.head.y}), killMoves: ${killMoves.toString()}`)
  //   let idx = getRandomInt(0, killMoves.length) // TODO: choose the smartest kill index
  //   logToFile(consoleWriteStream, `for snake at (${myself.head.x},${myself.head.y}), moving towards ${killMoves[idx]} to try to take a snake`)
  //   moves.disableOtherMoves(killMoves[idx])
  // }

  return states
}

// start looking ahead!
// replace random movement entirely
// replace all lets with consts where appropriate
// change tsconfig to noImplicitAny: true

// optional params indicate base case (so recursion doesn't run indefinitely) & the other snake to run on
export function move(gameState: GameState, isBaseCase?: boolean, otherSelf?: Battlesnake): MoveResponse {
    //logToFile(consoleWriteStream, `turn: ${gameState.turn}`)    
    
    let possibleMoves : Moves = new Moves(true, true, true, true)

    let myself: Battlesnake
    if (otherSelf instanceof Battlesnake) {
      myself = otherSelf
    } else {
      myself = gameState.you
    }
    const myHead: Coord = myself.head
    const myNeck: Coord = myself.body[1]
    const myBody: Coord[] = myself.body
    const otherSnakes: Battlesnake[] = gameState.board.snakes.filter(function filterMeOut(snake) { return snake.id !== myself.id})

    const board2d = new Board2d(gameState.board)

    // console.log(`Turn: ${gameState.turn}`)
    // board2d.logBoard()
    
    const timeBeginning = Date.now()

    //logToFile(consoleWriteStream, `myTail: ${coordToString(myTail)}`)
    //logToFile(consoleWriteStream, `myHead: ${coordToString(myHead)}`)

    checkForSnakesHealthAndWalls(myself, gameState, board2d, possibleMoves)
    //logToFile(consoleWriteStream, `possible moves after checkForSnakesAndWalls: ${possibleMoves}`)

    let moveNeighbors = findMoveNeighbors(myself, board2d, possibleMoves)
    let kissOfMurderMoves = findKissMurderMoves(myself, board2d, moveNeighbors)
    let kissOfDeathMoves = findKissDeathMoves(myself, board2d, moveNeighbors)
    //logToFile(evalWriteStream, `kissOfMurderMoves: ${kissOfMurderMoves.toString()}`)
    //logToFile(evalWriteStream, `kissOfDeathMoves: ${kissOfDeathMoves.toString()}`)

     let kissStates = kissDecider(myself, gameState, moveNeighbors, kissOfDeathMoves, kissOfMurderMoves, possibleMoves, board2d)

    // let kissOfDeathState : string = getKissOfDeathState(moveNeighbors, kissOfDeathMoves, possibleMoves)
    // let kissOfMurderState : string = "kissOfMurderNo"
    
    // Finally, choose a move from the available safe moves.
    // TODO: Step 5 - Select a move to make based on strategy, rather than random.
    
    // This function will determine the movement strategy for available moves. Should take in the board, the snakes, our health, the turn, etc. May want to replace this with lookahead functions later
    function decideMove(gameState: GameState, moves: Moves) : string {
      let availableMoves : string[] = moves.validMoves()
      //logToFile(consoleWriteStream, `moves after checking for snakes, health, & walls: ${moves}`)
      if (availableMoves.length < 1) { // given no good options, always choose another snake tile. It may die, which would make it a valid space again.
        let snakeMoves : Moves = new Moves(true, true, true, true)
        checkForHealth(myself, gameState, board2d, snakeMoves) // reset available moves to only exclude moves which kill me by wall or health. Snakecells are valid again
        //logToFile(consoleWriteStream, `snakeMoves after checking for just health & walls: ${snakeMoves}`)
        availableMoves = snakeMoves.validMoves()
        //logToFile(consoleWriteStream, `availableMoves after reassignment: ${availableMoves.toString()}`)
      }
      if (availableMoves.length < 1) { // if there are still no available moves, this means we're starving no matter what. Choose any direction that isn't a wall
        if (gameState.you.head.x !== 0) { // if we're not on left wall, move left
          return "left"
        } else { // else we are on the left wall, so move right
          return "right"
        }
      } else if (availableMoves.length === 1) {
        return availableMoves[0]
      }
      //return moveTowardsCenter(myHead, gameState.board, moves)

      // of the available remaining moves, evaluate the gameState if we took that move, and then choose the move resulting in the highest scoring gameState
      let bestMove : string = ""
      let bestMoveEval : number = -1

      availableMoves.forEach(function evaluateMove(move) {
        let newGameState = cloneGameState(gameState)
        let newBoard2d = new Board2d(newGameState.board)
        let evalState = 0

        moveSnake(newGameState, newGameState.you, newBoard2d, move)
        updateGameStateAfterMove(newGameState) // update gameState after moving myself
        let kissOfDeathState : string = ""
        let kissOfMurderState : string = ""
        switch (move) {
          case "up":
            kissOfDeathState = kissStates.kissOfDeathState.up
            kissOfMurderState = kissStates.kissOfMurderState.up
            break
          case "down":
            kissOfDeathState = kissStates.kissOfDeathState.down
            kissOfMurderState = kissStates.kissOfMurderState.down
            break
          case "left":
            kissOfDeathState = kissStates.kissOfDeathState.left
            kissOfMurderState = kissStates.kissOfMurderState.left
            break
          default: // case "right":
            kissOfDeathState = kissStates.kissOfDeathState.right
            kissOfMurderState = kissStates.kissOfMurderState.right
            break
        }
        evalState = evaluate(newGameState, newGameState.you, kissOfDeathState, kissOfMurderState, (myself.health < 10))
        //logToFile(consoleWriteStream, `eval for ${newGameState.you.name} at (${newGameState.you.head.x},${newGameState.you.head.y}): ${evalState}`)
        if (evalState > bestMoveEval) {
          bestMove = move
          bestMoveEval = evalState
        } else if ((evalState === bestMoveEval) && getRandomInt(0, 2)) { // in the event of tied evaluations, choose between them at random
          bestMove = move
          bestMoveEval = evalState
        }
      })

      return bestMove
    }

    if (isBaseCase) { // base case - don't want to run on other snakes
      let moveSnakes : { [key: string]: string} // array of snake IDs & the direction each snake having that ID wishes to move in
      otherSnakes.forEach(function mvsnk(snake) { // before evaluating myself snake's next move, get the moves of each other snake as if it moved the way I would
        moveSnakes[snake.id] = move(gameState, true, snake).move
      })
      otherSnakes.forEach(function mvsnk(snake) { // move each of the snakes at the same time, without updating gameState until each has moved
        if (moveSnakes[snake.id]) {
          moveSnake(gameState, snake, board2d, moveSnakes[snake.id])
        }
      })
      updateGameStateAfterMove(gameState) // after each otherSnake has moved, evaluate the new state
    }

    //const safeMoves = possibleMoves.validMoves()
    const chosenMove : string = decideMove(gameState, possibleMoves)
    const response: MoveResponse = {
        move: chosenMove
    }
    
    let newCoord = getCoordAfterMove(myHead, chosenMove)

    //checkTime()

    logToFile(consoleWriteStream, `${gameState.game.id} MOVE ${gameState.turn}: ${response.move}, newCoord: ${newCoord}`)

    //logToFile(consoleWriteStream, `myself: ${snakeToString(myself)}`)
    return response
}
