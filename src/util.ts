import { createWriteStream, WriteStream, existsSync, renameSync } from 'fs';
import { Board, GameState, Game, Ruleset, RulesetSettings, RoyaleSettings, SquadSettings, ICoord } from "./types"
import { Coord, Direction, Battlesnake, BoardCell, Board2d, Moves, SnakeCell, MoveNeighbors, KissStates, KissOfDeathState, KissOfMurderState, MoveWithEval, HazardWalls, TimingStats, SnakeScore, FoodCountTier, HazardCountTier, VoronoiSnake, VoronoiResults } from "./classes"
import { evaluate } from "./eval"
import { gameData, isDevelopment, version } from "./logic"

export function logToFile(file: WriteStream, str: string) {
  if (isDevelopment) {
    console.log(str)
    file.write(`${str}
`)
  }
}

const voronoiHazardValueSmall: number = 0.4
const voronoiHazardValueLarge: number = 0.75

let consoleWriteStream = createLogAndCycle("consoleLogs_util")

export function getRandomInt(min: number, max: number) : number {
  min = Math.ceil(min);
  max = Math.floor(max);
  
  let res: number = Math.floor(Math.random() * (max - min) + min); //The maximum is exclusive and the minimum is inclusive
  logToFile(consoleWriteStream, `getRandomInt for min ${min}, max ${max} returned ${res}`)
  return res
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

function calculateManhattenDistance(c1: Coord, c2: Coord): number {
  return Math.abs(c1.x - c2.x) + Math.abs(c1.y - c2.y)
}

// returns minimum number of moves between input coordinates
export function getDistance(c1: Coord, c2: Coord, gameState: GameState) : number {

  // if wrapped, shortest distance needs to be calculated in consideration of wrapping across board
  if (gameStateIsWrapped(gameState)) {
    let shortestDist: number
    let dist: number
    // consider four cases: where c1 approaches c2 normally, where c1 approaches c2 by crossing the x-wall, where c1 approaches c2 by crossing the y-wall, & where c1 approaches c2 by crossing both walls
    shortestDist = calculateManhattenDistance(c1, c2) // c1 approaches c2 normally

    let fakeC1: Coord = new Coord(c1.x, c1.y)
    let fakeC2: Coord = new Coord(c2.x, c2.y)

    // crossing x-wall, need to check which one is lower & shift that one above the right edge of the board
    if (c1.x < c2.x) { // 
      fakeC1.x = gameState.board.width + c1.x
    } else if (c1.x > c2.x) { // don't shift if they're equal, obviously won't need to cross the line in that case
      fakeC2.x = gameState.board.width + c2.x
    }
    dist = calculateManhattenDistance(fakeC1, fakeC2)
    if (dist < shortestDist) {
      shortestDist = dist
    }     

    fakeC1.x = c1.x
    fakeC2.x = c2.x

    // crossing y-wall, need to check which one is lower & shift that one above the top of the board
    if (c1.y < c2.y) {
      fakeC1.y = gameState.board.height + c1.y
    } else if (c1.y > c2.y) { // don't shift if they're equal, obviously won't need to cross the line in that case
      fakeC2.y = gameState.board.height + c2.y
    }
    dist = calculateManhattenDistance(fakeC1, fakeC2)
    if (dist < shortestDist) {
      shortestDist = dist
    }

    // re-crossing x-wall, need to check which one is lower & shift that one above the right edge of the board
    if (c1.x < c2.x) { // 
      fakeC1.x = gameState.board.width + c1.x
    } else if (c1.x > c2.x) { // don't shift if they're equal, obviously won't need to cross the line in that case
      fakeC2.x = gameState.board.width + c2.x
    }
    dist = calculateManhattenDistance(fakeC1, fakeC2)
    if (dist < shortestDist) {
      shortestDist = dist
    }

    return shortestDist
  } else {
    return calculateManhattenDistance(c1, c2)
  }
}

// gameMode functions
export function gameStateIsWrapped(gameState: GameState): boolean {
  return gameState.game.ruleset.name === "wrapped"
}

// no unique ruleset name yet, for now any game which is both wrapped & has hazard damage is Hazard Spiral
export function gameStateIsHazardSpiral(gameState: GameState): boolean {
  return gameStateIsWrapped(gameState) && (gameState.game.ruleset.settings.hazardDamagePerTurn > 0)
}

export function gameStateIsSolo(gameState: GameState): boolean {
  return gameState.game.ruleset.name === "solo"
}

export function gameStateIsConstrictor(gameState: GameState): boolean {
  return gameState.game.ruleset.name === "constrictor"
}

// returns coordinate after move has been applied to it. If move is undefined or AlreadyMoved, returns the same coordinate.
export function getCoordAfterMove(gameState: GameState, coord: Coord, move: Direction | undefined) : Coord {
  let newPosition : Coord = new Coord(coord.x, coord.y)
  let isWrapped: boolean = gameStateIsWrapped(gameState)
  switch (move) {
    case Direction.Up:
      if (isWrapped && newPosition.y === (gameState.board.height - 1)) { // in a wrapped game, going up from the top of the board leaves you at the bottom
        newPosition.y = 0
      } else {
        newPosition.y = newPosition.y + 1
      }
      break;
    case Direction.Down:
      if (isWrapped && newPosition.y === 0) { // in a wrapped game, going down from the bottom of the board leaves you at the top
        newPosition.y = gameState.board.height - 1
      } else {
        newPosition.y = newPosition.y - 1
      }
      break;
    case Direction.Left:
      if (isWrapped && newPosition.x === 0) { // in a wrapped game, going left from the left of the board leaves you on the right
        newPosition.x = gameState.board.width - 1
      } else {
        newPosition.x = newPosition.x - 1
      }
      break
    case Direction.Right:
      if (isWrapped && newPosition.x === (gameState.board.width - 1)) { // in a wrapped game, going right from the right of the board leaves you on the left
        newPosition.x = 0
      } else {
        newPosition.x = newPosition.x + 1
      }
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

// returns difference between my length & the length of the largest other snake on the board - can be positive (I am bigger) or negative (I am smaller). Returns self length if alone
export function snakeLengthDelta(me: Battlesnake, gameState: GameState) : number {
  let longestOtherSnake = getLongestOtherSnake(me, gameState)
  if (longestOtherSnake !== undefined) {
    return me.length - longestOtherSnake.length
  } else {
    return me.length // if no other snakes exist, simply return my own length
  }
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

// finds the longest snake on the board and, in the event of a tie, returns the one closest to me. Returns undefined if only snake on board
export function getLongestOtherSnake(me: Battlesnake, gameState: GameState) : Battlesnake | undefined {
  let longestSnakeIndex : number = 0
  let len : number = 0
  let distToMe : number = 0

  if (gameState.board.snakes.length === 0) {
    return undefined
  } else if (gameState.board.snakes.length === 1) {
    return undefined
  }
  gameState.board.snakes.forEach(function findLongestSnake(snake, idx) {
    if (snake.id !== me.id) { // don't check myself
      if (snake.length > len) {
        len = snake.length
        longestSnakeIndex = idx
        distToMe = getDistance(me.head, snake.head, gameState)
      } else if (snake.length === len) {
        let newDistToMe = getDistance(me.head, snake.head, gameState)
        if (newDistToMe < distToMe) { // if it's a tie & this one is closer
          longestSnakeIndex = idx
          distToMe = newDistToMe
        }
      }
    }
  })
  return gameState.board.snakes[longestSnakeIndex]
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
  let cloneYou: Battlesnake
  if (cloneYouProbably === undefined) { // if youSnake is no longer in the game, use the old gameState.you
    let newBody: Coord[] = []
    gameState.you.body.forEach(function addPart(coord: Coord) {
      newBody.push(new Coord(coord.x, coord.y))
    })
    cloneYou = new Battlesnake(gameState.you.id, gameState.you.name, gameState.you.health, newBody, gameState.you.latency, gameState.you.shout, gameState.you.squad)
  } else {
    cloneYou = cloneYouProbably
  }

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
export function getNeckDirection(gameState: GameState, snake: Battlesnake) : Direction | undefined {
  let neckCell : Coord = snake.body[1]
  let isWrapped: boolean = gameStateIsWrapped(gameState)
  if (coordsEqual(snake.head, neckCell)) {
    neckCell = snake.body[2] // this triggers on turn 1, when snake neck is at body cell 2 & snake head is at body cells 0 & 1
  }
  if (coordsEqual(snake.head, neckCell)) {
    return undefined // should only ever be true on turn 0, when snake body 0, 1, 2 are all the same coord
  }
  // special case in wrapped - need to treat a neck around the wrap as the opposite direction
  if (isWrapped) {
    if (snake.head.x === 0 && neckCell.x === (gameState.board.width - 1)) { // snake went Right, from right side of board - neck direction is Left, snake direction is Right
      return Direction.Left
    } else if (snake.head.x === (gameState.board.width - 1) && neckCell.x === 0) { // snake went Left, from left side of board - neck direction is Right, snake direction is Left 
      return Direction.Right
    } else if (snake.head.y === 0 && neckCell.y === (gameState.board.height - 1)) { // snake went Up, from top of board - neck direction is Down, snake direction is Up
      return Direction.Down
    } else if (snake.head.y === (gameState.board.height - 1) && neckCell.y === 0) { // snake went Down, from bottom of board - neck direction is Up, snake direction is Down
      return Direction.Up
    }
  }

  if (snake.head.x > neckCell.x) {
    return Direction.Left // neck is left of body
  } else if (snake.head.x < neckCell.x) {
    return Direction.Right // neck is right of body
  } else if (snake.head.y > neckCell.y) {
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
export function getSnakeDirection(gameState: GameState, snake: Battlesnake) : Direction | undefined {
  let neckDirection : Direction | undefined = getNeckDirection(gameState, snake)
  return getOppositeDirection(neckDirection)
}

// return any move that is neither outside of the gameState boundaries, nor the snake's neck
// a maximum of two directions can result in out of bounds, & one direction can result in neck. Thus there must always be one valid direction
function getDefaultMoveNaive(gameState: GameState, snake: Battlesnake) : Direction {
  let neckDir = getNeckDirection(gameState, snake)
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

// looks at gamestate & myself & returns a single move that is valid - won't result in starvation, moving out of bounds, or (if possible) snake cells
// disallows moving onto my own neck unless that is the only move that won't result in starvation
export function getDefaultMove(gameState: GameState, myself: Battlesnake, board2d: Board2d) : Direction {
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
    } else if (moves.validMoves().length < 1) { // should only happen if all moves result in starvation, in which case, choose any move that stays on the board
      moves.up = true
      moves.down = true
      moves.left = true
      moves.right = true
      checkForWalls(myself, board2d, moves)
    }
  }
  availableMoves = moves.validMoves()
  if (availableMoves.length < 1) { // if we somehow still don't have a valid move, just use the old naive getDefaultMove to give us something neither our neck, nor out of bounds
    return getDefaultMoveNaive(gameState, myself)
  } else {
    return availableMoves[getRandomInt(0, availableMoves.length)] // return some random valid move
  }
}

// moveSnake will move the input snake in the move direction, & if it can't, will move it in the next direction in line, until it succeeds
export function moveSnake(gameState: GameState, snake: Battlesnake, board2d: Board2d, _move: Direction | undefined) : void {
  if (_move === Direction.AlreadyMoved) {
    return // snake has already moved, don't move it
  }
  let isConstrictor: boolean = gameStateIsConstrictor(gameState)
  let move : Direction = _move === undefined ? getDefaultMove(gameState, snake, board2d) : _move // if a move was not provided, get a default one
  let newCoord = getCoordAfterMove(gameState, snake.head, move)
  let newCell = board2d.getCell(newCoord)
  if (newCell instanceof BoardCell) { // if it's a valid cell to move to
    // even if snake has eaten this turn, its tail cell will be duplicated, so we will still want to slice off the last element
    snake.body = snake.body.slice(0, -1) // remove last element of body
      
    snake.body.unshift(newCoord) // add new coordinate to front of body
    snake.head = snake.body[0]

    if (newCell.food || isConstrictor) { // in constrictor, there is no food, but every move is treated as though we ate, with length growing, tail duplicating, & health maximizing
      snake.health = 100
      snake.body.push(snake.body[snake.body.length - 1]) // snake should duplicate its tail cell if it has just eaten
    } else if (newCell.hazard) {
      snake.health = snake.health - 1 - gameState.game.ruleset.settings.hazardDamagePerTurn
    } else {
      snake.health = snake.health - 1
    }

    snake.length = snake.body.length // this is how Battlesnake does it too, length is just a reference to the snake body array length
  } else { // moveSnake should never move anywhere that isn't on the board, try again a different direction
    let newDir = getDefaultMove(gameState, snake, board2d)
    logToFile(consoleWriteStream, `failed to move snake ${snake.name} at (${snake.head.x},${snake.head.y}) towards ${move}, trying towards ${newDir} instead`)
    moveSnake(gameState, snake, board2d, newDir) // at least one of the directions will always be on the game board & not be our neck, so this should never infinitely recurse
  }
}

// for moving a snake without actually moving it. Reduces its tail without reducing its length, duplicating its tail instead
export function fakeMoveSnake(gameState: GameState, snake: Battlesnake) {
  if (!gameStateIsConstrictor(gameState) && !snakeHasEaten(snake)) { // if it hasn't eaten & it isn't constrictor, reduce its length by one by removing the tail
    snake.body = snake.body.slice(0, -1)
  }
  snake.body.push(snake.body[snake.body.length - 1]) // duplicate the tail
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
  if (board.isWrapped) {
    return // no such thing as walls in wrapped, don't bother disabling any moves
  }
  
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
  let neckDir = getNeckDirection(gameState, me)
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

export function findKissMurderMoves(kissMoves: MoveNeighbors) : Direction[] {
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

export function findKissDeathMoves(kissMoves: MoveNeighbors) : Direction[] {
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

export function calculateFoodSearchDepth(gameState: GameState, me: Battlesnake, board2d: Board2d) : number {
  const isSolo: boolean = gameStateIsSolo(gameState)
  if (isSolo) { // solo game, deprioritize food unless I'm dying
    if (me.health < 10) {
      return board2d.height + board2d.width
    } else {
      return 0
    }
  } else if (gameState.turn === 0) { // on turn 0, there is 1 food at depth 2, only look for that
    return 2
  } else if (gameState.turn === 1) { // on turn 1, we should be 1 away from our starting food, only look for that
    return 1
  } else {
    return board2d.height + board2d.width // unless otherwise specified, we're always hungry
  }
}

// looks for food within depth moves away from snakeHead
// returns an object whose keys are distances away, & whose values are food
// found at that distance
export function findFood(depth: number, food: Coord[], snakeHead : Coord, gameState: GameState) : { [key: number] : Coord[]} {
  let foundFood: { [key: number]: Coord[] } = {}
  // for (let i: number = 1; i < depth; i++) {
  //   foundFood[i] = []
  // }
  //let foundFood: Coord[] = []
  food.forEach(function addFood(foodUnit) {
    let dist = getDistance(snakeHead, foodUnit, gameState)
  
    if (dist <= depth) {
      if (!foundFood[dist]) {
        foundFood[dist] = []
      }
      foundFood[dist].push(foodUnit)
    }
  })

  return foundFood
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
export function isInOrAdjacentToHazard(coord: Coord, board2d: Board2d, hazardWalls: HazardWalls, gameState : GameState) : boolean {  
  if (gameState.game.ruleset.settings.hazardDamagePerTurn === 0) { // if hazard is not enabled, return false
    return false
  }
  let selfCell = board2d.getCell(coord)
  if (!(selfCell instanceof BoardCell)) {
    return false // return false for cells outside of board2d's bounds
  } else if (selfCell.hazard) {
    return true
  } else {
    return isAdjacentToHazard(coord, hazardWalls, gameState)
  }
}

// gets self and surrounding cells & checks them for hazards, returning true if it finds any. Returns false for spaces that are themselves hazard
export function isAdjacentToHazard(coord: Coord, hazardWalls: HazardWalls, gameState: GameState) : boolean {  
  if (gameState.game.ruleset.settings.hazardDamagePerTurn === 0) { // if hazard is not enabled, return false
    return false
  } else if (gameStateIsHazardSpiral(gameState)) { // hazard wall adjacency doesn't make sense when hazard spirals
    return false
  } else if (hazardWalls.left === undefined && coord.x === 0) { // if hazardWalls.left is undefined & coord.x is on the left wall, it's adjacent to hazard
    return true
  } else if (hazardWalls.left !== undefined && (coord.x - hazardWalls.left === 1)) { // if coord.x is exactly one right of hazardWalls.left, it's adjacent to left hazard
    return true
  } else if (hazardWalls.right === undefined && coord.x === (gameState.board.width - 1)) { // if hazardWalls.right is undefined & coord.x is on the right wall, it's adjacent to hazard
    return true
  } else if (hazardWalls.right !== undefined && (hazardWalls.right - coord.x === 1)) { // if coord.x is exactly one left of hazardWalls.right, it's adjacent to right hazard
    return true
  } else if (hazardWalls.down === undefined && coord.y === 0) { // if hazardWalls.down is undefined && coord.y is on the bottom wall, it's adjacent to hazard
    return true
  } else if (hazardWalls.down !== undefined && (coord.y - hazardWalls.down === 1)) { // if coord.y is exactly one above hazardWalls.down, it's adjacent to hazard
    return true
  } else if (hazardWalls.up === undefined && coord.y === (gameState.board.height - 1)) { // if hazardWalls.up is undefined & coord.y is on the top wall, it's adjacent to hazard
    return true
  } else if (hazardWalls.up !== undefined && (hazardWalls.up - coord.y === 1)) { // if coord.y is exactly one below hazardWalls.up, it's adjacent to top hazard
    return true
  } else {
    return false
  }
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

// looks at gamestate & myself & returns any moves that are valid - won't result in starvation, moving out of bounds, or snake cells
export function getAvailableMoves(gameState: GameState, myself: Battlesnake, board2d: Board2d) : Moves {
  let moves : Moves = new Moves(true, true, true, true)

  checkForSnakesHealthAndWalls(myself, gameState, board2d, moves)

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
          let faceoffMurder = isFaceoff(gameState, myself, moveNeighbors.upPrey, board2d) // if this is a faceoff, want to assign that particular kissOfMurder type
          switch(preyValidMoves) {
            case 1: // prey has only one valid place to go, & we can kill it there
              setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderCertainty)
              break
            case 2: // prey has two valid places to go, we may be able to kill it at either (Maybe), we may not (2to1Avoidance)
              if (moveNeighbors.isMurderChanceSnake(moveNeighbors.upPrey)) { // we can kill it at both places
                setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderMaybe)
              } else { // we can kill it at one direction, but it will likely escape in the other direction
                if (faceoffMurder) {
                  setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderFaceoff)
                } else {
                  setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderAvoidance)
                }
              }
              break
            case 3: // prey has three valid places to go, it is likely to avoid us this turn
              if (faceoffMurder) {
                setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderFaceoff)
              } else {
                setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderAvoidance)
              }
              break
          }
        }
        break
      case Direction.Down:
        if (typeof moveNeighbors.downPrey !== "undefined") {
          checkForSnakesHealthAndWalls(moveNeighbors.downPrey, gameState, board2d, preyMoves)
          let preyValidMoves = preyMoves.validMoves().length
          let faceoffMurder = isFaceoff(gameState, myself, moveNeighbors.downPrey, board2d) // if this is a faceoff, want to assign that particular kissOfMurder type
          switch(preyValidMoves) {
            case 1: // prey has only one valid place to go, & we can kill it there
              setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderCertainty)
              break
            case 2: // prey has two valid places to go, we may be able to kill it at either (Maybe), we may not (2to1Avoidance)
              if (moveNeighbors.isMurderChanceSnake(moveNeighbors.downPrey)) { // we can kill it at both places
                setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderMaybe)
              } else { // we can kill it at one direction, but it will likely escape in the other direction
                if (faceoffMurder) {
                  setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderFaceoff)
                } else {
                  setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderAvoidance)
                }
              }
              break
            case 3: // prey has three valid places to go, it is likely to avoid us this turn
              if (faceoffMurder) {
                setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderFaceoff)
              } else {
                setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderAvoidance)
              }
              break
          }
        }
        break
      case Direction.Left:
        if (typeof moveNeighbors.leftPrey !== "undefined") {
          checkForSnakesHealthAndWalls(moveNeighbors.leftPrey, gameState, board2d, preyMoves)
          let preyValidMoves = preyMoves.validMoves().length
          let faceoffMurder = isFaceoff(gameState, myself, moveNeighbors.leftPrey, board2d) // if this is a faceoff, want to assign that particular kissOfMurder type
          switch(preyValidMoves) {
            case 1: // prey has only one valid place to go, & we can kill it there
              setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderCertainty)
              break
            case 2: // prey has two valid places to go, we may be able to kill it at either (Maybe), we may not (2to1Avoidance)
              if (moveNeighbors.isMurderChanceSnake(moveNeighbors.leftPrey)) { // we can kill it at both places
                setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderMaybe)
              } else { // we can kill it at one direction, but it will likely escape in the other direction
                if (faceoffMurder) {
                  setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderFaceoff)
                } else {
                  setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderAvoidance)
                }
              }
              break
            case 3: // prey has three valid places to go, it is likely to avoid us this turn
              if (faceoffMurder) {
                setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderFaceoff)
              } else {
                setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderAvoidance)
              }
              break
          }
        }
        break
      default: //case Direction.Right:
        if (typeof moveNeighbors.rightPrey !== "undefined") {
          checkForSnakesHealthAndWalls(moveNeighbors.rightPrey, gameState, board2d, preyMoves)
          let preyValidMoves = preyMoves.validMoves().length
          let faceoffMurder = isFaceoff(gameState, myself, moveNeighbors.rightPrey, board2d) // if this is a faceoff, want to assign that particular kissOfMurder type
          switch(preyValidMoves) {
            case 1: // prey has only one valid place to go, & we can kill it there
              setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderCertainty)
              break
            case 2: // prey has two valid places to go, we may be able to kill it at either (Maybe), we may not (2to1Avoidance)
              if (moveNeighbors.isMurderChanceSnake(moveNeighbors.rightPrey)) { // we can kill it at both places
                setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderMaybe)
              } else { // we can kill it at one direction, but it will likely escape in the other direction
                if (faceoffMurder) {
                  setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderFaceoff)
                } else {
                  setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderAvoidance)
                }
              }
              break
            case 3: // prey has three valid places to go, it is likely to avoid us this turn
              if (faceoffMurder) {
                setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderFaceoff)
              } else {
                setKissOfMurderDirectionState(move, KissOfMurderState.kissOfMurderAvoidance)
              }
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

// finely tuned lookahead determinator based on various things - available moves, timeout, etc
export function lookaheadDeterminator(gameState: GameState): number {
  let lookahead: number
  let isSpeedSnake: boolean = gameState.game.timeout < 500
  let gameKeys = Object.keys(gameData)
  let isWrapped: boolean = gameStateIsWrapped(gameState)

  if (isSpeedSnake) {
    if (gameState.turn === 0) {
      lookahead = 0
    } else if (gameKeys.length > 1) { // if at least one other game is already running, run the game with one lookahead to avoid excess CPU usage 
        lookahead = 1
        logToFile(consoleWriteStream, `more than one game was running, decrementing lookahead to ${lookahead}`)
    } else if (gameState.turn < 15) {
      lookahead = 2
    } else {
      lookahead = 3
    }
    return lookahead
  }

   if (gameState.turn === 0) {
    lookahead = 0 // for turn 0, give lookahead of 0. This is the only turn all snakes have four options, so calqing this takes longer than normal.
  } else if (gameState.turn < 5) {
    lookahead = 2 // for turns 1 & 2 continue using a smaller lookahead to avoid a timeout 
  } else if (gameState.turn < 7) {
    lookahead = 3
  } else {
    switch (gameState.board.snakes.length) {
      case 0:
        lookahead = 0
        break
      case 1:
        lookahead = 5
        break
      case 2:
        if (isWrapped) {
          let board2d = new Board2d(gameState)
          let snakesHave3Moves = gameState.board.snakes.every(function hasThreeMoves(snake) {
            let availableMoves = getAvailableMoves(gameState, snake, board2d)
            return availableMoves.validMoves().length === 3
          })
          if (snakesHave3Moves) {
            lookahead = 4
          } else {
            lookahead = 5
          }
        } else {
          lookahead = 5
        }
        break
      case 3:
        let board2d = new Board2d(gameState)
        let myselfAvailableMoves = getAvailableMoves(gameState, gameState.you, board2d)
        if (myselfAvailableMoves.validMoves().length === 3) { // if I have three available moves, may need to decrement lookahead if all other snakes also do
          let otherSnakesHave3Moves = gameState.board.snakes.every(function hasThreeMoves(snake) {
            let availableMoves = getAvailableMoves(gameState, snake, board2d)
            return availableMoves.validMoves().length === 3
          })
          if (otherSnakesHave3Moves) {
            lookahead = 3
          } else {
            lookahead = 4
          }
        } else {
          lookahead = 4
        }
        break
      default: // 4 or more
        lookahead = 3
        break
    }
    if (lookahead >= 5) { // may again need to decrement the lookahead if all snakes are very small. Boards with lots of open space take longer to process, as there are more valid moves to consider
      let totalSnakeLength: number = 0
      gameState.board.snakes.forEach(function addSnakeLength(snake) {
        totalSnakeLength = totalSnakeLength + snake.length
      })
      if (gameState.you.length < 15 && totalSnakeLength < 30) { // my own length matters most since I look the farthest ahead, but if all snakes are small that also matters
        lookahead = lookahead - 1
      }
    }
  }

  if (gameKeys.length >= 3) { // if three or more games are already running, run the game with two less lookahead to avoid excess CPU usage 
    lookahead = ((lookahead - 2) >= 0)? lookahead - 2 : 0
    logToFile(consoleWriteStream, `three or more games were running, decrementing lookahead to ${lookahead}`)
  } else if (gameKeys.length === 2) {// if two games are currently running, run the game with one less lookahead to avoid excess CPU usage
    lookahead = lookahead > 0? lookahead - 1 : lookahead
    logToFile(consoleWriteStream, `two games were running, decrementing lookahead to ${lookahead}`)
  }
  return lookahead
}

// returns true if 'myself' is in position to cut off 'snake' at an edge
export function isCutoff(gameState: GameState, _myself: Battlesnake | undefined, _snake: Battlesnake | undefined, board2d: Board2d): boolean {  
  if (_myself === undefined) { // undefined snakes cannot cut off
    return false
  } else if (_snake === undefined) { // undefined snakes cannot be cut off
    return false
  } else if (_myself.id === _snake.id) {
    return false // cannot cut myself off
  } else if (gameStateIsWrapped(gameState)) {
    return false // cannot cut off in wrapped, at least not so simply
  }
  let myself: Battlesnake = _myself
  let snake: Battlesnake = _snake
  let myselfIsLonger = myself.length > snake.length // if my snake is longer. May recalculate later if snake grows while we cut it off

  let snakeMoves = new Moves(true, true, true, true)
  checkForSnakesHealthAndWalls(snake, gameState, board2d, snakeMoves)
  let snakeDirection = getSnakeDirection(gameState, snake)

  function cutoffLeftEdge(): boolean {
    if (snake.head.x === 0) { // if they are on the left edge
      if (myself.head.x === 1 || myself.head.x === 0) { // if I am next to them on the left edge
        if (snakeDirection === Direction.Up) { // if snake is moving up
          if (myself.head.y >= snake.head.y) { // if I am above or level with snake
            let cutoffCell = board2d.getCell({x: 1, y: snake.head.y}) // cell one right of snake's head
            if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.snake.id !== snake.id && !(cutoffCell.snakeCell.isTail && !snakeHasEaten(cutoffCell.snakeCell.snake))) { // if cutoffCell is not itself, & is not a snake's tail that hasn't eaten
              return true // no need to check for food, snake can't kiss us so long as we follow this straight to the edge
            }
          } else if (myselfIsLonger && (snake.head.y - myself.head.y) === 1) { // can still cut off if I'm one behind & larger
            let foundFood : number = 0
            for (let j: number = snake.head.y; j < gameState.board.height; j++) { // if my snake remains longer after considering food that snake will find on the way
              let cell = board2d.getCell({x: 0, y: j})
              if (cell instanceof BoardCell && cell.food) {
                foundFood = foundFood + 1
              }
            }
            myselfIsLonger = myself.length > (snake.length + foundFood)
            if (myselfIsLonger) { // so long as I remain longer, I can do the cutoff
              return true
            }
          }
        } else if (snakeDirection === Direction.Down) { // if snake is moving down
          if (myself.head.y <= snake.head.y) { // if I am below or level with snake
            let cutoffCell = board2d.getCell({x: 1, y: snake.head.y}) // cell one right of snake's head
            if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.snake.id !== snake.id && !(cutoffCell.snakeCell.isTail && !snakeHasEaten(cutoffCell.snakeCell.snake))) { // if cutoffCell is not itself, & is not a snake's tail that hasn't eaten
              return true // no need to check for food, snake can't kiss us so long as we follow this straight to the edge
            }
          } else if (myselfIsLonger && (myself.head.y - snake.head.y) === 1) { // can still cut off if I'm one behind & larger
            let foundFood : number = 0
            for (let j: number = snake.head.y; j >= 0; j--) { // if my snake remains longer after considering food that snake will find on the way
              let cell = board2d.getCell({x: 0, y: j})
              if (cell instanceof BoardCell && cell.food) {
                foundFood = foundFood + 1
              }
            }
            myselfIsLonger = myself.length > (snake.length + foundFood)
            if (myselfIsLonger) { // so long as I remain longer, I can do the cutoff
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
        if (snakeDirection === Direction.Up) { // if snake is moving up
          if (myself.head.y >= snake.head.y) { // if I am above or level with snake
            let cutoffCell = board2d.getCell({x: gameState.board.width - 2, y: snake.head.y}) // cell one left of snake's head
            if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.snake.id !== snake.id && !(cutoffCell.snakeCell.isTail && !snakeHasEaten(cutoffCell.snakeCell.snake))) { // if cutoffCell is not itself, & is not a snake's tail that hasn't eaten
              return true // no need to check for food, snake can't kiss us so long as we follow this straight to the edge
            }
          } else if (myselfIsLonger && (snake.head.y - myself.head.y) === 1) { // can still cut off if I'm one behind & larger
            let foundFood : number = 0
            for (let j: number = snake.head.y; j < gameState.board.height; j++) { // if my snake remains longer after considering food that snake will find on the way
              let cell = board2d.getCell({x: gameState.board.width - 1, y: j})
              if (cell instanceof BoardCell && cell.food) {
                foundFood = foundFood + 1
              }
            }
            myselfIsLonger = myself.length > (snake.length + foundFood)
            if (myselfIsLonger) { // so long as I remain longer, I can do the cutoff
              return true
            }
          }
        } else if (snakeDirection === Direction.Down) { // if snake is moving down
          if (myself.head.y <= snake.head.y) { // if I am below or level with snake
            let cutoffCell = board2d.getCell({x: gameState.board.width - 2, y: snake.head.y}) // cell one left of snake's head
            if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.snake.id !== snake.id && !(cutoffCell.snakeCell.isTail && !snakeHasEaten(cutoffCell.snakeCell.snake))) { // if cutoffCell is not itself, & is not a snake's tail that hasn't eaten
              return true // no need to check for food, snake can't kiss us so long as we follow this straight to the edge
            }
          } else if (myselfIsLonger && (myself.head.y - snake.head.y) === 1) { // can still cut off if I'm one behind & larger
            let foundFood : number = 0
            for (let j: number = snake.head.y; j >= 0; j--) { // if my snake remains longer after considering food that snake will find on the way
              let cell = board2d.getCell({x: gameState.board.width - 1, y: j})
              if (cell instanceof BoardCell && cell.food) {
                foundFood = foundFood + 1
              }
            }
            myselfIsLonger = myself.length > (snake.length + foundFood)
            if (myselfIsLonger) { // so long as I remain longer, I can do the cutoff
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
        if (snakeDirection === Direction.Right) { // if snake is moving right
          if (myself.head.x >= snake.head.x) { // if I am right of or level with snake
            let cutoffCell = board2d.getCell({x: snake.head.x, y: 1}) // cell one above snake's head
            if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.snake.id !== snake.id && !(cutoffCell.snakeCell.isTail && !snakeHasEaten(cutoffCell.snakeCell.snake))) { // if cutoffCell is not itself, & is not a snake's tail that hasn't eaten
              return true // no need to check for food, snake can't kiss us so long as we follow this straight to the edge
            }
          } else if (myselfIsLonger && (snake.head.x - myself.head.x) === 1) { // can still cut off if I'm one behind & larger
            let foundFood : number = 0
            for (let i: number = snake.head.x; i < gameState.board.width; i++) { // if my snake remains longer after considering food that snake will find on the way
              let cell = board2d.getCell({x: i, y: 0})
              if (cell instanceof BoardCell && cell.food) {
                foundFood = foundFood + 1
              }
            }
            myselfIsLonger = myself.length > (snake.length + foundFood)
            if (myselfIsLonger) { // so long as I remain longer, I can do the cutoff
              return true
            }
          }
        } else if (snakeDirection === Direction.Left) { // if snake is moving left
          if (myself.head.x <= snake.head.x) { // if I am left of or level with snake
            let cutoffCell = board2d.getCell({x: snake.head.x, y: 1}) // cell one above snake's head
            if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.snake.id !== snake.id && !(cutoffCell.snakeCell.isTail && !snakeHasEaten(cutoffCell.snakeCell.snake))) { // if cutoffCell is not itself, & is not a snake's tail that hasn't eaten
              return true // no need to check for food, snake can't kiss us so long as we follow this straight to the edge
            }
          } else if (myselfIsLonger && (myself.head.x - snake.head.x) === 1) { // can still cut off if I'm one behind & larger
            let foundFood : number = 0
            for (let i: number = snake.head.x; i >= 0; i--) { // if my snake remains longer after considering food that snake will find on the way
              let cell = board2d.getCell({x: i, y: 0})
              if (cell instanceof BoardCell && cell.food) {
                foundFood = foundFood + 1
              }
            }
            myselfIsLonger = myself.length > (snake.length + foundFood)
            if (myselfIsLonger) { // so long as I remain longer, I can do the cutoff
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
        if (snakeDirection === Direction.Right) { // if snake is moving right
          if (myself.head.x >= snake.head.x) { // if I am right of or level with snake
            let cutoffCell = board2d.getCell({x: snake.head.x, y: (gameState.board.height - 2)}) // cell one below snake's head
            if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.snake.id !== snake.id && !(cutoffCell.snakeCell.isTail && !snakeHasEaten(cutoffCell.snakeCell.snake))) { // if cutoffCell is not itself, & is not a snake's tail that hasn't eaten
              return true // no need to check for food, snake can't kiss us so long as we follow this straight to the edge
            }
          } else if (myselfIsLonger && (snake.head.x - myself.head.x) === 1) { // can still cut off if I'm one behind & larger
            let foundFood : number = 0
            for (let i: number = snake.head.x; i < gameState.board.width; i++) { // if my snake remains longer after considering food that snake will find on the way
              let cell = board2d.getCell({x: i, y: (gameState.board.height - 1)})
              if (cell instanceof BoardCell && cell.food) {
                foundFood = foundFood + 1
              }
            }
            myselfIsLonger = myself.length > (snake.length + foundFood)
            if (myselfIsLonger) { // so long as I remain longer, I can do the cutoff
              return true
            }
          }
        } else if (snakeDirection === Direction.Left) { // if snake is moving left
          if (myself.head.x <= snake.head.x) { // if I am left of or level with snake
            let cutoffCell = board2d.getCell({x: snake.head.x, y: (gameState.board.height - 2)}) // cell one below snake's head
            if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.snake.id !== snake.id && !(cutoffCell.snakeCell.isTail && !snakeHasEaten(cutoffCell.snakeCell.snake))) { // if cutoffCell is not itself, & is not a snake's tail that hasn't eaten
              return true // no need to check for food, snake can't kiss us so long as we follow this straight to the edge
            }
          } else if (myselfIsLonger && (myself.head.x - snake.head.x) === 1) { // can still cut off if I'm one behind & larger
            let foundFood : number = 0
            for (let i: number = snake.head.x; i >= 0; i--) { // if my snake remains longer after considering food that snake will find on the way
              let cell = board2d.getCell({x: i, y: (gameState.board.height - 1)})
              if (cell instanceof BoardCell && cell.food) {
                foundFood = foundFood + 1
              }
            }
            myselfIsLonger = myself.length > (snake.length + foundFood)
            if (myselfIsLonger) { // so long as I remain longer, I can do the cutoff
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

// returns true if 'myself' is in position to cut off 'snake' at a hazard wall
export function isHazardCutoff(gameState: GameState, _myself: Battlesnake | undefined, _snake: Battlesnake | undefined, board2d: Board2d, hazardWalls: HazardWalls): boolean {  
  if (_myself === undefined) { // undefined snakes cannot cut off
    return false
  } else if (_snake === undefined) { // undefined snakes cannot be cut off
    return false
  } else if (gameState.game.ruleset.settings.hazardDamagePerTurn === 0) { // cannot do hazard cutoff in a game without hazard
    return false
  } else if (gameStateIsHazardSpiral(gameState)) { // cannot do hazard cutoff in a hazard spiral game
    return false
  } else if (_myself.id === _snake.id) {
    return false // cannot cut myself off
  }
  let myself: Battlesnake = _myself
  let snake: Battlesnake = _snake
  let myselfIsLonger = myself.length > snake.length // if my snake is longer. May recalculate later if snake grows while we cut it off

  let snakeMoves = new Moves(true, true, true, true)
  checkForSnakesHealthAndWalls(snake, gameState, board2d, snakeMoves)
  let snakeDirection = getSnakeDirection(gameState, snake)

  function cutoffLeftEdge(): boolean {
    if (hazardWalls.left === undefined) { // cannot do a hazard cutoff against a hazard that doesn't exist
      return false
    }
    if (snake.head.x === (hazardWalls.left + 1)) { // if they are on the edge of the left hazard
      if (myself.head.x === (hazardWalls.left + 2) || myself.head.x === (hazardWalls.left + 1)) { // if I am next to them on the left edge
        if (snakeDirection === Direction.Up) { // if snake is moving up
          if (myself.head.y >= snake.head.y) { // if I am above or level with snake
            let cutoffCell = board2d.getCell({x: snake.head.x + 1, y: snake.head.y}) // cell one right of snake's head
            if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.snake.id !== snake.id && !(cutoffCell.snakeCell.isTail && !snakeHasEaten(cutoffCell.snakeCell.snake))) { // if cutoffCell is not itself, & is not a snake's tail that hasn't eaten
              return true // no need to check for food, snake can't kiss us so long as we follow this straight to the edge
            }
          } else if (myselfIsLonger && (snake.head.y - myself.head.y) === 1) { // can still cut off if I'm one behind & larger
            let foundFood : number = 0
            for (let j: number = snake.head.y; j < gameState.board.height; j++) { // if my snake remains longer after considering food that snake will find on the way
              let cell = board2d.getCell({x: 0, y: j})
              if (cell instanceof BoardCell && cell.food) {
                foundFood = foundFood + 1
              }
            }
            myselfIsLonger = myself.length > (snake.length + foundFood)
            if (myselfIsLonger) { // so long as I remain longer, I can do the cutoff
              return true
            }
          }
        } else if (snakeDirection === Direction.Down) { // if snake is moving down
          if (myself.head.y <= snake.head.y) { // if I am below or level with snake
            let cutoffCell = board2d.getCell({x: snake.head.x + 1, y: snake.head.y}) // cell one right of snake's head
            if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.snake.id !== snake.id && !(cutoffCell.snakeCell.isTail && !snakeHasEaten(cutoffCell.snakeCell.snake))) { // if cutoffCell is not itself, & is not a snake's tail that hasn't eaten
              return true // no need to check for food, snake can't kiss us so long as we follow this straight to the edge
            }
          } else if (myselfIsLonger && (myself.head.y - snake.head.y) === 1) { // can still cut off if I'm one behind & larger
            let foundFood : number = 0
            for (let j: number = snake.head.y; j >= 0; j--) { // if my snake remains longer after considering food that snake will find on the way
              let cell = board2d.getCell({x: 0, y: j})
              if (cell instanceof BoardCell && cell.food) {
                foundFood = foundFood + 1
              }
            }
            myselfIsLonger = myself.length > (snake.length + foundFood)
            if (myselfIsLonger) { // so long as I remain longer, I can do the cutoff
              return true
            }
          }
        }
      }
    }
    return false
  }

  function cutoffRightEdge(): boolean {
    if (hazardWalls.right === undefined) { // cannot do a hazard cutoff against a hazard that doesn't exist
      return false
    }
    if (snake.head.x === (hazardWalls.right - 1)) { // if they are on the edge of the right hazard
      if (myself.head.x === (hazardWalls.right - 2) || myself.head.x === (hazardWalls.right - 1)) { // if I am next to them on the right edge
        if (snakeDirection === Direction.Up) { // if snake is moving up
          if (myself.head.y >= snake.head.y) { // if I am above or level with snake
            let cutoffCell = board2d.getCell({x: snake.head.x - 1, y: snake.head.y}) // cell one left of snake's head
            if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.snake.id !== snake.id && !(cutoffCell.snakeCell.isTail && !snakeHasEaten(cutoffCell.snakeCell.snake))) { // if cutoffCell is not itself, & is not a snake's tail that hasn't eaten
              return true // no need to check for food, snake can't kiss us so long as we follow this straight to the edge
            }
          } else if (myselfIsLonger && (snake.head.y - myself.head.y) === 1) { // can still cut off if I'm one behind & larger
            let foundFood : number = 0
            for (let j: number = snake.head.y; j < gameState.board.height; j++) { // if my snake remains longer after considering food that snake will find on the way
              let cell = board2d.getCell({x: gameState.board.width - 1, y: j})
              if (cell instanceof BoardCell && cell.food) {
                foundFood = foundFood + 1
              }
            }
            myselfIsLonger = myself.length > (snake.length + foundFood)
            if (myselfIsLonger) { // so long as I remain longer, I can do the cutoff
              return true
            }
          }
        } else if (snakeDirection === Direction.Down) { // if snake is moving down
          if (myself.head.y <= snake.head.y) { // if I am below or level with snake
            let cutoffCell = board2d.getCell({x: snake.head.x - 1, y: snake.head.y}) // cell one left of snake's head
            if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.snake.id !== snake.id && !(cutoffCell.snakeCell.isTail && !snakeHasEaten(cutoffCell.snakeCell.snake))) { // if cutoffCell is not itself, & is not a snake's tail that hasn't eaten
              return true // no need to check for food, snake can't kiss us so long as we follow this straight to the edge
            }
          } else if (myselfIsLonger && (myself.head.y - snake.head.y) === 1) { // can still cut off if I'm one behind & larger
            let foundFood : number = 0
            for (let j: number = snake.head.y; j >= 0; j--) { // if my snake remains longer after considering food that snake will find on the way
              let cell = board2d.getCell({x: gameState.board.width - 1, y: j})
              if (cell instanceof BoardCell && cell.food) {
                foundFood = foundFood + 1
              }
            }
            myselfIsLonger = myself.length > (snake.length + foundFood)
            if (myselfIsLonger) { // so long as I remain longer, I can do the cutoff
              return true
            }
          }
        }
      }
    }
    return false
  }

  function cutoffBottomEdge(): boolean {
    if (hazardWalls.down === undefined) { // cannot do a hazard cutoff against a hazard that doesn't exist
      return false
    }
    if (snake.head.y === (hazardWalls.down + 1)) { // if they are on the edge of the bottom hazard
      if (myself.head.y === (hazardWalls.down + 2) || myself.head.y === (hazardWalls.down + 1)) { // if I am next to them on the bottom edge
        if (snakeDirection === Direction.Right) { // if snake is moving right
          if (myself.head.x >= snake.head.x) { // if I am right of or level with snake
            let cutoffCell = board2d.getCell({x: snake.head.x, y: snake.head.y + 1}) // cell one above snake's head
            if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.snake.id !== snake.id && !(cutoffCell.snakeCell.isTail && !snakeHasEaten(cutoffCell.snakeCell.snake))) { // if cutoffCell is not itself, & is not a snake's tail that hasn't eaten
              return true // no need to check for food, snake can't kiss us so long as we follow this straight to the edge
            }
          } else if (myselfIsLonger && (snake.head.x - myself.head.x) === 1) { // can still cut off if I'm one behind & larger
            let foundFood : number = 0
            for (let i: number = snake.head.x; i < gameState.board.width; i++) { // if my snake remains longer after considering food that snake will find on the way
              let cell = board2d.getCell({x: i, y: 0})
              if (cell instanceof BoardCell && cell.food) {
                foundFood = foundFood + 1
              }
            }
            myselfIsLonger = myself.length > (snake.length + foundFood)
            if (myselfIsLonger) { // so long as I remain longer, I can do the cutoff
              return true
            }
          }
        } else if (snakeDirection === Direction.Left) { // if snake is moving left
          if (myself.head.x <= snake.head.x) { // if I am left of or level with snake
            let cutoffCell = board2d.getCell({x: snake.head.x, y: snake.head.y + 1}) // cell one above snake's head
            if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.snake.id !== snake.id && !(cutoffCell.snakeCell.isTail && !snakeHasEaten(cutoffCell.snakeCell.snake))) { // if cutoffCell is not itself, & is not a snake's tail that hasn't eaten
              return true // no need to check for food, snake can't kiss us so long as we follow this straight to the edge
            }
          } else if (myselfIsLonger && (myself.head.x - snake.head.x) === 1) { // can still cut off if I'm one behind & larger
            let foundFood : number = 0
            for (let i: number = snake.head.x; i >= 0; i--) { // if my snake remains longer after considering food that snake will find on the way
              let cell = board2d.getCell({x: i, y: 0})
              if (cell instanceof BoardCell && cell.food) {
                foundFood = foundFood + 1
              }
            }
            myselfIsLonger = myself.length > (snake.length + foundFood)
            if (myselfIsLonger) { // so long as I remain longer, I can do the cutoff
              return true
            }
          }
        }
      }
    }
    return false
  }

  function cutoffTopEdge(): boolean {
    if (hazardWalls.up === undefined) { // cannot do a hazard cutoff against a hazard that doesn't exist
      return false
    }
    if (snake.head.y === (hazardWalls.up - 1)) { // if they are on edge of the top hazard
      if (myself.head.y === (hazardWalls.up - 2) || myself.head.y === (hazardWalls.up - 1)) { // if I am next to them on the bottom edge
        if (snakeDirection === Direction.Right) { // if snake is moving right
          if (myself.head.x >= snake.head.x) { // if I am right of or level with snake
            let cutoffCell = board2d.getCell({x: snake.head.x, y: snake.head.y - 1}) // cell one below snake's head
            if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.snake.id !== snake.id && !(cutoffCell.snakeCell.isTail && !snakeHasEaten(cutoffCell.snakeCell.snake))) { // if cutoffCell is not itself, & is not a snake's tail that hasn't eaten
              return true // no need to check for food, snake can't kiss us so long as we follow this straight to the edge
            }
          } else if (myselfIsLonger && (snake.head.x - myself.head.x) === 1) { // can still cut off if I'm one behind & larger
            let foundFood : number = 0
            for (let i: number = snake.head.x; i < gameState.board.width; i++) { // if my snake remains longer after considering food that snake will find on the way
              let cell = board2d.getCell({x: i, y: (gameState.board.height - 1)})
              if (cell instanceof BoardCell && cell.food) {
                foundFood = foundFood + 1
              }
            }
            myselfIsLonger = myself.length > (snake.length + foundFood)
            if (myselfIsLonger) { // so long as I remain longer, I can do the cutoff
              return true
            }
          }
        } else if (snakeDirection === Direction.Left) { // if snake is moving left
          if (myself.head.x <= snake.head.x) { // if I am left of or level with snake
            let cutoffCell = board2d.getCell({x: snake.head.x, y: snake.head.y - 1}) // cell one below snake's head
            if (cutoffCell instanceof BoardCell && cutoffCell.snakeCell instanceof SnakeCell && cutoffCell.snakeCell.snake.id !== snake.id && !(cutoffCell.snakeCell.isTail && !snakeHasEaten(cutoffCell.snakeCell.snake))) { // if cutoffCell is not itself, & is not a snake's tail that hasn't eaten
              return true // no need to check for food, snake can't kiss us so long as we follow this straight to the edge
            }
          } else if (myselfIsLonger && (myself.head.x - snake.head.x) === 1) { // can still cut off if I'm one behind & larger
            let foundFood : number = 0
            for (let i: number = snake.head.x; i >= 0; i--) { // if my snake remains longer after considering food that snake will find on the way
              let cell = board2d.getCell({x: i, y: (gameState.board.height - 1)})
              if (cell instanceof BoardCell && cell.food) {
                foundFood = foundFood + 1
              }
            }
            myselfIsLonger = myself.length > (snake.length + foundFood)
            if (myselfIsLonger) { // so long as I remain longer, I can do the cutoff
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

// returns true if 'myself' is in position with another snake to sandwich 'snake'
export function isSandwich(gameState: GameState, _myself: Battlesnake | undefined, _snake: Battlesnake | undefined, board2d: Board2d): boolean {
  if (_myself === undefined) { // undefined snakes cannot cut off
    return false
  } else if (_snake === undefined) { // undefined snakes cannot be cut off
    return false
  } else if (gameState.board.snakes.length < 3) { // cannot sandwich if there are not at least three snakes
    return false
  } else if (_myself.id === _snake.id) {
    return false // cannot sandwich myself
  }
  let myself: Battlesnake = _myself
  let snake: Battlesnake = _snake
  let _otherSnake: Battlesnake | undefined = gameState.board.snakes.find(function findOtherSnake(thirdSnake) { return thirdSnake.id !== myself.id && thirdSnake.id !== snake.id})

  if (_otherSnake === undefined) { // should not be possible, but if our third snake doesn't exist on the game board we also can't sandwich
    return false
  }
  let otherSnake: Battlesnake = _otherSnake

  let snakeDir = getSnakeDirection(gameState, snake)
  let snakeMoves = getAvailableMoves(gameState, snake, board2d)
  let myselfMoves = getAvailableMoves(gameState, myself, board2d)
  let otherSnakeMoves = getAvailableMoves(gameState, otherSnake, board2d)

  // helper function to determine if horizontal sandwicher 'myself' is vertically positioned to sandwich 'snake', either up or down
  function isHorizontalSandwichVerticallyPositioned(myself: Battlesnake, snake: Battlesnake, direction: Direction): boolean {
    switch(myself.head.y - snake.head.y) {
      case 0: // my head is even with snake head. This is sandwichable
        return true
      case -1: // my head is lower than snake head
        if (direction === Direction.Up) {
          if (myself.length > snake.length) { // This is only sandwichable if I am larger than snake
            return true
          }
        } else if (direction === Direction.Down) { // This is only sandwichable if snake can only move down
          if (snakeMoves.validMoves().length === 1) {
            return true
          }
        }
        break
      case 1: // my head is higher than snake head.
        if (direction === Direction.Up) {
          if (snakeMoves.validMoves().length === 1) { // This is only sandwichable if snake can only move up
            return true
          } 
        } else if (direction === Direction.Down) { 
          if (myself.length > snake.length) { // This is only sandwichable if I am larger than snake
            return true
          }
        }
        break
      default: // myself is not in position to sandwich, therefore this is not a sandwich
        return false
    }
    return false // if no case up until this point has returned, sandwich criteria were not met
  }

  // helper function to determine if vertical sandwicher 'myself' is horizontally positioned to sandwich 'snake', either left or right
  function isVerticalSandwichHorizontallyPositioned(myself: Battlesnake, snake: Battlesnake, direction: Direction): boolean {
    switch(myself.head.x - snake.head.x) {
      case 0: // my head is even with snake head. This is sandwichable
        return true
      case -1: // my head is left of snake head
        if (direction === Direction.Right) {
          if (myself.length > snake.length) { // This is only sandwichable if I am larger than snake
            return true
          }
        } else if (direction === Direction.Left) { // This is only sandwichable if snake can only move left
          if (snakeMoves.validMoves().length === 1) {
            return true
          }
        }
        break
      case 1: // my head is right of snake head.
        if (direction === Direction.Right) {
          if (snakeMoves.validMoves().length === 1) { // This is only sandwichable if snake can only move right
            return true
          } 
        } else if (direction === Direction.Left) { 
          if (myself.length > snake.length) { // This is only sandwichable if I am larger than snake
            return true
          }
        }
        break
      default: // myself is not in position to sandwich, therefore this is not a sandwich
        return false
    }
    return false // if no case up until this point has returned, sandwich criteria were not met
  }

  function isHorizontalSandwich(): boolean {
    // second condition is that sandwiching snakes can move in the same direction as snake is moving
    if (snakeDir === Direction.Up && myselfMoves.up && otherSnakeMoves.up) { // sandwiching moving up
      // third condition is that sandwiching snakes are near snake & can prevent it from moving out of the sandwich
      // this means either: they are one behind, but larger; they are level; or they are one ahead
      if (!isHorizontalSandwichVerticallyPositioned(myself, snake, Direction.Up)) { // if myself is not in position vertically to sandwich, this is not a sandwich
        return false
      } else if (!isHorizontalSandwichVerticallyPositioned(otherSnake, snake, Direction.Up)) { // likewise for otherSnake
        return false
      } else {
        return true // both snakes are in vertical position, we can sandwich
      }
    } else if (snakeDir === Direction.Down && myselfMoves.down && otherSnakeMoves.down) { // sandwiching moving down
      if (!isHorizontalSandwichVerticallyPositioned(myself, snake, Direction.Down)) { // if myself is not in position vertically to sandwich, this is not a sandwich
        return false
      } else if (!isHorizontalSandwichVerticallyPositioned(otherSnake, snake, Direction.Down)) { // likewise for otherSnake
        return false
      } else {
        return true // both snakes are in vertical position, we can sandwich
      }
    }
    return false
  }

  function isVerticalSandwich(): boolean {
    // second condition is that sandwiching snakes can move in the same direction as snake is moving
    if (snakeDir === Direction.Left && myselfMoves.left && otherSnakeMoves.left) { // sandwiching moving left
      // third condition is that sandwiching snakes are near snake & can prevent it from moving out of the sandwich
      // this means either: they are one behind, but larger; they are level; or they are one ahead
      if (!isVerticalSandwichHorizontallyPositioned(myself, snake, Direction.Left)) { // if myself is not in position horizontally to sandwich, this is not a sandwich
        return false
      } else if (!isVerticalSandwichHorizontallyPositioned(otherSnake, snake, Direction.Left)) { // likewise for otherSnake
        return false
      } else {
        return true // both snakes are in horizontal position, we can sandwich
      }
    } else if (snakeDir === Direction.Right && myselfMoves.right && otherSnakeMoves.right) { // sandwiching moving right
      if (!isVerticalSandwichHorizontallyPositioned(myself, snake, Direction.Right)) { // if myself is not in position horizontally to sandwich, this is not a sandwich
        return false
      } else if (!isVerticalSandwichHorizontallyPositioned(otherSnake, snake, Direction.Right)) { // likewise for otherSnake
        return false
      } else {
        return true // both snakes are in vertical position, we can sandwich
      }
    }
    return false
  }

  // first condition for sandwiching is snake is between myself & otherSnake. This can be either vertically or horizontally
  if ((snake.head.x - myself.head.x) === 1 && (otherSnake.head.x - snake.head.x) === 1) { // myself is 1 left of snake, otherSnake is 1 right of snake
    return isHorizontalSandwich()
  } else if ((snake.head.x - otherSnake.head.x) === 1 && (myself.head.x - snake.head.x) === 1) { // otherSnake is 1 left of snake, myself is 1 right of snake
    return isHorizontalSandwich()
  } else if ((snake.head.y - myself.head.y) === 1 && (otherSnake.head.y - snake.head.y) === 1) { // myself is 1 below snake, otherSnake is 1 above snake
    return isVerticalSandwich()
  } else if ((snake.head.y - otherSnake.head.y) === 1 && (myself.head.y - snake.head.y) === 1) { // otherSnake is 1 below snake, myself is 1 above snake
    return isVerticalSandwich()
  } else {
    return false
  }
}

// returns true if 'myself' is in position to face off with another, smaller snake - one empty space between them, & snake can't move directly away
export function isFaceoff(gameState: GameState, _myself: Battlesnake | undefined, _snake: Battlesnake | undefined, board2d: Board2d): boolean {
  if (_myself === undefined) { // undefined snakes cannot face off
    return false
  } else if (_snake === undefined) { // undefined snakes cannot face off
    return false
  } else if (_myself.id === _snake.id) {
    return false // cannot face self off
  } else if (gameState.board.snakes.length !== 2) { // make faceOff only matter in duels, where there's only one snake to worry about
    return false
  } else if (_myself.length <= _snake.length) { // myself cannot face off a snake that is larger or equal to it
    return false
  }
  let myself: Battlesnake = _myself
  let snake: Battlesnake = _snake

  // face off occurs when both snakes have one space inbetween them, & snake does not have the option to turn & run directly away from myself
  if (myself.head.x === snake.head.x && (Math.abs(myself.head.y - snake.head.y)) === 2) { // if x's are identical, y's need to be two apart
    let snakeAvailableMoves = getAvailableMoves(gameState, snake, board2d)
    if (myself.head.y > snake.head.y && !snakeAvailableMoves.down && snakeAvailableMoves.up) { // if myself is above snake, it's a faceoff if snake can't go down & can go up
      return true
    } else if (myself.head.y < snake.head.y && !snakeAvailableMoves.up && snakeAvailableMoves.down) { // if myself is below snake, it's a faceoff if snake can't go up & can go down
      return true
    }
  } else if (myself.head.y === snake.head.y && (Math.abs(myself.head.x - snake.head.x)) === 2) { // if y's are identical, x's need to be two apart
    let snakeAvailableMoves = getAvailableMoves(gameState, snake, board2d)
    if (myself.head.x > snake.head.x && !snakeAvailableMoves.left && snakeAvailableMoves.right) { // if myself is right of snake, it's a faceoff if snake can't go left & can go right
      return true
    } else if (myself.head.x < snake.head.x && !snakeAvailableMoves.right && snakeAvailableMoves.left) { // if myself is left of snake, it's a faceoff if snake can't go right & can go left
      return true
    }
  }
  return false // if it hasn't succeeded at any truth test up until this point, it's not a faceoff
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

export function isOnHorizontalWall(board: Board, coord: Coord): boolean {
  return (coord.x === 0 || coord.x === (board.width - 1))
}

export function isOnVerticalWall(board: Board, coord: Coord): boolean {
  return (coord.y === 0 || coord.y === (board.height - 1))
}

export function isCorner(board: Board, coord: Coord): boolean {
  return isOnHorizontalWall(board, coord) && isOnVerticalWall(board, coord)
}

// creates a file named filename.txt, & moves existing filename_3.txt to filename_4.txt, _2 to _3, _1 to _2, & filename to _1, if they existed
export function createLogAndCycle(filename: string): WriteStream {
  for (let i: number = 3; i >= 0; i--) { // in reverse order, move filename_3 to filename_4, _2 to _3, _1 to _2, & filename to _1
    let oldFilename = i === 0? filename + ".txt" : filename + "_" + i + ".txt"
    let newFilename = filename + "_" + (i + 1) + ".txt"
    if (existsSync(oldFilename)) { // if the old filename exists, move it to the new filename
      renameSync(oldFilename, newFilename)
    }
  }
  
  return createWriteStream(filename + ".txt", { // create filename.txt
    encoding: "utf8"
  }) 
}

export function createGameDataId(gameState: GameState): string {
  return gameState.game.id + gameState.you.id
}

// given an array of numbers, calculates the average, highest, variance, & standard deviation of those numbers
export function calculateTimingData(numbers: number[], gameResult: string): TimingStats {
  let average: number = 0
  let max: number = 0

  numbers.forEach(function processTimes(num) {
    average = average + num
    max = num > max? num : max
  })
  average = average / numbers.length
  let deviations: number[] = []
  numbers.forEach(function calculateDeviations(num) {
    let deviation = average - num
    deviation = deviation * deviation
    deviations.push(deviation)
  })
  let variance = deviations.reduce(function sumDeviations(previousValue: number, currentValue: number): number { return previousValue + currentValue }) / numbers.length
  let standardDeviation = Math.sqrt(variance)

  if (isDevelopment) {
    logToFile(consoleWriteStream, `of ${numbers.length} total times, average time: ${average}; highest time: ${max}; variance: ${variance}; standard deviation: ${standardDeviation}`)
  }

  return new TimingStats(average, max, variance, standardDeviation, gameResult)
}

export function shuffle(array: any[]): any[] { // Fisher-Yates Shuffle for randomizing array contents
  let currentIndex = array.length,  randomIndex;

  // While there remain elements to shuffle...
  while (currentIndex != 0) {

    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex], array[currentIndex]];
  }

  return array;
}

// function to return a unique hash key for retrieving a score based on all unique identifying pieces of data (not version or gameResult, since those are the same for everyone)
export function getSnakeScoreHashKey(snakeLength: number, foodCountTier: FoodCountTier, hazardCountTier: HazardCountTier, snakeCount: number, depth: number): string {
  return `${snakeLength};${foodCountTier};${hazardCountTier};${snakeCount};${depth}`
}

// given a snake score hash key, we should be able to reliably rebuild the SnakeScore
export function getSnakeScoreFromHashKey(hashKey: string, score: number): SnakeScore | undefined {
  let parts = hashKey.split(";")
  if (parts.length !== 5) {
    return undefined
  } else {
    let snakeLength: number = parseInt(parts[0], 10)
    if (isNaN(snakeLength)) {
      return undefined
    }
    let foodCountTier: FoodCountTier = parseInt(parts[1], 10)
    if (isNaN(foodCountTier)) {
      return undefined
    } else if (!(foodCountTier in FoodCountTier)) {
      return undefined // invalid number for a FoodCountTier
    }
    let hazardCountTier: HazardCountTier = parseInt(parts[2], 10)
    if (isNaN(hazardCountTier)) {
      return undefined
    } else if (!(hazardCountTier in HazardCountTier)) {
      return undefined // invalid number for a HazardCountTier
    }
    let snakeCount: number = parseInt(parts[3], 10)
    if (isNaN(snakeCount)) {
      return undefined
    }
    let depth: number = parseInt(parts[4], 10)
    if (isNaN(depth)) {
      return undefined
    }
    // if we get here, all parts appear to be valid - create a new SnakeScore & return it
    return new SnakeScore(score, snakeLength, foodCountTier, hazardCountTier, snakeCount, depth, version)
  }
}

export function getFoodCountTier(numFood: number): FoodCountTier {
  if (numFood === 0) {
    return FoodCountTier.zero
  } else if (numFood < 4) {
    return FoodCountTier.less4
  } else if (numFood < 7) {
    return FoodCountTier.less7
  } else {
    return FoodCountTier.lots
  }
}

export function getHazardCountTier(numHazard: number): HazardCountTier {
  if (numHazard === 0) {
    return HazardCountTier.zero
  } else if (numHazard < 31) {
    return HazardCountTier.less31
  } else if (numHazard < 61) {
    return HazardCountTier.less61
  } else {
    return HazardCountTier.lots
  }
}

// given a board2d & an array of battlesnakes, returns an object whose keys are snake IDs & whose values are numbers of cells in that snake's Voronoi cell
export function calculateReachableCells(gameState: GameState, board2d: Board2d): {[key: string]: VoronoiResults} {
  let cellTotals: {[key: string]: VoronoiResults} = {}
  const hazardDamage: number = 1 + gameState.game.ruleset.settings.hazardDamagePerTurn
  const hazardValue: number = hazardDamage >= 15? voronoiHazardValueSmall : voronoiHazardValueLarge
  gameState.board.snakes.forEach(snake => { cellTotals[snake.id] = new VoronoiResults() }) // instantiate each snake object
  for (let i: number = 0; i < board2d.width; i++) { // for each cell at width i
    for (let j: number = 0; j < board2d.height; j++) { // for each cell at height j
      let cell: BoardCell | undefined = board2d.getCell({x: i, y: j})
      if (cell !== undefined) {
        let voronoiKeys = Object.keys(cell.voronoi)
        voronoiKeys.forEach(snakeId => { // for each voronoiSnake in cell.voronoi, increment the total of that snake in the cellTotals object
          let voronoiSnake: VoronoiSnake | undefined = cell?.voronoi[snakeId]
          if (voronoiSnake !== undefined) {
            let depth = cell? cell.voronoiDepth() : undefined
            if (voronoiSnake.depth === 0) { // cell that snake is currently occupying should always have a value of at least 1
              cellTotals[snakeId].reachableCells = cellTotals[snakeId].reachableCells + 1 // normal Voronoi reward
            } else if (cell && cell.hazard && !cell.food) { // for hazard cells
              cellTotals[snakeId].reachableCells = cellTotals[snakeId].reachableCells + hazardValue
            } else {
              cellTotals[snakeId].reachableCells = cellTotals[snakeId].reachableCells + 1
            }

            if (cell && cell.food && depth !== undefined) {
              if (cellTotals[snakeId].food[depth] !== undefined) {
                cellTotals[snakeId].food[depth].push(cell.coord)
              } else {
                cellTotals[snakeId].food[depth] = [cell.coord]
              }
            }
          }          
        })
      }
    }
  }
  return cellTotals
}