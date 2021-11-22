import { InfoResponse, GameState, MoveResponse, Game, Coord } from "./types"

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

    var myHead = gameState.you.head
    const myNeck = gameState.you.body[1]
    const boardWidth = gameState.board.width
    const boardHeight = gameState.board.height
    const myBody = gameState.you.body
    const otherSnakes = gameState.board.snakes
    const myTail = myBody[myBody.length - 1]


    //logCoord(myTail, "myTail")
    //console.log("myTail x: %d, y: %d", myTail.x, myTail.y)

    //logCoord(myHead, "myHead")
    //console.log("myHead x: %d, y: %d", myHead.x, myHead.y)

    // Step 0: Don't let your Battlesnake move back on it's own neck
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
      return body.slice(0, body.length)
    }

    getBodyWithoutTail(myBody).forEach(partChecker)

    // TODO: Step 3 - Don't collide with others.
    // Use information in gameState to prevent your Battlesnake from colliding with others.
    otherSnakes.forEach(enemySnake => getBodyWithoutTail(enemySnake.body).forEach(partChecker))

    // TODO: Step 4 - Find food.
    // Use information in gameState to seek out and find food.

    // Finally, choose a move from the available safe moves.
    // TODO: Step 5 - Select a move to make based on strategy, rather than random.
    const safeMoves = Object.keys(possibleMoves).filter(key => possibleMoves[key])
    const response: MoveResponse = { // if no valid moves, go up by default
        move: safeMoves.length > 0 ? safeMoves[Math.floor(Math.random() * safeMoves.length)] : "up"
    }

    // update myHead's position to the new position we will be moving to
    switch (response.move) {
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

    if (coordsEqual(myHead, myTail)) {
      console.log("new position is the same as the old tail position!")
    }

    //console.log(`${gameState.game.id} MOVE ${gameState.turn}: ${response.move}`)
    return response
}
