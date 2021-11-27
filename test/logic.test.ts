import { info, move, buildBoard2d } from '../src/logic'
import { GameState, MoveResponse, RulesetSettings } from '../src/types';
import { Battlesnake, Coord } from '../src/classes'

// snake diagrams: x is empty, s is body, h is head, t is tail, f is food, z is hazard
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

function createGameState(me: Battlesnake, turn: number): GameState {
    return {
        game: {
            id: "totally-unique-game-id",
            ruleset: { name: "standard", version: "v1.2.3", settings: createRulesetSettings() },
            timeout: 500,
            source: "testing"
        },
        turn: turn,
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
      const me = new Battlesnake("me", "me", 100, [{ x: 2, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }], "100", "", "")
      const gameState = createGameState(me, 0)

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
    const snek = new Battlesnake("snek", "snek", 50, [{x: 0, y: 0}, {x: 0, y: 1}, {x: 1, y: 1}, {x: 1, y: 0}], "100", "", "") // 50 health means it hasn't just eaten
    //const snek = createBattlesnake("snek", [{x: 0, y: 0}, {x: 0, y: 1}, {x: 1, y: 1}, {x: 1, y: 0}], 50) // 50 health means it hasn't just eaten
    const gameState = createGameState(snek, 30) // arbitrary turn 30

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
    const snek = new Battlesnake("snek", "snek", 100, [{x: 0, y: 0}, {x: 0, y: 1}], "100", "", "")
    const gameState = createGameState(snek, 30) // arbitrary turn 30

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
    const snek = new Battlesnake("snek", "snek", 100, [{x: 0, y: 0}, {x: 0, y: 1}], "100", "", "")
    const gameState = createGameState(snek, 30) // arbitrary turn 30
    const gameBoard = gameState.board

    gameBoard.food = [{x: 1, y: 1}, {x: 1, y: 2}]
    gameBoard.hazards = [{x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}]

    let board2d = buildBoard2d(gameBoard, snek)

    snek.body.forEach(function checkBodyPart(part, index, arr) {
      let boardCell = board2d.getCell(part)
      let checkSnek = boardCell.snakeCell
      if (checkSnek) {
        expect(snek.id).toBe(checkSnek.snake.id)
        expect(checkSnek.isHead).toBe(index === 0) // index 0 of the snake body is the head
        expect(checkSnek.isTail).toBe(index === (arr.length - 1)) // the last index of the snake body is the tail
      }
    })

    gameBoard.food.forEach(function checkFood(coord) {
      let boardCell = board2d.getCell(coord)
      expect(boardCell.food).toBe(true)
    })

    gameBoard.hazards.forEach(function checkHazard(coord) {
      let boardCell = board2d.getCell(coord)
      expect(boardCell.hazard).toBe(true)
    })
  })
})

describe('BattleSnake will not eat a left wall', () => {
  it('should not go left if there is a wall there', () => {
    // x x x
    // h s t
    // x x x
    const snek = new Battlesnake("snek", "snek", 100, [{x: 0, y: 1}, {x: 1, y: 1}, {x: 2, y: 1}], "100", "", "")
    const gameState = createGameState(snek, 30) // arbitrary turn 30

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
    const snek = new Battlesnake("snek", "snek", 100, [{x: 10, y: 1}, {x: 9, y: 1}, {x: 8, y: 1}], "100", "", "")
    const gameState = createGameState(snek, 30) // arbitrary turn 30

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
    const snek = new Battlesnake("snek", "snek", 100, [{x: 1, y: 10}, {x: 1, y: 9}, {x: 1, y: 8}], "100", "", "")
    const gameState = createGameState(snek, 30) // arbitrary turn 30

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
    const snek = new Battlesnake("snek", "snek", 100, [{x: 1, y: 0}, {x: 1, y: 1}, {x: 1, y: 2}], "100", "", "")
    const gameState = createGameState(snek, 30) // arbitrary turn 30

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
    const snek = new Battlesnake("snek", "snek", 100, [{x: 2, y: 1}, {x: 2, y: 2}, {x: 1, y: 2}, {x: 1, y: 1}, {x: 1, y: 0}], "100", "", "")
    const gameState = createGameState(snek, 30) // arbitrary turn 30

    for (let i = 0; i < 50; i++) {
      let moveResponse: MoveResponse = move(gameState)
      expect(["down", "right"]).toContain(moveResponse.move)
    }
  })
})

// TODO: Other snake body move tester