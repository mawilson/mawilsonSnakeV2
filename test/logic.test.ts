import { info, move } from '../src/logic'
import { GameState, MoveResponse, RulesetSettings } from '../src/types';
import { Battlesnake, Coord, BoardCell, Board2d } from '../src/classes'
import { isKingOfTheSnakes, getLongestSnake, cloneGameState, moveSnake, coordsEqual } from '../src/util'
import { evaluate } from '../src/eval'

// snake diagrams: x is empty, s is body, h is head, t is tail, f is food, z is hazard
// for multi-snake diagrams, a - b - c are body, u - v - w are tail, i - j - k are head
// x f z
// s s z
// h t z

function createRulesetSettings() : RulesetSettings {
  return {
    "foodSpawnChance": 25,
    "minimumFood": 1,
    "hazardDamagePerTurn": 14,
    "royale": {
      "shrinkEveryNTurns": 5
    },
    "squad": {
      "allowBodyCollisions": true,
      "sharedElimination": true,
      "sharedHealth": true,
      "sharedLength": true
    }
  }
}

export function createGameState(me: Battlesnake): GameState {
  return {
      game: {
          id: "totally-unique-game-id",
          ruleset: { name: "standard", version: "v1.2.3", settings: createRulesetSettings() },
          timeout: 500,
          source: "testing"
      },
      turn: 30, // arbitrary
      board: {
          height: 11,
          width: 11,
          food: [],
          snakes: [me],
          hazards: []
      },
      you: me
  }
}

describe('Battlesnake API Version', () => {
    it('should be api version 1', () => {
        const result = info()
        expect(result.apiversion).toBe("1")
    })
})

describe('Battlesnake Moves', () => {
    it('should never move into its own neck', () => {
      // x x x
      // s s x
      // h t x
      const me = new Battlesnake("me", "me", 80, [{ x: 2, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }], "101", "", "")
      const gameState = createGameState(me)

      // Act 1,000x (this isn't a great way to test, but it's okay for starting out)
      for (let i = 0; i < 50; i++) {
          const moveResponse: MoveResponse = move(gameState)
          // In this state, we should NEVER move left.
          const allowedMoves = ["up", "down", "right"]
          expect(allowedMoves).toContain(moveResponse.move)
      }
    })
})

describe('BattleSnake can chase tail', () => {
  it('should be allowed to chase its tail into the space it currently occupies', () => {
    // x x x
    // s s x
    // h t x
    const snek = new Battlesnake("snek", "snek", 50, [{x: 0, y: 0}, {x: 0, y: 1}, {x: 1, y: 1}, {x: 1, y: 0}], "101", "", "") // 50 health means it hasn't just eaten
    //const snek = createBattlesnake("snek", [{x: 0, y: 0}, {x: 0, y: 1}, {x: 1, y: 1}, {x: 1, y: 0}], 50) // 50 health means it hasn't just eaten
    const gameState = createGameState(snek)

    for (let i = 0; i < 50; i++) {
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("right")
    }
  })
})

describe('BattleSnake will not chase tail after eating', () => {
  it('should not chase its tail if it just ate', () => {
    // x x x
    // t x x
    // h x x
    const snek = new Battlesnake("snek", "snek", 100, [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 1}], "101", "", "")
    const gameState = createGameState(snek)

    for (let i = 0; i < 50; i++) {
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("right")
    }
  })
})

describe('Board2d accurately maps game state', () => {
  it('should know where snakes, food, and hazards are', () => {
    // x f z
    // t f z
    // h x z
    const snek = new Battlesnake("snek", "snek", 80, [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 1}], "101", "", "")
    const gameState = createGameState(snek)
    const gameBoard = gameState.board

    gameBoard.food = [{x: 1, y: 1}, {x: 1, y: 2}]
    gameBoard.hazards = [{x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}]

    let board2d = new Board2d(gameBoard)

    snek.body.forEach(function checkBodyPart(part, index, arr) {
      let boardCell = board2d.getCell(part)
      if (boardCell) {
        boardCell = boardCell as BoardCell
        let checkSnek = boardCell.snakeCell
        if (checkSnek) {
          expect(snek.id).toBe(checkSnek.snake.id)
          expect(checkSnek.isHead).toBe(index === 0) // index 0 of the snake body is the head
          expect(checkSnek.isTail).toBe(coordsEqual(part, arr[arr.length - 1])) // it can be a tail if its coordinates equal the coordinates of the last element in the snake body. If the snake has just eaten food, as in this example, this will be both the last & the second-to-last coord in the body.
        }
      }
    })

    gameBoard.food.forEach(function checkFood(coord) {
      let boardCell = board2d.getCell(coord)
      if (boardCell) {
        boardCell = boardCell as BoardCell
        expect(boardCell.food).toBe(true)
      }
    })

    gameBoard.hazards.forEach(function checkHazard(coord) {
      let boardCell = board2d.getCell(coord)
      if (boardCell) {
        boardCell = boardCell as BoardCell
        expect(boardCell.hazard).toBe(true)
      }
    })
  })
})

describe('BattleSnake will not eat a left wall', () => {
  it('should not go left if there is a wall there', () => {
    // x x x
    // h s t
    // x x x
    const snek = new Battlesnake("snek", "snek", 80, [{x: 0, y: 1}, {x: 1, y: 1}, {x: 2, y: 1}], "101", "", "")
    const gameState = createGameState(snek)

    for (let i = 0; i < 50; i++) {
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("left")
    }
  })
})

describe('BattleSnake will not eat a right wall', () => {
  it('should not go right if there is a wall there', () => {
    // x x x
    // t s h
    // x x x
    const snek = new Battlesnake("snek", "snek", 80, [{x: 10, y: 1}, {x: 9, y: 1}, {x: 8, y: 1}], "101", "", "")
    const gameState = createGameState(snek)

    for (let i = 0; i < 50; i++) {
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("right")
    }
  })
})

describe('BattleSnake will not eat an up wall', () => {
  it('should not go up if there is a wall there', () => {
    // x h x
    // x s x
    // x t x
    const snek = new Battlesnake("snek", "snek", 80, [{x: 1, y: 10}, {x: 1, y: 9}, {x: 1, y: 8}], "101", "", "")
    const gameState = createGameState(snek)

    for (let i = 0; i < 50; i++) {
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("up")
    }
  })
})

describe('BattleSnake will not eat a down wall', () => {
  it('should not go down if there is a wall there', () => {
    // x t x
    // x s x
    // x h x
    const snek = new Battlesnake("snek", "snek", 80, [{x: 1, y: 0}, {x: 1, y: 1}, {x: 1, y: 2}], "101", "", "")
    const gameState = createGameState(snek)

    for (let i = 0; i < 50; i++) {
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("down")
    }
  })
})

describe('Battlesnake will not eat its own body', () => {
  it('should not move into its own body, other than the tail', () => {
    // x s s
    // x s h
    // x t x
    const snek = new Battlesnake("snek", "snek", 80, [{x: 2, y: 1}, {x: 2, y: 2}, {x: 1, y: 2}, {x: 1, y: 1}, {x: 1, y: 0}], "101", "", "")
    const gameState = createGameState(snek)

    for (let i = 0; i < 50; i++) {
      let moveResponse: MoveResponse = move(gameState)
      expect(["down", "right"]).toContain(moveResponse.move)
    }
  })
})

describe('Snake should not walk into another snake body', () => {
  it('should go somewhere that does not have a snake body', () => {
    // x x  x
    // s h  x
    // s s1 h1
    // t s1 t1
    const snek = new Battlesnake("snek", "snek", 80, [{x: 1, y: 2}, {x: 0, y: 2}, {x: 0, y: 1}, {x: 0, y: 0}], "101", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 2, y: 1}, {x: 1, y: 1}, {x: 1, y: 0}, {x: 2, y: 0}], "101", "", "")
    gameState.board.snakes.push(otherSnek)

    for (let i = 0; i < 50; i++) {
      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("down")
    }
  })
})

describe('Battlesnake knows if it is king snake', () => {
  it('should know if it is at least two longer than any other snake', () => {
    const snek = new Battlesnake("snek", "snek", 80, [{x: 0, y: 0}, {x: 1, y: 0}, {x: 2, y: 0}, {x: 3, y: 0}], "101", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 0, y: 2}, {x: 1, y: 2}], "101", "", "")
    gameState.board.snakes.push(otherSnek)

    const kingOfSnakes = isKingOfTheSnakes(snek, gameState.board)
    expect(kingOfSnakes).toBe(true)
  })
})

describe('Longest snake function tester', () => {
  it('should return the longest, closest snake other than itself', () => {
    const snek = new Battlesnake("snek", "snek", 80, [{x: 0, y: 0}, {x: 1, y: 0}, {x: 2, y: 0}, {x: 3, y: 0}], "101", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 0, y: 2}, {x: 1, y: 2}, {x: 1, y: 2}], "101", "", "")
    gameState.board.snakes.push(otherSnek)

    const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 80, [{x: 5, y: 2}, {x: 5, y: 2}, {x: 5, y: 2}], "101", "", "")
    gameState.board.snakes.push(otherSnek2)

    const longestSnake = getLongestSnake(snek, gameState.board.snakes)
    expect(longestSnake.id).toBe("otherSnek") // otherSnek is closer to snek, both otherSnek and otherSnek2 are length 2
  })
})

describe('Snake should go towards uncertain doom versus certain doom', () => {
  it('should navigate towards a kiss that might happen instead of a kiss that ought to happen', () => {
    // s1 t1 x h2 s2 s2 s2 t2
    // s1 x  h s  x  x  x  x
    // s1 h1 x s  x  x  x  x
    // x  x  x t  x  x  x  x
    const snek = new Battlesnake("snek", "snek", 80, [{x: 2, y: 4}, {x: 3, y: 4}, {x: 3, y: 3}, {x: 3, y: 2}], "101", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 1, y: 3}, {x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5}, {x: 1, y: 5}], "101", "", "")
    gameState.board.snakes.push(otherSnek)

    const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 80, [{x: 3, y: 5}, {x: 4, y: 5}, {x: 5, y: 5}, {x: 6, y: 5}, {x: 7, y: 5}], "101", "", "")
    gameState.board.snakes.push(otherSnek2)

    for (let i = 0; i < 50; i++) {
      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("up") // up is certain death to otherSnek2, but left or down are 50% death to otherSnek
    }
  })
})

describe('Snake should avoid two kisses of death for one not', () => {
  it('should navigate away from kiss of death cells towards freedom', () => {
    // x  x  x x x x  x
    // s1 s1 x x x s2 s2
    // s1 h1 x h x h2 s2
    // t1 x  t s x x  t2
    const snek = new Battlesnake("snek", "snek", 80, [{x: 3, y: 3}, {x: 3, y: 2}, {x: 2, y: 2}], "101", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 1, y: 3}, {x: 1, y: 4}, {x: 0, y: 4}, {x: 0, y: 3}, {x: 0, y: 2}], "101", "", "")
    gameState.board.snakes.push(otherSnek)

    const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 80, [{x: 5, y: 3}, {x: 5, y: 4}, {x: 6, y: 4}, {x: 6, y: 3}, {x: 6, y: 2}], "101", "", "")
    gameState.board.snakes.push(otherSnek2)

    for (let i = 0; i < 50; i++) {
      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // left & right should result in death kisses, leaving only up
    }
  })
})

describe('Snake should avoid a kiss of death', () => {
  it('should navigate elsewhere, even an otherwise worse tile', () => {
    // x x h1 s1 s1
    // x h s  x  s1
    // x x s  t  t1
    const snek = new Battlesnake("snek", "snek", 80, [{x: 1, y: 1}, {x: 2, y: 1}, {x: 2, y: 0}, {x: 3, y: 0}], "101", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 4, y: 2}, {x: 4, y: 1}, {x: 4, y: 0}], "101", "", "")
    gameState.board.snakes.push(otherSnek)

    for (let i = 0; i < 50; i++) {
      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("up") // left & bottom shove me in a corner, but don't result in a kiss of death
    }
  })
})

describe('Snake should avoid a tie kiss of death', () => {
  it('should navigate elsewhere, even an otherwise worse tile', () => {
    // x x h1 s1 s1
    // x h s  x  t1
    // x x s  t  x
    const snek = new Battlesnake("snek", "snek", 80, [{x: 1, y: 1}, {x: 2, y: 1}, {x: 2, y: 0}, {x: 3, y: 0}], "101", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 4, y: 2}, {x: 4, y: 1}], "101", "", "")
    gameState.board.snakes.push(otherSnek)

    for (let i = 0; i < 50; i++) {
      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("up") // a tie kiss is still a death kiss, don't risk it given better alternatives
    }
  })
})

// this one might get commented out later when eval functions exist
describe('Snake should seek out a kiss of murder', () => {
  it('should attempt to eat another snake given the opportunity', () => {
    // t  s  s
    // t1 x  h
    // s1 h1 x
    // x  x  x
    const snek = new Battlesnake("snek", "snek", 80, [{x: 2, y: 2}, {x: 2, y: 3}, {x: 1, y: 3}, {x: 0, y: 3}], "101", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 1, y: 1}, {x: 0, y: 1}, {x: 0, y: 2}], "101", "", "")
    gameState.board.snakes.push(otherSnek)

    for (let i = 0; i < 50; i++) {
      let moveResponse : MoveResponse = move(gameState)
      expect(["down", "left"]).toContain(moveResponse.move) // should try to murder the snake by going either left or down
    }
  })
})

describe('King snake should seek out next longest snake', () => {
  it('should attempt to eat another snake given the opportunity', () => {
    // x  x  x t2 s2 s2 x
    // x  x  x x x  h2 x
    // x  x  h s x  x x
    // x  x  x s s  s t
    // t1 h1 x x x  x x
    const snek = new Battlesnake("snek", "snek", 80, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}, {x: 4, y: 1}, {x: 5, y: 1}, {x: 6, y: 1}], "101", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 1, y: 0}, {x: 0, y: 0}, {x: 0, y: 0}], "101", "", "")
    gameState.board.snakes.push(otherSnek)

    const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 80, [{x: 5, y: 3}, {x: 5, y: 4}, {x: 4, y: 4}, {x: 3, y: 4}], "101", "", "")
    gameState.board.snakes.push(otherSnek2)

    for (let i = 0; i < 50; i++) {
      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // otherSnek is closer, but otherSnek2 is longer, & so we chase it by going up
    }
  })
})

describe('Snake should not attempt to murder in a square that will likely immediately get it killed', () => {
  // x x x x x x x b b b x
  // x x x t s x x b x u x
  // x x x x s s b b x x x
  // x x x x x s b x x x x
  // x x x x x s b x x x x
  // x x x x s s b i x x x
  // x x x x h x c c c c c
  // x x x x x j c x x x c
  // x x x x x x x x x x c
  it('prioritizes kill moves in safer tiles', () => {
    const snek = new Battlesnake("snek", "snek", 80, [{x: 4, y: 4}, {x: 4, y: 5}, {x: 5, y: 5}, {x: 5, y: 6}, {x: 5, y: 7}, {x: 5, y: 8}, {x: 4, y: 8}, {x: 4, y: 9}, {x: 3, y: 9}], "101", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 7, y: 5}, {x: 6, y: 5}, {x: 6, y: 6}, {x: 6, y: 7}, {x: 6, y: 8}, {x: 7, y: 8}, {x: 7, y: 9}, {x: 7, y: 10}, {x: 8, y: 10}, {x: 9, y: 10}, {x: 9, y: 9}], "101", "", "")
    gameState.board.snakes.push(otherSnek)

    const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 90, [{x: 5, y: 3}, {x: 6, y: 3}, {x: 6, y: 4}, {x: 7, y: 4}, {x: 8, y: 4}, {x: 9, y: 4}, {x: 10, y: 4}, {x: 10, y: 3}, {x: 10, y: 2}], "101", "", "")
    gameState.board.snakes.push(otherSnek2)

    for (let i = 0; i < 50; i++) {
      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("down") // snek can eat otherSnek2 at right or down, but going right will result in certain death unless otherSnek2 stupidly goes up
    }
  })
})

describe('Snake should try to murder another snake of equivalent length if it has just eaten', () => {
  // x x x x x x x x x x x
  // x x x t s x x x x x x
  // x x x x s s x x x x x
  // x x x x x s x x x x x
  // x x x x x s x x x x x
  // x x x x s s x x x x x
  // x x x x h x c c c c c
  // x x x x x j c x x x c
  // x x x x x x x x x x c
  it('will murder after it has grown one length', () => {
    const snek = new Battlesnake("snek", "snek", 100, [{x: 4, y: 4}, {x: 4, y: 5}, {x: 5, y: 5}, {x: 5, y: 6}, {x: 5, y: 7}, {x: 5, y: 8}, {x: 4, y: 8}, {x: 4, y: 9}, {x: 3, y: 9}, {x: 3, y: 9}], "101", "", "")
    const gameState = createGameState(snek)

    const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 90, [{x: 5, y: 3}, {x: 6, y: 3}, {x: 6, y: 4}, {x: 7, y: 4}, {x: 8, y: 4}, {x: 9, y: 4}, {x: 10, y: 4}, {x: 10, y: 3}, {x: 10, y: 2}], "101", "", "")
    gameState.board.snakes.push(otherSnek2)

    for (let i = 0; i < 50; i++) {
      let moveResponse : MoveResponse = move(gameState)
      let allowedMoves : string[] = ["right", "down"]
      expect(allowedMoves).toContain(moveResponse.move) // snek can eat otherSnek2 at right or down, but going right will result in certain death unless otherSnek2 stupidly goes up
    }
  })
})

describe('Snake should not try to murder another snake of one less length if that snake has just eaten', () => {
  // x x x x x x x x x x x
  // x x x t s x x x x x x
  // x x x x s s x x x x x
  // x x x x x s x x x x x
  // x x x x x s x x x x x
  // x x x x s s x x x x x
  // x x x x h x c c c c c
  // x x x x x j c x x x c
  // x x x x x x x x x x x
  it('will equal the other snake length after the other snake grows', () => {
    const snek = new Battlesnake("snek", "snek", 90, [{x: 4, y: 4}, {x: 4, y: 5}, {x: 5, y: 5}, {x: 5, y: 6}, {x: 5, y: 7}, {x: 5, y: 8}, {x: 4, y: 8}, {x: 4, y: 9}, {x: 3, y: 9}], "101", "", "")
    const gameState = createGameState(snek)

    const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 100, [{x: 5, y: 3}, {x: 6, y: 3}, {x: 6, y: 4}, {x: 7, y: 4}, {x: 8, y: 4}, {x: 9, y: 4}, {x: 10, y: 4}, {x: 10, y: 3}, {x: 10, y: 3}], "101", "", "")
    gameState.board.snakes.push(otherSnek2)

    for (let i = 0; i < 50; i++) {
      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("left") // snek should avoid otherSnek2 as they are effectively the same length now that otherSnek2 has eaten
    }
  })
})

describe('Snake should not try to eat a snake of identical length if it just ate', () => {
  // x x x x x x x x x x x
  // x x x x x x x x x x x
  // x x x x x x x x x x x
  // x x x x x x x x x x x
  // x x x x x x x x x x x
  // x x x x x x x x x x x
  // x x x x x x x x x x x
  // x x x x x x x x x x x
  // x x x x x x x x x x x
  it('will go up or right to avoid a chicken situation', () => {
    const snek = new Battlesnake("snek", "snek", 100, [{x: 5, y: 9}, {x: 5, y: 8}, {x: 5, y: 7}, {x: 4, y: 7}, {x: 4, y: 6}, {x: 4, y: 5}, {x: 4, y: 4}, {x: 4, y: 3}, {x: 4, y: 2}, {x: 5, y: 2}, {x: 6, y: 2}, {x: 6, y: 3}, {x: 6, y: 4}, {x: 7, y: 4}, {x: 7, y: 5}, {x: 7, y: 5}], "101", "", "")
    const gameState = createGameState(snek)

    const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 90, [{x: 4, y: 8}, {x: 3, y: 8}, {x: 3, y: 7}, {x: 3, y: 6}, {x: 3, y: 5}, {x: 3, y: 4}, {x: 3, y: 3}, {x: 3, y: 2}, {x: 2, y: 2}, {x: 1, y: 2}, {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5}, {x: 1, y: 5}, {x: 1, y: 6}], "101", "", "")
    gameState.board.snakes.push(otherSnek2)

    for (let i = 0; i < 50; i++) {
      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("left")
    }
  })
})

describe('Cloned game state should not have any references left to original game state', () => {
  it('should contain identical values which can be changed without changing the original', () => {
    const snek = new Battlesnake("snek", "snek", 90, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}, {x: 4, y: 1}, {x: 5, y: 1}], "101", "", "")
    const gameState = createGameState(snek)

    gameState.board.food = [{x: 5, y: 5}, {x: 6, y: 6}]

    gameState.board.hazards = [{x:0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5}, {x: 0, y: 6}, {x: 0, y: 7}, {x: 0, y: 8}, {x: 0, y: 9}, {x: 0, y: 10}]

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 100, [{x: 9, y: 5}, {x: 10, y: 5}, {x: 10, y: 4}, {x: 9, y: 4}, {x: 8, y: 4}, {x: 8, y: 4}], "101", "", "")
    gameState.board.snakes.push(otherSnek)

    const clone = cloneGameState(gameState)
    // modify clone gameState values, check if originals were affected
    clone.turn = 40

    expect(gameState.turn).toBe(30)
    // modify clone game values, check if originals were affected
    clone.game.id = "cloneGameId"
    clone.game.source = "cloneSource"
    clone.game.timeout = 1000

    expect(gameState.game.id).toBe("totally-unique-game-id")
    expect(gameState.game.source).toBe("testing")
    expect(gameState.game.timeout).toBe(500)
    // modify clone game ruleset, check if originals were affected
    clone.game.ruleset.version = "cloneRulesetVersion"
    clone.game.ruleset.name = "cloneRulesetName"

    expect(gameState.game.ruleset.name).toBe("standard")
    expect(gameState.game.ruleset.version).toBe("v1.2.3")
    // modify clone game ruleset settings, check if originals were affected
    clone.game.ruleset.settings.foodSpawnChance = 5
    clone.game.ruleset.settings.minimumFood = 5
    clone.game.ruleset.settings.hazardDamagePerTurn = 5
    clone.game.ruleset.settings.royale.shrinkEveryNTurns = 5
    clone.game.ruleset.settings.squad.allowBodyCollisions = false
    clone.game.ruleset.settings.squad.sharedElimination = false
    clone.game.ruleset.settings.squad.sharedLength = false
    clone.game.ruleset.settings.squad.sharedHealth = false

    expect(gameState.game.ruleset.settings.foodSpawnChance).toBe(25)
    expect(gameState.game.ruleset.settings.minimumFood).toBe(1)
    expect(gameState.game.ruleset.settings.hazardDamagePerTurn).toBe(14)
    expect(gameState.game.ruleset.settings.royale.shrinkEveryNTurns).toBe(5)
    expect(gameState.game.ruleset.settings.squad.allowBodyCollisions).toBe(true)
    expect(gameState.game.ruleset.settings.squad.sharedElimination).toBe(true)
    expect(gameState.game.ruleset.settings.squad.sharedLength).toBe(true)
    expect(gameState.game.ruleset.settings.squad.sharedHealth).toBe(true)
    // modify clone game board, check if originals were affected
    clone.board.height = 15
    clone.board.width = 15

    expect(gameState.board.height).toBe(11)
    expect(gameState.board.width).toBe(11)
    // modify clone game food, check if original food was affected
    clone.board.food[0].x = 7
    clone.board.food[1].y = 7

    expect(gameState.board.food[0].x).toBe(5)
    expect(gameState.board.food[1].y).toBe(6)

    // reassign clone game food, check if original food was affected
    clone.board.food = [{x: 0, y: 0}, {x: 10, y: 10}, {x: 6, y: 0}]

    expect(gameState.board.food.length).toBe(2)
    expect(gameState.board.food[0].y).toBe(5)
    expect(gameState.board.food[1].x).toBe(6)

    // modify clone game hazard, check if original hazard was affected
    clone.board.hazards[0].x = 9
    clone.board.hazards[1].y = 9

    expect(gameState.board.hazards[0].x).toBe(0)
    expect(gameState.board.hazards[1].y).toBe(1)

    // reassign clone game hazard, check if original hazard was affected
    clone.board.hazards = [{x: 7, y: 7}, {x: 6, y: 7}, {x: 5, y: 7}]

    expect(gameState.board.hazards.length).toBe(11)
    expect(gameState.board.hazards[0].y).toBe(0)
    expect(gameState.board.hazards[1].x).toBe(0)

    // modify clone game snakes, check if original snakes were affected
    clone.board.snakes[0].name = "cloneSnek0"
    clone.board.snakes[0].latency = "50"
    clone.board.snakes[1].body.push({x: 8, y: 3})
    clone.board.snakes[1].squad = "cloneSquid"

    expect(gameState.board.snakes[0].name).toBe("snek")
    expect(gameState.board.snakes[0].latency).toBe("101")
    expect(gameState.board.snakes[1].body.length).toBe(6)
    expect(gameState.board.snakes[1].squad).toBe("")

    // reassign clone game snakes, check if original snakes were affected
    const cloneSnek1 = new Battlesnake("cloneSnek1", "cloneSnek1", 50, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}, {x: 4, y: 1}, {x: 5, y: 1}], "50", "clone1Shout", "cloneSquad")
    const cloneSnek2 = new Battlesnake("cloneSnek2", "cloneSnek2", 50, [{x: 4, y: 6}, {x: 5, y: 6}, {x: 5, y: 7}], "50", "clone2Shout", "cloneSquad")
    const cloneSnek3 = new Battlesnake("cloneSnek2", "cloneSnek2", 50, [{x: 10, y: 8}, {x: 9, y: 8}], "50", "clone3Shout", "cloneSquad")

    clone.board.snakes = [cloneSnek1, cloneSnek2, cloneSnek3]
    expect(gameState.board.snakes.length).toBe(2)
    expect(gameState.board.snakes[0].id).toBe("snek")
    expect(gameState.board.snakes[0].health).toBe(90)
    expect(gameState.board.snakes[1].shout).toBe("")
    expect(gameState.board.snakes[1].body[2].x).toBe(10)

    // modify clone youSnake, check if original youSnake was affected
    clone.you.id = "cloneSnekYou"

    expect (gameState.you.id).toBe("snek")

    // reassign clone youSnake, check if original youSnake was affected
    clone.you = cloneSnek1

    expect (gameState.you.name).toBe("snek")
  })
})

describe('Cloned game state should be identical to source game state', () => {
  it('should have the same snakes, rulesets, etc', () => {
    const snek = new Battlesnake("snek", "snek", 90, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}, {x: 4, y: 1}, {x: 5, y: 1}], "101", "", "")
    const gameState = createGameState(snek)

    gameState.board.food = [{x: 5, y: 5}, {x: 6, y: 6}]

    gameState.board.hazards = [{x:0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5}, {x: 0, y: 6}, {x: 0, y: 7}, {x: 0, y: 8}, {x: 0, y: 9}, {x: 0, y: 10}]

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 100, [{x: 9, y: 5}, {x: 10, y: 5}, {x: 10, y: 4}, {x: 9, y: 4}, {x: 8, y: 4}, {x: 8, y: 4}], "101", "", "")
    gameState.board.snakes.push(otherSnek)

    const clone = cloneGameState(gameState)

    expect(clone.turn).toBe(30)

    expect(clone.game.id).toBe("totally-unique-game-id")
    expect(clone.game.source).toBe("testing")
    expect(clone.game.timeout).toBe(500)

    expect(clone.game.ruleset.name).toBe("standard")
    expect(clone.game.ruleset.version).toBe("v1.2.3")

    expect(clone.game.ruleset.settings.foodSpawnChance).toBe(25)
    expect(clone.game.ruleset.settings.minimumFood).toBe(1)
    expect(clone.game.ruleset.settings.hazardDamagePerTurn).toBe(14)
    expect(clone.game.ruleset.settings.royale.shrinkEveryNTurns).toBe(5)
    expect(clone.game.ruleset.settings.squad.allowBodyCollisions).toBe(true)
    expect(clone.game.ruleset.settings.squad.sharedElimination).toBe(true)
    expect(clone.game.ruleset.settings.squad.sharedLength).toBe(true)
    expect(clone.game.ruleset.settings.squad.sharedHealth).toBe(true)

    expect(clone.board.height).toBe(11)
    expect(clone.board.width).toBe(11)

    expect(clone.board.food[0].x).toBe(5)
    expect(clone.board.food[1].y).toBe(6)

    expect(clone.board.food.length).toBe(2)
    expect(clone.board.food[0].y).toBe(5)
    expect(clone.board.food[1].x).toBe(6)

    expect(gameState.board.hazards[0].x).toBe(0)
    expect(gameState.board.hazards[1].y).toBe(1)

    expect(gameState.board.hazards.length).toBe(11)
    expect(gameState.board.hazards[0].y).toBe(0)
    expect(gameState.board.hazards[1].x).toBe(0)

    expect(clone.board.snakes[0].name).toBe("snek")
    expect(clone.board.snakes[0].latency).toBe("101")
    expect(clone.board.snakes[1].body.length).toBe(6)
    expect(clone.board.snakes[1].squad).toBe("")

    expect(clone.board.snakes.length).toBe(2)
    expect(clone.board.snakes[0].id).toBe("snek")
    expect(clone.board.snakes[0].health).toBe(90)
    expect(clone.board.snakes[1].shout).toBe("")
    expect(clone.board.snakes[1].body[2].x).toBe(10)
    expect(clone.board.snakes[1].length).toBe(6)

    expect (clone.you.name).toBe("snek")
  })
})

describe('Moving a snake results in changes to body, head, health', () => {
  it('should have correct body and health after moving', () => {
    const snek = new Battlesnake("snek", "snek", 80, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}, {x: 4, y: 1}, {x: 5, y: 1}], "101", "", "")
    const gameState = createGameState(snek)

    gameState.board.food = [{x: 5, y: 5}, {x: 6, y: 6}]

    gameState.board.hazards = [{x:0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5}, {x: 0, y: 6}, {x: 0, y: 7}, {x: 0, y: 8}, {x: 0, y: 9}, {x: 0, y: 10}]

    const board2d = new Board2d(gameState.board)

    const moveResult = moveSnake(gameState, snek, board2d, "up")
    expect(moveResult).toBe(true)

    expect(snek.length).toBe(5) // length shouldn't have changed
    expect(snek.health).toBe(79) // health should be one less
    expect(snek.head.x).toBe(2)
    expect(snek.head.y).toBe(3)
    expect(snek.body[0].x).toBe(snek.head.x)
    expect(snek.body[0].y).toBe(snek.head.y)
    expect(snek.body[1].x).toBe(2)
    expect(snek.body[1].y).toBe(2)
    expect(snek.body[2].x).toBe(3)
    expect(snek.body[2].y).toBe(2)
    expect(snek.body[3].x).toBe(3)
    expect(snek.body[3].y).toBe(1)
    expect(snek.body[4].x).toBe(4)
    expect(snek.body[4].y).toBe(1)
  })
})

describe('Moving a snake into hazard results in changes to body, head, health', () => {
  it('should have correct body and health after moving into hazard', () => {
    const snek = new Battlesnake("snek", "snek", 80, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}, {x: 4, y: 1}, {x: 5, y: 1}], "101", "", "")
    const gameState = createGameState(snek)

    gameState.board.food = [{x: 5, y: 5}, {x: 6, y: 6}]

    gameState.board.hazards = [{x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4}, {x: 2, y: 5}, {x: 2, y: 6}, {x: 2, y: 7}, {x: 2, y: 8}, {x: 2, y: 9}, {x: 2, y: 10}]

    const board2d = new Board2d(gameState.board)

    const moveResult = moveSnake(gameState, snek, board2d, "up")
    expect(moveResult).toBe(true)

    expect(snek.length).toBe(5) // length shouldn't have changed
    expect(snek.health).toBe(80 - 1 - gameState.game.ruleset.settings.hazardDamagePerTurn) // health should be one less, and also hazardDamagePerTurn less
    expect(snek.head.x).toBe(2)
    expect(snek.head.y).toBe(3)
    expect(snek.body[0].x).toBe(snek.head.x)
    expect(snek.body[0].y).toBe(snek.head.y)
    expect(snek.body[1].x).toBe(2)
    expect(snek.body[1].y).toBe(2)
    expect(snek.body[2].x).toBe(3)
    expect(snek.body[2].y).toBe(2)
    expect(snek.body[3].x).toBe(3)
    expect(snek.body[3].y).toBe(1)
    expect(snek.body[4].x).toBe(4)
    expect(snek.body[4].y).toBe(1)
  })
})

describe('Moving a snake into food results in changes to body, head, health', () => {
  it('should have correct body and health after moving into food', () => {
    const snek = new Battlesnake("snek", "snek", 80, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}, {x: 4, y: 1}, {x: 5, y: 1}], "101", "", "")
    const gameState = createGameState(snek)

    gameState.board.food = [{x: 2, y: 3}, {x: 6, y: 6}]

    gameState.board.hazards = [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5}, {x: 0, y: 6}, {x: 0, y: 7}, {x: 0, y: 8}, {x: 0, y: 9}, {x: 0, y: 10}]

    const board2d = new Board2d(gameState.board)

    const moveResult = moveSnake(gameState, snek, board2d, "up")
    expect(moveResult).toBe(true)

    expect(snek.length).toBe(5) // length shouldn't have changed
    expect(snek.health).toBe(100) // health should be maximum of 100
    expect(snek.head.x).toBe(2)
    expect(snek.head.y).toBe(3)
    expect(snek.body[0].x).toBe(snek.head.x)
    expect(snek.body[0].y).toBe(snek.head.y)
    expect(snek.body[1].x).toBe(2)
    expect(snek.body[1].y).toBe(2)
    expect(snek.body[2].x).toBe(3)
    expect(snek.body[2].y).toBe(2)
    expect(snek.body[3].x).toBe(3)
    expect(snek.body[3].y).toBe(1)
    expect(snek.body[4].x).toBe(4)
    expect(snek.body[4].y).toBe(1)
    // expect(snek.body[5].x).toBe(5) // tail doesn't grow until next turn
    // expect(snek.body[5].y).toBe(1)
  })
})

describe('Moving a snake from food results in changes to body, head, health', () => {
  it('should have correct body and health after moving from food', () => {
    const snek = new Battlesnake("snek", "snek", 100, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}, {x: 4, y: 1}, {x: 5, y: 1}, {x: 5, y: 1}], "101", "", "")
    const gameState = createGameState(snek)

    gameState.board.food = [{x: 5, y: 5}, {x: 6, y: 6}]

    gameState.board.hazards = [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5}, {x: 0, y: 6}, {x: 0, y: 7}, {x: 0, y: 8}, {x: 0, y: 9}, {x: 0, y: 10}]

    const board2d = new Board2d(gameState.board)

    const moveResult = moveSnake(gameState, snek, board2d, "up")
    expect(moveResult).toBe(true)

    expect(snek.length).toBe(6)
    expect(snek.health).toBe(99)
    expect(snek.head.x).toBe(2)
    expect(snek.head.y).toBe(3)
    expect(snek.body[0].x).toBe(snek.head.x)
    expect(snek.body[0].y).toBe(snek.head.y)
    expect(snek.body[1].x).toBe(2)
    expect(snek.body[1].y).toBe(2)
    expect(snek.body[2].x).toBe(3)
    expect(snek.body[2].y).toBe(2)
    expect(snek.body[3].x).toBe(3)
    expect(snek.body[3].y).toBe(1)
    expect(snek.body[4].x).toBe(4)
    expect(snek.body[4].y).toBe(1)
    expect(snek.body[5].x).toBe(5)
    expect(snek.body[5].y).toBe(1)
  })
})

//// evaluate tests ////////

describe('Evaluate a doomed snake and an undoomed snake', () => {
    it('should rank the undoomed move higher', () => {
        const snek = new Battlesnake("snek", "snek", 50, [{x: 0, y: 1}, {x: 1, y: 1}, {x: 1, y: 0}, {x: 2, y: 0}], "101", "", "")
        
        const gameState = createGameState(snek)

        const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 0, y: 0}, {x: 0, y: 0}, {x: 0, y: 0}], "101", "", "")
        gameState.board.snakes.push(otherSnek)
        
        let evalSnek = evaluate(gameState, snek, "kissOfDeathNo", "kissOfMurderNo")
        let evalOtherSnek = evaluate(gameState, otherSnek, "kissOfDeathNo", "kissOfMurderNo")

        expect(evalSnek).toBeGreaterThan(evalOtherSnek)
    })
})

///// end evaluate tests ///////


// test cases for evaluation function - can include basic stuff as well as more convoluted test cases, can even include specific board configurations from games lost where I picked out a better move
// test cases for Move output in specific board configurations where I have a preferred move - can even include specific board configurations from games lost where I picked out a better move
// hazard testing
// food seekout testing
// kiss of death selector - chooses kiss of death cell with higher evaluation score
// kiss of death selector - given a choice between death the next turn (0 possible moves) & kissOfDeathCertainty, choose kissOfDeathCertainty
// add test for getting food when next to it, even when lots of food is further away in another direction