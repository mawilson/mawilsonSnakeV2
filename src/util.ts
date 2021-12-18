import { createWriteStream, WriteStream } from 'fs';
import { Board, GameState, Game, Ruleset, RulesetSettings, RoyaleSettings, SquadSettings, ICoord } from "./types"
import { Coord, Battlesnake, BoardCell, Board2d, Moves, SnakeCell, MoveNeighbors, KissStates, KissOfDeathState, KissOfMurderState, MoveWithEval } from "./classes"
import { evaluate } from "./eval"

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
  let selfCell = board2d.getCell(coord)
  let surroundingCells : BoardCell[] = []
  if (!(selfCell instanceof BoardCell)) { // a cell that doesn't exist shouldn't return neighbors
    return surroundingCells
  }
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

// returns difference between my length & the length of the largest other snake on the board - can be positive (I am bigger) or negative (I am smaller)
export function snakeLengthDelta(me: Battlesnake, board: Board) : number {
  return me.length - getLongestSnake(me, board.snakes).length
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

// given a battlesnake, returns what direction its neck is relative to its head. Should always be either left, right, down, or up
// will be undefined on turn 0, as snakes effectively have no necks yet
export function getNeckDirection(snake: Battlesnake) : string | undefined {
  let neckCell : Coord = snake.body[1]
  if (coordsEqual(snake.head, neckCell)) {
    neckCell = snake.body[2] // this triggers on turn 1, when snake neck is at body cell 2 & snake head is at body cells 0 & 1
  }
  if (coordsEqual(snake.head, neckCell)) {
    return undefined // should only ever be true on turn 0, when snake body 0, 1, 2 are all the same coord
  }
  if (snake.head.x > snake.body[1].x) {
    return "left" // neck is left of body
  } else if (snake.head.x < snake.body[1].x) {
    return "right" // neck is right of body
  } else if (snake.head.y > snake.body[1].y) {
    return "down" // neck is below body
  } else { // snake.head.y < snake.body[1].y
    return "up"
  }
}

function getOppositeDirection(dir: string | undefined) : string | undefined {
  switch (dir) {
    case "left":
      return "right"
    case "right":
      return "left"
    case "up":
      return "down"
    case "down":
      return "up"
    default:
      return undefined
  }
}

// returns the direction a snake is moving by checking which direction its neck is relative to itself. Returns undefined on turn 0
export function getSnakeDirection(snake: Battlesnake) : string | undefined {
  let neckDirection : string | undefined = getNeckDirection(snake)
  return getOppositeDirection(neckDirection)
}

// return any move that is neither outside of the gameState boundaries, nor the snake's neck
// a maximum of two directions can result in out of bounds, & one direction can result in neck. Thus there must always be one valid direction
export function getDefaultMove(gameState: GameState, snake: Battlesnake) : string {
  let neckDir = getNeckDirection(snake)
  if (snake.head.x !== 0 && neckDir !== "left") {
    return "left" // left is neither out of bounds nor our neck
  } else if (snake.head.x !== (gameState.board.width - 1) && neckDir !== "right") {
    return "right" // right is neither out of bounds nor our neck
  } else if (snake.head.y !== 0 && neckDir !== "down") {
    return "down" // down is neither out of bounds nor our neck
  } else {
    return "up"
  }
}

// moveSnake will move the input snake in the move direction, & if it can't, will move it in the next direction in line, until it succeeds
export function moveSnake(gameState: GameState, snake: Battlesnake, board2d: Board2d, _move: string | undefined) : void {
  //logToFile(consoleWriteStream, `moveSnake snake before move: ${snakeToString(snake)}`)
  let move : string = _move === undefined ? getDefaultMove(gameState, snake) : _move // if a move was not provided, get a default one
  let newCoord = getCoordAfterMove(snake.head, move)
  let newCell = board2d.getCell(newCoord)
  if (newCell instanceof BoardCell) { // if it's a valid cell to move to
    // even if snake has eaten this turn, its tail cell will be duplicated, so we will still want to slice off the last element
    snake.body = snake.body.slice(0, -1) // remove last element of body
      
    snake.body.unshift(newCoord) // add new coordinate to front of body
    snake.head = snake.body[0]

    if (newCell.food) {
      snake.health = 100
      snake.body.push(snake.body[snake.body.length - 1]) // snake should duplicate its tail cell if it has just eaten
    } else if (newCell.hazard) {
      snake.health = snake.health - 1 - gameState.game.ruleset.settings.hazardDamagePerTurn
    } else {
      snake.health = snake.health - 1
    }

    snake.length = snake.body.length // this is how Battlesnake does it too, length is just a reference to the snake body array length
  } else { // moveSnake should never move anywhere that isn't on the board, try again a different direction
    let newDir = getDefaultMove(gameState, snake)
    logToFile(consoleWriteStream, `failed to move snake ${snake.name} at (${snake.head.x},${snake.head.y}) towards ${move}, trying towards ${newDir} instead`)
    moveSnake(gameState, snake, board2d, newDir) // at least one of the directions will always be on the game board & not be our neck, so this should never infinitely recurse
  }
  //logToFile(consoleWriteStream, `moveSnake snake after move: ${snakeToString(snake)}`)
}

// After snakes have moved, may need to do some gamestate updating - removing eaten food & dead snakes
export function updateGameStateAfterMove(gameState: GameState) {
  gameState.board.food = gameState.board.food.filter(function findUneatenFood(food): boolean {
    let eatSnake : Battlesnake | undefined = gameState.board.snakes.find(function findEatSnake(snake : Battlesnake): boolean { // find any snake whose head is at this food
      return coordsEqual(snake.head, food) // if snake head is at this food, the food has been eaten. True means this head is on a food, false means it is not
    })
    return eatSnake === undefined // for this food, if it does not have an eatSnake, it has not been eaten.
  })
  
  let liveSnakes : Battlesnake[] = [] // snakes that live past the health check
  gameState.board.snakes.forEach(function checkSnake(snake) { // first check healths. Want to remove any snakes that have starved before checking for collisions
    if (snake.health > 0) {
      liveSnakes.push(snake)
    }
  })
  gameState.board.snakes = liveSnakes // should be same snakes, but without the starved ones

  gameState.board.snakes = gameState.board.snakes.filter(function checkSnake(snake) { // after checking for snakes that have run out of health, check for collisions with other snakes
    let murderSnek : Battlesnake | undefined = gameState.board.snakes.find(function findMurderSnek(otherSnake) { // find a different snake in the same cell as my head
      let otherSnakeIsLarger = otherSnake.length >= snake.length
      // look through other snake cells. If it's a snake body, I'm dead for sure, if it's a snake head, check lengths
      // note that this didn't filter out myself for iterating through otherSnakes - can still collide with own parts. Need to check for own head later though, see line 382
      let deathCell : Coord | undefined = otherSnake.body.find(function checkBody(coord : Coord, idx: number) : boolean {
        if (coordsEqual(coord, snake.head)) { // if coords are equal, we have a collision of some type
          if (coordsEqual(coord, otherSnake.head)) { // this is otherSnake's head (or a body part on turn 0 or 1), we have a head-on collision, evaluate length
            if (snake.id === otherSnake.id) {
              if (idx === 0) { // obviously snake head has 'collided' with itself, ignore this case
                return false
              } else if (idx === 1 && gameState.turn <= 1) { // special case for turns 1 & 0 when index 1 also has the head coordinate
                return false
              } else if (idx === 2 && gameState.turn === 0) { // special case for turn 0 when index 2 also has the head coordinate
                return false
              } else {
                return true // snake can still collide with any other cell
              }
            } else {
              return otherSnakeIsLarger // return true if otherSnake is larger or equal, otherwise return false
            }
          } else { // if we have a collision that is not with otherSnake's head, it always means death for snake
            return true
          }
        } else {
          return false
        }
      })
      return deathCell !== undefined // if deathCell is defined, return true to indicate we've found its death
    })
    return murderSnek === undefined // if we have not found a murderSnek, the snake survives
  })
}

// Disables moves in Moves object which lead to or past a wall
export function checkForWalls(me: Battlesnake, board: Board2d, moves: Moves) {
  function checkCell(x: number, y: number) : boolean {
    if (x < 0) { // indicates a move into the left wall
      return false
    } else if (y < 0) { // indicates a move into the bottom wall
      return false
    } else if (x >= board.width) { // indicates a move into the right wall
      return false
    } else if (y >= board.height) { // indicates a move into the top wall
      return false
    } else {
      return true
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

// Disables moves in Moves object which lead into a snake body, except for tails which will recede the next turn
export function checkForSnakes(me: Battlesnake, board: Board2d, moves: Moves) {
  function checkCell(x: number, y: number) : boolean {
    let newCoord = new Coord(x, y)
    let newCell = board.getCell(newCoord)
    if (newCell instanceof BoardCell) {
      if (newCell.snakeCell instanceof SnakeCell) { // if newCell has a snake, we may be able to move into it if it's a tail
        //logToFile(consoleWriteStream, `snakeCell at (${newCell.coord.x},${newCell.coord.y}) is a tail: ${newCell.snakeCell.isTail} and has eaten: ${snakeHasEaten(newCell.snakeCell.snake)} and is greater than length 3: ${newCell.snakeCell.snake.length >= 3}`)
        if (newCell.snakeCell.isTail && !snakeHasEaten(newCell.snakeCell.snake) && !coordsEqual(newCoord, newCell.snakeCell.snake.body[1])) { // if a snake hasn't eaten on this turn, its tail will recede next turn, making it a safe place to move. Third check is to ensure the tail is not also the neck - this only applies for turns 0 & 1, when the snake has not yet expanded out to its full starting length of 3
          //logToFile(consoleWriteStream, `can chase tail at (${newCell.coord.x},${newCell.coord.y})`)
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

// Disables moves which will cause the snakes death, taking into account normal turn damage, hazard damage, & food acquisition
export function checkForHealth(me: Battlesnake, gameState: GameState, board: Board2d, moves: Moves) {
  function checkCell(x: number, y: number) : boolean {
    let newCoord = new Coord(x, y)
    let newCell = board.getCell(newCoord)
    if (newCell instanceof BoardCell) {
      if (newCell.food) {
        return true // will not starve if we got food on this cell
      } else if (newCell.hazard) {
        return (me.health - 1 - gameState.game.ruleset.settings.hazardDamagePerTurn) > 0 // true if I will not starve here after accounting for hazard, false if not
      } else {
        return (me.health - 1) > 0 // true if I will not starve here, false if not
      }
    } else {
      return false // any cell that doesn't exist will also lead to snake's 'starvation' by walking out through a wall
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

// disables the direction in moves that contains the neck of me
export function checkForNeck(me: Battlesnake, gameState: GameState, moves: Moves): void {
  let neckDir = getNeckDirection(me)
  switch (neckDir) {
    case "left":
      moves.left = false
      break
    case "right":
      moves.right = false
      break
    case "up":
      moves.up = false
      break
    case "down":
      moves.down = false
      break
    default: // snake has no neck, don't disable any neck direction
      break
  }
}

export function checkForSnakesHealthAndWalls(me: Battlesnake, gameState: GameState, board2d: Board2d, moves: Moves) {
  checkForHealth(me, gameState, board2d, moves)
  checkForSnakes(me, board2d, moves)
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

export function findMoveNeighbors(me: Battlesnake, board2d: Board2d, moves: Moves) : MoveNeighbors {
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
  //logToFile(evalWriteStream, `findMoveNeighbors for snake at (${me.head.x},${me.head.y}): upLength, downLength, leftLength, rightLength: ${kissMoves.upNeighbors.length}, ${kissMoves.downNeighbors.length}, ${kissMoves.leftNeighbors.length}, ${kissMoves.rightNeighbors.length}`)
  return kissMoves
}

export function findKissMurderMoves(me: Battlesnake, board2d: Board2d, kissMoves: MoveNeighbors) : string[] {
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

export function findKissDeathMoves(me: Battlesnake, board2d: Board2d, kissMoves: MoveNeighbors) : string[] {
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

export function getKissOfDeathState(moveNeighbors: MoveNeighbors, kissOfDeathMoves: string[], possibleMoves: Moves) : KissOfDeathState {
  let validMoves : string[] = possibleMoves.validMoves()
  let kissOfDeathState : KissOfDeathState = KissOfDeathState.kissOfDeathNo
  switch (kissOfDeathMoves.length) {
    case 3: // all three available moves may result in my demise
      // in this scenario, at least two snakes must be involved in order to cut off all of my options. Assuming that a murder snake will murder if it can, we want to eliminate any move option that is the only one that snake can reach
      let huntingChanceDirections : Moves = moveNeighbors.huntingChanceDirections()
      let huntedDirections = huntingChanceDirections.invalidMoves()
      if (huntedDirections.length !== 3) { // two of the directions offer us a chance
        //buildLogString(`KissOfDeathMaybe, adding ${evalKissOfDeathMaybe}`)
        kissOfDeathState = KissOfDeathState.kissOfDeathMaybe
        huntedDirections.forEach(function disableDir(dir) {
          possibleMoves.disableMove(dir)
        })
      } else { // they all seem like certain death - maybe we'll get lucky & a snake won't take the free kill. It is a clusterfuck at this point, after all
        //buildLogString(`KissOfDeathCertainty, adding ${evalKissOfDeathCertainty}`)
        kissOfDeathState = KissOfDeathState.kissOfDeathCertainty
      }
      break
    case 2:
      if (validMoves.length === 3) { // in this case, two moves give us a 50/50 kiss of death, but the third is fine. This isn't ideal, but isn't a terrible evaluation
        //buildLogString(`KissOfDeath3To1Avoidance, adding ${evalKissOfDeath3To1Avoidance}`)
        kissOfDeathState = KissOfDeathState.kissOfDeath3To1Avoidance
        possibleMoves.disableMove(kissOfDeathMoves[0])
        possibleMoves.disableMove(kissOfDeathMoves[1])
      } else { // this means a 50/50
        //buildLogString(`KissOfDeathMaybe, adding ${evalKissOfDeathMaybe}`)
        kissOfDeathState = KissOfDeathState.kissOfDeathMaybe
      }
      break
    case 1:
      if (possibleMoves.hasOtherMoves(kissOfDeathMoves[0])) {
        if (validMoves.length === 3) {
          //buildLogString(`KissOfDeath3To2Avoidance, adding ${evalKissOfDeath3To2Avoidance}`)
          kissOfDeathState = KissOfDeathState.kissOfDeath3To2Avoidance
          possibleMoves.disableMove(kissOfDeathMoves[0])
        } else { // we know validMoves can't be of length 1, else that would be a kiss cell
          //buildLogString(`KissOfDeath2To1Avoidance, adding ${evalKissOfDeath2To1Avoidance}`)
          kissOfDeathState = KissOfDeathState.kissOfDeath2To1Avoidance
        }
      } else {
        kissOfDeathState = KissOfDeathState.kissOfDeathCertainty
      }
      break
    default: // no kissOfDeathMoves nearby, this is good
      //buildLogString(`No kisses of death nearby, adding ${evalKissOfDeathNo}`)
      kissOfDeathState = KissOfDeathState.kissOfDeathNo
      break
  }
  return kissOfDeathState
}

export function calculateFoodSearchDepth(gameState: GameState, me: Battlesnake, board2d: Board2d, snakeKing: boolean) : number {
  const otherSnakes: Battlesnake[] = gameState.board.snakes.filter(function filterMeOut(snake) { return snake.id !== me.id})
  if (otherSnakes.length === 0) { // solo game, deprioritize food unless I'm dying
    if (me.health < 10) {
      return board2d.height + board2d.width
    } else {
      return 0
    }
  }
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

// looks for food within depth moves away from snakeHead
// returns an object whose keys are distances away, & whose values are food
// found at that distance
export function findFood(depth: number, food: Coord[], snakeHead : Coord) : { [key: number] : Coord[]} {
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
export function navigateTowards(snakeHead : Coord, newCoord: Coord, moves: Moves) {
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

// primarily useful for tests to quickly populate a hazard array. Duplicates hazard coordinates where rows & columns coincide, which shouldn't matter, maybe
export function createHazardColumn(board: Board, width: number) {
  for (let i: number = 0; i < board.height; i++) {
    board.hazards.push({x: width, y: i})
  }
}

// primarily useful for tests to quickly populate a hazard array. Duplicates hazard coordinates where rows & columns coincide, which shouldn't matter, maybe
export function createHazardRow(board: Board, height: number) {
  for (let i: number = 0; i < board.width; i++) {
    board.hazards.push({x: i, y: height})
  }
}

// gets self and surrounding cells & checks them for hazards, returning true if it finds any. Ignores spaces with snakes! Not beneficial to check for that.
export function isInOrAdjacentToHazard(coord: Coord, board2d: Board2d, gameState : GameState) : boolean {  
  if (gameState.game.ruleset.settings.hazardDamagePerTurn === 0) { // if hazard is not enabled, return false
    return false
  }
  let selfCell = board2d.getCell(coord)
  if (!(selfCell instanceof BoardCell)) {
    return false // return false for cells outside of board2d's bounds
  }
  if (coord.x === 0 || coord.y === 0 || (coord.x === board2d.width - 1) || (coord.y === board2d.height - 1)) {
    return true // edges are always adjacent to hazard, unless coord is outside of bounds
  }
  let neighbors = getSurroundingCells(coord, board2d, "")
  let hazardCell = neighbors.find(function checkForHazard(neighbor) {
    if (neighbor.snakeCell instanceof SnakeCell) {
      return false
    } else {
      return neighbor.hazard
    }
  })
  return hazardCell !== undefined
}

// return # of cells on board that have no snake & no hazard
export function getSafeCells(board2d: Board2d) : number {
  let num : number = 0
  for (let i: number = 0; i < board2d.width; i++) {
    for (let j: number = 0; j < board2d.height; j++) {
      let cell = board2d.getCell({x: i, y: j})
      if (cell instanceof BoardCell) {
        if (!(cell.snakeCell instanceof SnakeCell) && !cell.hazard) {
          num = num + 1 // if cell has neither snake nor hazard, it is safe
        }
      }
    }
  }
  return num
}

// looks at gamestate & myself & returns any moves that are valid - won't result in starvation, moving out of bounds, or (if possible) snake cells
export function getAvailableMoves(gameState: GameState, myself: Battlesnake, board2d: Board2d) : Moves {
  let moves : Moves = new Moves(true, true, true, true)

  checkForSnakesHealthAndWalls(myself, gameState, board2d, moves)
  //logToFile(consoleWriteStream, `possible moves after checkForSnakesAndWalls: ${possibleMoves}`)

  let availableMoves : string[] = moves.validMoves()
  //logToFile(consoleWriteStream, `moves after checking for snakes, health, & walls: ${moves}`)
  if (availableMoves.length < 1) { // given no good options, always choose another snake tile. It may die, which would make it a valid space again.
    moves.up = true
    moves.down = true
    moves.left = true
    moves.right = true
    checkForHealth(myself, gameState, board2d, moves) // reset available moves to only exclude moves which kill me by wall or health. Snakecells are valid again
    checkForNeck(myself, gameState, moves) // also disable neck as a valid place to move
    //logToFile(consoleWriteStream, `snakeMoves after checking for just health & walls: ${snakeMoves}`)
    //logToFile(consoleWriteStream, `availableMoves after reassignment: ${availableMoves.toString()}`)
  }
  return moves
}

// given a set of deathMoves that lead us into possibly being eaten,
// killMoves that lead us into possibly eating another snake,
// and moves, which is our actual move decision array
export function kissDecider(gameState: GameState, moveNeighbors: MoveNeighbors, deathMoves : string[], killMoves : string[], moves: Moves, board2d: Board2d) : KissStates {
  let validMoves = moves.validMoves()
  let states = new KissStates()
  function setKissOfDeathDirectionState(dir : string, state: KissOfDeathState) : void {
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

  function setKissOfMurderDirectionState(dir : string, state: KissOfMurderState) : void {
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
            setKissOfDeathDirectionState(move, KissOfDeathState.kissOfDeathCertainty)
          } else {
            setKissOfDeathDirectionState(move, KissOfDeathState.kissOfDeathMaybe)
          }
        } else{
          if (validMoves.length === 3) {
            setKissOfDeathDirectionState(move, KissOfDeathState.kissOfDeath3To2Avoidance)
          } else {
            setKissOfDeathDirectionState(move, KissOfDeathState.kissOfDeath2To1Avoidance)
          }
        }
      })
      break
    case 2: // if two moves result in a kiss of death, penalize those moves in evaluate
      validMoves.forEach(function setMoveState(move: string) {
        if (move === deathMoves[0] || move === deathMoves[1]) {
          if (huntedDirections.includes(move)) { // this direction spells certain death
            setKissOfDeathDirectionState(move, KissOfDeathState.kissOfDeathCertainty)
          } else { // this direction spells possible death
            setKissOfDeathDirectionState(move, KissOfDeathState.kissOfDeathMaybe)
          }
        } else { // this direction does not have any kiss of death cells
          setKissOfDeathDirectionState(move, KissOfDeathState.kissOfDeath3To1Avoidance)
        }
      })
      break
    case 3: // if all three moves may cause my demise, penalize those moves in evaluate
      validMoves.forEach(function setMoveState(move: string) {
        if (huntedDirections.includes(move)) { // this direction spells certain death
          setKissOfDeathDirectionState(move, KissOfDeathState.kissOfDeathCertainty)
        } else { // this direction spells possible death
          setKissOfDeathDirectionState(move, KissOfDeathState.kissOfDeathMaybe)
        }
      })
      break
    default: // case 0
      break // all states are by default kissOfDeathNo
  }

  killMoves.forEach(function determineKillMoveState(move) {
    let preyMoves : Moves = new Moves(true, true, true, true) // do a basic check of prey's surroundings & evaluate how likely this kill is from that
    switch(move) {
      case "up":
        if (typeof moveNeighbors.upPrey !== "undefined") {
          checkForSnakesHealthAndWalls(moveNeighbors.upPrey, gameState, board2d, preyMoves)
          if (preyMoves.validMoves().length === 1) {
            setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderCertainty)
          } else {
            setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderMaybe)
          }
        }
        break
      case "down":
        if (typeof moveNeighbors.downPrey !== "undefined") {
          checkForSnakesHealthAndWalls(moveNeighbors.downPrey, gameState, board2d, preyMoves)
          if (preyMoves.validMoves().length === 1) {
            setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderCertainty)
          } else {
            setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderMaybe)
          }
        }
        break
      case "left":
        if (typeof moveNeighbors.leftPrey !== "undefined") {
          checkForSnakesHealthAndWalls(moveNeighbors.leftPrey, gameState, board2d, preyMoves)
          if (preyMoves.validMoves().length === 1) {
            setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderCertainty)
          } else {
            setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderMaybe)
          }
        }
        break
      default: //case "right":
        if (typeof moveNeighbors.rightPrey !== "undefined") {
          checkForSnakesHealthAndWalls(moveNeighbors.rightPrey, gameState, board2d, preyMoves)
          if (preyMoves.validMoves().length === 1) {
            setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderCertainty)
          } else {
            setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderMaybe)
          }
        }
        break
    }
  })
  return states
}

// given a gamestate, snake, & board2d, return the kiss states of the neighboring cells
export function determineKissStates(gameState: GameState, myself: Battlesnake, board2d: Board2d) : KissStates {
  let moves : Moves = getAvailableMoves(gameState, myself, board2d)
  let moveNeighbors = findMoveNeighbors(myself, board2d, moves)
  let kissOfMurderMoves = findKissMurderMoves(myself, board2d, moveNeighbors)
  let kissOfDeathMoves = findKissDeathMoves(myself, board2d, moveNeighbors)
  //logToFile(evalWriteStream, `kissOfMurderMoves: ${kissOfMurderMoves.toString()}`)
  //logToFile(evalWriteStream, `kissOfDeathMoves: ${kissOfDeathMoves.toString()}`)

  return kissDecider(gameState, moveNeighbors, kissOfDeathMoves, kissOfMurderMoves, moves, board2d)
}

// given a set of neighboring cells & their kiss states, return the appropriate kiss states per the direction given
export function determineKissStateForDirection(direction: string, kissStates: KissStates): {kissOfDeathState: KissOfDeathState, kissOfMurderState: KissOfMurderState} {
  let kissOfDeathState : KissOfDeathState
  let kissOfMurderState : KissOfMurderState
  switch (direction) {
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
  return {kissOfDeathState: kissOfDeathState, kissOfMurderState: kissOfMurderState}
}