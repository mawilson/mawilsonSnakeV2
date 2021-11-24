import { info, move } from '../src/logic'
import { Battlesnake, Coord, GameState, MoveResponse, RulesetSettings } from '../src/types';

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

function createGameState(me: Battlesnake): GameState {
    return {
        game: {
            id: "totally-unique-game-id",
            ruleset: { name: "standard", version: "v1.2.3", settings: createRulesetSettings() },
            timeout: 500,
            source: "testing"
        },
        turn: 0,
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

function createBattlesnake(id: string, body: Coord[]): Battlesnake {
    return {
        id: id,
        name: id,
        health: 100,
        body: body,
        latency: "",
        head: body[0],
        length: body.length,
        shout: "",
        squad: ""
    }
}

describe('Battlesnake API Version', () => {
    it('should be api version 1', () => {
        const result = info()
        expect(result.apiversion).toBe("1")
    })
})

// describe('Battlesnake Moves', () => {
//     it('should never move into its own neck', () => {
//         // Arrange
//         const me = createBattlesnake("me", [{ x: 2, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }])
//         const gameState = createGameState(me)

//         // Act 1,000x (this isn't a great way to test, but it's okay for starting out)
//         for (let i = 0; i < 50; i++) {
//             const moveResponse: MoveResponse = move(gameState)
//             // In this state, we should NEVER move left.
//             const allowedMoves = ["up", "down", "right"]
//             expect(allowedMoves).toContain(moveResponse.move)
//         }
//     })
// })

describe('BattleSnake can chase tail', () => {
  it('should be allowed to chase its tail into the space it currently occupies', () => {
    const snek = createBattlesnake("snek", [{x: 0, y: 0}, {x: 0, y: 1}, {x: 1, y: 1}, {x: 1, y: 0}])
    const gameState = createGameState(snek)

    // console.log("gameState height, width: %d, %d", gameState.board.height, gameState.board.width)
    // console.log("gameState snek head, tail: (%d,%d), (%d,%d)", gameState.you.body[0].x, gameState.you.body[0].y, gameState.you.body[gameState.you.body.length -1].x, gameState.you.body[gameState.you.body.length - 1].y)

    for (let i = 0; i < 50; i++) {
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("right")
    }
  })
})

// TODO: tail chaser, but if the snake has just eaten
// TODO: Board2d validator
// TODO: Wall tester
// TODO: Self body move tester
// TODO: Other snake body move tester