import { InfoResponse, GameState, MoveResponse, Game, ICoord, Battlesnake, Board, IBoardCell, SnakeCell } from "./types"

import { writeFile, createWriteStream } from 'fs';
let consoleWriteStream = createWriteStream("consoleLogs.txt", {
  encoding: "utf8"
})

function logToFile(str: string) {
  console.log(str)
  consoleWriteStream.write(`${str}
  `)
  // writeFile('message.txt', str, (err) => {
  //   if (err) throw err;
  //   console.log('The file has been saved!');
  // });
}

class Coord implements ICoord {
  x: number
  y: number

  constructor(x: number, y: number) {
    this.x = x
    this.y = y
  }
}

class BoardCell implements IBoardCell {
  snakeCell?: SnakeCell;
  food: boolean;
  hazard: boolean;
  coord: Coord;

  constructor(_coord: Coord, _food: boolean, _hazard: boolean, _snakeCell?: SnakeCell) {
    this.snakeCell = _snakeCell;
    this.food = _food;
    this.hazard = _hazard;
    this.coord = _coord;
  }

  logSelf(str? : string) : void {
    logToFile(`${str}; BoardCell at (${this.coord.x},${this.coord.y}) has snake: ${!!this.snakeCell}; has food: ${this.food}; has hazard: ${this.hazard}`);
  }
}

class Board2d {
  private cells: Array<BoardCell>;
  width: number;
  height: number;

  constructor(_width: number, _height: number) {
    this.width = _width;
    this.height = _height;
    this.cells = new Array(_width * _height);
  }

  getCell(coord: Coord) : BoardCell {
    let x = coord.x;
    let y = coord.y;
    let idx = y * this.width + x;
    if (!this.cells[idx]) { // if this BoardCell has not yet been instantiated, do so
      this.cells[idx] = new BoardCell(new Coord(x, y), false, false);
    }
    return this.cells[idx];
  }

  logCell(coord: Coord) : void {
    let cell = this.getCell(coord);
    cell.logSelf();
    // console.log(`board2d at (${coord.x},${coord.y}) food: ${cell.food}`);
    // console.log(`board2d at (${coord.x},${coord.y}) hazard: ${cell.hazard}`);
    // console.log(`board2d at (${coord.x},${coord.y}) has snake: ${cell.snakeCell !== undefined}`);
  }

  logBoard() : void {
    for (let i = 0; i < this.width; i++) {
      for (let j = 0; j < this.height; j++) {
        let tempCoord = new Coord(i, j);
        this.logCell(tempCoord);
      }
    }
  }

  hasSnake(coord: Coord, inputSnake: Battlesnake) : boolean {
    let cell = this.getCell(coord);
    return cell.snakeCell ? cell.snakeCell.snake.id === inputSnake.id : false;
  }
}

class Moves {
  up: boolean;
  down: boolean;
  right: boolean;
  left: boolean;

  constructor(up: boolean, down: boolean, right: boolean, left: boolean) {
    this.up = up;
    this.down = down;
    this.right = right;
    this.left = left;
  }

  validMoves() : string[] {
    let moves : string[] = [];
    if (this.up) {
      moves.push("up");
    }
    if (this.down) {
      moves.push("down");
    }
    if (this.left) {
      moves.push("left");
    }
    if (this.right) {
      moves.push("right");
    }
    return moves;
  }
}

// returns true if snake health is max, indicating it ate this turn
function snakeHasEaten(snake: Battlesnake) {
  //logToFile(`snakeHasEaten: snake at (${snake.head.x},${snake.head.y}) length: ${snake.length}; body length: ${snake.body.length}; snake health: ${snake.health}`)
  //return snake.length !== snake.body.length
  return snake.health === 100
}

function getRandomInt(min: number, max: number) : number {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min) + min); //The maximum is exclusive and the minimum is inclusive
}


function logCoord(c: Coord, descriptor: string) : void {
  console.log(descriptor + " x: %d, y: %d", c.x, c.y)
}

export function info(): InfoResponse {
    console.log("INFO")
    const response: InfoResponse = {
        apiversion: "1",
        author: "waryferryman",
        color: "#ff00ff",
        head: "bendr",
        tail: "freckled"
    }
    return response
}

export function start(gameState: GameState): void {
    console.log(`${gameState.game.id} START`)
}

export function end(gameState: GameState): void {
    console.log(`${gameState.game.id} END\n`)
}

// TODO: adjust food search depth based on food priority
// calculate food priority based on size of self & other snakes
// calculate food priority based on turn
// calculate food priority based on current health
// turn off center focus early in game, back on later
// move towards kisses of death if you are the projected winner
export function move(gameState: GameState): MoveResponse {
    //logToFile(`turn: ${gameState.turn}`)    
    
    let possibleMoves : Moves = new Moves(true, true, true, true)

    const myself = gameState.you
    const myHead: Coord = myself.head
    const myNeck: Coord = myself.body[1]
    const boardWidth: number = gameState.board.width
    const boardHeight: number = gameState.board.height
    const myBody: Coord[] = myself.body
    const otherSnakes: Battlesnake[] = gameState.board.snakes
    const myTail: Coord = myBody[myBody.length - 1]
    const snakeBites = gameState.board.food

    function coordsEqual(c1: Coord, c2: Coord): boolean {
      return (c1.x === c2.x && c1.y === c2.y)
    }

    function buildBoard2d(board : Board, you : Battlesnake) : Board2d {
      // const board2d : Board2d = {
      //   cells: Array.from(Array(board.width), () => new Array(board.height))
      // }
      const board2d = new Board2d(board.width, board.height)

      function processSnake(inputSnake : Battlesnake) : void {
        inputSnake.body.forEach(function addSnakeCell(part : Coord) : void {
          let newSnakeCell : SnakeCell = {
            snake: inputSnake,
            isHead: coordsEqual(part, inputSnake.head),
            isTail: coordsEqual(part, inputSnake.body[inputSnake.body.length - 1])
          },
              board2dCell = board2d.getCell(part)
          board2dCell.snakeCell = newSnakeCell
        })
      }

      processSnake(you)
      board.snakes.forEach(processSnake)

      board.food.forEach(function addFood(coord : Coord) : void {
        let board2dCell = board2d.getCell(coord)
        board2dCell.food = true
      })

      board.hazards.forEach(function addHazard(coord: Coord) : void {
        let board2dCell = board2d.getCell(coord)
        board2dCell.hazard = true
      })

      return board2d
    }

    const board2d = buildBoard2d(gameState.board, myself)

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

    //logCoord(myTail, "myTail")
    //console.log("myTail x: %d, y: %d", myTail.x, myTail.y)

    //logCoord(myHead, "myHead")
    //console.log("myHead x: %d, y: %d", myHead.x, myHead.y)

    // Step 0: Don't let your Battlesnake move back on its own neck
    // if (myNeck.x < myHead.x) {
    //     possibleMoves.left = false
    // } else if (myNeck.x > myHead.x) {
    //     possibleMoves.right = false
    // } else if (myNeck.y < myHead.y) {
    //     possibleMoves.down = false
    // } else if (myNeck.y > myHead.y) {
    //     possibleMoves.up = false
    // }

    // TODO: Step 1 - Don't hit walls.
    // Use information in gameState to prevent your Battlesnake from moving beyond the boundaries of the board.
    
    // if (myHead.x === 0) {
    //   possibleMoves.left = false
    // }
    // if (myHead.x === (boardWidth - 1)) {
    //   possibleMoves.right = false
    // }
    // if (myHead.y === 0) {
    //   possibleMoves.down = false
    // }
    // if (myHead.y === (boardHeight - 1)) {
    //   possibleMoves.up = false
    // }

    // TODO: Step 2 - Don't hit yourself.
    // Use information in gameState to prevent your Battlesnake from colliding with itself.

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

    // function partChecker(part: Coord): void {
    //   if (isAbove(part, myHead)) {
    //     possibleMoves.up = false
    //   }
    //   if (isBelow(part, myHead)) {
    //     possibleMoves.down = false
    //   }
    //   if (isRight(part, myHead)) {
    //     possibleMoves.right = false
    //   }
    //   if (isLeft(part, myHead)) {
    //     possibleMoves.left = false
    //   }
    // }

    function getBodyWithoutTail(body: Coord[]): Coord[] {
      return body.slice(0, -1)
    }

    // return true if board has food at the provided coordinate
    function hasFood(coord: Coord, board2d: Board2d) : boolean {
      return board2d.getCell(coord).food
      //return food.some(foodUnit => foodUnit.x === coord.x && foodUnit.y === coord.y)
    }

    // if (hasFood(myTail, snakeBites)) { // if our tail has food on it, we don't want to treat it as a valid tile to enter
    //   myBody.forEach(partChecker)
    // } else {
    //   getBodyWithoutTail(myBody).forEach(partChecker)
    // }

    // // TODO: Step 3 - Don't collide with others.
    // // Use information in gameState to prevent your Battlesnake from colliding with others.
    // otherSnakes.forEach(enemySnake => getBodyWithoutTail(enemySnake.body).forEach(partChecker))

    function checkForSnakesAndWalls(me: Battlesnake, board: Board2d, moves: Moves) {
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
        if (newCell.snakeCell) { // if newCell has a snake, we may be able to move into it if it's a tail
          let snakeCell = newCell.snakeCell as SnakeCell // if we've reached here, we know it's not undefined
          //logToFile(`snakeCell at (${newCell.coord.x},${newCell.coord.y}) is a tail: ${snakeCell.isTail} and has eaten: ${snakeHasEaten(snakeCell.snake)}`)
          if (snakeCell.isTail && !snakeHasEaten(snakeCell.snake)) { // if a snake hasn't eaten on this turn, its tail will recede next turn, making it a safe place to move
            return true
          } else { // cannot move into any other body part
            return false
          }
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

    checkForSnakesAndWalls(myself, board2d, possibleMoves)

    function findKissCells(me: Battlesnake, board2d: Board2d, moves: Moves) : void {
      function getSurroundingCells(coord : Coord, directionFrom: string) : BoardCell[] {
        let surroundingCells : BoardCell[] = []
        if (coord.x - 1 >= 0 && directionFrom !== "left") {
          surroundingCells.push(board2d.getCell(new Coord(coord.x - 1, coord.y)))
        }
        if (coord.x + 1 < board2d.width && directionFrom !== "right") {
          surroundingCells.push(board2d.getCell(new Coord(coord.x + 1, coord.y)))
        }
        if (coord.y - 1 >= 0 && directionFrom !== "down") {
          surroundingCells.push(board2d.getCell(new Coord(coord.x, coord.y - 1)))
        }
        if (coord.y + 1 < board2d.height && directionFrom !== "up") {
          surroundingCells.push(board2d.getCell(new Coord(coord.x, coord.y + 1)))
        }

        //logToFile(`cells surrounding (${coord.x},${coord.y}) for ${me.id}`)
        //surroundingCells.forEach(cell => cell.logSelf(me.id))

        return surroundingCells
      }
      
      let myLength = me.length
      let myHead = me.head
      if (moves.up) {
        let amInDanger : boolean = false
        let newCoord : Coord = new Coord(myHead.x, myHead.y + 1)
        let neighborCells = getSurroundingCells(newCoord, "down")
        neighborCells.forEach(function checkIfInDanger(cell) {
          if (cell.snakeCell && cell.snakeCell.isHead && (cell.snakeCell.snake.length >= myLength)) {
            //logToFile(`snake ${me.id} at (${myHead.x},${myHead.y}) thinks (${newCoord.x},${newCoord.y}) is dangerous due to neighbor snake at (${cell.coord.x},${cell.coord.y})`)
            amInDanger = true
          }
        })
        if (amInDanger && (moves.left || moves.right || moves.down)) { // moving here would likely result in at least one bad kiss
          moves.up = false
        }
      }

      if (moves.down) {
        let amInDanger : boolean = false
        let newCoord : Coord = new Coord(myHead.x, myHead.y - 1)
        let neighborCells = getSurroundingCells(newCoord, "up")
        neighborCells.forEach(function checkIfInDanger(cell) {
          if (cell.snakeCell && cell.snakeCell.isHead && (cell.snakeCell.snake.length >= myLength)) {
            //logToFile(`snake ${me.id} at (${myHead.x},${myHead.y}) thinks (${newCoord.x},${newCoord.y}) is dangerous due to neighbor snake at (${cell.coord.x},${cell.coord.y})`)
            amInDanger = true
          }
        })
        if (amInDanger && (moves.left || moves.right || moves.up)) { // moving here would likely result in at least one bad kiss
          moves.down = false
        }
      }

      if (moves.right) {
        let amInDanger : boolean = false
        let newCoord : Coord = new Coord(myHead.x + 1, myHead.y)
        let neighborCells = getSurroundingCells(newCoord, "left")
        neighborCells.forEach(function checkIfInDanger(cell) {
          if (cell.snakeCell && cell.snakeCell.isHead && (cell.snakeCell.snake.length >= myLength)) {
            //logToFile(`snake ${me.id} at (${myHead.x},${myHead.y}) thinks (${newCoord.x},${newCoord.y}) is dangerous due to neighbor snake at (${cell.coord.x},${cell.coord.y})`)
            amInDanger = true
          }
        })
        if (amInDanger && (moves.left || moves.up || moves.down)) { // moving here would likely result in at least one bad kiss
          moves.right = false
        }
      }

      if (moves.left) {
        let amInDanger : boolean = false
        let newCoord : Coord = new Coord(myHead.x - 1, myHead.y)
        let neighborCells = getSurroundingCells(newCoord, "right")
        neighborCells.forEach(function checkIfInDanger(cell) {
          if (cell.snakeCell && cell.snakeCell.isHead && (cell.snakeCell.snake.length >= myLength)) {
            //logToFile(`snake ${me.id} at (${myHead.x},${myHead.y}) thinks (${newCoord.x},${newCoord.y}) is dangerous due to neighbor snake at (${cell.coord.x},${cell.coord.y})`)
            amInDanger = true
          }
        })
        if (amInDanger && (moves.right || moves.up || moves.down)) { // moving here would likely result in at least one bad kiss
          moves.left = false
        }
      }
    }

    findKissCells(myself, board2d, possibleMoves)

    // TODO: Step 4 - Find food.
    // Use information in gameState to seek out and find food.

    // returns minimum number of moves between input coordinates
    function getDistance(c1: Coord, c2: Coord) : number {
      return Math.abs(c1.x - c2.x) + Math.abs(c1.y - c2.y)
    }

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
      
        //console.log("findFood dist: %d for foodUnit (%d,%d)", dist, foodUnit.x, foodUnit.y)
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
        if (moves.left || moves.up || moves.down) {
          moves.right = false
        }
      } else if (snakeHead.x < newCoord.x) { // snake is left of newCoord, no left
      // don't disallow the only remaining valid route
        if (moves.right || moves.up || moves.down) {
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
        if (moves.right || moves.left || moves.down) {
          moves.up = false
        }
      } else if (snakeHead.y < newCoord.y) { // snake is below newCoord, no down
      // don't disallow the only remaining valid route
        if (moves.right || moves.up || moves.left) {
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

    function calculateFoodSearchDepth(me: Battlesnake, board2d: Board2d) : number {
      let depth : number = 2
      if (me.health < 10) { // search for food from farther away if health is lower
        depth = 8
      } else if (me.health < 20) {
        depth = 5
      } else if (me.health < 30) {
        depth = 4
      } else if (me.health < 40) {
        depth = 3
      } else if (me.health < 50) {
        depth = 2
      }

      if (gameState.turn < 20) { // prioritize food slightly more earlier in game
        depth = depth > 4 ? depth : 4
      }

      let kingOfTheSnakes = true
      gameState.board.snakes.forEach(function isSnakeBigger(snake) {
        if (me.length - snake.length < 2) { // if any snake is within 2 lengths of me, I am not fat enough to deprioritize food
          kingOfTheSnakes = false
        }
      })
      if (kingOfTheSnakes) {
        depth = 0 // I don't need it
      }

      return depth
    }

    const foodSearchDepth = calculateFoodSearchDepth(myself, board2d)
    const nearbyFood = findFood(foodSearchDepth, snakeBites, myHead)
    let foodToHunt : Coord[] = []

    for (let i: number = 1; i <= foodSearchDepth; i++) {
      foodToHunt = nearbyFood[i]
      if (foodToHunt && foodToHunt.length > 0) { // the hunt was successful! Don't look any farther
        break
      }
    }

    if (foodToHunt && foodToHunt.length > 0) { // if we've found food nearby, navigate towards one at random
      //console.log("food found within %d of head, navigating towards (%d,%d)", foodSearchDepth, foodToHunt.x, foodToHunt.y)
      navigateTowards(myHead, foodToHunt[getRandomInt(0, foodToHunt.length)], possibleMoves)
    }


    // Finally, choose a move from the available safe moves.
    // TODO: Step 5 - Select a move to make based on strategy, rather than random.
    const safeMoves = possibleMoves.validMoves()
    
    function getCoordAfterMove(coord: Coord, move: string) : Coord {
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
      //console.log("of available moves %s, choosing random move %s", moves.toString(), randomMove)
      return randomMove
    }
    
    function decideMove(moves: string[]) : string {
      if (moves.length < 1) {
        return "up"
      }
      if (moves.length === 1) {
        return moves[0]
      }
      if (myself.length < 15) { // shorter snakes can afford to skirt the edges better
        return getRandomMove(moves)
      } else {
        return moveTowardsCenter(myHead, gameState.board, moves)
      }
    }

    let chosenMove : string = decideMove(safeMoves)
    const response: MoveResponse = { // if no valid moves, go up by default
        move: chosenMove
        //move: safeMoves.length > 0 ? getRandomMove(safeMoves) : "up"
    }
    
    //logCoord(getCoordAfterMove(myHead, chosenMove), "new position")

    // if (coordsEqual(myHead, myTail)) {
    //   console.log("new position (%d,%d) is the same as the old tail position!", myHead.x, myHead.y)
    // }

    //checkTime()

    //snakeHasEaten(myself)

    //console.log(`${gameState.game.id} MOVE ${gameState.turn}: ${response.move}`)
    return response
}
