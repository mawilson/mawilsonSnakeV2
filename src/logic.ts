import { InfoResponse, GameState, MoveResponse, Game, Coord, Battlesnake, Board, IBoardCell, SnakeCell } from "./types"

class BoardCell implements IBoardCell {
  snakeCell?: SnakeCell;
  food: boolean;
  hazard: boolean;

  constructor(_food: boolean, _hazard: boolean, _snakeCell?: SnakeCell) {
    this.snakeCell = _snakeCell;
    this.food = _food;
    this.hazard = _hazard;
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
      this.cells[idx] = new BoardCell(false, false);
    }
    return this.cells[idx];
  }

  logCell(coord: Coord) : void {
    let cell = this.getCell(coord);
    console.log(`board2d at (${coord.x},${coord.y}) food: ${cell.food}`);
    console.log(`board2d at (${coord.x},${coord.y}) hazard: ${cell.hazard}`);
    console.log(`board2d at (${coord.x},${coord.y}) has snake: ${cell.snakeCell !== undefined}`);
  }

  logBoard() : void {
    for (let i = 0; i < this.width; i++) {
      for (let j = 0; j < this.height; j++) {
        let tempCoord = {x: i, y: j} as Coord;
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
}

// returns true if snake length does not match body length, indicating it ate this turn
function snakeHasEaten(snake: Battlesnake) {
  return snake.length !== snake.body.length
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
        head: "shades",
        tail: "skinny"
    }
    return response
}

export function start(gameState: GameState): void {
    console.log(`${gameState.game.id} START`)
}

export function end(gameState: GameState): void {
    console.log(`${gameState.game.id} END\n`)
}

export function move(gameState: GameState): MoveResponse {
    let possibleMoves: { [key: string]: boolean } = {
        up: true,
        down: true,
        left: true,
        right: true
    }

    const myHead: Coord = gameState.you.head
    const myNeck: Coord = gameState.you.body[1]
    const boardWidth: number = gameState.board.width
    const boardHeight: number = gameState.board.height
    const myBody: Coord[] = gameState.you.body
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

    const board2d = buildBoard2d(gameState.board, gameState.you)

    //let tempCell = {x: 0, y: 0} as Coord
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
    const myLatency = gameState.you.latency
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
    if (myNeck.x < myHead.x) {
        possibleMoves.left = false
    } else if (myNeck.x > myHead.x) {
        possibleMoves.right = false
    } else if (myNeck.y < myHead.y) {
        possibleMoves.down = false
    } else if (myNeck.y > myHead.y) {
        possibleMoves.up = false
    }

    // TODO: Step 1 - Don't hit walls.
    // Use information in gameState to prevent your Battlesnake from moving beyond the boundaries of the board.
    
    if (myHead.x === 0) {
      possibleMoves.left = false
    }
    if (myHead.x === (boardWidth - 1)) {
      possibleMoves.right = false
    }
    if (myHead.y === 0) {
      possibleMoves.down = false
    }
    if (myHead.y === (boardHeight - 1)) {
      possibleMoves.up = false
    }

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

    function partChecker(part: Coord): void {
      if (isAbove(part, myHead)) {
        possibleMoves.up = false
      }
      if (isBelow(part, myHead)) {
        possibleMoves.down = false
      }
      if (isRight(part, myHead)) {
        possibleMoves.right = false
      }
      if (isLeft(part, myHead)) {
        possibleMoves.left = false
      }
    }

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

    function checkForSnakesAndWalls(me: Battlesnake, board: Board2d) {
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
        let newCoord = {x, y} as Coord
        let newCell = board.getCell(newCoord)
        if (newCell.snakeCell) { // if newCell has a snake, we may be able to move into it if it's a tail
          let snakeCell = newCell.snakeCell as SnakeCell // if we've reached here, we know it's not undefined
          if (snakeCell.isTail && !snakeHasEaten(me)) { // if a snake hasn't eaten on this turn, its tail will recede next turn, making it a safe place to move
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
        possibleMoves.left = false
      }
      if (!checkCell(myCoords.x, myCoords.y - 1)) {
        possibleMoves.down = false
      }
      if (!checkCell(myCoords.x + 1, myCoords.y)) {
        possibleMoves.right = false
      }
      if (!checkCell(myCoords.x, myCoords.y + 1)) {
        possibleMoves.up = false
      }
    }

    checkForSnakesAndWalls(gameState.you, board2d)

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
    function navigateTowards(snakeHead : Coord, newCoord: Coord) {
      if (snakeHead.x > newCoord.x) { // snake is right of newCoord, no right
        // don't disallow the only remaining valid route
        if (possibleMoves.left || possibleMoves.up || possibleMoves.down) {
          possibleMoves.right = false
        }
      } else if (snakeHead.x < newCoord.x) { // snake is left of newCoord, no left
      // don't disallow the only remaining valid route
        if (possibleMoves.right || possibleMoves.up || possibleMoves.down) {
          possibleMoves.left = false
        }
      } else { // snake is in same column as newCoord, don't move left or right
        // don't disallow the only remaining valid routes
        if (possibleMoves.up || possibleMoves.down) {
          possibleMoves.right = false
          possibleMoves.left = false
        }
      }
      if (snakeHead.y > newCoord.y) { // snake is above newCoord, no up
      // don't disallow the only remaining valid route
        if (possibleMoves.right || possibleMoves.left || possibleMoves.down) {
          possibleMoves.up = false
        }
      } else if (snakeHead.y < newCoord.y) { // snake is below newCoord, no down
      // don't disallow the only remaining valid route
        if (possibleMoves.right || possibleMoves.up || possibleMoves.left) {
          possibleMoves.down = false
        }
      } else { // snake is in same row as newCoord, don't move up or down
        // don't disallow the only remaining valid routes
        if (possibleMoves.left || possibleMoves.right) {
          possibleMoves.up = false
          possibleMoves.down = false
        }
      }
    }

    const foodSearchDepth = 2
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
      navigateTowards(myHead, foodToHunt[getRandomInt(0, foodToHunt.length)])
    }

    // Finally, choose a move from the available safe moves.
    // TODO: Step 5 - Select a move to make based on strategy, rather than random.
    const safeMoves = Object.keys(possibleMoves).filter(key => possibleMoves[key])
    
    function getCoordAfterMove(coord: Coord, move: string) : Coord {
      let newPosition : Coord = {x: coord.x, y: coord.y} as Coord
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
          midCoord = {x: midX, y: midY} as Coord

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
    
    let chosenMove : string = safeMoves.length < 1 ? "up" : safeMoves.length === 1 ? safeMoves[0] : moveTowardsCenter(myHead, gameState.board, safeMoves)
    const response: MoveResponse = { // if no valid moves, go up by default
        move: chosenMove
        //move: safeMoves.length > 0 ? safeMoves[Math.floor(Math.random() * safeMoves.length)] : "up"
    }
    
    //logCoord(getCoordAfterMove(myHead, chosenMove), "new position")

    // if (coordsEqual(myHead, myTail)) {
    //   console.log("new position (%d,%d) is the same as the old tail position!", myHead.x, myHead.y)
    // }

    //checkTime()

    //console.log(`${gameState.game.id} MOVE ${gameState.turn}: ${response.move}`)
    return response
}
