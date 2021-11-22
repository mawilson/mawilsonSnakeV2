import { InfoResponse, GameState, MoveResponse, Game, Coord, Battlesnake } from "./types"

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

    var myHead: Coord = gameState.you.head
    const myNeck: Coord = gameState.you.body[1]
    const boardWidth: number = gameState.board.width
    const boardHeight: number = gameState.board.height
    const myBody: Coord[] = gameState.you.body
    const otherSnakes: Battlesnake[] = gameState.board.snakes
    const myTail: Coord = myBody[myBody.length - 1]
    const snakeBites = gameState.board.food


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
      console.log("turn: %d. Elapsed time: %d; latency: %d; time left: %d", timeElapsed, _myLatency, timeLeft)
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

    function coordsEqual(c1: Coord, c2: Coord): boolean {
      return (c1.x === c2.x && c1.y === c2.y)
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

    // return true if food array contains the provided coordinate
    function hasFood(coord: Coord, food: Coord[]) : boolean {
      return food.some(foodUnit => foodUnit.x === coord.x && foodUnit.y === coord.y)
    }

    if (hasFood(myTail, snakeBites)) { // if our tail has food on it, we don't want to treat it as a valid tile to enter
      myBody.forEach(partChecker)
    } else {
      getBodyWithoutTail(myBody).forEach(partChecker)
    }

    // TODO: Step 3 - Don't collide with others.
    // Use information in gameState to prevent your Battlesnake from colliding with others.
    otherSnakes.forEach(enemySnake => getBodyWithoutTail(enemySnake.body).forEach(partChecker))

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
    var foodToHunt : Coord | undefined

    for (let i: number = 1; i <= foodSearchDepth; i++) {
      foodToHunt = nearbyFood[i] ? nearbyFood[i].shift(): undefined
      if (foodToHunt) { // the hunt was successful! Don't look any farther
        break
      }
    }

    if (foodToHunt) { // if we've found food nearby, navigate towards it
      //console.log("food found within %d of head, navigating towards (%d,%d)", foodSearchDepth, foodToHunt.x, foodToHunt.y)
      navigateTowards(myHead, foodToHunt)
    }

    // Finally, choose a move from the available safe moves.
    // TODO: Step 5 - Select a move to make based on strategy, rather than random.
    const safeMoves = Object.keys(possibleMoves).filter(key => possibleMoves[key])
    
    function getRandomMove(moves: string[]) : string {
      let randomMove : string = moves[Math.floor(Math.random() * moves.length)]
      //console.log("of available moves %s, choosing random move %s", moves.toString(), randomMove)
      return randomMove
    }
    
    let chosenMove : string = safeMoves.length < 1 ? "up" : safeMoves.length === 1 ? safeMoves[0] : getRandomMove(safeMoves)
    const response: MoveResponse = { // if no valid moves, go up by default
        move: chosenMove
        //move: safeMoves.length > 0 ? safeMoves[Math.floor(Math.random() * safeMoves.length)] : "up"
    }

    // update myHead's position to the new position we will be moving to
    switch (chosenMove) {
      case "up":
        myHead.y = myHead.y + 1
        break;
      case "down":
        myHead.y = myHead.y - 1
        break;
      case "left":
        myHead.x = myHead.x - 1
        break
      default: // case "right":
        myHead.x = myHead.x + 1
        break
    }
    //logCoord(myHead, "new position")

    // if (coordsEqual(myHead, myTail)) {
    //   console.log("new position (%d,%d) is the same as the old tail position!", myHead.x, myHead.y)
    // }

    checkTime()

    //console.log(`${gameState.game.id} MOVE ${gameState.turn}: ${response.move}`)
    return response
}
