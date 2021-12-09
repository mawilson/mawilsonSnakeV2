import { InfoResponse, GameState, MoveResponse, Game, Board } from "./types"
import { Coord, SnakeCell, Board2d, Moves, MoveNeighbors, BoardCell, Battlesnake, KissStates } from "./classes"
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
function kissDecider(myself: Battlesnake, moveNeighbors: MoveNeighbors, deathMoves : string[], killMoves : string[], moves: Moves) : KissStates {
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
        } else if (d === shortestDist && getRandomInt(0, 2)) { // given another valid route towards middle, choose it half of the time
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
          evalState = evaluate(newGameState, newGameState.you, kissOfDeathState, kissOfMurderState)
          //logToFile(consoleWriteStream, `eval for ${newGameState.you.name} at (${newGameState.you.head.x},${newGameState.you.head.y}): ${evalState}`)
          if (evalState > bestMoveEval) {
            bestMove = move
            bestMoveEval = evalState
          } else if ((evalState === bestMoveEval) && getRandomInt(0, 2)) { // in the event of tied evaluations, choose between them at random
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
