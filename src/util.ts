import { createWriteStream, WriteStream } from 'fs';
import { Board, GameState, Game, Ruleset, RulesetSettings, RoyaleSettings, SquadSettings, ICoord } from "./types"
import { Coord, Direction, Battlesnake, BoardCell, Board2d, Moves, SnakeCell, MoveNeighbors, KissStates, KissOfDeathState, KissOfMurderState, MoveWithEval, HazardWalls } from "./classes"
import { evaluate } from "./eval"
import { gameData, isDevelopment } from "./logic"

export function logToFile(file: WriteStream, str: string) {
  if (isDevelopment) {
    console.log(str)
    file.write(`${str}
`)
  }
}

let consoleWriteStream = createWriteStream("consoleLogs_util.txt", {
  encoding: "utf8"
})

export function getRandomInt(min: number, max: number) : number {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min) + min); //The maximum is exclusive and the minimum is inclusive
}

export function getRandomMove(moves: Direction[]) : Direction {
  let randomMove : Direction = moves[getRandomInt(0, moves.length)]
  return randomMove
}

export function coordsEqual(c1: Coord, c2: Coord): boolean {
  return (c1.x === c2.x && c1.y === c2.y)
}

// returns true if snake health is max, indicating it ate this turn
export function snakeHasEaten(snake: Battlesnake, lookahead?: number) : boolean {
  if (lookahead !== undefined) {
    return ((snake.health + lookahead) >= 100) && snake.length > 3
  } else {
    return (snake.health === 100 && snake.length > 3)
  }
}

// returns minimum number of moves between input coordinates
export function getDistance(c1: Coord, c2: Coord) : number {
  return Math.abs(c1.x - c2.x) + Math.abs(c1.y - c2.y)
}

// returns coordinate after move has been applied to it. If move is undefined, returns the same coordinate.
export function getCoordAfterMove(coord: Coord, move: Direction | undefined) : Coord {
  let newPosition : Coord = new Coord(coord.x, coord.y)
  switch (move) {
    case Direction.Up:
      newPosition.y = newPosition.y + 1
      break;
    case Direction.Down:
      newPosition.y = newPosition.y - 1
      break;
    case Direction.Left:
      newPosition.x = newPosition.x - 1
      break
    case Direction.Right: // case Direction.Right:
      newPosition.x = newPosition.x + 1
      break
    default:
      break
  }
  return newPosition
}

export function getSurroundingCells(coord : Coord, board2d: Board2d, directionFrom?: Direction) : BoardCell[] {
  let selfCell = board2d.getCell(coord)
  let surroundingCells : BoardCell[] = []
  if (!(selfCell instanceof BoardCell)) { // a cell that doesn't exist shouldn't return neighbors
    return surroundingCells
  }
  if (directionFrom !== Direction.Left) {
    let newCell = board2d.getCell(new Coord(coord.x - 1, coord.y))
    if (newCell instanceof BoardCell) {
      surroundingCells.push(newCell)
    }
  }
  if (directionFrom !== Direction.Right) {
    let newCell = board2d.getCell(new Coord(coord.x + 1, coord.y))
    if (newCell instanceof BoardCell) {
      surroundingCells.push(newCell)
    }
  }
  if (directionFrom !== Direction.Down) {
    let newCell = board2d.getCell(new Coord(coord.x, coord.y - 1))
    if (newCell instanceof BoardCell) {
      surroundingCells.push(newCell)
    }
  }
  if (directionFrom !== Direction.Up) {
    let newCell = board2d.getCell(new Coord(coord.x, coord.y + 1))
    if (newCell instanceof BoardCell) {
      surroundingCells.push(newCell)
    }
  }

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

  if (snakes.length === 0) {
    return me
  } else if (snakes.length === 1) {
    return snakes[0]
  }
  snakes.forEach(function findLongestSnake(snake, idx) {
    if (snake.id !== me.id) { // don't check myself
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
export function getRelativeDirection(c1: Coord, c2: Coord): Direction | undefined {
  if (isAbove(c1, c2)) {
    return Direction.Up
  } else if (isBelow(c1, c2)) {
    return Direction.Down
  } else if (isLeft(c1, c2)) {
    return Direction.Left
  } else if (isRight(c1, c2)) {
    return Direction.Right
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
export function getNeckDirection(snake: Battlesnake) : Direction | undefined {
  let neckCell : Coord = snake.body[1]
  if (coordsEqual(snake.head, neckCell)) {
    neckCell = snake.body[2] // this triggers on turn 1, when snake neck is at body cell 2 & snake head is at body cells 0 & 1
  }
  if (coordsEqual(snake.head, neckCell)) {
    return undefined // should only ever be true on turn 0, when snake body 0, 1, 2 are all the same coord
  }
  if (snake.head.x > snake.body[1].x) {
    return Direction.Left // neck is left of body
  } else if (snake.head.x < snake.body[1].x) {
    return Direction.Right // neck is right of body
  } else if (snake.head.y > snake.body[1].y) {
    return Direction.Down // neck is below body
  } else { // snake.head.y < snake.body[1].y
    return Direction.Up
  }
}

function getOppositeDirection(dir: Direction | undefined) : Direction | undefined {
  switch (dir) {
    case Direction.Left:
      return Direction.Right
    case Direction.Right:
      return Direction.Left
    case Direction.Up:
      return Direction.Down
    case Direction.Down:
      return Direction.Up
    default:
      return undefined
  }
}

// returns the direction a snake is moving by checking which direction its neck is relative to itself. Returns undefined on turn 0
export function getSnakeDirection(snake: Battlesnake) : Direction | undefined {
  let neckDirection : Direction | undefined = getNeckDirection(snake)
  return getOppositeDirection(neckDirection)
}

// return any move that is neither outside of the gameState boundaries, nor the snake's neck
// a maximum of two directions can result in out of bounds, & one direction can result in neck. Thus there must always be one valid direction
export function getDefaultMove(gameState: GameState, snake: Battlesnake) : Direction {
  let neckDir = getNeckDirection(snake)
  if (snake.head.x !== 0 && neckDir !== Direction.Left) {
    return Direction.Left // left is neither out of bounds nor our neck
  } else if (snake.head.x !== (gameState.board.width - 1) && neckDir !== Direction.Right) {
    return Direction.Right // right is neither out of bounds nor our neck
  } else if (snake.head.y !== 0 && neckDir !== Direction.Down) {
    return Direction.Down // down is neither out of bounds nor our neck
  } else {
    return Direction.Up
  }
}

// moveSnake will move the input snake in the move direction, & if it can't, will move it in the next direction in line, until it succeeds
export function moveSnake(gameState: GameState, snake: Battlesnake, board2d: Board2d, _move: Direction | undefined) : void {
  let move : Direction = _move === undefined ? getDefaultMove(gameState, snake) : _move // if a move was not provided, get a default one
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
}

// for moving a snake without actually moving it. Reduces its tail without reducing its length, duplicating its head instead
export function fakeMoveSnake(snake: Battlesnake) {
  snake.body = snake.body.slice(0, -1)
  snake.body.push(snake.body[snake.body.length - 1])
}

// After snakes have moved, may need to do some gamestate updating - removing eaten food & dead snakes, increment turn
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
  gameState.turn = gameState.turn + 1
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
        if (newCell.snakeCell.isTail && !snakeHasEaten(newCell.snakeCell.snake) && !coordsEqual(newCoord, newCell.snakeCell.snake.body[1])) { // if a snake hasn't eaten on this turn, its tail will recede next turn, making it a safe place to move. Third check is to ensure the tail is not also the neck - this only applies for turns 0 & 1, when the snake has not yet expanded out to its full starting length of 3
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
    case Direction.Left:
      moves.left = false
      break
    case Direction.Right:
      moves.right = false
      break
    case Direction.Up:
      moves.up = false
      break
    case Direction.Down:
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
export function checkTime(timeBeginning: number, gameState: GameState, logTime?: boolean) : boolean {
  let timeCurrent : number = Date.now()
  let timeElapsed : number = timeCurrent - timeBeginning
  //let myLatency : number = gameState.you.latency ? parseInt(gameState.you.latency, 10) : 200, // assume a high latency when no value exists, either on first run or after timeout
  let myLatency = isDevelopment? 150 : 30
  // comfort margin represents the time we want to leave ourselves to finish up calculations & return a value.
  let comfortMargin: number = 40 // gameState.game.timeout / 10, or myLatency - not sure what's best
  let timeLeft = gameState.game.timeout - timeElapsed - myLatency
  let timeGood = timeLeft > comfortMargin
  if (!timeGood && logTime) {
    logToFile(consoleWriteStream, `turn: ${gameState.turn}; Elapsed Time: ${timeElapsed}; Latency: ${myLatency}; Time Left: ${timeLeft}. Ran out of time.`)
  }
  return timeGood
}

export function findMoveNeighbors(gameState: GameState, me: Battlesnake, board2d: Board2d, moves: Moves) : MoveNeighbors {
  let myHead = me.head
  let isDuel = gameState.board.snakes.length === 2 // only treat as a duel if 2 snakes are left. Assumes other snakes will also allow ties now that it's a duel
  
  let upNeighbors: BoardCell[] | undefined = undefined
  let downNeighbors: BoardCell[] | undefined = undefined
  let leftNeighbors: BoardCell[] | undefined = undefined
  let rightNeighbors: BoardCell[] | undefined = undefined

  if (moves.up) {
    let newCoord : Coord = new Coord(myHead.x, myHead.y + 1)
    upNeighbors = getSurroundingCells(newCoord, board2d, Direction.Down)    
  }

  if (moves.down) {
    let newCoord : Coord = new Coord(myHead.x, myHead.y - 1)
    downNeighbors = getSurroundingCells(newCoord, board2d, Direction.Up)
  }

  if (moves.left) {
    let newCoord : Coord = new Coord(myHead.x - 1, myHead.y)
    leftNeighbors = getSurroundingCells(newCoord, board2d, Direction.Right)
  }

  if (moves.right) {
    let newCoord : Coord = new Coord(myHead.x + 1, myHead.y)
    rightNeighbors = getSurroundingCells(newCoord, board2d, Direction.Left)
  }
  let kissMoves : MoveNeighbors = new MoveNeighbors(me, isDuel, upNeighbors, downNeighbors, leftNeighbors, rightNeighbors) // pass in argument for whether it's a duel or not

  return kissMoves
}

export function findKissMurderMoves(me: Battlesnake, board2d: Board2d, kissMoves: MoveNeighbors) : Direction[] {
  let murderMoves : Direction[] = []
  if (kissMoves.huntingAtUp) {
    murderMoves.push(Direction.Up)
  }
  if (kissMoves.huntingAtDown) {
    murderMoves.push(Direction.Down)
  }
  if (kissMoves.huntingAtLeft) {
    murderMoves.push(Direction.Left)
  }
  if (kissMoves.huntingAtRight) {
    murderMoves.push(Direction.Right)
  }
  return murderMoves
}

export function findKissDeathMoves(me: Battlesnake, board2d: Board2d, kissMoves: MoveNeighbors) : Direction[] {
  let deathMoves : Direction[] = []
  if (kissMoves.huntedAtUp) {
    deathMoves.push(Direction.Up)
  }
  if (kissMoves.huntedAtDown) {
    deathMoves.push(Direction.Down)
  }
  if (kissMoves.huntedAtLeft) {
    deathMoves.push(Direction.Left)
  }
  if (kissMoves.huntedAtRight) {
    deathMoves.push(Direction.Right)
  }
  return deathMoves
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
    if (moves.hasOtherMoves(Direction.Right)) {
      moves.right = false
    }
  } else if (snakeHead.x < newCoord.x) { // snake is left of newCoord, no left
  // don't disallow the only remaining valid route
    if (moves.hasOtherMoves(Direction.Left)) {
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
    if (moves.hasOtherMoves(Direction.Up)) {
      moves.up = false
    }
  } else if (snakeHead.y < newCoord.y) { // snake is below newCoord, no down
  // don't disallow the only remaining valid route
    if (moves.hasOtherMoves(Direction.Down)) {
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

// primarily useful for tests to quickly populate a hazard array. Duplicates hazard coordinates where rows & columns coincide, which breaks HazardWalls constructor
export function createHazardColumn(board: Board, width: number) {
  for (let i: number = 0; i < board.height; i++) {
    board.hazards.push({x: width, y: i})
  }
}

// primarily useful for tests to quickly populate a hazard array. Duplicates hazard coordinates where rows & columns coincide, which breaks HazardWalls constructor
export function createHazardRow(board: Board, height: number) {
  for (let i: number = 0; i < board.width; i++) {
    board.hazards.push({x: i, y: height})
  }
}

// gets self and surrounding cells & checks them for hazards, returning true if it finds any.
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
  let neighbors = getSurroundingCells(coord, board2d)
  let hazardCell = neighbors.find(function checkForHazard(neighbor) {
    return neighbor.hazard
  })
  return hazardCell !== undefined
}

// gets self and surrounding cells & checks them for hazards, returning true if it finds any. Returns false for spaces that are themselves hazard
export function isAdjacentToHazard(coord: Coord, board2d: Board2d, gameState : GameState) : boolean {  
  if (gameState.game.ruleset.settings.hazardDamagePerTurn === 0) { // if hazard is not enabled, return false
    return false
  }
  let selfCell = board2d.getCell(coord)
  if (!(selfCell instanceof BoardCell)) {
    return false // return false for cells outside of board2d's bounds
  } else if (selfCell.hazard) { // return false for cells which are themselves hazard
    return false
  }
  if (coord.x === 0 || coord.y === 0 || (coord.x === board2d.width - 1) || (coord.y === board2d.height - 1)) {
    return true // edges are always adjacent to hazard, unless coord is outside of bounds
  }
  let neighbors = getSurroundingCells(coord, board2d)
  let hazardCell = neighbors.find(function checkForHazard(neighbor) {
    return neighbor.hazard
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

  let availableMoves : Direction[] = moves.validMoves()
  if (availableMoves.length < 1) { // given no good options, always choose another snake tile. It may die, which would make it a valid space again.
    moves.up = true
    moves.down = true
    moves.left = true
    moves.right = true
    checkForHealth(myself, gameState, board2d, moves) // reset available moves to only exclude moves which kill me by wall or health. Snakecells are valid again
    if (moves.validMoves().length > 1) { // if there are more than one available snakecells to pick from, disable our own neck
      checkForNeck(myself, gameState, moves) // also disable neck as a valid place to move
    }
  }
  return moves
}

// given a set of deathMoves that lead us into possibly being eaten,
// killMoves that lead us into possibly eating another snake,
// and moves, which is our actual move decision array
export function kissDecider(gameState: GameState, myself: Battlesnake, moveNeighbors: MoveNeighbors, deathMoves : Direction[], killMoves : Direction[], moves: Moves, board2d: Board2d) : KissStates {
  let validMoves = moves.validMoves()
  let states = new KissStates()
  function setKissOfDeathDirectionState(dir : Direction, state: KissOfDeathState) : void {
    switch (dir) {
      case Direction.Up:
        states.kissOfDeathState.up = state
        break
      case Direction.Down:
        states.kissOfDeathState.down = state
        break
      case Direction.Left:
        states.kissOfDeathState.left = state
        break
      default: // case Direction.Right:
        states.kissOfDeathState.right = state
        break
    }
  }

  function setKissOfMurderDirectionState(dir : Direction, state: KissOfMurderState) : void {
    switch (dir) {
      case Direction.Up:
        states.kissOfMurderState.up = state
        break
      case Direction.Down:
        states.kissOfMurderState.down = state
        break
      case Direction.Left:
        states.kissOfMurderState.left = state
        break
      default: // case Direction.Right:
        states.kissOfMurderState.right = state
        break
    }
  }
  
  let huntingChanceDirections : Moves = moveNeighbors.huntingChanceDirections()
  let huntedDirections = huntingChanceDirections.invalidMoves()
  // first look through dangerous moves
  switch(deathMoves.length) {
    case 1: // if one move results in a kissOfDeath, penalize that move in evaluate
    validMoves.forEach(function setMoveState(move: Direction) {
        if (move === deathMoves[0]) {
          let predator: Battlesnake | undefined = moveNeighbors.getPredator(move) // get the snake that is stalking me for this direction
          if (huntedDirections.includes(move)) {
            if (predator !== undefined && predator.length === myself.length) { // if my predator is my same length
              setKissOfDeathDirectionState(move, KissOfDeathState.kissOfDeathCertaintyMutual)
            } else {
              setKissOfDeathDirectionState(move, KissOfDeathState.kissOfDeathCertainty)
            }
          } else {
            if (predator !== undefined && predator.length === myself.length) { // if my predator is my same length
              setKissOfDeathDirectionState(move, KissOfDeathState.kissOfDeathMaybeMutual)
            } else {
              setKissOfDeathDirectionState(move, KissOfDeathState.kissOfDeathMaybe)
            }
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
      validMoves.forEach(function setMoveState(move: Direction) {
        let predator: Battlesnake | undefined = moveNeighbors.getPredator(move) // get the snake that is stalking me for this direction
        if (move === deathMoves[0] || move === deathMoves[1]) {
          if (huntedDirections.includes(move)) { // this direction spells certain death
            if (predator !== undefined && predator.length === myself.length) { // if my predator is my same length
              setKissOfDeathDirectionState(move, KissOfDeathState.kissOfDeathCertaintyMutual)
            } else {
              setKissOfDeathDirectionState(move, KissOfDeathState.kissOfDeathCertainty)
            }
          } else { // this direction spells possible death
            if (predator !== undefined && predator.length === myself.length) { // if my predator is my same length
              setKissOfDeathDirectionState(move, KissOfDeathState.kissOfDeathMaybeMutual)
            } else {
              setKissOfDeathDirectionState(move, KissOfDeathState.kissOfDeathMaybe)
            }         
          }
        } else { // this direction does not have any kiss of death cells
          setKissOfDeathDirectionState(move, KissOfDeathState.kissOfDeath3To1Avoidance)
        }
      })
      break
    case 3: // if all three moves may cause my demise, penalize those moves in evaluate
      validMoves.forEach(function setMoveState(move: Direction) {
        let predator: Battlesnake | undefined = moveNeighbors.getPredator(move) // get the snake that is stalking me for this direction
        if (huntedDirections.includes(move)) { // this direction spells certain death
          if (predator !== undefined && predator.length === myself.length) { // if my predator is my same length
            setKissOfDeathDirectionState(move, KissOfDeathState.kissOfDeathCertaintyMutual)
          } else {
            setKissOfDeathDirectionState(move, KissOfDeathState.kissOfDeathCertainty)
          }        
        } else { // this direction spells possible death
          if (predator !== undefined && predator.length === myself.length) { // if my predator is my same length
            setKissOfDeathDirectionState(move, KissOfDeathState.kissOfDeathMaybeMutual)
          } else {
            setKissOfDeathDirectionState(move, KissOfDeathState.kissOfDeathMaybe)
          }        
        }
      })
      break
    default: // case 0
      break // all states are by default kissOfDeathNo
  }

  killMoves.forEach(function determineKillMoveState(move) {
    let preyMoves : Moves = new Moves(true, true, true, true) // do a basic check of prey's surroundings & evaluate how likely this kill is from that
    switch(move) {
      case Direction.Up:
        if (typeof moveNeighbors.upPrey !== "undefined") {
          checkForSnakesHealthAndWalls(moveNeighbors.upPrey, gameState, board2d, preyMoves)
          let preyValidMoves = preyMoves.validMoves().length
          switch(preyValidMoves) {
            case 1: // prey has only one valid place to go, & we can kill it there
              setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderCertainty)
              break
            case 2: // prey has two valid places to go, we may be able to kill it at either (Maybe), we may not (2to1Avoidance)
              if (moveNeighbors.isMurderChanceSnake(moveNeighbors.upPrey)) { // we can kill it at both places
                setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderMaybe)
              } else { // we can kill it at one direction, but it will likely escape in the other direction
                setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderAvoidance)
              }
              break
            case 3: // prey has three valid places to go, it is likely to avoid us this turn
              setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderAvoidance)
              break
          }
        }
        break
      case Direction.Down:
        if (typeof moveNeighbors.downPrey !== "undefined") {
          checkForSnakesHealthAndWalls(moveNeighbors.downPrey, gameState, board2d, preyMoves)
          let preyValidMoves = preyMoves.validMoves().length
          switch(preyValidMoves) {
            case 1: // prey has only one valid place to go, & we can kill it there
              setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderCertainty)
              break
            case 2: // prey has two valid places to go, we may be able to kill it at either (Maybe), we may not (2to1Avoidance)
              if (moveNeighbors.isMurderChanceSnake(moveNeighbors.downPrey)) { // we can kill it at both places
                setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderMaybe)
              } else { // we can kill it at one direction, but it will likely escape in the other direction
                setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderAvoidance)
              }
              break
            case 3: // prey has three valid places to go, it is likely to avoid us this turn
              setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderAvoidance)
              break
          }
        }
        break
      case Direction.Left:
        if (typeof moveNeighbors.leftPrey !== "undefined") {
          checkForSnakesHealthAndWalls(moveNeighbors.leftPrey, gameState, board2d, preyMoves)
          let preyValidMoves = preyMoves.validMoves().length
          switch(preyValidMoves) {
            case 1: // prey has only one valid place to go, & we can kill it there
              setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderCertainty)
              break
            case 2: // prey has two valid places to go, we may be able to kill it at either (Maybe), we may not (2to1Avoidance)
              if (moveNeighbors.isMurderChanceSnake(moveNeighbors.leftPrey)) { // we can kill it at both places
                setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderMaybe)
              } else { // we can kill it at one direction, but it will likely escape in the other direction
                setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderAvoidance)
              }
              break
            case 3: // prey has three valid places to go, it is likely to avoid us this turn
              setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderAvoidance)
              break
          }
        }
        break
      default: //case Direction.Right:
        if (typeof moveNeighbors.rightPrey !== "undefined") {
          checkForSnakesHealthAndWalls(moveNeighbors.rightPrey, gameState, board2d, preyMoves)
          let preyValidMoves = preyMoves.validMoves().length
          switch(preyValidMoves) {
            case 1: // prey has only one valid place to go, & we can kill it there
              setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderCertainty)
              break
            case 2: // prey has two valid places to go, we may be able to kill it at either (Maybe), we may not (2to1Avoidance)
              if (moveNeighbors.isMurderChanceSnake(moveNeighbors.rightPrey)) { // we can kill it at both places
                setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderMaybe)
              } else { // we can kill it at one direction, but it will likely escape in the other direction
                setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderAvoidance)
              }
              break
            case 3: // prey has three valid places to go, it is likely to avoid us this turn
              setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderAvoidance)
              break
          }
        }
        break
    }
  })
  return states
}

// given a set of neighboring cells & their kiss states, return the appropriate kiss states per the direction given
export function determineKissStateForDirection(direction: Direction, kissStates: KissStates): {kissOfDeathState: KissOfDeathState, kissOfMurderState: KissOfMurderState} {
  let kissOfDeathState : KissOfDeathState
  let kissOfMurderState : KissOfMurderState
  switch (direction) {
    case Direction.Up:
      kissOfDeathState = kissStates.kissOfDeathState.up
      kissOfMurderState = kissStates.kissOfMurderState.up
      break
    case Direction.Down:
      kissOfDeathState = kissStates.kissOfDeathState.down
      kissOfMurderState = kissStates.kissOfMurderState.down
      break
    case Direction.Left:
      kissOfDeathState = kissStates.kissOfDeathState.left
      kissOfMurderState = kissStates.kissOfMurderState.left
      break
    default: // case Direction.Right:
      kissOfDeathState = kissStates.kissOfDeathState.right
      kissOfMurderState = kissStates.kissOfMurderState.right
      break
  }
  return {kissOfDeathState: kissOfDeathState, kissOfMurderState: kissOfMurderState}
}

function lookaheadDeterminatorNonCpuBound(gameState: GameState): number {
  let timeout = gameState.game.timeout
  let defaultLatency = gameState.you.name === "Test Snake Please Ignore" ? 150 : 30 // default latency of 30 for prod snakes, 150 for local snake
  let latency = gameState.you.latency === "" ? defaultLatency : parseInt(gameState.you.latency, 10)
  latency = latency === NaN ? defaultLatency : latency // in case latency is non-numeric for some reason
  let numSnakes = gameState.board.snakes.length
  let comfortMargin: number = 50 // time in ms I'm comfortable skirting close to the edge of timeout
  let timeLeft: number = timeout - latency - comfortMargin

  function _lookaheadDeterminator(penalty: number) {
    let lookahead: number = 0 // base lookahead of 1, assume we can do at least this

    // for jaguar, with a latency of 30 & penalty of 20, this would give us a lookahead of 8, with a 90ms penalty for the 8th lookahead
    // for test snake, with a latency of 150 & penalty of 20, this would give us a lookahead of 7, with a 80ms penalty for the 7th lookahead
    for (let j: number = timeLeft; j >= 0; j = j - penalty - (lookahead * 10)) { // 1st lookahead free. 40ms for second, 50ms for third, etc.
      lookahead = lookahead + 1
    }
    return lookahead
  }

  if (numSnakes < 1) {
    return 0 // with one or no snakes there's no meaningful calqs for us to do anyway, return lookahead of 0
  }
  if (numSnakes > 2) {
    return _lookaheadDeterminator(20) // give a 20ms base penalty for each loop plus cost associated with lookahead depth
  } else { // numSnakes === 2
    return _lookaheadDeterminator(10) // give a 10ms base penalty for each loop plus cost associated with lookahead depth
  }
}

// dumber lookahead determinator to account for weaker CPU of Linode server
export function lookaheadDeterminator(gameState: GameState): number {
  let lookahead: number
  if (gameState.turn === 0) {
    lookahead = 1 // for turn 0, give lookahead of 1. This is the only turn all snakes have four options, so calqing this takes longer than normal.
  } else if (gameState.turn < 3) {
    lookahead = 3 // for turns 1 & 2 continue using a smaller lookahead to avoid a timeout 
  // } else if (isLocalSnake(gameState.you)) {
  //   return lookaheadDeterminatorNonCpuBound(gameState)
  } else if (gameState.turn < 7 && gameState.game.timeout >= 500) {
    lookahead = 4
  } else {
    if(gameState.game.timeout < 500) { // this is all we can afford in speed snake
      if (gameState.board.snakes.length > 2) {
        lookahead = 3
      } else {
        lookahead = 3
      }
    } else {
      switch (gameState.board.snakes.length) {
        case 0:
          lookahead = 0
          break
        case 1:
          lookahead = 7
          break
        case 2:
          lookahead = 6
          break
        case 3:
          lookahead = 6
          break
        default: // 4 or more
          lookahead = 5
          break
      }
    }
  }

  if (Object.keys(gameData).length > 1) { // if at least one game is already running, run the game with one less lookahead to avoid excess CPU usage
    lookahead = lookahead > 0? lookahead - 1 : lookahead
    logToFile(consoleWriteStream, `more than one game was running, decrementing lookahead to ${lookahead}`)
  }
  return lookahead
}

// returns true if 'myself' is in position to cut off 'snake' at an edge
export function isCutoff(gameState: GameState, myself: Battlesnake, snake: Battlesnake, board2d: Board2d): boolean {  
  let snakeMoves = new Moves(true, true, true, true)
  checkForSnakesHealthAndWalls(snake, gameState, board2d, snakeMoves)
  let snakeDirection = getSnakeDirection(snake)

  function cutoffLeftEdge(): boolean {
    if (snake.head.x === 0) { // if they are on the left edge
      if (myself.head.x === 1 || myself.head.x === 0) { // if I am next to them on the left edge
        if (myself.head.y >= snake.head.y && snakeDirection === Direction.Up) { // if I am above snake, & it is moving up
          let cutoffCell = board2d.getCell({x: 1, y: snake.head.y}) // cell one to the right of snake's head - TODO: Make this snake's NECK after moving otherSnakes prior to evaluate
          if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.isTail && !cutoffCell.snakeCell.hasEaten) { // if this cell is a tail & the snake hasn't eaten, it will shrink & won't serve to cut off. Check the cell behind it
            cutoffCell = board2d.getCell({x: 1, y: snake.head.y - 1}) // cell one to the right of snake's head & one below
          }
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
              return true
            } else if (myself.head.x === 1 && !myselfIsLonger) { // only consider cutting off on top edge if I am not longer
              return true
            }
          }
        } else if (myself.head.y <= snake.head.y && snakeDirection === Direction.Down) { // if I am below snake, & it is moving down
          let cutoffCell = board2d.getCell({x: 1, y: snake.head.y}) // cell one to the right of snake's head
          if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.isTail && !cutoffCell.snakeCell.hasEaten) { // if this cell is a tail & the snake hasn't eaten, it will shrink & won't serve to cut off. Check the cell behind it
            cutoffCell = board2d.getCell({x: 1, y: snake.head.y + 1}) // cell one to the right of snake's head & one above
          }
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
              return true
            } else if (myself.head.x === 1 && !myselfIsLonger) { // only consider cutting off on bottom edge if I am not longer
              return true
            }
          }
        }
      }
    }
    return false
  }

  function cutoffRightEdge(): boolean {
    if (snake.head.x === (gameState.board.width - 1)) { // if they are on the right edge
      if (myself.head.x === (gameState.board.width - 2) || myself.head.x === (gameState.board.width - 1)) { // if I am next to them on the right edge
        if (myself.head.y >= snake.head.y && snakeDirection === Direction.Up) { // if I am above snake, & it is moving up
          let cutoffCell = board2d.getCell({x: (gameState.board.width - 2), y: snake.head.y}) // cell one to the left of snake's head
          if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.isTail && !cutoffCell.snakeCell.hasEaten) { // if this cell is a tail & the snake hasn't eaten, it will shrink & won't serve to cut off. Check the cell behind it
            cutoffCell = board2d.getCell({x: (gameState.board.width - 2), y: snake.head.y - 1}) // cell one to the left of snake's head & one below
          }
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
              return true
            } else if (myself.head.x === (gameState.board.width - 2) && !myselfIsLonger) { // only consider cutting off on top edge if I am not longer
              return true
            }
          }
        } else if (myself.head.y <= snake.head.y && snakeDirection === Direction.Down) { // if I am below snake, & it is moving down
          let cutoffCell = board2d.getCell({x: (gameState.board.width - 2), y: snake.head.y}) // cell one to the left of snake's head
          if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.isTail && !cutoffCell.snakeCell.hasEaten) { // if this cell is a tail & the snake hasn't eaten, it will shrink & won't serve to cut off. Check the cell behind it
            cutoffCell = board2d.getCell({x: (gameState.board.width - 2), y: snake.head.y + 1}) // cell one to the left of snake's head & one above
          }
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
              return true
            } else if (myself.head.x === (gameState.board.width - 2) && !myselfIsLonger) { // only consider cutting off on bottom edge if I am not longer
              return true
            }
          }
        }
      }
    }
    return false
  }

  function cutoffBottomEdge(): boolean {
    if (snake.head.y === 0) { // if they are on the bottom edge
      if (myself.head.y === 1 || myself.head.y === 0) { // if I am next to them on the bottom edge
        if (myself.head.x >= snake.head.x && snakeDirection === Direction.Right) { // if I am right of snake, & it is moving right
          let cutoffCell = board2d.getCell({x: snake.head.x, y: 1}) // cell one above snake's head
          if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.isTail && !cutoffCell.snakeCell.hasEaten) { // if this cell is a tail & the snake hasn't eaten, it will shrink & won't serve to cut off. Check the cell behind it
            cutoffCell = board2d.getCell({x: snake.head.x - 1, y: 1}) // cell one above snake's head & one left
          }
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
              return true
            } else if (myself.head.y === 1 && !myselfIsLonger) { // only consider cutting off on right edge if I am not longer
              return true
            }
          }
        } else if (myself.head.x <= snake.head.x && snakeDirection === Direction.Left) { // if I am left of snake, & it is moving left
          let cutoffCell = board2d.getCell({x: snake.head.x, y: 1}) // cell one above snake's head
          if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.isTail && !cutoffCell.snakeCell.hasEaten) { // if this cell is a tail & the snake hasn't eaten, it will shrink & won't serve to cut off. Check the cell behind it
            cutoffCell = board2d.getCell({x: snake.head.x + 1, y: 1}) // cell one above snake's head & one right
          }
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
              return true
            } else if (myself.head.y === 1 && !myselfIsLonger) { // only consider cutting off on left edge if I am not longer
              return true
            }
          }
        }
      }
    }
    return false
  }

  function cutoffTopEdge(): boolean {
    if (snake.head.y === (gameState.board.height - 1)) { // if they are on the top edge
      if (myself.head.y === (gameState.board.height - 2) || myself.head.y === (gameState.board.height - 1)) { // if I am next to them on the bottom edge
        if (myself.head.x >= snake.head.x && snakeDirection === Direction.Right) { // if I am right of snake, & it is moving right
          let cutoffCell = board2d.getCell({x: snake.head.x, y: (gameState.board.height - 2)}) // cell one below snake's head
          if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.isTail && !cutoffCell.snakeCell.hasEaten) { // if this cell is a tail & the snake hasn't eaten, it will shrink & won't serve to cut off. Check the cell behind it
            cutoffCell = board2d.getCell({x: snake.head.x - 1, y: (gameState.board.height - 2)}) // cell one below snake's head & one left
          }
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
              return true
            } else if (myself.head.y === (gameState.board.height - 2) && !myselfIsLonger) { // only consider cutting off on right edge if I am not longer
              return true
            }
          }
        } else if (myself.head.x <= snake.head.x && snakeDirection === Direction.Left) { // if I am left of snake, & it is moving left
          let cutoffCell = board2d.getCell({x: snake.head.x, y: (gameState.board.height - 2)}) // cell one below snake's head
          if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.isTail && !cutoffCell.snakeCell.hasEaten) { // if this cell is a tail & the snake hasn't eaten, it will shrink & won't serve to cut off. Check the cell behind it
            cutoffCell = board2d.getCell({x: snake.head.x + 1, y: (gameState.board.height - 2)}) // cell one below snake's head & one right
          }
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
              return true
            } else if (myself.head.y === (gameState.board.height - 2) && !myselfIsLonger) { // only consider cutting off on left edge if I am not longer
              return true
            }
          }
        }
      }
    }
    return false
  }

  if (cutoffLeftEdge() || cutoffRightEdge() || cutoffBottomEdge() || cutoffTopEdge()) {
    return true
  } else {
    return false
  }
}

// calculates the center of the board when considering hazard. For a game without hazard, this will just be the center of the board
export function calculateCenterWithHazard(gameState: GameState, hazardWalls: HazardWalls): {centerX: number, centerY: number} {
  let leftEdge: number = hazardWalls.left === undefined? 0 : hazardWalls.left
  let rightEdge: number = hazardWalls.right === undefined? gameState.board.width - 1 : hazardWalls.right
  let bottomEdge: number = hazardWalls.down === undefined? 0 : hazardWalls.down
  let topEdge: number = hazardWalls.up === undefined? gameState.board.height - 1: hazardWalls.up

  let centerX = (leftEdge + rightEdge) / 2
  let centerY = (bottomEdge + topEdge) / 2

  if (centerX === gameState.board.width - 1) {
    centerX = gameState.board.width / 2 // in the event that there is hazard across the width of the board, reset centerX to middle of board
  }
  if (centerY === gameState.board.height - 1) {
    centerY = gameState.board.height / 2 // in the event that there is hazard across the height of the board, reset centerY to middle of board
  }

  // centers should always round down to an integer value
  centerX = Math.floor(centerX)
  centerY = Math.floor(centerY)

  return {centerX: centerX, centerY: centerY}
}