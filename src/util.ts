import { createWriteStream, WriteStream } from 'fs';
import { Board, GameState, Game, Ruleset, RulesetSettings, RoyaleSettings, SquadSettings, ICoord } from "./types"
import { Coord, Battlesnake, BoardCell, Board2d, Moves, SnakeCell } from "./classes"

export function logToFile(file: WriteStream, str: string) {
  console.log(str)
  file.write(`${str}
  `)
}

let consoleWriteStream = createWriteStream("consoleLogs_util.txt", {
  encoding: "utf8"
})

export function getRandomInt(min: number, max: number) : number {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min) + min); //The maximum is exclusive and the minimum is inclusive
}

export function getRandomMove(moves: string[]) : string {
  let randomMove : string = moves[getRandomInt(0, moves.length)]
  //logToFile(consoleWriteStream, `of available moves ${moves.toString()}, choosing random move ${randomMove}`)
  return randomMove
}

export function coordsEqual(c1: Coord, c2: Coord): boolean {
  return (c1.x === c2.x && c1.y === c2.y)
}

// returns true if snake health is max, indicating it ate this turn
export function snakeHasEaten(snake: Battlesnake) : boolean {
  //logToFile(`snakeHasEaten: snake at (${snake.head.x},${snake.head.y}) length: ${snake.length}; body length: ${snake.body.length}; snake health: ${snake.health}`)
  return (snake.health === 100 && snake.length > 1)
}

// returns minimum number of moves between input coordinates
export function getDistance(c1: Coord, c2: Coord) : number {
  return Math.abs(c1.x - c2.x) + Math.abs(c1.y - c2.y)
}

export function getCoordAfterMove(coord: Coord, move: string) : Coord {
  let newPosition : Coord = new Coord(coord.x, coord.y)
  switch (move) {
    case "up":
      newPosition.y = newPosition.y + 1
      break;
    case "down":
      newPosition.y = newPosition.y - 1
      break;
    case "left":
      newPosition.x = newPosition.x - 1
      break
    default: // case "right":
      newPosition.x = newPosition.x + 1
      break
  }
  return newPosition
}

export function getSurroundingCells(coord : Coord, board2d: Board2d, directionFrom: string) : BoardCell[] {
  let surroundingCells : BoardCell[] = []
  if (directionFrom !== "left") {
    let newCell = board2d.getCell(new Coord(coord.x - 1, coord.y))
    if (newCell instanceof BoardCell) {
      surroundingCells.push(newCell)
    }
  }
  if (directionFrom !== "right") {
    let newCell = board2d.getCell(new Coord(coord.x + 1, coord.y))
    if (newCell instanceof BoardCell) {
      surroundingCells.push(newCell)
    }
  }
  if (directionFrom !== "down") {
    let newCell = board2d.getCell(new Coord(coord.x, coord.y - 1))
    if (newCell instanceof BoardCell) {
      surroundingCells.push(newCell)
    }
  }
  if (directionFrom !== "up") {
    let newCell = board2d.getCell(new Coord(coord.x, coord.y + 1))
    if (newCell instanceof BoardCell) {
      surroundingCells.push(newCell)
    }
  }

  //logToFile(consoleWriteStream, `cells surrounding (${coord.x},${coord.y}) for ${me.id}`)
  //surroundingCells.forEach(cell => cell.logSelf(me.id))

  return surroundingCells
}

export function isKingOfTheSnakes(me: Battlesnake, board: Board) : boolean {
  let kingOfTheSnakes = true
  if (board.snakes.length === 1) { // what is a king without a kingdom?
    return false
  } else {
    board.snakes.forEach(function isSnakeBigger(snake) {
      if ((me.id !== snake.id) && ((me.length - snake.length) < 2)) { // if any snake is within 2 lengths of me
        kingOfTheSnakes = false
      }
    })
  }
  return kingOfTheSnakes
}

// finds the longest snake on the board and, in the event of a tie, returns the one closest to me. Returns self if only snake on board
export function getLongestSnake(me: Battlesnake, snakes: Battlesnake[]) : Battlesnake {
  let longestSnakeIndex : number = 0
  let len : number = 0
  let distToMe : number = 0

  //logToFile(consoleWriteStream, `getLongestSnake logic for snake at (${me.head.x},${me.head.y})`)
  if (snakes.length === 0) {
    return me
  } else if (snakes.length === 1) {
    return snakes[0]
  }
  snakes.forEach(function findLongestSnake(snake, idx) {
    if (snake.id !== me.id) { // don't check myself
      //logToFile(consoleWriteStream, `snake len: ${len}, distToMe: ${distToMe}`)
      if (snake.length > len) {
        len = snake.length
        longestSnakeIndex = idx
        distToMe = getDistance(me.head, snake.head)
      } else if (snake.length === len) {
        let newDistToMe = getDistance(me.head, snake.head)
        if (newDistToMe < distToMe) { // if it's a tie & this one is closer
          longestSnakeIndex = idx
          distToMe = newDistToMe
        }
      }
    }
  })
  //logToFile(consoleWriteStream, `longestSnakeIndex: ${longestSnakeIndex}, snakes length: ${snakes.length}`)
  //logToFile(consoleWriteStream, `final snake len: ${len}, distToMe: ${distToMe}, coords of head: (${snakes[longestSnakeIndex].head.x},${snakes[longestSnakeIndex].head.y})`)
  return snakes[longestSnakeIndex]
}

// returns true if c1 is directly above c2
function isAbove(c1: Coord, c2: Coord): boolean {
  return (c1.x === c2.x && c1.y - c2.y === 1)
}

// returns true if c1 is directly below c2
function isBelow(c1: Coord, c2: Coord): boolean {
  return (c1.x === c2.x && c2.y - c1.y === 1)
}

// returns true if c1 is directly right of c2
function isRight(c1: Coord, c2: Coord): boolean {
  return (c1.y === c2.y && c1.x - c2.x === 1)
}

// returns true if c1 is directly left of c2
function isLeft(c1: Coord, c2: Coord): boolean {
  return (c1.y === c2.y && c2.x - c1.x === 1)
}

// returns up, down, left, or right if c1 is directly up, down, left, or right, respectively, of c2. Undefined if not exactly 1 away in any one direction.
export function getRelativeDirection(c1: Coord, c2: Coord): string | undefined {
  if (isAbove(c1, c2)) {
    return "up"
  } else if (isBelow(c1, c2)) {
    return "down"
  } else if (isLeft(c1, c2)) {
    return "left"
  } else if (isRight(c1, c2)) {
    return "right"
  } else return undefined
}

export function coordToString(coord: Coord) : string {
  return `(${coord.x},${coord.y})`
}

export function snakeToString(snake: Battlesnake) : string {
  let bodyString : string = ""
  snake.body.forEach(function concatBodyPart(coord: Coord) {
    bodyString = bodyString ? `${bodyString},${coordToString(coord)}` : `${coordToString(coord)}` 
  })
  return `snake id: ${snake.id}; name: ${snake.name}; health: ${snake.health}; body: ${bodyString}; length: ${snake.length}; latency: ${snake.latency}; shout: ${snake.shout}; squad: ${snake.squad}`
}

// function for duplicating a game state, with no references to original
export function cloneGameState(gameState: GameState) : GameState {
  // create new RoyaleSettings
  let cloneRoyaleSettings : RoyaleSettings = {
    shrinkEveryNTurns: gameState.game.ruleset.settings.royale.shrinkEveryNTurns
  }
  // create new SquadSettings
  let cloneSquadSettings : SquadSettings = {
    allowBodyCollisions: gameState.game.ruleset.settings.squad.allowBodyCollisions,
    sharedElimination: gameState.game.ruleset.settings.squad.sharedElimination,
    sharedHealth: gameState.game.ruleset.settings.squad.sharedHealth,
    sharedLength: gameState.game.ruleset.settings.squad.sharedLength
  }
  // create new RulesetSettings
  let cloneRulesetSettings : RulesetSettings = {
    foodSpawnChance: gameState.game.ruleset.settings.foodSpawnChance,
    minimumFood: gameState.game.ruleset.settings.minimumFood,
    hazardDamagePerTurn: gameState.game.ruleset.settings.hazardDamagePerTurn,
    royale: cloneRoyaleSettings,
    squad: cloneSquadSettings
  }
  // create new Ruleset
  let cloneRuleset : Ruleset = {
    name: gameState.game.ruleset.name,
    version: gameState.game.ruleset.version,
    settings: cloneRulesetSettings
  }
  // create new Game
  let cloneGame : Game = {
    id: gameState.game.id,
    ruleset: cloneRuleset,
    timeout: gameState.game.timeout,
    source: gameState.game.source
  }

  // create new Food array
  let cloneFood : ICoord[] = []
  gameState.board.food.forEach(function addFood(coord) {
    cloneFood.push({x: coord.x, y: coord.y})
  })

  let cloneSnakes : Battlesnake[] = [] // note that this is of type Battlesnake, not IBattlesnake, meaning our clone diverges from the original here. But our class is better, so maybe that's okay.
  gameState.board.snakes.forEach(function addSnake(snake) {
    let newBody : Coord[] = []
    snake.body.forEach(function addPart(coord: Coord) {
      newBody.push({x: coord.x, y: coord.y})
    })
    cloneSnakes.push(new Battlesnake(snake.id, snake.name, snake.health, newBody, snake.latency, snake.shout, snake.squad))
  })

  let cloneHazards : ICoord[] = []
  gameState.board.hazards.forEach(function addHazard(coord) {
    cloneHazards.push({x: coord.x, y: coord.y})
  })

  // create new Board
  let cloneBoard : Board = {
    height: gameState.board.height,
    width: gameState.board.width,
    food: cloneFood,
    snakes: cloneSnakes,
    hazards: cloneHazards
  }

  let cloneYouProbably : Battlesnake | undefined = cloneBoard.snakes.find(function findSnake(snake) {
    return snake.id === gameState.you.id
  })
  let cloneYou : Battlesnake = cloneYouProbably instanceof Battlesnake ? cloneYouProbably : cloneSnakes[0] // it shouldn't ever need to assign cloneSnakes[0], but typescript wants this in case the find returns undefined

  let cloneGameState : GameState = {
    game: cloneGame,
    turn: gameState.turn,
    board: cloneBoard,
    you: cloneYou
  }

  return cloneGameState
}

// returns true if it was able to move the snake, else false
export function moveSnake(gameState: GameState, snake: Battlesnake, board2d: Board2d, move: string) : boolean {
  let newCoord = getCoordAfterMove(snake.head, move)
  let newCell = board2d.getCell(newCoord)
  if (newCell instanceof BoardCell) { // if it's a valid cell to move to
    // even if snake has eaten this turn, its tail cell will be duplicated, so we will still want to slice off the last element
    snake.body = snake.body.slice(0, -1) // remove last element of body

    if (newCell.food) {
      snake.health = 100
    } else if (newCell.hazard) {
      snake.health = snake.health - 1 - gameState.game.ruleset.settings.hazardDamagePerTurn
    } else {
      snake.health = snake.health - 1
    }
      
    snake.body.unshift(newCoord) // add new coordinate to front of body
    snake.head = snake.body[0]
    snake.length = snake.body.length // note this doesn't account for whether food was eaten this round - this is how Battlesnake does it too, length is just a reference to the snake body array length
    return true
  } else {
    return false
  }
}

export function checkForSnakesAndWalls(me: Battlesnake, board: Board2d, moves: Moves) {
  function checkCell(x: number, y: number) : boolean {
    if (x < 0) { // indicates a move into the left wall
      return false
    } else if (y < 0) { // indicates a move into the bottom wall
      return false
    } else if (x >= board.width) { // indicates a move into the right wall
      return false
    } else if (y >= board.height) { // indicates a move into the top wall
      return false
    }
    let newCoord = new Coord(x, y)
    let newCell = board.getCell(newCoord)
    if (newCell instanceof BoardCell) {
      if (newCell.snakeCell instanceof SnakeCell) { // if newCell has a snake, we may be able to move into it if it's a tail
        //logToFile(consoleWriteStream, `snakeCell at (${newCell.coord.x},${newCell.coord.y}) is a tail: ${snakeCell.isTail} and has eaten: ${snakeHasEaten(snakeCell.snake)}`)
        if (newCell.snakeCell.isTail && !snakeHasEaten(newCell.snakeCell.snake)) { // if a snake hasn't eaten on this turn, its tail will recede next turn, making it a safe place to move
          return true
        } else { // cannot move into any other body part
          return false
        }
      } else {
        return true
      }
    } else {
      return false
    }
  }
  
  let myCoords : Coord = me.head

  if (!checkCell(myCoords.x - 1, myCoords.y)) {
    moves.left = false
  }
  if (!checkCell(myCoords.x, myCoords.y - 1)) {
    moves.down = false
  }
  if (!checkCell(myCoords.x + 1, myCoords.y)) {
    moves.right = false
  }
  if (!checkCell(myCoords.x, myCoords.y + 1)) {
    moves.up = false
  }
}

// checks how much time has elapsed since beginning of move function,
// returns true if more than 50ms exists after latency
export function checkTime(timeBeginning: number, gameState: GameState) : boolean {
  let timeCurrent : number = Date.now(),
      timeElapsed : number = timeCurrent - timeBeginning,
      myLatency : number = gameState.you.latency ? parseInt(gameState.you.latency, 10) : 200, // assume a high latency when no value exists, either on first run or after timeout
      timeLeft = gameState.game.timeout - timeElapsed - myLatency
  console.log("turn: %d. Elapsed time: %d; latency: %d; time left: %d", gameState.turn, timeElapsed, myLatency, timeLeft)
  return timeLeft > 50
}