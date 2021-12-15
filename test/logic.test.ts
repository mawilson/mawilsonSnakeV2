import { info, move } from '../src/logic'
import { GameState, MoveResponse, RulesetSettings } from '../src/types';
import { Battlesnake, Coord, BoardCell, Board2d } from '../src/classes'
import { isKingOfTheSnakes, getLongestSnake, cloneGameState, moveSnake, coordsEqual, createHazardRow, createHazardColumn, isInOrAdjacentToHazard, updateGameStateAfterMove, snakeToString } from '../src/util'
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
      // Act 1,000x (this isn't a great way to test, but it's okay for starting out)
      for (let i = 0; i < 50; i++) {
        const me = new Battlesnake("me", "me", 80, [{ x: 2, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }], "101", "", "")
        const gameState = createGameState(me)
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
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 0, y: 0}, {x: 0, y: 1}, {x: 1, y: 1}, {x: 1, y: 0}], "101", "", "") // 50 health means it hasn't just eaten
      const gameState = createGameState(snek)
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
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 100, [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 1}], "101", "", "")
      const gameState = createGameState(snek)
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("right")
    }
  })
})

describe('BattleSnake chooses death by snake over death by wall or hazard', () => {
  it('always chooses a snake body over a border death given no other valid moves', () => {
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 5, y: 10}, {x: 6, y: 10}, {x: 7, y: 10}, {x: 7, y: 9}, {x: 7, y: 8}], "101", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 50, [{x: 6, y: 9}, {x: 5, y: 9}, {x: 4, y: 9}, {x: 4, y: 10}, {x: 3, y: 10}, {x: 2, y: 10}, {x: 2, y: 9}, {x: 1, y: 9}], "101", "", "")
      gameState.board.snakes.push(otherSnek)
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("up")
    }
  })
  it('always chooses a snake body over a hazard death or wall given no other valid moves', () => {
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 10, [{x: 5, y: 10}, {x: 6, y: 10}, {x: 7, y: 10}, {x: 7, y: 9}, {x: 7, y: 8}], "101", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 50, [{x: 6, y: 9}, {x: 5, y: 9}, {x: 4, y: 9}, {x: 3, y: 9}, {x: 2, y: 9}], "101", "", "")
      gameState.board.snakes.push(otherSnek)

      createHazardRow(gameState.board, 10)
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("down") // there is no scenario where I live walking into hazard left, even though it is open space. Try the snake cell instead
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
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 0, y: 1}, {x: 1, y: 1}, {x: 2, y: 1}], "101", "", "")
      const gameState = createGameState(snek)
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
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 10, y: 1}, {x: 9, y: 1}, {x: 8, y: 1}], "101", "", "")
      const gameState = createGameState(snek)
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
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 1, y: 10}, {x: 1, y: 9}, {x: 1, y: 8}], "101", "", "")
      const gameState = createGameState(snek)
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
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 1, y: 0}, {x: 1, y: 1}, {x: 1, y: 2}], "101", "", "")
      const gameState = createGameState(snek)
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
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 2, y: 1}, {x: 2, y: 2}, {x: 1, y: 2}, {x: 1, y: 1}, {x: 1, y: 0}], "101", "", "")
      const gameState = createGameState(snek)
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
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 1, y: 2}, {x: 0, y: 2}, {x: 0, y: 1}, {x: 0, y: 0}], "101", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 2, y: 1}, {x: 1, y: 1}, {x: 1, y: 0}, {x: 2, y: 0}], "101", "", "")
      gameState.board.snakes.push(otherSnek)
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
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 2, y: 4}, {x: 3, y: 4}, {x: 3, y: 3}, {x: 3, y: 2}], "101", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 1, y: 3}, {x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5}, {x: 1, y: 5}], "101", "", "")
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 80, [{x: 3, y: 5}, {x: 4, y: 5}, {x: 5, y: 5}, {x: 6, y: 5}, {x: 7, y: 5}], "101", "", "")
      gameState.board.snakes.push(otherSnek2)
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
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 3, y: 3}, {x: 3, y: 2}, {x: 2, y: 2}], "101", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 1, y: 3}, {x: 1, y: 4}, {x: 0, y: 4}, {x: 0, y: 3}, {x: 0, y: 2}], "101", "", "")
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 80, [{x: 5, y: 3}, {x: 5, y: 4}, {x: 6, y: 4}, {x: 6, y: 3}, {x: 6, y: 2}], "101", "", "")
      gameState.board.snakes.push(otherSnek2)
      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // left & right should result in death kisses, leaving up
    }
  })
})

describe('Snake should avoid a kiss of death', () => {
  it('should navigate elsewhere, even an otherwise worse tile', () => {
    // x x h1 s1 s1
    // x h s  x  s1
    // x x s  t  t1
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 1, y: 1}, {x: 2, y: 1}, {x: 2, y: 0}, {x: 3, y: 0}], "101", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 4, y: 2}, {x: 4, y: 1}, {x: 4, y: 0}], "101", "", "")
      gameState.board.snakes.push(otherSnek)
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
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 1, y: 1}, {x: 2, y: 1}, {x: 2, y: 0}, {x: 3, y: 0}], "101", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 4, y: 2}, {x: 4, y: 1}], "101", "", "")
      gameState.board.snakes.push(otherSnek)
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
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 2, y: 2}, {x: 2, y: 3}, {x: 1, y: 3}, {x: 0, y: 3}], "101", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 1, y: 1}, {x: 0, y: 1}, {x: 0, y: 2}], "101", "", "")
      gameState.board.snakes.push(otherSnek)
      let moveResponse : MoveResponse = move(gameState)
      expect(["down", "left"]).toContain(moveResponse.move) // should try to murder the snake by going either left or down
    }
  })
})

describe('Snake should seek out a kiss of murder in the borderlands', () => {
  it('seeks out murder even on the outskirts of town', () => {
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 9, y: 9}, {x: 8, y: 9}, {x: 7, y: 9}, {x: 7, y: 8}, {x: 6, y: 8}, {x: 6, y: 7}], "101", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 8, y: 10}, {x: 7, y: 10}, {x: 6, y: 10}, {x: 5, y: 10}, {x: 5, y: 9}], "101", "", "")
      gameState.board.snakes.push(otherSnek)
      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // should try to murder the snake by going either left or down
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
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 5, y: 5}, {x: 6, y: 5}, {x: 6, y: 4}, {x: 7, y: 4}, {x: 8, y: 4}, {x: 9, y: 4}], "101", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 4, y: 3}, {x: 3, y: 3}, {x: 3, y: 3}], "101", "", "")
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 80, [{x: 8, y: 6}, {x: 8, y: 7}, {x: 7, y: 7}, {x: 6, y: 7}], "101", "", "")
      gameState.board.snakes.push(otherSnek2)
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
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 100, [{x: 4, y: 4}, {x: 4, y: 5}, {x: 5, y: 5}, {x: 5, y: 6}, {x: 5, y: 7}, {x: 5, y: 8}, {x: 4, y: 8}, {x: 4, y: 9}, {x: 3, y: 9}, {x: 3, y: 9}], "101", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 7, y: 5}, {x: 6, y: 5}, {x: 6, y: 6}, {x: 6, y: 7}, {x: 6, y: 8}, {x: 7, y: 8}, {x: 7, y: 9}, {x: 7, y: 10}, {x: 8, y: 10}, {x: 9, y: 10}, {x: 9, y: 9}], "101", "", "")
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 90, [{x: 5, y: 3}, {x: 6, y: 3}, {x: 6, y: 4}, {x: 7, y: 4}, {x: 8, y: 4}, {x: 9, y: 4}, {x: 10, y: 4}, {x: 10, y: 3}, {x: 10, y: 2}], "101", "", "")
      gameState.board.snakes.push(otherSnek2)
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
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 100, [{x: 4, y: 4}, {x: 4, y: 5}, {x: 5, y: 5}, {x: 5, y: 6}, {x: 5, y: 7}, {x: 5, y: 8}, {x: 4, y: 8}, {x: 4, y: 9}, {x: 3, y: 9}, {x: 3, y: 9}], "101", "", "")
      const gameState = createGameState(snek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 90, [{x: 5, y: 3}, {x: 6, y: 3}, {x: 6, y: 4}, {x: 7, y: 4}, {x: 8, y: 4}, {x: 9, y: 4}, {x: 10, y: 4}, {x: 10, y: 3}, {x: 10, y: 2}], "101", "", "")
      gameState.board.snakes.push(otherSnek2)
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
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 90, [{x: 4, y: 4}, {x: 4, y: 5}, {x: 5, y: 5}, {x: 5, y: 6}, {x: 5, y: 7}, {x: 5, y: 8}, {x: 4, y: 8}, {x: 4, y: 9}, {x: 3, y: 9}], "101", "", "")
      const gameState = createGameState(snek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 100, [{x: 5, y: 3}, {x: 6, y: 3}, {x: 6, y: 4}, {x: 7, y: 4}, {x: 8, y: 4}, {x: 9, y: 4}, {x: 10, y: 4}, {x: 10, y: 3}, {x: 10, y: 3}], "101", "", "")
      gameState.board.snakes.push(otherSnek2)
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
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 100, [{x: 5, y: 9}, {x: 5, y: 8}, {x: 5, y: 7}, {x: 4, y: 7}, {x: 4, y: 6}, {x: 4, y: 5}, {x: 4, y: 4}, {x: 4, y: 3}, {x: 4, y: 2}, {x: 5, y: 2}, {x: 6, y: 2}, {x: 6, y: 3}, {x: 6, y: 4}, {x: 7, y: 4}, {x: 7, y: 5}, {x: 7, y: 5}], "101", "", "")
      const gameState = createGameState(snek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 90, [{x: 4, y: 8}, {x: 3, y: 8}, {x: 3, y: 7}, {x: 3, y: 6}, {x: 3, y: 5}, {x: 3, y: 4}, {x: 3, y: 3}, {x: 3, y: 2}, {x: 2, y: 2}, {x: 1, y: 2}, {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5}, {x: 1, y: 5}, {x: 1, y: 6}], "101", "", "")
      gameState.board.snakes.push(otherSnek2)
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

    moveSnake(gameState, snek, board2d, "up")

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

    moveSnake(gameState, snek, board2d, "up")

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

    moveSnake(gameState, snek, board2d, "up")

    expect(snek.length).toBe(6) // length will have changed
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
    expect(snek.body[5].x).toBe(4) // snake has just eaten, should have tail show up twice
    expect(snek.body[5].y).toBe(1)
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

    moveSnake(gameState, snek, board2d, "up")

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

describe('Evaluate a doomed snake and an undoomed snake', () => {
    it('should rank the undoomed move higher', () => {
        const snek = new Battlesnake("snek", "snek", 50, [{x: 0, y: 1}, {x: 1, y: 1}, {x: 1, y: 0}, {x: 2, y: 0}], "101", "", "")
        
        const gameState = createGameState(snek)

        const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 0, y: 0}, {x: 0, y: 0}, {x: 0, y: 0}], "101", "", "")
        gameState.board.snakes.push(otherSnek)
        
        let evalSnek = evaluate(gameState, snek, "kissOfDeathNo", "kissOfMurderNo", false)
        let evalOtherSnek = evaluate(gameState, otherSnek, "kissOfDeathNo", "kissOfMurderNo", false)

        expect(evalSnek).toBeGreaterThan(evalOtherSnek)
    })
})

describe('Snake should move towards open space', () => {
  it('even if that means choosing a corner 1move over a wall 2move', () => {
      for (let i = 0; i < 50; i++) {
        const snek = new Battlesnake("snek", "snek", 50, [{x: 0, y: 9}, {x: 1, y: 9}, {x: 2, y: 9}, {x: 2, y: 8}, {x: 2, y: 7}, {x: 1, y: 7}, {x: 1, y: 6}, {x: 1, y: 5}, {x: 0, y: 5}, {x: 0, y: 4}, {x: 1, y: 4}, {x: 1, y: 3}, {x: 0, y: 3}, {x: 0, y: 2}], "101", "", "")
      
        const gameState = createGameState(snek)
        let moveResponse: MoveResponse = move(gameState)
        expect(moveResponse.move).toBe("up") // down moves us away from a corner & towards two possible moves, but dooms us after three moves. Up offers freedom in a few turns.
      }
  })
})

describe('Snake should avoid food when king snake', () => {
  it('does not choose food if better options exist while king snake', () => {
      for (let i = 0; i < 50; i++) {
        const snek = new Battlesnake("snek", "snek", 50, [{x: 5, y: 5}, {x: 5, y: 6}, {x: 5, y: 7}, {x: 5, y: 8}, {x: 5, y: 9}, {x: 5, y: 10}, {x: 4, y: 10}], "101", "", "")
      
        const gameState = createGameState(snek)

        const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 0, y: 0}, {x: 0, y: 0}, {x: 0, y: 0}], "101", "", "")
        gameState.board.snakes.push(otherSnek)

        gameState.board.food = [{x: 5, y: 4}]
        let moveResponse: MoveResponse = move(gameState)
        expect(moveResponse.move).toBe("left") // we should be king snake here & say no to food while still navigating toward otherSnek
      }
  })
})

// TODO
// kiss of death selector - chooses kiss of death cell with higher evaluation score
// tests for seeking open space
// tests for MoveNeighbors prey calculator

describe('Snake should not try for a maybe kill if it leads it to certain doom', () => {
  it('does not chase after a snake it cannot catch', () => {
      for (let i = 0; i < 50; i++) {
        const snek = new Battlesnake("snek", "snek", 95, [{x: 5, y: 9}, {x: 4, y: 9}, {x: 4, y: 8}, {x: 4, y: 7}, {x: 5, y: 7}, {x: 5, y: 6}, {x: 5, y: 5}, {x: 4, y: 5}, {x: 3, y: 5}, {x: 2, y: 5}], "101", "", "")
      
        const gameState = createGameState(snek)

        const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 6, y: 8}, {x: 6, y: 9}, {x: 6, y: 10}, {x: 7, y: 10}, {x: 8, y: 10}, {x: 9, y: 10}, {x: 10, y: 10}, {x: 10, y: 9}, {x: 10, y: 8}], "101", "", "")
        gameState.board.snakes.push(otherSnek)

        gameState.board.food = [{x: 6, y: 5}, {x: 0, y: 6}, {x: 7, y: 1}]
        let moveResponse: MoveResponse = move(gameState)
        expect(moveResponse.move).toBe("up") // bottom spells death don't chase
      }
  })
})

describe('Snake should not seek food through hazard if not hazard route exists', () => {
  it('does not path through hazard when possible', () => {
      for (let i = 0; i < 50; i++) {
        const snek = new Battlesnake("snek", "snek", 45, [{x: 8, y: 3}, {x: 8, y: 2}, {x: 7, y: 2}, {x: 7, y: 1}, {x: 6, y: 1}, {x: 5, y: 1}, {x: 4, y: 1}, {x: 4, y: 2}, {x: 3, y: 2}, {x: 3, y: 3}, {x: 2, y: 3}, {x: 1, y: 3}], "101", "", "")
      
        const gameState = createGameState(snek)

        const otherSnek = new Battlesnake("otherSnek", "otherSnek", 92, [{x: 5, y: 8}, {x: 5, y: 7}, {x: 5, y: 6}, {x: 5, y: 5}, {x: 6, y: 5}, {x: 6, y: 4}, {x: 6, y: 3}, {x: 5, y: 3}, {x: 5, y: 4}, {x: 4, y: 4}, {x: 4, y: 5}, {x: 4, y: 6}], "101", "", "")
        gameState.board.snakes.push(otherSnek)

        gameState.board.food = [{x: 4, y: 3}, {x: 1, y: 6}, {x: 1, y: 8}, {x: 5, y: 10}, {x: 10, y: 10}, {x: 9, y: 6}]
        createHazardRow(gameState.board, 10)
        createHazardColumn(gameState.board, 0)
        createHazardColumn(gameState.board, 1)
        createHazardColumn(gameState.board, 9)
        createHazardColumn(gameState.board, 10)
        let moveResponse: MoveResponse = move(gameState)
        expect(moveResponse.move).not.toBe("right") // I do want the food at (9,6) but I shouldn't go into the hazard to get it
      }
  })
})

describe('Snake should not seek kill through hazard if not hazard route exists', () => {
  it('does not path through hazard when possible', () => {
      for (let i = 0; i < 50; i++) {
        const snek = new Battlesnake("snek", "snek", 92, [{x: 7, y: 9}, {x: 6, y: 9}, {x: 6, y: 8}, {x: 6, y: 7}, {x: 6, y: 6}, {x: 6, y: 5}, {x: 6, y: 4}, {x: 6, y: 3}, {x: 6, y: 2}, {x: 5, y: 2}, {x: 5, y: 1}, {x: 4, y: 1}], "101", "", "")
      
        const gameState = createGameState(snek)

        const otherSnek = new Battlesnake("otherSnek", "otherSnek", 92, [{x: 8, y: 8}, {x: 8, y: 7}, {x: 8, y: 6}, {x: 8, y: 5}, {x: 8, y: 4}, {x: 8, y: 3}, {x: 8, y: 2}, {x: 8, y: 1}, {x: 8, y: 0}, {x: 7, y: 0}], "101", "", "")
        gameState.board.snakes.push(otherSnek)

        createHazardRow(gameState.board, 10)
        createHazardRow(gameState.board, 9)
        createHazardColumn(gameState.board, 9)
        createHazardColumn(gameState.board, 10)

        gameState.board.food = [{x: 0, y: 8}]
        let moveResponse: MoveResponse = move(gameState)
        expect(moveResponse.move).toBe("down") // I should try to kill directly below me as there's no hazard there, rather than right
      }
  })
})

describe('Snake should exit hazard when it can do so safely', () => {
  it('does not travel through hazard longer than necessary', () => {
      for (let i = 0; i < 50; i++) {
        const snek = new Battlesnake("snek", "snek", 50, [{x: 7, y: 2}, {x: 6, y: 2}, {x: 5, y: 2}, {x: 5, y: 3}, {x: 5, y: 4}, {x: 6, y: 4}, {x: 6, y: 5}, {x: 7, y: 5}, {x: 7, y: 6}, {x: 8, y: 6}, {x: 9, y: 6}], "101", "", "")
      
        const gameState = createGameState(snek)

        const otherSnek = new Battlesnake("otherSnek", "otherSnek", 30, [{x: 1, y: 4}, {x: 1, y: 3}, {x: 2, y: 3}, {x: 2, y: 4}, {x: 2, y: 5}, {x: 2, y: 6}, {x: 3, y: 6}, {x: 4, y: 6}, {x: 4, y: 5}, {x: 3, y: 5}], "101", "", "")
        gameState.board.snakes.push(otherSnek)

        createHazardRow(gameState.board, 10)
        createHazardRow(gameState.board, 9)
        createHazardRow(gameState.board, 0)
        createHazardRow(gameState.board, 1)
        createHazardRow(gameState.board, 2)

        gameState.board.food = [{x: 9, y: 0}, {x: 8, y: 5}]
        let moveResponse: MoveResponse = move(gameState)
        expect(moveResponse.move).toBe("up") // Down & right are both hazard, up also has food, should go up
      }
  })
})

describe('Snake should not enter hazard when it does not need to', () => {
  it('does not travel through hazard when another viable option exists', () => {
      for (let i = 0; i < 50; i++) {
        const snek = new Battlesnake("snek", "snek", 20, [{x: 2, y: 1}, {x: 1, y: 1}, {x: 0, y: 1}, {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4}], "101", "", "")
      
        const gameState = createGameState(snek)

        const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 6, y: 1}, {x: 7, y: 1}, {x: 7, y: 2}, {x: 7, y: 3}, {x: 6, y: 3}, {x: 5, y: 3}, {x: 4, y: 3}, {x: 4, y: 2}, {x: 3, y: 2}, {x: 3, y: 3}, {x: 3, y: 4}, {x: 4, y: 4}], "101", "", "")
        gameState.board.snakes.push(otherSnek)

        createHazardRow(gameState.board, 0)
        createHazardColumn(gameState.board, 0)
        createHazardColumn(gameState.board, 10)
        let moveResponse: MoveResponse = move(gameState)
        expect(moveResponse.move).not.toBe("down") // right leads towards larger otherSnek & is pretty bad, but down is certain death. Up is the correct choice
      }
  })
})

describe('Can accurately get adjacency to hazard', () => {
  it('knows when hazards are adjacent to a coordinate and without a snake', () => {
    const snek = new Battlesnake("snek", "snek", 100, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}], "101", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("snek", "snek", 100, [{x: 6, y: 10}, {x: 7, y: 10}, {x: 8, y: 10}, {x: 9, y: 10}], "101", "", "")
    gameState.board.snakes.push(otherSnek)

    gameState.board.food = [{x: 5, y: 5}, {x: 6, y: 6}]

    createHazardColumn(gameState.board, 0)
    createHazardColumn(gameState.board, 1)
    createHazardColumn(gameState.board, 10)
    createHazardColumn(gameState.board, 9)
    createHazardColumn(gameState.board, 8)
    createHazardRow(gameState.board, 0)
    createHazardRow(gameState.board, 1)
    createHazardRow(gameState.board, 2)
    createHazardRow(gameState.board, 3)
    createHazardRow(gameState.board, 4)
    createHazardRow(gameState.board, 5)
    createHazardRow(gameState.board, 10)
    const board2d = new Board2d(gameState.board)
    
    expect(isInOrAdjacentToHazard(snek.body[0], board2d, gameState)).toBe(true)
    expect(isInOrAdjacentToHazard(snek.body[1], board2d, gameState)).toBe(true)
    expect(isInOrAdjacentToHazard({x: 2, y: 6}, board2d, gameState)).toBe(true)
    expect(isInOrAdjacentToHazard({x: 2, y: 7}, board2d, gameState)).toBe(true)
    expect(isInOrAdjacentToHazard({x: 3, y: 7}, board2d, gameState)).toBe(false)
    expect(isInOrAdjacentToHazard({x: 7, y: 7}, board2d, gameState)).toBe(true)
    expect(isInOrAdjacentToHazard({x: 6, y: 7}, board2d, gameState)).toBe(false)
    expect(isInOrAdjacentToHazard({x: 6, y: 6}, board2d, gameState)).toBe(true)

    expect(isInOrAdjacentToHazard({x: 1, y: 7}, board2d, gameState)).toBe(true) // in the hazard should also return true
    expect(isInOrAdjacentToHazard({x: 3, y: 5}, board2d, gameState)).toBe(true)
    expect(isInOrAdjacentToHazard({x: 3, y: 10}, board2d, gameState)).toBe(true)

    expect(isInOrAdjacentToHazard({x: 6, y: 9}, board2d, gameState)).toBe(false) // is adjacent to a hazard, but that hazard has a snake, so don't consider it a hazard

    expect(isInOrAdjacentToHazard({x: 11, y: 10}, board2d, gameState)).toBe(false) // doesn't exist & thus has no neighbors, even if it is numerically one away from it

    gameState.game.ruleset.settings.hazardDamagePerTurn = 0 // if hazard damage is 0, function should always return false
    expect(isInOrAdjacentToHazard({x: 0, y: 0}, board2d, gameState)).toBe(false)
  })
})

describe('Snake should cut other snakes off', () => {
  it('travels straight into the wall, then turns away to kill a larger snake', () => {
      for (let i = 0; i < 50; i++) {
        const snek = new Battlesnake("snek", "snek", 50, [{x: 1, y: 9}, {x: 1, y: 8}, {x: 1, y: 7}, {x: 1, y: 6}, {x: 1, y: 5}, {x: 1, y : 4}], "101", "", "")
      
        const gameState = createGameState(snek)

        const otherSnek = new Battlesnake("otherSnek", "otherSnek", 30, [{x: 0, y: 6}, {x: 0, y: 5}, {x: 0, y: 4}, {x: 0, y: 3}, {x: 0, y: 2}, {x: 0, y: 1}, {x: 1, y: 0}, {x: 2, y: 0}], "101", "", "")
        gameState.board.snakes.push(otherSnek)
        let moveResponse: MoveResponse = move(gameState)
        const allowedMoves = ["left", "up"]
        expect(allowedMoves).toContain(moveResponse.move) // Both up & left will cut otherSnek off, effectively killing it
      }
  })
  it('travels straight into the wall, then turns away to kill a larger snake even with me', () => {
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 1, y: 9}, {x: 1, y: 8}, {x: 1, y: 7}, {x: 1, y: 6}, {x: 1, y: 5}], "101", "", "")
    
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 30, [{x: 0, y: 9}, {x: 0, y: 8}, {x: 0, y: 7}, {x: 0, y: 6}, {x: 0, y: 5}, {x: 0, y: 4}, {x: 0, y: 3}, {x: 0, y: 2}, {x: 0, y: 1}, {x: 1, y: 0}], "101", "", "")
      gameState.board.snakes.push(otherSnek)
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // Up will cut otherSnek off, effectively killing it
    }
  })
  it('travels straight into the wall, then turns away to kill a larger snake one behind me', () => {
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 1, y: 9}, {x: 1, y: 8}, {x: 1, y: 7}, {x: 1, y: 6}, {x: 1, y: 5}], "101", "", "")
    
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 30, [{x: 0, y: 8}, {x: 0, y: 7}, {x: 0, y: 6}, {x: 0, y: 5}, {x: 0, y: 4}, {x: 0, y: 3}, {x: 0, y: 2}, {x: 0, y: 1}, {x: 1, y: 0}], "101", "", "")
      gameState.board.snakes.push(otherSnek)
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // Up will cut otherSnek off, effectively killing it
    }
  })
  it('turns towards the smaller snake and goes for the kill', () => {
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 1, y: 9}, {x: 1, y: 8}, {x: 1, y: 7}, {x: 1, y: 6}, {x: 1, y: 5}, {x: 1, y: 4}], "101", "", "")
    
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 30, [{x: 0, y: 6}, {x: 0, y: 5}, {x: 0, y: 4}, {x: 0, y: 3}], "101", "", "")
      gameState.board.snakes.push(otherSnek)

      // add another larger snake so snek doesn't think it's king snake & navigate towards otherSnek for that reason
      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 30, [{x: 10, y: 0}, {x: 10, y: 1}, {x: 10, y: 2}, {x: 10, y: 3}, {x: 10, y: 4}, {x: 10, y: 5}, {x: 10, y: 6}, {x: 10, y: 7}], "101", "", "")
      gameState.board.snakes.push(otherSnek2)
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("left") // Left will send us towards the smaller snake, going for the kill.
    }
  })
  it('turns straight into the wall, then turns away to kill a snake that will grow to my length', () => {
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 1, y: 9}, {x: 1, y: 8}, {x: 1, y: 7}, {x: 1, y: 6}, {x: 1, y: 5}, {x: 1, y: 4}], "101", "", "")
    
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 30, [{x: 0, y: 6}, {x: 0, y: 5}, {x: 0, y: 4}, {x: 0, y: 3}, {x: 0, y: 2}], "101", "", "")
      gameState.board.snakes.push(otherSnek)
      
      gameState.board.food = [{x: 0, y: 7}]
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // Left will send us towards the smaller snake, but it won't be smaller soon, so go up
    }
  })
})

describe('Snake should not enter spaces without a clear escape route', () => {
  it('does not enter a space enclosed by itself', () => {
      for (let i = 0; i < 50; i++) {
        const snek = new Battlesnake("snek", "snek", 50, [{x: 6, y: 6}, {x: 7, y: 6}, {x: 8, y: 6}, {x: 8, y: 6}, {x: 8, y: 4}, {x: 7, y: 4}, {x: 7, y: 3}, {x: 7, y: 2}, {x: 6, y: 2}, {x: 6, y: 3}, {x: 5, y: 3}, {x: 5, y: 4}, {x: 5, y: 5}, {x: 4, y: 5}, {x: 4, y: 6}, {x: 4, y: 7}, {x: 5, y: 7}], "101", "", "")
      
        const gameState = createGameState(snek)

        gameState.board.food = [{x: 0, y: 0}, {x: 2, y: 5}, {x: 9, y: 10}]
        let moveResponse: MoveResponse = move(gameState)
        expect(moveResponse.move).not.toBe("down") // Down has three spaces available, fully enclosed by my body. Will die after two turns.
      }
  })
  it('does not enter a space enclosed by another snake', () => {
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 4, y: 2}, {x: 5, y: 2}, {x: 6, y: 2}, {x: 7, y: 2}, {x: 8, y: 2}, {x: 9, y: 2}, {x: 9, y: 3}, {x: 9, y: 4}, {x: 9, y: 5}, {x: 9, y: 6}, {x: 9, y: 7}, {x: 9, y: 8}, {x: 9, y: 9}, {x: 8, y: 9}], "101", "", "")
    
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 30, [{x: 0, y: 2}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 1, y: 4}, {x: 1, y: 5}, {x: 1, y: 6}, {x: 2, y: 6}, {x: 3, y: 6}, {x: 3, y: 5}, {x: 3, y: 4}, {x: 4, y: 4}, {x: 4, y: 3}, {x: 5, y: 3}], "101", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 0, y: 0}, {x: 2, y: 5}, {x: 9, y: 10}]
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("down") // Up has three spaces available, fully enclosed by my otherSnek's body. Will die after two turns.
    }
  })
  it('does not chase a snake into a corner trap', () => {
    for (let i = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 2, y: 10}, {x: 2, y: 9}, {x: 3, y: 9}, {x: 3, y: 8}, {x: 4, y: 8}, {x: 5, y: 8}, {x: 6, y: 8}, {x: 6, y: 7}, {x: 6, y: 6}, {x: 6, y: 5}, {x: 6, y: 4}], "101", "", "")
    
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 30, [{x: 0, y: 8}, {x: 0, y: 9}, {x: 1, y: 9}, {x: 1, y: 8}, {x: 2, y: 8}, {x: 2, y: 7}, {x: 3, y: 7}, {x: 4, y: 7}, {x: 5, y: 7}], "101", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 0, y: 0}, {x: 2, y: 5}, {x: 9, y: 10}]
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("down") // Up has three spaces available, fully enclosed by my otherSnek's body. Will die after two turns.
    }
  })
})

describe('updateGameState tests', () => {
  it('updates game state to kill & remove snakes that have starved', () => {
      const snek = new Battlesnake("snek", "snek", 10, [{x: 9, y: 10}, {x: 9, y: 9}, {x: 9, y: 8}], "101", "", "")
      
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 92, [{x: 5, y: 8}, {x: 5, y: 7}, {x: 5, y: 6}], "101", "", "")
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 92, [{x: 0, y: 10}, {x: 0, y: 9}, {x: 0, y: 8}], "101", "", "")
      gameState.board.snakes.push(otherSnek2)

      const otherSnek3 = new Battlesnake("otherSnek3", "otherSnek3", 5, [{x: 2, y: 7}, {x: 2, y: 8}, {x: 3, y: 8}], "101", "", "")
      gameState.board.snakes.push(otherSnek3)

      const otherSnek4 = new Battlesnake("otherSnek4", "otherSnek4", 1, [{x: 10, y: 0}, {x: 9, y: 0}, {x: 8, y: 0}], "101", "", "")
      gameState.board.snakes.push(otherSnek4)

      createHazardRow(gameState.board, 10)

      let board2d = new Board2d(gameState.board)

      moveSnake(gameState, snek, board2d, "left") // this should starve the snake out due to hazard
      moveSnake(gameState, otherSnek, board2d, "up") // this snake should be safe moving any direction
      moveSnake(gameState, otherSnek2, board2d, "right") // this snake has enough health not to starve if it moves into hazard
      moveSnake(gameState, otherSnek3, board2d, "right") // this snake would starve moving into hazard, but shouldn't starve moving into not hazard
      moveSnake(gameState, otherSnek4, board2d, "up") // this snake will starve, even though up is a valid direction

      updateGameStateAfterMove(gameState)

      // this should kill snek & otherSnek4, but leave otherSnek, otherSnek2, & otherSnek3 alive at (5,9), (1,10), (3,7) respectively
      expect(gameState.board.snakes.length).toBe(3)

      expect(gameState.board.snakes[0].head.x).toBe(5)
      expect(gameState.board.snakes[0].head.y).toBe(9)
      expect(gameState.board.snakes[0].body[2].x).toBe(5)
      expect(gameState.board.snakes[0].body[2].y).toBe(7)

      expect(gameState.board.snakes[1].head.x).toBe(1)
      expect(gameState.board.snakes[1].head.y).toBe(10)
      expect(gameState.board.snakes[1].body[2].x).toBe(0)
      expect(gameState.board.snakes[1].body[2].y).toBe(9)

      expect(gameState.board.snakes[2].head.x).toBe(3)
      expect(gameState.board.snakes[2].head.y).toBe(7)
      expect(gameState.board.snakes[2].body[2].x).toBe(2)
      expect(gameState.board.snakes[2].body[2].y).toBe(8)
  })
  it('updates game state to remove food that has been eaten and update snake tail lengths for those that have eaten', () => {
    const snek = new Battlesnake("snek", "snek", 10, [{x: 5, y: 5}, {x: 5, y: 4}, {x: 5, y: 3}], "101", "", "")
    
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 100, [{x: 4, y: 8}, {x: 5, y: 8}, {x: 6, y: 8}, {x: 6, y: 9}, {x: 6, y: 9}], "101", "", "") // snake has just eaten
    gameState.board.snakes.push(otherSnek)

    gameState.board.food = [{x: 5, y: 6}, {x: 5, y: 4}]

    let board2d = new Board2d(gameState.board)

    moveSnake(gameState, snek, board2d, "up") // snek should get the food at (5,6)
    moveSnake(gameState, otherSnek, board2d, "down")

    updateGameStateAfterMove(gameState)

    expect(gameState.board.snakes.length).toBe(2)

    expect(gameState.board.snakes[0].health).toBe(100)
    expect(gameState.board.snakes[0].length).toBe(4)
    expect(gameState.board.snakes[0].head.x).toBe(5)
    expect(gameState.board.snakes[0].head.y).toBe(6)
    expect(gameState.board.snakes[0].head.x).toBe(gameState.board.snakes[0].body[0].x) // head should point to same place as body[0]
    expect(gameState.board.snakes[0].head.y).toBe(gameState.board.snakes[0].body[0].y)
    expect(gameState.board.snakes[0].body[1].x).toBe(5)
    expect(gameState.board.snakes[0].body[1].y).toBe(5)
    expect(gameState.board.snakes[0].body[2].x).toBe(5)
    expect(gameState.board.snakes[0].body[2].y).toBe(4)
    expect(gameState.board.snakes[0].body[3].x).toBe(5)// after eating food, tail should be duplicated so that length increases, but prior tail still shrinks
    expect(gameState.board.snakes[0].body[3].y).toBe(4)

    expect(gameState.board.snakes[1].length).toBe(5)
    expect(gameState.board.snakes[1].head.x).toBe(4)
    expect(gameState.board.snakes[1].head.y).toBe(7)
    expect(gameState.board.snakes[1].body[1].x).toBe(4)
    expect(gameState.board.snakes[1].body[1].y).toBe(8)
    expect(gameState.board.snakes[1].body[2].x).toBe(5)
    expect(gameState.board.snakes[1].body[2].y).toBe(8)
    expect(gameState.board.snakes[1].body[3].x).toBe(6)
    expect(gameState.board.snakes[1].body[3].y).toBe(8)
    expect(gameState.board.snakes[1].body[4].x).toBe(6)
    expect(gameState.board.snakes[1].body[4].y).toBe(9)

    expect(gameState.board.food.length).toBe(1)
    expect(gameState.board.food[0].x).toBe(5)
    expect(gameState.board.food[0].y).toBe(4)
  })
  it('updates game state to kill & remove snakes that have collided head-to-head', () => {
    const snek = new Battlesnake("snek", "snek", 92, [{x: 10, y: 8}, {x: 10, y: 9}, {x: 10, y: 10}], "101", "", "")
    
    const gameState = createGameState(snek)

    const snekOpponent = new Battlesnake("snekOpponent", "snekOpponent", 92, [{x: 10, y: 6}, {x: 10, y: 5}, {x: 10, y: 4}, {x: 10, y: 3}], "101", "", "")
    gameState.board.snakes.push(snekOpponent)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 92, [{x: 8, y: 8}, {x: 8, y: 9}, {x: 8, y: 10}], "101", "", "")
    gameState.board.snakes.push(otherSnek)

    const otherSnekOpponent = new Battlesnake("otherSnekOpponent", "otherSnekOpponent", 1, [{x: 8, y: 6}, {x: 8, y: 5}, {x: 8, y: 4}, {x: 8, y: 3}], "101", "", "")
    gameState.board.snakes.push(otherSnekOpponent)

    const hazardSnek = new Battlesnake("hazardSnek", "hazardSnek", 92, [{x: 0, y: 8}, {x: 0, y: 9}, {x: 0, y: 10}], "101", "", "")
    gameState.board.snakes.push(hazardSnek)

    const hazardSnekOpponent = new Battlesnake("hazardSnekOpponent", "hazardSnekOpponent", 10, [{x: 0, y: 6}, {x: 0, y: 5}, {x: 0, y: 4}], "101", "", "")
    gameState.board.snakes.push(hazardSnekOpponent)

    const newSnek = new Battlesnake("newSnek", "newSnek", 100, [{x: 6, y: 8}, {x: 6, y: 9}, {x: 6, y: 10}, {x: 6, y: 10}], "101", "", "") // just eaten
    gameState.board.snakes.push(newSnek)

    const newSnekOpponent = new Battlesnake("newSnekOpponent", "newSnekOpponent", 92, [{x: 6, y: 6}, {x: 6, y: 5}, {x: 6, y: 4}], "101", "", "")
    gameState.board.snakes.push(newSnekOpponent)
    
    const lastSnek = new Battlesnake("lastSnek", "lastSnek", 92, [{x: 4, y: 8}, {x: 4, y: 9}, {x: 4, y: 10}], "101", "", "")
    gameState.board.snakes.push(lastSnek)

    const lastSnekOpponent = new Battlesnake("lastSnekOpponent", "lastSnekOpponent", 92, [{x: 4, y: 6}, {x: 4, y: 5}, {x: 4, y: 4}], "101", "", "")
    gameState.board.snakes.push(lastSnekOpponent)

    createHazardColumn(gameState.board, 0)

    let board2d = new Board2d(gameState.board)

    moveSnake(gameState, snek, board2d, "down") // snek moves down to die at the jaws of snekOpponent, who is larger
    moveSnake(gameState, snekOpponent, board2d, "up") // snekOpponent moves up to kill snek, who is smaller
    moveSnake(gameState, otherSnek, board2d, "down") // otherSnek moves down, but doesn't die to otherSnekOpponent, who starves first
    moveSnake(gameState, otherSnekOpponent, board2d, "up") // otherSnekOpponent moves up & tries to kill otherSnek, but starves first & dies
    moveSnake(gameState, hazardSnek, board2d, "down") // hazardSnake moves down & lives thanks to hazardSnekOpponent dying before they can collide
    moveSnake(gameState, hazardSnekOpponent, board2d, "up") // hazardSnekOpponent moves up & starves before colliding with hazardSnek
    moveSnake(gameState, newSnek, board2d, "down") // newSnek moves down to kill newSnekOpponent, since it just grew by eating this turn
    moveSnake(gameState, newSnekOpponent, board2d, "up") // newSnekOpponent moves up to die to newSnek, who is now one larger since newSnekOpponent did not eat this turn
    moveSnake(gameState, lastSnek, board2d, "down") // lastSnek moves down to die in a mutual kiss of death with lastSnekOpponent
    moveSnake(gameState, lastSnekOpponent, board2d, "up") // lastSnekOpponent moves up to die in a mutual kiss of death with lastSnek

    updateGameStateAfterMove(gameState)

    // after all the carnage, snekOpponent, otherSnek, hazardSnek, & newSnek should still be alive
    expect(gameState.board.snakes.length).toBe(4)

    expect(gameState.board.snakes[0].id).toBe("snekOpponent")
    expect(gameState.board.snakes[1].id).toBe("otherSnek")
    expect(gameState.board.snakes[2].id).toBe("hazardSnek")
    expect(gameState.board.snakes[3].id).toBe("newSnek")

    expect(gameState.board.snakes[0].head.x).toBe(10)
    expect(gameState.board.snakes[0].head.y).toBe(7)
    expect(gameState.board.snakes[0].body[2].x).toBe(10)
    expect(gameState.board.snakes[0].body[2].y).toBe(5)

    expect(gameState.board.snakes[1].head.x).toBe(8)
    expect(gameState.board.snakes[1].head.y).toBe(7)
    expect(gameState.board.snakes[1].body[2].x).toBe(8)
    expect(gameState.board.snakes[1].body[2].y).toBe(9)

    expect(gameState.board.snakes[2].head.x).toBe(0)
    expect(gameState.board.snakes[2].head.y).toBe(7)
    expect(gameState.board.snakes[2].body[2].x).toBe(0)
    expect(gameState.board.snakes[2].body[2].y).toBe(9)

    expect(gameState.board.snakes[3].head.x).toBe(6)
    expect(gameState.board.snakes[3].head.y).toBe(7)
    expect(gameState.board.snakes[3].body[2].x).toBe(6)
    expect(gameState.board.snakes[3].body[2].y).toBe(9)
  })
  it('updates game state to kill & remove snakes that collided with another snake body', () => {
    const snek = new Battlesnake("snek", "snek", 10, [{x: 9, y: 10}, {x: 9, y: 9}, {x: 9, y: 8}], "101", "", "")
    
    const gameState = createGameState(snek)

    const snekOpponent = new Battlesnake("snekOpponent", "snekOpponent", 92, [{x: 10, y: 10}, {x: 10, y: 9}, {x: 10, y: 8}], "101", "", "")
    gameState.board.snakes.push(snekOpponent)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 92, [{x: 1, y: 9}, {x: 1, y: 10}, {x: 0, y: 10}, {x: 0, y: 9}, {x: 0, y: 8}], "101", "", "")
    gameState.board.snakes.push(otherSnek)

    const hazardSnek = new Battlesnake("hazardSnek", "hazardSnek", 5, [{x: 3, y: 0}, {x: 3, y: 1}, {x: 4, y: 1}, {x: 5, y: 1}], "101", "", "")
    gameState.board.snakes.push(hazardSnek)

    const hazardSnekOpponent = new Battlesnake("hazardSnekOpponent", "hazardSnekOpponent", 100, [{x: 4, y: 0}, {x: 5, y: 0}, {x: 6, y: 0}, {x: 6, y: 0}], "101", "", "")
    gameState.board.snakes.push(hazardSnekOpponent)

    const starvingSnek = new Battlesnake("starvingSnek", "starvingSnek", 1, [{x: 5, y: 5}, {x: 6, y: 5}, {x: 7, y: 5}, {x: 8, y: 5}], "101", "", "")
    gameState.board.snakes.push(starvingSnek)

    const starvingSnekOpponent = new Battlesnake("starvingSnekOpponent", "starvingSnekOpponent", 90, [{x: 5, y: 6}, {x: 6, y: 6}, {x: 7, y: 6}, {x: 8, y: 6}], "101", "", "")
    gameState.board.snakes.push(starvingSnekOpponent)

    createHazardRow(gameState.board, 0)

    let board2d = new Board2d(gameState.board)

    moveSnake(gameState, snek, board2d, "left") // snek will avoid colliding with snekOpponent by moving its head left
    moveSnake(gameState, snekOpponent, board2d, "left") // otherSnek will collide with snek's neck at (1,9) - note that because snek also moves, this won't be a head-to-head
    moveSnake(gameState, otherSnek, board2d, "left") // otherSnek is right of its body, it will die if it moves left
    moveSnake(gameState, hazardSnek, board2d, "left") // hazardSnek will die after turning left into one more turn of hazard
    moveSnake(gameState, hazardSnekOpponent, board2d, "left") // hazardSnekOpponent should live as hazardSnek will starve before it collides with its body left
    moveSnake(gameState, starvingSnek, board2d, "left") // starvingSnek will starve next turn no matter what
    moveSnake(gameState, starvingSnekOpponent, board2d, "down") // starvingSnekOpponent should live as starvingSnek will starve before this collision happens

    updateGameStateAfterMove(gameState)

    // this should kill snekOpponent, otherSnek, hazardSnek, & starvingSnek, leaving snek, hazardSnekOpponent, & starvingSnekOpponent alive
    expect(gameState.board.snakes.length).toBe(3)

    expect(gameState.board.snakes[0].id).toBe("snek")
    expect(gameState.board.snakes[1].id).toBe("hazardSnekOpponent")
    expect(gameState.board.snakes[2].id).toBe("starvingSnekOpponent")

    expect(gameState.board.snakes[0].head.x).toBe(8)
    expect(gameState.board.snakes[0].head.y).toBe(10)
    expect(gameState.board.snakes[0].body[2].x).toBe(9)
    expect(gameState.board.snakes[0].body[2].y).toBe(9)

    expect(gameState.board.snakes[1].head.x).toBe(3)
    expect(gameState.board.snakes[1].head.y).toBe(0)
    expect(gameState.board.snakes[1].body[2].x).toBe(5)
    expect(gameState.board.snakes[1].body[2].y).toBe(0)

    expect(gameState.board.snakes[2].head.x).toBe(5)
    expect(gameState.board.snakes[2].head.y).toBe(5)
    expect(gameState.board.snakes[2].body[2].x).toBe(6)
    expect(gameState.board.snakes[2].body[2].y).toBe(6)
  })
})

describe('Food prioritization and acquisition', () => {
  it('acquires food when healthy and adjacent to it', () => {
      for (let i: number = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 90, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}], "101", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 6, y: 10}, {x: 7, y: 10}, {x: 8, y: 10}, {x: 9, y: 10}], "101", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 2, y: 1}, {x: 6, y: 6}]

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("down") // food is down, we should get it even if we don't really need it (we're not king snake)
    }
  })
  it('acquires food when starving and adjacent to it', () => {
    for (let i: number = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 5, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}], "101", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 6, y: 10}, {x: 7, y: 10}, {x: 8, y: 10}, {x: 9, y: 10}], "101", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 2, y: 1}, {x: 6, y: 6}]

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("down") // food is down, we should get it especially if we really need it
    }
  })
  it('ignores food when adjacent to it but hunting another snake', () => {
    for (let i: number = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 90, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}, {x: 4, y: 1}, {x: 5, y: 1}, {x: 6, y: 1}, {x: 7, y: 1}], "101", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 6, y: 10}, {x: 7, y: 10}, {x: 8, y: 10}, {x: 9, y: 10}], "101", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 2, y: 1}, {x: 6, y: 6}]

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("down") // food is left, but we're king snake, should be hunting otherSnek & not food
    }
  })
  it('avoids food when significantly larger than other snakes', () => {
    for (let i: number = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 90, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}, {x: 4, y: 1}, {x: 5, y: 1}, {x: 6, y: 1}, {x: 7, y: 1}, {x: 8, y: 1}], "101", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 2, y: 10}, {x: 3, y: 10}, {x: 4, y: 10}, {x: 5, y: 10}], "101", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 2, y: 3}, {x: 6, y: 6}]

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("up") // want to hunt snake above us, but will avoid food while doing so
    }
  })
  it('seeks out food under normal competitive circumstances', () => {
    for (let i: number = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 90, [{x: 5, y: 5}, {x: 5, y: 4}, {x: 5, y: 3}, {x: 5, y: 2}], "101", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 2, y: 10}, {x: 3, y: 10}, {x: 4, y: 10}, {x: 5, y: 10}], "101", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 8, y: 5}]

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("right") // food is straight right, should seek it out
    }
  })
  it('does not seek out food under normal solo circumstances', () => {
    for (let i: number = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 90, [{x: 6, y: 7}, {x: 6, y: 6}, {x: 6, y: 5}, {x: 5, y: 5}, {x: 5, y: 4}, {x: 5, y: 3}, {x: 5, y: 2}], "101", "", "")
      const gameState = createGameState(snek)

      gameState.board.food = [{x: 9, y: 5}]

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("right") // should go back towards center instead, right just takes us further from center
    }
  })
  it('acquires food even along walls', () => {
    for (let i: number = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 90, [{x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 1, y: 4}], "101", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 2, y: 10}, {x: 3, y: 10}, {x: 4, y: 10}, {x: 5, y: 10}], "101", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 0, y: 1}]

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("left") // food is straight left, should seek it out
    }
  })
  it('acquires food even in corners', () => {
    for (let i: number = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 90, [{x: 1, y: 0}, {x: 2, y: 0}, {x: 3, y: 0}, {x: 4, y: 0}], "101", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 2, y: 10}, {x: 3, y: 10}, {x: 4, y: 10}, {x: 5, y: 10}], "101", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 0, y: 0}]

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("left") // food is straight left, should seek it out even in a corner
    }
  })
  it('acquires food even if more food exists in another direction', () => {
    for (let i: number = 0; i < 50; i++) {
      const snek = new Battlesnake("snek", "snek", 30, [{x: 5, y: 5}, {x: 5, y: 4}, {x: 5, y: 3}, {x: 5, y: 2}], "101", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 2, y: 10}, {x: 3, y: 10}, {x: 4, y: 10}, {x: 5, y: 10}], "101", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 6, y: 5}, {x: 4, y: 4}, {x: 4, y: 6}, {x: 3, y: 5}]

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("right") // food is immediately adjacent to the right, but more food is nearby left. Should still get the immediate food
    }
  })
})