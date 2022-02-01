import { info, move, decideMove, start } from '../src/logic'
import { GameState, MoveResponse, RulesetSettings } from '../src/types';
import { Battlesnake, Direction, stringToDirection, BoardCell, Board2d, KissOfDeathState, KissOfMurderState, HazardWalls, KissStatesForEvaluate, SnakeScore, FoodCountTier, HazardCountTier } from '../src/classes'
import { isKingOfTheSnakes, cloneGameState, moveSnake, coordsEqual, createHazardRow, createHazardColumn, isInOrAdjacentToHazard, updateGameStateAfterMove, getLongestOtherSnake, calculateCenterWithHazard, getSnakeScoreFromHashKey, calculateReachableCells } from '../src/util'
import { evaluate } from '../src/eval'
import { machineLearningDataResult, server } from '../src/index'

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
  let settings = createRulesetSettings()
  let timeout: number
  if (settings.hazardDamagePerTurn > 0) {
    timeout = 600
  } else {
    timeout = 500
  }
  return {
      game: {
          id: "totally-unique-game-id",
          ruleset: { name: "standard", version: "v1.2.3", settings: settings },
          timeout: timeout,
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

beforeAll(() => {
  const snek = new Battlesnake("snek", "snek", 80, [{x: 5, y: 5}, {x: 5, y: 5}, {x: 5, y: 5}], "30", "", "")
  let gameState = createGameState(snek)
  start(gameState) // initializes gameData

  // TODO: Fix, currently this is just an empty object after returning, despite it theoretically waiting on the promise to finish
  return machineLearningDataResult // wait for machine learning data to be processed
})

afterAll(() => {
  return server.close()
})

// tests whose use case may still be valid, but which can no longer be effectively tested when different lookaheads are in place
describe('Tests deprecated by lookahead', () => {
  // with a lookahead there are many factors that might push the snake elsewhere. Need to either scrap or design a better test
  it.skip('should attempt to eat another snake given the opportunity', () => {
    // x  x  x t2 s2 s2 x
    // x  x  x x x  h2 x
    // x  x  h s x  x x
    // x  x  x s s  s t
    // t1 h1 x x x  x x
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 5, y: 5}, {x: 6, y: 5}, {x: 6, y: 4}, {x: 7, y: 4}, {x: 8, y: 4}, {x: 9, y: 4}], "30", "", "")
      const gameState = createGameState(snek)

      // const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 4, y: 1}, {x:4, y: 2}, {x: 4, y: 3}], "30", "", "")
      // gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 80, [{x: 8, y: 6}, {x: 8, y: 7}, {x: 7, y: 7}, {x: 6, y: 7}], "30", "", "")
      gameState.board.snakes.push(otherSnek2)

      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // chase after otherSnek2 by going up. Lookahead made snek consistently seek otherSnek, so stopped adding him
    }
  })

  // may no longer go for the kill if looking ahead, the nudge may not be enough
  it.skip('will murder snake of one fewer length after it has grown one length', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 100, [{x: 4, y: 4}, {x: 4, y: 5}, {x: 5, y: 5}, {x: 5, y: 6}, {x: 5, y: 7}, {x: 5, y: 8}, {x: 4, y: 8}, {x: 4, y: 9}, {x: 3, y: 9}, {x: 3, y: 9}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 90, [{x: 5, y: 3}, {x: 6, y: 3}, {x: 6, y: 4}, {x: 7, y: 4}, {x: 8, y: 4}, {x: 9, y: 4}, {x: 10, y: 4}, {x: 10, y: 3}, {x: 10, y: 2}], "30", "", "")
      gameState.board.snakes.push(otherSnek2)
      let moveResponse : MoveResponse = move(gameState)
      let allowedMoves : string[] = ["right", "down"]
      expect(allowedMoves).toContain(moveResponse.move)
    }
  })

  it.skip('does not choose food if better options exist while king snake', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 95, [{x: 5, y: 5}, {x: 5, y: 6}, {x: 5, y: 7}, {x: 5, y: 8}, {x: 5, y: 9}, {x: 5, y: 10}, {x: 4, y: 10}], "30", "", "")
    
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 5, y: 4}]
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("left") // we should be king snake here & say no to food while still navigating toward otherSnek
    }
  })

  it.skip('avoids food when significantly larger than other snakes', () => {
    for (let i: number = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 90, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}, {x: 4, y: 1}, {x: 5, y: 1}, {x: 6, y: 1}, {x: 7, y: 1}, {x: 8, y: 1}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 2, y: 10}, {x: 3, y: 10}, {x: 4, y: 10}, {x: 5, y: 10}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 2, y: 3}, {x: 6, y: 6}]

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("up") // want to hunt snake above us, but will avoid food while doing so
    }
  })

  // as lookahead gets longer, may need to skip this test as snek thinks it can go for multiple food instead of just the one
  it.skip('acquires food even if more food exists in another direction', () => {
    for (let i: number = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 30, [{x: 5, y: 5}, {x: 5, y: 4}, {x: 5, y: 3}, {x: 5, y: 2}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 2, y: 10}, {x: 3, y: 10}, {x: 4, y: 10}, {x: 5, y: 10}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 6, y: 5}, {x: 3, y: 4}, {x: 3, y: 6}, {x: 2, y: 5}]

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("right") // food is immediately adjacent to the right, but more food is nearby left. Should still get the immediate food
    }
  })

  // not sure how to test this in a situation where there's a clear move. If on turn 31 the priorKissOfDeathState is KissOfDeathCertaintyMutual, it's fine
  it.skip('given no other choice, prioritizes kisses of death from ties over kisses from non-ties', () => {
    for (let i = 0; i < 10; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 5, y: 5}, {x: 5, y: 4}, {x: 5, y: 3}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 25, [{x: 3, y: 5}, {x: 2, y: 5}, {x: 1, y: 5}], "30", "", "") // same length as snek, not likely to go for kill
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 25, [{x: 7, y: 5}, {x: 8, y: 5}, {x: 9, y: 5}, {x: 10, y: 5}], "30", "", "") // larger than snek, likely to go for kill
      gameState.board.snakes.push(otherSnek2)

      const otherSnek3 = new Battlesnake("otherSnek3", "otherSnek3", 25, [{x: 5, y: 7}, {x: 5, y: 8}, {x: 5, y: 9}, {x: 5, y: 10}], "30", "", "") // larger than snek, likely to go for kill
      gameState.board.snakes.push(otherSnek3)

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("left") // snek ought to know that otherSnek is the least likely to go for the kill
    }
  })

  // lookahead means this is no longer guaranteed, snek may choose to prolong until a better opportunity arises
  it.skip('should attempt to eat another snake given the opportunity', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 2, y: 2}, {x: 2, y: 3}, {x: 1, y: 3}, {x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5}, {x: 0, y: 6}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 1, y: 1}, {x: 1, y: 0}, {x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}], "30", "", "")
      gameState.board.snakes.push(otherSnek)
      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("down") // left murder isn't likely to land & puts us in a 0move, down murder is obvious
    }
  })
  // with lookahead, may no longer be valid - particularly may want to go up instead for future looping
  it.skip('seeks out food under normal competitive circumstances', () => {
    for (let i: number = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 90, [{x: 5, y: 5}, {x: 5, y: 4}, {x: 5, y: 3}, {x: 5, y: 2}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 2, y: 10}, {x: 3, y: 10}, {x: 4, y: 10}, {x: 5, y: 10}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 8, y: 5}]

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("right") // food is straight right, should seek it out
    }
  })

  // we no longer want to ignore food, even when king snake
  it.skip('ignores food when adjacent to it but hunting another snake', () => {
    for (let i: number = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 90, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}, {x: 4, y: 1}, {x: 5, y: 1}, {x: 6, y: 1}, {x: 7, y: 1}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 6, y: 10}, {x: 7, y: 10}, {x: 8, y: 10}, {x: 9, y: 10}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 2, y: 1}, {x: 6, y: 6}]

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("down") // food is left, but we're king snake, should be hunting otherSnek & not food
    }
  })
  // area control may render this one obsolete
  it.skip('does not travel through hazard longer than necessary', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 40, [{x: 7, y: 2}, {x: 6, y: 2}, {x: 5, y: 2}, {x: 5, y: 3}, {x: 5, y: 4}, {x: 6, y: 4}, {x: 6, y: 5}, {x: 7, y: 5}, {x: 7, y: 6}, {x: 8, y: 6}, {x: 9, y: 6}], "30", "", "")
    
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 30, [{x: 1, y: 4}, {x: 1, y: 3}, {x: 2, y: 3}, {x: 2, y: 4}, {x: 2, y: 5}, {x: 2, y: 6}, {x: 3, y: 6}, {x: 4, y: 6}, {x: 4, y: 5}, {x: 3, y: 5}], "30", "", "")
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
  // no longer passing with area control, snek would rather wander off & secure more board
  it.skip('continues sandwiching an enemy snake so long as its other half does', () => {
    for (let i: number = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 70, [{x: 5, y: 2}, {x: 5, y: 1}, {x: 5, y: 0}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 70, [{x: 7, y: 2}, {x: 7, y: 1}, {x: 8, y: 1}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 70, [{x: 6, y: 2}, {x: 6, y: 1}, {x: 6, y: 0}, {x: 7, y: 0}, {x: 8, y: 0}], "30", "", "")
      gameState.board.snakes.push(otherSnek2)

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // otherSnek2 is currently sandwiched, should continue moving up to continue sandwiching
    }
  })
  it.skip('does not seek to acquire food when it is large enough and no longer wants food', () => {
    for (let i: number = 0; i < 3; i++) {
      // 92 health: didn't just become large enough to stop caring about food, but also high enough health to not feel like it's better to just top health up
      const snek = new Battlesnake("snek", "snek", 92, [{x: 8, y: 8}, {x: 8, y: 7}, {x: 8, y: 6}, {x: 8, y: 5}, {x: 8, y: 4}, {x: 8, y: 3}, {x: 8, y: 2}, {x: 9, y: 2}, {x: 9, y: 3}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 5, y: 5}, {x: 6, y: 5}, {x: 7, y: 5}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 80, [{x: 0, y: 5}, {x: 0, y: 4}, {x: 1, y: 4}], "30", "", "")
      gameState.board.snakes.push(otherSnek2)

      gameState.board.food = [{x: 9, y: 9}]

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("left") // snek is large enough, should ignore food cache directly up & right & go back towards center & other snakes
    }
  })
  // now failing because snek correctly would rather secure more open space than sequester itself in hazard where otherSnek can potentially pin it in
  it.skip('still seeks acquiring food when large enough to no longer want food, but stuck in hazard', () => {
    for (let i: number = 0; i < 3; i++) {
      // 50 health: snake is a bit wanting for health, so will brave some hazard in order to top up
      const snek = new Battlesnake("snek", "snek", 50, [{x: 8, y: 8}, {x: 8, y: 7}, {x: 8, y: 6}, {x: 8, y: 5}, {x: 8, y: 4}, {x: 8, y: 3}, {x: 8, y: 2}, {x: 9, y: 2}, {x: 9, y: 3}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 5, y: 5}, {x: 6, y: 5}, {x: 7, y: 5}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 80, [{x: 0, y: 5}, {x: 0, y: 4}, {x: 1, y: 4}], "30", "", "")
      gameState.board.snakes.push(otherSnek2)

      gameState.board.food = [{x: 9, y: 9}]

      createHazardColumn(gameState.board, 10)
      createHazardColumn(gameState.board, 9)
      createHazardColumn(gameState.board, 8)
      createHazardColumn(gameState.board, 7)

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("right") // snek should still care about food because it's in hazard, & should loop right->up->left->left to navigate in & out of hazard while retrieving food
    }
  })
  // board is wide open, area control will do as it pleases now
  it.skip('seeks out a face off cell in a duel', () => {
    for (let i: number = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 70, [{x: 3, y: 5}, {x: 2, y: 5}, {x: 1, y: 5}, {x: 1, y: 6}, {x: 1, y: 7}, {x: 1, y: 8}, {x: 1, y: 9}, {x: 1, y: 10}, {x: 0, y: 10}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 70, [{x: 7, y: 5}, {x: 8, y: 5}, {x: 9, y: 5}, {x: 9, y: 6}, {x: 8, y: 6}, {x: 7, y: 6}, {x: 7, y: 7}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 6, y: 5}]

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("right") // right will likely put us in a faceoff with otherSnek, who wants the food & will go left
    }
  })
})

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
      for (let i = 0; i < 3; i++) {
        const snek = new Battlesnake("snek", "snek", 80, [{ x: 2, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }], "30", "", "")
        const gameState = createGameState(snek)
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
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 0, y: 0}, {x: 0, y: 1}, {x: 1, y: 1}, {x: 1, y: 0}], "30", "", "") // 50 health means it hasn't just eaten
      const gameState = createGameState(snek)
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("right")
    }
  })
  it('should be allowed to chase another snake tail', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 50, [{x: 1, y: 1}, {x: 2, y: 1}, {x: 2, y: 0}, {x: 1, y: 0}], "30", "", "")
      gameState.board.snakes.push(otherSnek)
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("right")
    }
  })
  it('should allow otherSnakes to chase their own tails', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 50, [{x: 10, y: 10}, {x: 10, y: 9}, {x: 9, y: 9}, {x: 9, y: 10}], "30", "", "")
      gameState.board.snakes.push(otherSnek)
      let otherSnekMove = decideMove(gameState, otherSnek, Date.now(), new HazardWalls(gameState), snek.health)
      expect(otherSnekMove.direction).toBe(Direction.Left)
    }
  })
  it('should allow otherSnakes to chase other snake tails', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 0, y: 2}, {x: 0, y: 1}, {x: 0, y: 0}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 50, [{x: 1, y: 0}, {x: 1, y: 1}, {x: 2, y: 1}, {x: 2, y: 0}, {x: 3, y: 0}], "30", "", "")
      gameState.board.snakes.push(otherSnek)
      let otherSnekMove = decideMove(gameState, otherSnek, Date.now(), new HazardWalls(gameState), snek.health)
      expect(otherSnekMove.direction).toBe(Direction.Left)
    }
  })
  it('should not chase its tail if it just ate', () => {
    // x x x
    // t x x
    // h x x
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 100, [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 1}], "30", "", "")
      const gameState = createGameState(snek)
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("right")
    }
  })
  it('should not enter a space it can exclusively leave via tail if that snake will eat', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 6, y: 6}, {x: 6, y: 7}, {x: 5, y: 7}, {x: 5, y: 8}, {x: 4, y: 8}, {x: 4, y: 7}, {x: 4, y: 6}, {x: 3, y: 6}, {x: 2, y: 6}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 100, [{x: 8, y: 2}, {x: 8, y: 3}, {x: 8, y: 4}, {x: 7, y: 4}, {x: 7, y: 5}, {x: 6, y: 5}, {x: 5, y: 5}, {x: 5, y: 5}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 0, y: 4}, {x: 7, y: 2}]

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("left") // left will be trapped by otherSnek's tail if otherSnek gets the food at 7,2 like it should
    }
  })
})

describe('BattleSnake chooses death by snake over death by wall or hazard', () => {
  it('always chooses a snake body over a border death given no other valid moves', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 5, y: 10}, {x: 6, y: 10}, {x: 7, y: 10}, {x: 7, y: 9}, {x: 7, y: 8}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 50, [{x: 6, y: 9}, {x: 5, y: 9}, {x: 4, y: 9}, {x: 4, y: 10}, {x: 3, y: 10}, {x: 2, y: 10}, {x: 2, y: 9}, {x: 1, y: 9}], "30", "", "")
      gameState.board.snakes.push(otherSnek)
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("up")
    }
  })
  it('always chooses a snake body over a hazard death or wall given no other valid moves', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 10, [{x: 5, y: 10}, {x: 6, y: 10}, {x: 7, y: 10}, {x: 7, y: 9}, {x: 7, y: 8}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 50, [{x: 6, y: 9}, {x: 5, y: 9}, {x: 4, y: 9}, {x: 3, y: 9}, {x: 2, y: 9}], "30", "", "")
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
    const snek = new Battlesnake("snek", "snek", 80, [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 1}], "30", "", "")
    const gameState = createGameState(snek)
    const gameBoard = gameState.board

    gameBoard.food = [{x: 1, y: 1}, {x: 1, y: 2}]
    gameBoard.hazards = [{x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}]

    let board2d = new Board2d(gameState)

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

describe('Wall tests', () => {
  it('should not go left if there is a wall there', () => {
    // x x x
    // h s t
    // x x x
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 0, y: 1}, {x: 1, y: 1}, {x: 2, y: 1}], "30", "", "")
      const gameState = createGameState(snek)
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("left")
    }
  })
  it('should not go right if there is a wall there', () => {
    // x x x
    // t s h
    // x x x
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 10, y: 1}, {x: 9, y: 1}, {x: 8, y: 1}], "30", "", "")
      const gameState = createGameState(snek)
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("right")
    }
  })
  it('should not go up if there is a wall there', () => {
    // x h x
    // x s x
    // x t x
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 1, y: 10}, {x: 1, y: 9}, {x: 1, y: 8}], "30", "", "")
      const gameState = createGameState(snek)
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("up")
    }
  })
  it('should not go down if there is a wall there', () => {
    // x t x
    // x s x
    // x h x
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 1, y: 0}, {x: 1, y: 1}, {x: 1, y: 2}], "30", "", "")
      const gameState = createGameState(snek)
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("down")
    }
  })
})

describe('Body tests', () => {
  it('should not move into its own body, other than the tail', () => {
    // x s s
    // x s h
    // x t x
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 2, y: 1}, {x: 2, y: 2}, {x: 1, y: 2}, {x: 1, y: 1}, {x: 1, y: 0}], "30", "", "")
      const gameState = createGameState(snek)
      let moveResponse: MoveResponse = move(gameState)
      expect(["down", "right"]).toContain(moveResponse.move)
    }
  })
  it('should go somewhere that does not have a snake body', () => {
    // x x  x
    // s h  x
    // s s1 h1
    // t s1 t1
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 1, y: 2}, {x: 0, y: 2}, {x: 0, y: 1}, {x: 0, y: 0}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 2, y: 1}, {x: 1, y: 1}, {x: 1, y: 0}, {x: 2, y: 0}], "30", "", "")
      gameState.board.snakes.push(otherSnek)
      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("down")
    }
  })
})

describe('Longest snake tests', () => {
  it('should return the longest, closest snake other than itself', () => {
    const snek = new Battlesnake("snek", "snek", 80, [{x: 0, y: 0}, {x: 1, y: 0}, {x: 2, y: 0}, {x: 3, y: 0}], "30", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 0, y: 2}, {x: 1, y: 2}, {x: 1, y: 2}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 80, [{x: 5, y: 2}, {x: 5, y: 2}, {x: 5, y: 2}], "30", "", "")
    gameState.board.snakes.push(otherSnek2)

    const longestSnake = getLongestOtherSnake(snek, gameState.board.snakes)
    expect(longestSnake).toBeDefined()
    if (longestSnake !== undefined) {
      expect(longestSnake.id).toBe("otherSnek") // otherSnek is closer to snek, both otherSnek and otherSnek2 are length 2
    }
  })
  it('should know if it is at least two longer than any other snake', () => {
    const snek = new Battlesnake("snek", "snek", 80, [{x: 0, y: 0}, {x: 1, y: 0}, {x: 2, y: 0}, {x: 3, y: 0}], "30", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 0, y: 2}, {x: 1, y: 2}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    const kingOfSnakes = isKingOfTheSnakes(snek, gameState.board)
    expect(kingOfSnakes).toBe(true)
  })
})

describe('Kiss of death tests', () => {
  it('should navigate away from kiss of death cells towards freedom', () => {
    // x  x  x x x x  x
    // s1 s1 x x x s2 s2
    // s1 h1 x h x h2 s2
    // t1 x  t s x x  t2
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 3, y: 3}, {x: 3, y: 2}, {x: 2, y: 2}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 1, y: 3}, {x: 1, y: 4}, {x: 0, y: 4}, {x: 0, y: 3}, {x: 0, y: 2}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 80, [{x: 5, y: 3}, {x: 5, y: 4}, {x: 6, y: 4}, {x: 6, y: 3}, {x: 6, y: 2}], "30", "", "")
      gameState.board.snakes.push(otherSnek2)
      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // left & right should result in death kisses, leaving up
    }
  })
  // good test case for otherSnakes always correctly choosing a kiss of death against me, otherwise snek may think otherSnakes would prioritize killing another snake
  it('navigates away from a single kiss of death certainty towards freedom', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 90, [{x: 2, y: 4}, {x: 3, y: 4}, {x: 3, y: 5}, {x: 2, y: 5}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 3, y: 3}, {x: 4, y: 3}, {x: 5, y: 3}, {x: 5, y: 4}, {x: 5, y: 5}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 90, [{x: 0, y: 2}, {x: 1, y: 2}, {x: 1, y: 1}], "30", "", "")
      gameState.board.snakes.push(otherSnek2)

      const otherSnek3 = new Battlesnake("otherSnek3", "otherSnek3", 90, [{x: 4, y: 0}, {x: 4, y: 1}, {x: 5, y: 1}, {x: 6, y: 1}, {x: 6, y: 2}], "30", "", "")
      gameState.board.snakes.push(otherSnek3)

      gameState.board.food = [{x: 0, y: 0}]

      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("down") // down meets otherSnek & I am very small, left & up are both no kiss
    }
  })
  it('chooses a kiss of death cell over a snake body if those are the sole options', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 5, y: 3}, {x: 4, y: 3}, {x: 3, y: 3}, {x: 2, y: 3}, {x: 1, y: 3}, {x: 1, y: 4}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 5, y: 1}, {x: 6, y: 1}, {x: 6, y: 2}, {x: 6, y: 3}, {x: 6, y: 4}, {x: 7, y: 4}, {x: 7, y: 5}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 80, [{x: 5, y: 5}, {x: 4, y: 5}, {x: 3, y: 5}, {x: 2, y: 5}, {x: 1, y: 5}, {x: 1, y: 6}], "30", "", "")
      gameState.board.snakes.push(otherSnek2)

      let moveResponse : MoveResponse = move(gameState)
      let allowedMoves : string[] = ["up", "down"]
      expect(allowedMoves).toContain(moveResponse.move)
    }
  })
  it('should navigate towards a kiss that might happen instead of a kiss that ought to happen', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 2, y: 4}, {x: 3, y: 4}, {x: 3, y: 3}, {x: 3, y: 2}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 1, y: 3}, {x: 0, y: 3}, {x: 0, y: 2}, {x: 0, y: 1}, {x: 1, y: 0}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 80, [{x: 3, y: 5}, {x: 4, y: 5}, {x: 5, y: 5}, {x: 6, y: 5}, {x: 7, y: 5}], "30", "", "")
      gameState.board.snakes.push(otherSnek2)
      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("up") // up is certain death to otherSnek2, but left or down are 50% death to otherSnek
    }
  })
  it('should navigate elsewhere, even an otherwise worse tile', () => {
    // x x h1 s1 s1
    // x h s  x  s1
    // x x s  t  t1
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 1, y: 1}, {x: 2, y: 1}, {x: 2, y: 0}, {x: 3, y: 0}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 4, y: 2}, {x: 4, y: 1}, {x: 4, y: 0}], "30", "", "")
      gameState.board.snakes.push(otherSnek)
      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("up") // left & bottom shove me in a corner, but don't result in a kiss of death
    }
  })
  it('avoids future kisses of death choices', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 5, y: 5}, {x: 4, y: 5}, {x: 3, y: 5}, {x: 3, y: 4}, {x: 2, y: 4}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 3, y: 7}, {x: 3, y: 8}, {x: 4, y: 8}, {x: 4, y: 9}, {x: 5, y: 9}, {x: 5, y: 8}, {x: 6, y: 8}, {x: 7, y: 8}, {x: 7, y: 7}, {x: 8, y: 7}, {x: 8, y: 6}, {x: 7, y: 6}, {x: 6, y: 6}, {x: 6, y: 7}, {x: 5, y: 7}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 80, [{x: 0, y: 6}, {x: 1, y: 6}, {x: 2, y: 6}, {x: 2, y: 7}, {x: 2, y: 8}, {x: 1, y: 8}, {x: 1, y: 7}, {x: 0, y: 7}, {x: 0, y: 8}, {x: 0, y: 9}, {x: 0, y: 10}], "30", "", "")
      gameState.board.snakes.push(otherSnek2)

      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("up") // up puts us in a 50/50 against otherSnek for basically no reason
    }
  })
  it('avoids a tie kiss of death', () => {
    // x x h1 s1 s1
    // x h s  x  t1
    // x x s  t  x
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 1, y: 1}, {x: 2, y: 1}, {x: 2, y: 0}, {x: 3, y: 0}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 4, y: 2}, {x: 4, y: 1}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 80, [{x: 9, y: 9}, {x: 9, y: 8}, {x: 9, y: 7}], "30", "", "")
      gameState.board.snakes.push(otherSnek2)
      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("up") // a tie kiss is still a death kiss, don't risk it given better alternatives
    }
  })
  it('avoids a tie kiss of death v2', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 95, [{x: 5, y: 6}, {x: 5, y: 7}, {x: 4, y: 7}, {x: 4, y: 6}, {x: 3, y: 6}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 95, [{x: 5, y: 4}, {x: 5, y: 3}, {x: 4, y: 3}, {x: 4, y: 4}, {x: 4, y: 5}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 95, [{x: 6, y: 3}, {x: 6, y: 2}, {x: 7, y: 2}, {x: 7, y: 3}, {x: 7, y: 4}], "30", "", "")
      gameState.board.snakes.push(otherSnek2)

      const otherSnek3 = new Battlesnake("otherSnek3", "otherSnek3", 95, [{x: 1, y: 0}, {x: 2, y: 0}, {x: 3, y: 0}], "30", "", "")
      gameState.board.snakes.push(otherSnek3)

      gameState.turn = 13
      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("down") // down puts us in a possible kissOfDeath tie with otherSnek, whose two options are kisses of death. We can just avoid this by going right.
    }
  })
  it('avoids a tie kiss of death v3', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 82, [{x: 7, y: 6}, {x: 6, y: 6}, {x: 5, y: 6}, {x: 5, y: 7}, {x: 6, y: 7}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 79, [{x: 8, y: 5}, {x: 9, y: 5}, {x: 9, y: 6}, {x: 8, y: 6}, {x: 8, y: 7}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 100, [{x: 9, y: 2}, {x: 9, y: 1}, {x: 9, y: 0}, {x: 8, y: 0}, {x: 7, y: 0}, {x: 6, y: 0}, {x: 6, y: 0}], "30", "", "")
      gameState.board.snakes.push(otherSnek2)

      gameState.turn = 31

      gameState.board.food = [{x: 1, y: 1}, {x: 3, y: 9}, {x: 10, y: 4}]

      createHazardColumn(gameState.board, 10)
      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // down puts us in a possible kissOfDeath tie with otherSnek. We have no reason to risk this, can just go up.
    }
  })
  it('does not avoid a tie kiss of death if in a duel', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 4, y: 5}, {x: 4, y: 4}, {x: 4, y: 3}, {x: 4, y: 2}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 6, y: 5}, {x: 6, y: 6}, {x: 6, y: 7}, {x: 6, y: 8}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 5, y: 5}] // put food in the center so snakes have a good reason to collide

      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("right") // in this case not going for the food means otherSnek has a good chance to get it, putting me at a real disadvantage in a duel. Instead, can just go for it, & maybe tie
    }
  })
  it('does not avoid a tie kiss of death if in a duel if it saves my life', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 100, [{x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 1, y: 4}, {x: 0, y: 4}, {x: 0, y: 5}, {x: 1, y: 5}, {x: 2, y: 5}, {x: 3, y: 5}, {x: 3, y: 6}, {x: 3, y: 7}, {x: 4, y: 7}, {x: 5, y: 7}, {x: 5, y: 8}, {x: 5, y: 9}, {x: 5, y: 10}, {x: 6, y: 10}, {x: 6, y: 10}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 95, [{x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4}, {x: 3, y: 4}, {x: 4, y: 4}, {x: 5, y: 4}, {x: 6, y: 4}, {x: 6, y: 5}, {x: 7, y: 5}, {x: 7, y: 6}, {x: 8, y: 6}, {x: 8, y: 5}, {x: 8, y: 4}, {x: 8, y: 3}, {x: 8, y: 2}, {x: 8, y: 1}, {x: 7, y: 1}, {x: 6, y: 1}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 9, y: 0}, {x: 10, y: 0}, {x: 10, y: 5}, {x: 10, y: 8}]
      createHazardRow(gameState.board, 0)
      createHazardRow(gameState.board, 10)
      createHazardColumn(gameState.board, 0)
      createHazardColumn(gameState.board, 1)
      createHazardColumn(gameState.board, 10)

      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("right") // left traps us in sauce, bottom traps us in sauce a couple turns later. Right threatens tie, but is also not sauce, our best option
    }
  })
  it('avoids a tie kiss of death in a duel if it thinks it can do better', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 6, y: 5}, {x: 6, y: 6}, {x: 6, y: 7}, {x: 7, y: 7}, {x: 8, y: 7}, {x: 8, y: 8}, {x: 7, y: 8}, {x: 6, y: 8}, {x: 5, y: 8}, {x: 5, y: 7}, {x: 5, y: 6}, {x: 4, y: 6}, {x: 3, y: 6}, {x: 3, y: 5}, {x: 4, y: 5}, {x: 4, y: 4}, {x: 4, y: 3}, {x: 4, y: 2}, {x: 4, y: 1}, {x: 5, y: 1}, {x: 5, y: 2}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 25, [{x: 7, y: 6}, {x: 8, y: 6}, {x: 8, y: 5}, {x: 8, y: 4}, {x: 9, y: 4}, {x: 9, y: 3}, {x: 9, y: 2}, {x: 8, y: 2}, {x: 8, y: 1}, {x: 7, y: 1}, {x: 6, y: 1}, {x: 6, y: 0}, {x: 5, y: 0}, {x: 4, y: 0}, {x: 3, y: 0}, {x: 2, y: 0}, {x: 1, y: 0}, {x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}, {x: 0, y: 3}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 0, y: 6}, {x: 0, y: 9}, {x: 1, y: 9}, {x: 1, y: 10}, {x: 4, y: 10}, {x: 10, y: 10}]
      createHazardRow(gameState.board, 0)
      createHazardRow(gameState.board, 1)
      createHazardRow(gameState.board, 2)
      createHazardRow(gameState.board, 8)
      createHazardRow(gameState.board, 9)
      createHazardRow(gameState.board, 10)

      createHazardColumn(gameState.board, 0)
      createHazardColumn(gameState.board, 8)
      createHazardColumn(gameState.board, 9)
      createHazardColumn(gameState.board, 10)

      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("right") // snek has multiple move options & much more health in a hazard-filled board. Don't go for the tie right, make otherSnek play it out
    }
  })
  it('avoids a tie kiss of death in a duel if it thinks it can cut the snake off instead', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 1, y: 7}, {x: 2, y: 7}, {x: 3, y: 7}, {x: 4, y: 7}, {x: 5, y: 7}, {x: 6, y: 7}, {x: 7, y: 7}, {x: 7, y: 6}, {x: 6, y: 6}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 0, y: 6}, {x: 1, y: 6}, {x: 1, y: 5}, {x: 1, y: 4}, {x: 0, y: 4}, {x: 0, y: 3}, {x: 0, y: 2}, {x: 0, y: 1}, {x: 0, y: 0}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 7, y: 8}, {x: 9, y: 0}]

      gameState.game.ruleset.settings.hazardDamagePerTurn = 0

      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // snek can tie by going left, but will cut otherSnek off in a few turns by going up, should prefer that
    }
  })
  it('avoids a tie kiss of death in a duel if it thinks it can cut the snake off instead, v2', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 90, [{x: 9, y: 3}, {x: 8, y: 3}, {x: 7, y: 3}, {x: 7, y: 2}, {x: 6, y: 2}, {x: 6, y: 3}, {x: 6, y: 4}, {x: 5, y: 4}, {x: 4, y: 4}, {x: 4, y: 5}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 97, [{x: 10, y: 2}, {x: 10, y: 1}, {x: 9, y: 1}, {x: 8, y: 1}, {x: 7, y: 1}, {x: 6, y: 1}, {x: 5, y: 1}, {x: 5, y: 2}, {x: 4, y: 2}, {x: 3, y: 2}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 9, y: 7}, {x: 4, y: 10}]

      gameState.turn = 50

      createHazardRow(gameState.board, 10)
      createHazardRow(gameState.board, 9)

      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // snek can tie by going right, but will cut otherSnek off & win if it goes up. Note otherSnek has option of going left, but will die in two turns - may break in speed snake.
    }
  })
  it('does not avoid a tie kiss of death in a non-duel if it saves my life', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 92, [{x: 5, y: 4}, {x: 6, y: 4}, {x: 6, y: 5}, {x: 5, y: 5}, {x: 5, y: 6}, {x: 5, y: 7}, {x: 5, y: 8}, {x: 5, y: 9}, {x: 4, y: 9}, {x: 4, y: 8}, {x: 4, y: 7}, {x: 4, y: 6}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 91, [{x: 3, y: 4}, {x: 2, y: 4}, {x: 2, y: 3}, {x: 2, y: 2}, {x: 3, y: 2}, {x: 4, y: 2}, {x: 5, y: 2}, {x: 6, y: 2}, {x: 6, y: 3}, {x: 7, y: 3}, {x: 7, y: 4}, {x: 8, y: 4}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 85, [{x: 10, y: 5}, {x: 9, y: 5}, {x: 8, y: 5}, {x: 8, y: 6}, {x: 7, y: 6}, {x: 7, y: 7}, {x: 7, y: 8}], "30", "", "")
      gameState.board.snakes.push(otherSnek2)

      gameState.board.food = [{x: 2, y: 0}, {x: 3, y: 1}, {x: 10, y: 4}, {x: 1, y: 10}]

      createHazardRow(gameState.board, 10)
      createHazardColumn(gameState.board, 0)
      createHazardColumn(gameState.board, 9)
      createHazardColumn(gameState.board, 10)

      gameState.turn = 117

      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("left") // left is a tie cell, but otherSnek likely won't go for it, since in a non-duel, ties are losses. Down kills us in a few turns, so should go left.
    }
  })
  it('avoids kisses of death even if it will die in a few turns anyway', () => {
    const snek = new Battlesnake("snek", "snek", 80, [{x: 5, y: 3}, {x: 4, y: 3}, {x: 4, y: 2}, {x: 5, y: 2}, {x: 6, y: 2}, {x: 7, y: 2}, {x: 8, y: 2}, {x: 9, y: 2}, {x: 10, y: 2}, {x: 10, y: 3}, {x: 9, y: 3}, {x: 9, y: 4}, {x: 8, y: 4}, {x: 8, y: 5}, {x: 7, y: 5}, {x: 7, y: 6}, {x: 6, y: 6}], "30", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 25, [{x: 4, y: 4}, {x: 3, y: 4}, {x: 3, y: 5}, {x: 4, y: 5}, {x: 4, y: 6}, {x: 4, y: 7}, {x: 5, y: 7}, {x: 6, y: 7}, {x: 7, y: 7}, {x: 8, y: 7}, {x: 9, y: 7}, {x: 10, y: 7}, {x: 10, y: 8}, {x: 10, y: 9}, {x: 9, y: 9}, {x: 8, y: 9}, {x: 7, y: 9}, {x: 6, y: 9}, {x: 6, y: 8}, {x: 5, y: 8}, {x: 4, y: 8}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    gameState.board.food = [{x: 7, y: 4}, {x: 9, y: 6}]

    let moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).not.toBe("up") // otherSnek 'must' move here, & it will eat us if we do too. We will get shoved into a corner in four turns anyway, but don't just walk into otherSnek
  })
  it('avoids kisses of death that it can avoid even if they have food', () => {
    const snek = new Battlesnake("snek", "snek", 80, [{x: 4, y: 3}, {x: 5, y: 3}, {x: 6, y: 3}, {x: 6, y: 2}], "30", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 25, [{x: 5, y: 4}, {x: 5, y: 5}, {x: 5, y: 6}, {x: 5, y: 7}, {x: 5, y: 8}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 25, [{x: 3, y: 6}, {x: 2, y: 6}, {x: 2, y: 5}, {x: 1, y: 5}], "30", "", "")
    gameState.board.snakes.push(otherSnek2)

    const otherSnek3 = new Battlesnake("otherSnek3", "otherSnek3", 25, [{x: 7, y: 6}, {x: 8, y: 6}, {x: 9, y: 6}, {x: 10, y: 6}], "30", "", "")
    gameState.board.snakes.push(otherSnek3)

    gameState.board.food = [{x: 4, y: 4}]

    let moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).not.toBe("up") // otherSnek has every reason to take the food, & if we go there we'll be eaten
  })
  it('avoids a tie kiss of death in a non-duel situation', () => {
    const snek = new Battlesnake("snek", "snek", 95, [{x: 2, y: 8}, {x: 3, y: 8}, {x: 3, y: 7}, {x: 4, y: 7}, {x: 4, y: 6}, {x: 4, y: 5}, {x: 4, y: 4}], "30", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 65, [{x: 1, y: 7}, {x: 1, y: 6}, {x: 2, y: 6}, {x: 2, y: 5}, {x: 2, y: 4}, {x: 2, y: 3}, {x: 3, y: 3}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 40, [{x: 0, y: 8}, {x: 0, y: 7}, {x: 0, y: 6}, {x: 0, y: 5}], "30", "", "")
    gameState.board.snakes.push(otherSnek2)

    const otherSnek3 = new Battlesnake("otherSnek3", "otherSnek3", 80, [{x: 6, y: 6}, {x: 7, y: 6}, {x: 8, y: 6}, {x: 8, y: 5}, {x: 8, y: 4}, {x: 8, y: 3}, {x: 7, y: 3}], "30", "", "")
    gameState.board.snakes.push(otherSnek3)

    gameState.board.food = [{x: 4, y: 10}]

    createHazardRow(gameState.board, 10)
    createHazardRow(gameState.board, 0)

    let moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("up") // down is certain death, left is almost certainly a tie death with otherSnek. Up is sensible choice
  })
  it('avoids moving towards a cell that would result in kisses of death', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 4, y: 10}, {x: 3, y: 10}, {x: 3, y: 9}, {x: 3, y: 8}, {x: 3, y: 7}, {x: 3, y: 6}, {x: 3, y: 5}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 5, y: 9}, {x: 6, y: 9}, {x: 6, y: 8}, {x: 6, y: 7}, {x: 7, y: 7}, {x: 8, y: 7}, {x: 9, y: 7}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 5, y: 8}, {x: 7, y: 5}]

      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("right") // down will put me in a situation where I will be kissed to death the next turn
    }
  })
  // valid test, but sadly snek just wants that food too badly. Even notching the tie penalty all the way up to 200 wasn't enough.
  it('avoids tie kiss of death in non-duel if otherSnake is likely to also go there', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 40, [{x: 3, y: 6}, {x: 4, y: 6}, {x: 4, y: 7}, {x: 5, y: 7}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 40, [{x: 4, y: 5}, {x: 4, y: 4}, {x: 5, y: 4}, {x: 5, y: 3}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 80, [{x: 6, y: 6}, {x: 7, y: 6}, {x: 7, y: 5}, {x: 8, y: 5}, {x: 8, y: 4}, {x: 7, y: 4}, {x: 6, y: 4}, {x: 6, y: 5}], "30", "", "")
      gameState.board.snakes.push(otherSnek2)

      const otherSnek3 = new Battlesnake("otherSnek3", "otherSnek3", 90, [{x: 3, y: 2}, {x: 3, y: 3}, {x: 2, y: 3}, {x: 1, y: 3}, {x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5}, {x: 0, y: 6}], "30", "", "")
      gameState.board.snakes.push(otherSnek3)

      gameState.board.food = [{x: 0, y: 0}, {x: 3, y: 4}, {x: 10, y: 7}]

      createHazardRow(gameState.board, 0)
      createHazardColumn(gameState.board, 10)

      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("down") // I have three options, down is the sole possible death. otherSnek2 will want the food & to escape otherSnek3, so will likely go left. Avoid the tie.
    }
  })
})

describe('Kiss of murder tests', () => {
  // in this test, up is a guaranteed immediate kill, though right is also a guaranteed kill in three moves. Take the immediate win.
  it('seeks out murder even on the outskirts of town', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 9, y: 9}, {x: 8, y: 9}, {x: 7, y: 9}, {x: 7, y: 8}, {x: 6, y: 8}, {x: 6, y: 7}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 8, y: 10}, {x: 7, y: 10}, {x: 6, y: 10}, {x: 5, y: 10}, {x: 5, y: 9}], "30", "", "")
      gameState.board.snakes.push(otherSnek)
      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // should try to murder the snake by going up
    }
  })
  it('does not seek out a murder of avoidance if it leads it into a bad situation', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 3, y: 7}, {x: 2, y: 7}, {x: 1, y: 7}, {x: 0, y: 7}, {x: 0, y: 6}, {x: 0, y: 5}, {x: 1, y: 5}, {x: 1, y: 4}, {x: 1, y: 3}, {x: 2, y: 3}, {x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}, {x: 4, y: 1}, {x: 5, y: 1}, {x: 5, y: 2}, {x: 4, y: 2}, {x: 4, y: 3}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 4, y: 8}, {x: 4, y: 7}, {x: 4, y: 6}, {x: 5, y: 6}, {x: 6, y: 6}, {x: 7, y: 6}, {x: 8, y: 6}, {x: 8, y: 5}, {x: 8, y: 4}, {x: 9, y: 4}, {x: 9, y: 3}, {x: 9, y: 2}, {x: 9, y: 1}, {x: 8, y: 1}, {x: 7, y: 1}, {x: 7, y: 2}], "30", "", "")
      gameState.board.snakes.push(otherSnek)
      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("up") // up quickly leads us into a rotten situation where we are cut off in the corner & die. Don't chase otherSnek there
    }
  })
  // sadly nerfing the reward for being the last snake means the reward for this future kill is not enough to get us to go down anymore
  it.skip('looks ahead and goes for a surefire kill far in the future', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 4, y : 5}, {x: 5, y: 5}, {x: 5, y: 4}, {x: 5, y: 3}, {x: 5, y: 2}, {x: 5, y: 1}, {x: 5, y: 0}, {x: 6, y: 0}, {x: 7, y: 0}, {x: 8, y: 0}, {x: 8, y: 1}, {x: 7, y: 1}, {x: 6, y: 1}, {x: 6, y: 2}, {x: 6, y: 3}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 0, y: 1}, {x: 0, y: 2}, {x: 1, y: 2}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 3, y: 3}, {x: 3, y: 2}, {x: 3, y: 1}, {x: 3, y: 0}, {x: 2, y: 0}, {x: 2, y: 1}, {x: 1, y: 1}, {x: 1, y: 0}, {x: 0, y: 0}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 6, y: 5}, {x: 9, y: 5}, {x: 0, y: 10}, {x: 8, y: 10}]

      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("down") // given at least 6 lookahead (& no timeouts), down will 100% of the time lead to a kiss of murder in 6 turns
    }
  })
  it('chooses a murder that leads it towards open space if it misses', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 5, y: 1}, {x: 4, y: 1}, {x: 4, y: 0}, {x: 3, y: 0}, {x: 3, y: 1}, {x: 2, y: 1}, {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5}, {x: 1, y: 5}, {x: 1, y: 6}, {x: 1, y: 7}, {x: 1, y: 8}, {x: 2, y: 8}, {x: 2, y: 7}, {x: 3, y: 7}, {x: 4, y: 7}, {x: 4, y: 6}, {x: 4, y: 5}, {x: 4, y: 4}, {x: 5, y: 4}, {x: 5, y: 3}, {x: 4, y: 3}, {x: 3, y: 3}, {x: 2, y: 3}, {x: 2, y: 2}, {x: 3, y: 2}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 6, y: 2}, {x: 7, y: 2}, {x: 7, y: 1}, {x: 8, y: 1}, {x: 9, y: 1}, {x: 9, y: 0}, {x: 10, y: 0}, {x: 10, y: 1}, {x: 10, y: 2}, {x: 10, y: 3}, {x: 10, y: 4}, {x: 10, y: 5}, {x: 9, y: 5}, {x: 8, y: 5}, {x: 7, y: 5}, {x: 7, y: 4}, {x: 8, y: 4}, {x: 8, y: 3}, {x: 7, y: 3}, {x: 6, y: 3}, {x: 6, y: 4}, {x: 6, y: 5}, {x: 6, y: 6}, {x: 7, y: 6}, {x: 8, y: 6}, {x: 9, y: 6}, {x: 9, y: 7}, {x: 10, y: 7}, {x: 10, y: 8}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 8, y: 2}, {x: 0, y: 8}]

      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // down is puts us in a box, right is a 50/50 kill but puts us in a box if we miss. Up is also a 50/50, & if we miss, it shoves otherSnek in said box.
    }
  })
  it('prioritizes kill moves in safer tiles', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 90, [{x: 4, y: 4}, {x: 4, y: 5}, {x: 5, y: 5}, {x: 5, y: 6}, {x: 5, y: 7}, {x: 5, y: 8}, {x: 4, y: 8}, {x: 4, y: 9}, {x: 3, y: 9}, {x: 3, y: 9}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 7, y: 5}, {x: 6, y: 5}, {x: 6, y: 6}, {x: 6, y: 7}, {x: 6, y: 8}, {x: 7, y: 8}, {x: 7, y: 9}, {x: 7, y: 10}, {x: 8, y: 10}, {x: 9, y: 10}, {x: 9, y: 9}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 90, [{x: 5, y: 3}, {x: 6, y: 3}, {x: 6, y: 4}, {x: 7, y: 4}, {x: 8, y: 4}, {x: 9, y: 4}, {x: 10, y: 4}, {x: 10, y: 3}, {x: 10, y: 2}], "30", "", "")
      gameState.board.snakes.push(otherSnek2)
      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("right") // snek can eat otherSnek2 at right or down, but going right will result in certain death unless otherSnek2 stupidly goes up
    }
  })
  it('does not attempt a kill in a cell where its prey can escape by chasing another snake tail', () => {
    const snek = new Battlesnake("snek", "snek", 90, [{x: 7, y: 7}, {x: 6, y: 7}, {x: 6, y: 6}, {x: 6, y: 5}, {x: 7, y: 5}, {x: 8, y: 5}, {x: 9, y: 5}, {x: 9, y: 6}], "30", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 50, [{x: 8, y: 6}, {x: 8, y: 7}, {x: 8, y: 8}, {x: 8, y: 9}, {x: 9, y: 9}, {x: 10, y: 9}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 90, [{x: 5, y: 9}, {x: 5, y: 8}, {x: 5, y: 7}, {x: 5, y: 6}, {x: 5, y: 5}, {x: 5, y: 4}, {x: 5, y: 3}, {x: 5, y: 2}], "30", "", "")
    gameState.board.snakes.push(otherSnek2)
    let moveResponse : MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("up") // as above, otherSnek should never go left, so snek should never close itself in by trying to eat it going down
  })
  it('will equal the other snake length after the other snake grows', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 90, [{x: 4, y: 4}, {x: 4, y: 5}, {x: 5, y: 5}, {x: 5, y: 6}, {x: 5, y: 7}, {x: 5, y: 8}, {x: 4, y: 8}, {x: 4, y: 9}, {x: 3, y: 9}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 1, y: 0}, {x: 2, y: 0}, {x: 3, y: 0}], "30", "", "") // otherSnek so snek doesn't think this is a duel where collisions are acceptable
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 100, [{x: 5, y: 3}, {x: 6, y: 3}, {x: 6, y: 4}, {x: 7, y: 4}, {x: 8, y: 4}, {x: 9, y: 4}, {x: 10, y: 4}, {x: 10, y: 3}, {x: 10, y: 3}], "30", "", "")
      gameState.board.snakes.push(otherSnek2)

      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("left") // snek should avoid otherSnek2 as they are effectively the same length now that otherSnek2 has eaten
    }
  })
  it('will go up or right to avoid a chicken situation', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 100, [{x: 5, y: 9}, {x: 5, y: 8}, {x: 5, y: 7}, {x: 4, y: 7}, {x: 4, y: 6}, {x: 4, y: 5}, {x: 4, y: 4}, {x: 4, y: 3}, {x: 4, y: 2}, {x: 5, y: 2}, {x: 6, y: 2}, {x: 6, y: 3}, {x: 6, y: 4}, {x: 7, y: 4}, {x: 7, y: 5}, {x: 7, y: 5}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 90, [{x: 4, y: 8}, {x: 3, y: 8}, {x: 3, y: 7}, {x: 3, y: 6}, {x: 3, y: 5}, {x: 3, y: 4}, {x: 3, y: 3}, {x: 3, y: 2}, {x: 2, y: 2}, {x: 1, y: 2}, {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5}, {x: 1, y: 5}, {x: 1, y: 6}], "30", "", "")
      gameState.board.snakes.push(otherSnek2)
      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("left")
    }
  })
  it('will not try to kill in a situation where it will die no matter what', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 83, [{x: 2, y: 9}, {x: 3, y: 9}, {x: 3, y: 10}, {x: 4, y: 10}, {x: 4, y: 9}, {x: 4, y: 8}, {x: 4, y: 7}, {x: 5, y: 7}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 96, [{x: 1, y: 10}, {x: 1, y: 9}, {x: 1, y: 8}, {x: 0, y: 8}, {x: 0, y: 7}, {x: 1, y: 7}, {x: 2, y: 7}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 80, [{x: 2, y: 5}, {x: 3, y: 5}, {x: 3, y: 4}, {x: 3, y: 3}, {x: 2, y: 3}, {x: 2, y: 2}, {x: 1, y: 2}, {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5}], "30", "", "")
      gameState.board.snakes.push(otherSnek2)

      const otherSnek3 = new Battlesnake("otherSnek3", "otherSnek3", 99, [{x: 7, y: 10}, {x: 6, y: 10}, {x: 6, y: 9}, {x: 6, y: 8}, {x: 6, y: 7}, {x: 7, y: 7}, {x: 7, y: 6}, {x: 8, y: 6}, {x: 8, y: 7}, {x: 8, y: 8}], "30", "", "")
      gameState.board.snakes.push(otherSnek3)

      gameState.turn = 87

      gameState.board.food = [{x: 0, y: 1}]

      createHazardColumn(gameState.board, 10)
      createHazardRow(gameState.board, 0)
      createHazardRow(gameState.board, 1)

      let moveResponse : MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("down") // up will kill me unless otherSnek deliberately kills itself against me. Down likely kills me against otherSnek2 in a few turns, but obviously better
    }
  })
})

describe('Cloned game state tests', () => {
  it('Cloned game state should contain identical values which can be changed without changing the original', () => {
    const snek = new Battlesnake("snek", "snek", 90, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}, {x: 4, y: 1}, {x: 5, y: 1}], "30", "", "")
    const gameState = createGameState(snek)

    gameState.board.food = [{x: 5, y: 5}, {x: 6, y: 6}]

    gameState.board.hazards = [{x:0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5}, {x: 0, y: 6}, {x: 0, y: 7}, {x: 0, y: 8}, {x: 0, y: 9}, {x: 0, y: 10}]

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 100, [{x: 9, y: 5}, {x: 10, y: 5}, {x: 10, y: 4}, {x: 9, y: 4}, {x: 8, y: 4}, {x: 8, y: 4}], "30", "", "")
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
    expect(gameState.game.timeout).toBe(600)
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
    expect(gameState.board.snakes[0].latency).toBe("30")
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

    expect(gameState.you.id).toBe("snek")

    // reassign clone youSnake, check if original youSnake was affected
    clone.you = cloneSnek1

    expect(gameState.you.name).toBe("snek")
  })
  it('should have the same snakes, rulesets, etc', () => {
    const snek = new Battlesnake("snek", "snek", 90, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}, {x: 4, y: 1}, {x: 5, y: 1}], "30", "", "")
    const gameState = createGameState(snek)

    gameState.board.food = [{x: 5, y: 5}, {x: 6, y: 6}]

    gameState.board.hazards = [{x:0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5}, {x: 0, y: 6}, {x: 0, y: 7}, {x: 0, y: 8}, {x: 0, y: 9}, {x: 0, y: 10}]

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 100, [{x: 9, y: 5}, {x: 10, y: 5}, {x: 10, y: 4}, {x: 9, y: 4}, {x: 8, y: 4}, {x: 8, y: 4}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    const clone = cloneGameState(gameState)

    expect(clone.turn).toBe(30)

    expect(clone.game.id).toBe("totally-unique-game-id")
    expect(clone.game.source).toBe("testing")
    expect(clone.game.timeout).toBe(600)

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
    expect(clone.board.snakes[0].latency).toBe("30")
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

describe('MoveSnake tests', () => {
  it('should have correct body and health after moving', () => {
    const snek = new Battlesnake("snek", "snek", 80, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}, {x: 4, y: 1}, {x: 5, y: 1}], "30", "", "")
    const gameState = createGameState(snek)

    gameState.board.food = [{x: 5, y: 5}, {x: 6, y: 6}]

    gameState.board.hazards = [{x:0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5}, {x: 0, y: 6}, {x: 0, y: 7}, {x: 0, y: 8}, {x: 0, y: 9}, {x: 0, y: 10}]

    const board2d = new Board2d(gameState)

    moveSnake(gameState, snek, board2d, Direction.Up)

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
  it('should have correct body and health after moving into hazard', () => {
    const snek = new Battlesnake("snek", "snek", 80, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}, {x: 4, y: 1}, {x: 5, y: 1}], "30", "", "")
    const gameState = createGameState(snek)

    gameState.board.food = [{x: 5, y: 5}, {x: 6, y: 6}]

    gameState.board.hazards = [{x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4}, {x: 2, y: 5}, {x: 2, y: 6}, {x: 2, y: 7}, {x: 2, y: 8}, {x: 2, y: 9}, {x: 2, y: 10}]

    const board2d = new Board2d(gameState)

    moveSnake(gameState, snek, board2d, Direction.Up)

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
  it('should have correct body and health after moving into food', () => {
    const snek = new Battlesnake("snek", "snek", 80, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}, {x: 4, y: 1}, {x: 5, y: 1}], "30", "", "")
    const gameState = createGameState(snek)

    gameState.board.food = [{x: 2, y: 3}, {x: 6, y: 6}]

    gameState.board.hazards = [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5}, {x: 0, y: 6}, {x: 0, y: 7}, {x: 0, y: 8}, {x: 0, y: 9}, {x: 0, y: 10}]

    const board2d = new Board2d(gameState)

    moveSnake(gameState, snek, board2d, Direction.Up)

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
  it('should have correct body and health after moving from food', () => {
    const snek = new Battlesnake("snek", "snek", 100, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}, {x: 4, y: 1}, {x: 5, y: 1}, {x: 5, y: 1}], "30", "", "")
    const gameState = createGameState(snek)

    gameState.board.food = [{x: 5, y: 5}, {x: 6, y: 6}]

    gameState.board.hazards = [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5}, {x: 0, y: 6}, {x: 0, y: 7}, {x: 0, y: 8}, {x: 0, y: 9}, {x: 0, y: 10}]

    const board2d = new Board2d(gameState)

    moveSnake(gameState, snek, board2d, Direction.Up)

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
        const snek = new Battlesnake("snek", "snek", 50, [{x: 0, y: 1}, {x: 1, y: 1}, {x: 1, y: 0}, {x: 2, y: 0}], "30", "", "")
        
        const gameState = createGameState(snek)

        const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 0, y: 0}, {x: 0, y: 0}, {x: 0, y: 0}], "30", "", "")
        gameState.board.snakes.push(otherSnek)
        
        let kissStates = new KissStatesForEvaluate(KissOfDeathState.kissOfDeathNo, KissOfMurderState.kissOfMurderNo)
        let evalSnek = evaluate(gameState, snek, kissStates)
        let evalOtherSnek = evaluate(gameState, otherSnek, kissStates)

        expect(evalSnek).toBeGreaterThan(evalOtherSnek)
    })
})

// TODO
// kiss of death selector - chooses kiss of death cell with higher evaluation score
// tests for seeking open space
// tests for MoveNeighbors prey calculator

describe('Snake should not try for a maybe kill if it leads it to certain doom', () => {
  it('does not chase after a snake it cannot catch', () => {
      for (let i = 0; i < 3; i++) {
        const snek = new Battlesnake("snek", "snek", 95, [{x: 5, y: 9}, {x: 4, y: 9}, {x: 4, y: 8}, {x: 4, y: 7}, {x: 5, y: 7}, {x: 5, y: 6}, {x: 5, y: 5}, {x: 4, y: 5}, {x: 3, y: 5}, {x: 2, y: 5}], "30", "", "")
      
        const gameState = createGameState(snek)

        const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 6, y: 8}, {x: 6, y: 9}, {x: 6, y: 10}, {x: 7, y: 10}, {x: 8, y: 10}, {x: 9, y: 10}, {x: 10, y: 10}, {x: 10, y: 9}, {x: 10, y: 8}], "30", "", "")
        gameState.board.snakes.push(otherSnek)

        gameState.board.food = [{x: 6, y: 5}, {x: 0, y: 6}, {x: 7, y: 1}]
        let moveResponse: MoveResponse = move(gameState)
        expect(moveResponse.move).toBe("up") // bottom spells death don't chase
      }
  })
})

describe('Hazard tests', () => {
  it('does not seek food through hazard when possible', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 45, [{x: 8, y: 3}, {x: 8, y: 2}, {x: 7, y: 2}, {x: 7, y: 1}, {x: 6, y: 1}, {x: 5, y: 1}, {x: 4, y: 1}, {x: 4, y: 2}, {x: 3, y: 2}, {x: 3, y: 3}, {x: 2, y: 3}, {x: 1, y: 3}], "30", "", "")
    
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 92, [{x: 5, y: 8}, {x: 5, y: 7}, {x: 5, y: 6}, {x: 5, y: 5}, {x: 6, y: 5}, {x: 6, y: 4}, {x: 6, y: 3}, {x: 5, y: 3}, {x: 5, y: 4}, {x: 4, y: 4}, {x: 4, y: 5}, {x: 4, y: 6}], "30", "", "")
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
  it('does not seek kill through hazard when possible', () => { // maybe no longer valid as we predict snake moves away & we don't consider down as good a prospect as right, even considering hazard
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 10, [{x: 7, y: 9}, {x: 6, y: 9}, {x: 6, y: 8}, {x: 6, y: 7}, {x: 6, y: 6}, {x: 6, y: 5}, {x: 6, y: 4}, {x: 6, y: 3}, {x: 6, y: 2}, {x: 5, y: 2}, {x: 5, y: 1}, {x: 4, y: 1}], "30", "", "")
    
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 92, [{x: 8, y: 8}, {x: 8, y: 7}, {x: 8, y: 6}, {x: 8, y: 5}, {x: 8, y: 4}, {x: 8, y: 3}, {x: 8, y: 2}, {x: 8, y: 1}, {x: 8, y: 0}, {x: 7, y: 0}], "30", "", "")
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
  it('seeks food on the edge of hazard if it is easy to acquire', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 90, [{x: 4, y: 8}, {x: 4, y: 7}, {x: 4, y: 6}, {x: 3, y: 6}, {x: 2, y: 6}, {x: 2, y: 5}, {x: 2, y: 4}], "30", "", "")
    
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 92, [{x: 8, y: 1}, {x: 8, y: 2}, {x: 8, y: 3}, {x: 8, y: 4}, {x: 8, y: 5}, {x: 8, y: 6}, {x: 8, y: 7}, {x: 8, y: 8}, {x: 8, y: 0}, {x: 7, y: 0}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 3, y: 9}]

      createHazardRow(gameState.board, 10)
      createHazardRow(gameState.board, 9)

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // I am smaller & almost full health. The lone food on the board is in hazard, we can retrieve it & get out without health loss by going up, then left
    }
  })
  it('does not travel through hazard when another viable option exists', () => {
      for (let i = 0; i < 3; i++) {
        const snek = new Battlesnake("snek", "snek", 20, [{x: 2, y: 1}, {x: 1, y: 1}, {x: 0, y: 1}, {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4}], "30", "", "")
      
        const gameState = createGameState(snek)

        const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 6, y: 1}, {x: 7, y: 1}, {x: 7, y: 2}, {x: 7, y: 3}, {x: 6, y: 3}, {x: 5, y: 3}, {x: 4, y: 3}, {x: 4, y: 2}, {x: 3, y: 2}, {x: 3, y: 3}, {x: 3, y: 4}, {x: 4, y: 4}], "30", "", "")
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
    const snek = new Battlesnake("snek", "snek", 100, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}], "30", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("snek", "snek", 100, [{x: 6, y: 10}, {x: 7, y: 10}, {x: 8, y: 10}, {x: 9, y: 10}], "30", "", "")
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
    const board2d = new Board2d(gameState)
    
    let hazardWalls: HazardWalls = new HazardWalls(gameState)

    expect(isInOrAdjacentToHazard(snek.body[0], board2d, hazardWalls, gameState)).toBe(true)
    expect(isInOrAdjacentToHazard(snek.body[1], board2d, hazardWalls, gameState)).toBe(true)
    expect(isInOrAdjacentToHazard({x: 2, y: 6}, board2d, hazardWalls, gameState)).toBe(true)
    expect(isInOrAdjacentToHazard({x: 2, y: 7}, board2d, hazardWalls, gameState)).toBe(true)
    expect(isInOrAdjacentToHazard({x: 3, y: 7}, board2d, hazardWalls, gameState)).toBe(false)
    expect(isInOrAdjacentToHazard({x: 7, y: 7}, board2d, hazardWalls, gameState)).toBe(true)
    expect(isInOrAdjacentToHazard({x: 6, y: 7}, board2d, hazardWalls, gameState)).toBe(false)
    expect(isInOrAdjacentToHazard({x: 6, y: 6}, board2d, hazardWalls, gameState)).toBe(true)

    expect(isInOrAdjacentToHazard({x: 1, y: 7}, board2d, hazardWalls, gameState)).toBe(true) // in the hazard should also return true
    expect(isInOrAdjacentToHazard({x: 3, y: 5}, board2d, hazardWalls, gameState)).toBe(true)
    expect(isInOrAdjacentToHazard({x: 3, y: 10}, board2d, hazardWalls, gameState)).toBe(true)

    expect(isInOrAdjacentToHazard({x: 6, y: 9}, board2d, hazardWalls, gameState)).toBe(true) // is adjacent to a hazard, but that hazard has a snake, so STILL consider it a hazard

    expect(isInOrAdjacentToHazard({x: 11, y: 10}, board2d, hazardWalls, gameState)).toBe(false) // doesn't exist & thus has no neighbors, even if it is numerically one away from it

    gameState.game.ruleset.settings.hazardDamagePerTurn = 0 // if hazard damage is 0, function should always return false
    expect(isInOrAdjacentToHazard({x: 0, y: 0}, board2d, hazardWalls, gameState)).toBe(false)
  })
})

describe('Snake cutoff tests', () => {
  it('travels straight into the wall, then turns away to kill a larger snake', () => {
      for (let i = 0; i < 3; i++) {
        const snek = new Battlesnake("snek", "snek", 50, [{x: 1, y: 9}, {x: 1, y: 8}, {x: 1, y: 7}, {x: 1, y: 6}, {x: 1, y: 5}, {x: 1, y : 4}], "30", "", "")
      
        const gameState = createGameState(snek)

        const otherSnek = new Battlesnake("otherSnek", "otherSnek", 30, [{x: 0, y: 6}, {x: 0, y: 5}, {x: 0, y: 4}, {x: 0, y: 3}, {x: 0, y: 2}, {x: 0, y: 1}, {x: 0, y: 0}, {x: 1, y: 0}], "30", "", "")
        gameState.board.snakes.push(otherSnek)
        let moveResponse: MoveResponse = move(gameState)
        const allowedMoves = ["left", "up"]
        expect(allowedMoves).toContain(moveResponse.move) // Both up & left will cut otherSnek off, effectively killing it
      }
  })
  it('travels straight into the wall, then turns away to kill a larger snake even with me', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 1, y: 9}, {x: 1, y: 8}, {x: 1, y: 7}, {x: 1, y: 6}, {x: 1, y: 5}], "30", "", "")
    
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 30, [{x: 0, y: 9}, {x: 0, y: 8}, {x: 0, y: 7}, {x: 0, y: 6}, {x: 0, y: 5}, {x: 0, y: 4}, {x: 0, y: 3}, {x: 0, y: 2}, {x: 0, y: 1}, {x: 0, y: 0}], "30", "", "")
      gameState.board.snakes.push(otherSnek)
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // Up will cut otherSnek off, effectively killing it
    }
  })
  it('travels straight into the wall, then turns away to kill a larger snake one behind me', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 1, y: 9}, {x: 1, y: 8}, {x: 1, y: 7}, {x: 1, y: 6}, {x: 1, y: 5}], "30", "", "")
    
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 30, [{x: 0, y: 8}, {x: 0, y: 7}, {x: 0, y: 6}, {x: 0, y: 5}, {x: 0, y: 4}, {x: 0, y: 3}, {x: 0, y: 2}, {x: 0, y: 1}, {x: 0, y: 0}], "30", "", "")
      gameState.board.snakes.push(otherSnek)
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // Up will cut otherSnek off, effectively killing it
    }
  })
  it('attempts a cutoff using its tail if it has just eaten food', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 100, [{x: 1, y: 9}, {x: 1, y: 8}, {x: 1, y: 7}, {x: 1, y: 6}, {x: 1, y: 5}, {x: 1, y: 5}], "30", "", "")
    
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 30, [{x: 0, y: 5}, {x: 0, y: 4}, {x: 0, y: 3}, {x: 0, y: 2}, {x: 0, y: 1}, {x: 0, y: 0}, {x: 1, y: 0}], "30", "", "")
      gameState.board.snakes.push(otherSnek)
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("right") // Up or left will cut otherSnek off, effectively killing it. Tail should keep otherSnek in line since it won't shrink this turn.
    }
  })
  it('turns towards the smaller snake and goes for the kill', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 1, y: 9}, {x: 1, y: 8}, {x: 1, y: 7}, {x: 1, y: 6}, {x: 1, y: 5}, {x: 1, y: 4}], "30", "", "")
    
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 30, [{x: 0, y: 6}, {x: 0, y: 5}, {x: 0, y: 4}, {x: 0, y: 3}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      // add another larger snake so snek doesn't think it's king snake & navigate towards otherSnek for that reason
      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 30, [{x: 10, y: 0}, {x: 10, y: 1}, {x: 10, y: 2}, {x: 10, y: 3}, {x: 10, y: 4}, {x: 10, y: 5}, {x: 10, y: 6}, {x: 10, y: 7}], "30", "", "")
      gameState.board.snakes.push(otherSnek2)
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("left") // Left will send us towards the smaller snake, going for the kill.
    }
  })
  it('having cut a snake off, let it die if it will grow to my size rather than go after it', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 0, y: 9}, {x: 1, y: 9}, {x: 1, y: 8}, {x: 1, y: 7}, {x: 1, y: 6}, {x: 1, y: 5}, {x: 1, y: 4}], "30", "", "")
    
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 30, [{x: 0, y: 6}, {x: 0, y: 5}, {x: 0, y: 4}, {x: 0, y: 3}, {x: 0, y: 2}, {x: 1, y: 2}], "30", "", "")
      gameState.board.snakes.push(otherSnek)
      
      gameState.board.food = [{x: 0, y: 7}]
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // Down will send us towards the smaller snake, but it won't be smaller soon, so go up
    }
  })
  // skipping for now, as this exclusively passes if otherSnakes have a lookahead of at least 1
  it.skip('avoids cutoff cells against other snakes before going in the cutoff direction', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 1, y: 0}, {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 1, y: 4}, {x: 1, y: 5}, {x: 1, y: 6}, {x: 1, y: 7}, {x: 1, y: 8}, {x: 1, y: 9}, {x: 1, y: 10}, {x: 2, y: 10}, {x: 3, y: 10}, {x: 4, y: 10}, {x: 5, y: 10}], "30", "", "")
    
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 30, [{x: 6, y: 1}, {x: 5, y: 1}, {x: 4, y: 1}, {x: 3, y: 1}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 3, y: 2}, {x: 4, y: 2}, {x: 5, y: 2}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.game.ruleset.settings.hazardDamagePerTurn = 0
      
      gameState.board.food = [{x: 2, y: 0}, {x: 7, y: 1}, {x: 8, y: 1}, {x: 9, y: 1}] // add a little food to sweeten the pot even more for snek, & some other bait to get otherSnek into position
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("left") // Right is immediately a cutoff, should absolutely not do this. Left takes us into a corner away from food, away from hunted snake, but means freedom
    }
  })
  it('does not walk into a cutoff by a snake & a wall', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [ {x: 10, y: 1}, {x: 9, y: 1}, {x: 9, y: 2}, {x: 9, y: 3}], "30", "", "")
    
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 50, [{x: 8, y: 1}, {x: 8, y: 2}, {x: 8, y: 3}, {x: 8, y: 4}, {x: 7, y: 4}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.game.ruleset.settings.hazardDamagePerTurn = 0
      
      gameState.board.food = [{x: 10, y: 0}, {x: 1, y: 8}, {x: 3, y: 9}]
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("down") // down puts us in a corner where otherSnek can immediately cut us off by going either down or right
    }
  })
  it('moves towards a cutoff situation before otherSnek can escape', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [ {x: 3, y: 2}, {x: 2, y: 2}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 1, y: 4}], "30", "", "")
    
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 50, [{x: 3, y: 0}, {x: 2, y: 0}, {x: 1, y: 0}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 4, y: 0}] // one food won't prevent otherSnek from being large enough to escape this cutoff

      gameState.game.ruleset.settings.hazardDamagePerTurn = 0
      
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("down") // should move towards otherSnek to create a kill cutoff situation, otherwise otherSnek can risk the kiss of murder & double back & escape
    }
  })
  // now failing due to snek preferring to keep better board control
  it.skip('finishes off a cutoff kill', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 70, [{x: 4, y: 1}, {x: 3, y: 1}, {x: 2, y: 1}, {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 1, y: 4}, {x: 1, y: 5}, {x: 1, y: 6}], "30", "", "")
      
      const gameState = createGameState(snek)
      gameState.turn = 77

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 3, y: 0}, {x: 2, y: 0}, {x: 1, y: 0}, {x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 95, [{x: 7, y: 4}, {x: 8, y: 4}, {x: 9, y: 4}, {x: 9, y: 3}, {x: 8, y: 3}, {x: 7, y: 3}, {x: 6, y: 3}, {x: 5, y: 3}], "30", "", "")
      gameState.board.snakes.push(otherSnek2)

      gameState.board.food = [{x: 5, y: 7}, {x: 8, y: 6}, {x: 5, y: 9}, {x: 6, y: 9}, {x: 2, y: 10}]

      createHazardColumn(gameState.board, 0)
      createHazardColumn(gameState.board, 10)
      createHazardRow(gameState.board, 10)

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("down") // should move down to finish otherSnek off & stop wasting time we could spend gathering food for war against otherSnek2
    }
  })
  it('avoids a cutoff when pinned against hazard', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 70, [{x: 1, y: 5}, {x: 1, y: 4}, {x: 1, y: 3}, {x: 1, y: 2}, {x: 1, y: 1}, {x: 0, y: 1}, {x: 0, y: 0}, {x: 1, y: 0}, {x: 2, y: 0}, {x: 3, y: 0}, {x: 4, y: 0}, {x: 4, y: 1}, {x: 4, y: 2}, {x: 3, y: 2}, {x: 2, y: 2}, {x: 2, y: 3}], "30", "", "")
      
      const gameState = createGameState(snek)
      gameState.turn = 180

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 85, [{x: 2, y: 6}, {x: 3, y: 6}, {x: 3, y: 5}, {x: 3, y: 4}, {x: 3, y: 3}, {x: 4, y: 3}, {x: 4, y: 4}, {x: 4, y: 5}, {x: 5, y: 5}, {x: 5, y: 4}, {x: 5, y: 3}, {x: 6, y: 3}, {x: 6, y: 4}, {x: 7, y: 4}, {x: 7, y: 5}, {x: 6, y: 5}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      createHazardColumn(gameState.board, 0)
      createHazardColumn(gameState.board, 10)
      createHazardColumn(gameState.board, 9)
      createHazardColumn(gameState.board, 8)

      createHazardRow(gameState.board, 0)
      createHazardRow(gameState.board, 9)
      createHazardRow(gameState.board, 10)

      gameState.board.food = [{x: 1, y: 6}, {x: 0, y: 10}, {x: 8, y: 4}, {x: 9, y: 4}]

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("right") // left is hazard death. Up gets us larger, but otherSnek can easily cut us off against hazard & kill us. Right gives us an escape route
    }
  })
  it('seeks a cutoff pinning snake against hazard', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 93, [{x: 4, y: 2}, {x: 3, y: 2}, {x: 2, y: 2}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 0, y: 3}, {x: 0, y: 4}, {x: 1, y: 4}, {x: 2, y: 4}, {x: 2, y: 3}, {x: 3, y: 3}, {x: 4, y: 3}], "30", "", "")
      
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 45, [{x: 5, y: 1}, {x: 4, y: 1}, {x: 3, y: 1}, {x: 2, y: 1}, {x: 1, y: 1}, {x: 1, y: 0}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      createHazardRow(gameState.board, 0)
      createHazardRow(gameState.board, 10)

      gameState.board.food = [{x: 0, y: 2}, {x: 1, y: 7}, {x: 1, y: 10}, {x: 8, y: 7}]

      gameState.turn = 70

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("right") // can pin otherSnek up against hazard by continuing to move right
    }
  })
  it('ignores food while seeking a cutoff pinning snake against hazard in a duel', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 90, [{x: 5, y: 2}, {x: 4, y :2}, {x: 3, y: 2}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4}, {x: 2, y: 5}], "30", "", "")
      
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 95, [{x: 6, y: 1}, {x: 5, y: 1}, {x: 4, y: 1}, {x: 3, y: 1}, {x: 2, y: 1}, {x: 1, y: 1}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 5, y: 3}] // this is the bait that snek should not take because it's in a hazard cutoff, should not wantToEat

      createHazardRow(gameState.board, 0)

      gameState.turn = 43

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("right") // can pin otherSnek up against hazard by continuing to move right, should not get food by going up
    }
  })
  it('does not give up on a hazard cutoff in a duel in order to chase tail or center', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 90, [{x: 7, y: 4}, {x: 7, y: 3}, {x: 7, y: 2}, {x: 6, y: 2}, {x: 5, y: 2}, {x: 4, y: 2}, {x: 3, y: 2}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 3, y: 3}, {x: 3, y: 4}, {x: 4, y: 4}], "30", "", "")
      
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 70, [{x: 8, y: 3}, {x: 8, y: 2}, {x: 8, y: 1}, {x: 8, y: 0}, {x: 7, y: 0}, {x: 6, y: 0}, {x: 5, y: 0}, {x: 4, y: 0}, {x: 3, y: 0}, {x: 2, y: 0}, {x: 2, y: 1}, {x: 3, y: 1}, {x: 4, y: 1}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 0, y: 1}, {x: 10, y: 0}, {x: 10, y: 1}, {x: 10, y: 10}]

      createHazardRow(gameState.board, 0)
      createHazardRow(gameState.board, 10)
      createHazardColumn(gameState.board, 0)
      createHazardColumn(gameState.board, 1)
      createHazardColumn(gameState.board, 10)
      createHazardColumn(gameState.board, 9)

      gameState.turn = 155

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // right gets us eaten, left lets snake out of hazard cutoff. Up continues hazard cutoff.
    }
  })
})

describe('Snake should not enter spaces without a clear escape route', () => {
  it('does not enter a space enclosed by itself', () => {
      for (let i = 0; i < 3; i++) {
        const snek = new Battlesnake("snek", "snek", 50, [{x: 6, y: 6}, {x: 7, y: 6}, {x: 8, y: 6}, {x: 8, y: 6}, {x: 8, y: 4}, {x: 7, y: 4}, {x: 7, y: 3}, {x: 7, y: 2}, {x: 6, y: 2}, {x: 6, y: 3}, {x: 5, y: 3}, {x: 5, y: 4}, {x: 5, y: 5}, {x: 4, y: 5}, {x: 4, y: 6}, {x: 4, y: 7}, {x: 5, y: 7}], "30", "", "")
      
        const gameState = createGameState(snek)

        gameState.board.food = [{x: 0, y: 0}, {x: 2, y: 5}, {x: 9, y: 10}]
        let moveResponse: MoveResponse = move(gameState)
        expect(moveResponse.move).not.toBe("down") // Down has three spaces available, fully enclosed by my body. Will die after two turns.
      }
  })
  it('does not enter a space enclosed by another snake', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 4, y: 2}, {x: 5, y: 2}, {x: 6, y: 2}, {x: 7, y: 2}, {x: 8, y: 2}, {x: 9, y: 2}, {x: 9, y: 3}, {x: 9, y: 4}, {x: 9, y: 5}, {x: 9, y: 6}, {x: 9, y: 7}, {x: 9, y: 8}, {x: 9, y: 9}, {x: 8, y: 9}], "30", "", "")
    
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 30, [{x: 0, y: 2}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 1, y: 4}, {x: 1, y: 5}, {x: 1, y: 6}, {x: 2, y: 6}, {x: 3, y: 6}, {x: 3, y: 5}, {x: 3, y: 4}, {x: 4, y: 4}, {x: 4, y: 3}, {x: 5, y: 3}, {x: 6, y: 3}, {x: 7, y: 3}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 0, y: 0}, {x: 2, y: 5}, {x: 9, y: 10}]
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("down") // Up has three spaces available, fully enclosed by my otherSnek's body. Will die after two turns.
    }
  })
  it('navigates an enclosed space effectively', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 3, y: 10}, {x: 2, y: 10}, {x: 2, y: 9}, {x: 2, y: 8}, {x: 2, y: 7}, {x: 2, y: 6}, {x: 3, y: 6}, {x: 3, y: 5}, {x: 3, y: 4}, {x: 3, y: 3}, {x: 3, y: 2}, {x: 3, y: 1}, {x: 3, y: 0}], "30", "", "")
    
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 100, [{x: 6, y: 10}, {x: 5, y: 10}, {x: 5, y: 9}, {x: 5, y: 8}, {x: 4, y: 8}, {x: 4, y: 7}, {x: 4, y: 6}, {x: 4, y: 5}, {x: 4, y: 4}, {x: 4, y: 4}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.game.ruleset.settings.hazardDamagePerTurn = 0

      gameState.board.food = [{x: 0, y: 0}, {x: 2, y: 2}, {x: 0, y: 3}, {x: 0, y: 10}, {x: 1, y: 10}, {x: 7, y: 7}, {x: 9, y: 4}, {x: 10, y: 0}, {x: 10, y: 1}]
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("right") // Down limits our space enough that we won't be able to escape through otherSnek's tail
    }
  })
  it('does not chase a snake into a corner trap', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 2, y: 10}, {x: 2, y: 9}, {x: 3, y: 9}, {x: 3, y: 8}, {x: 4, y: 8}, {x: 5, y: 8}, {x: 6, y: 8}, {x: 6, y: 7}, {x: 6, y: 6}, {x: 6, y: 5}, {x: 6, y: 4}], "30", "", "")
    
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 30, [{x: 1, y: 9}, {x: 1, y: 8}, {x: 2, y: 8}, {x: 2, y: 7}, {x: 3, y: 7}, {x: 4, y: 7}, {x: 5, y: 7}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 0, y: 0}, {x: 2, y: 5}, {x: 9, y: 10}]
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("right") // Left is a clear trap leading us into a corner, otherSnek will escape, abort mission & go right
    }
  })
  it('does not walk into a single space with no exit', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 2, y: 9}, {x: 1, y: 9}, {x: 1, y: 8}, {x: 1, y: 7}, {x: 1, y: 6}, {x: 1, y: 5}, {x: 2, y: 5}], "30", "", "")
    
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 30, [{x: 3, y: 6}, {x: 2, y: 6}, {x: 2, y: 7}, {x: 3, y: 7}, {x: 3, y: 8}, {x: 3, y: 9}, {x: 3, y: 10}, {x:4, y: 10}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 4, y: 6}]
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // Down means insta-death, this should be a no-brainer
    }
  })
  it('does not move into a space enclosed by itself version two', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 0, y: 9}, {x: 1, y: 9}, {x: 2, y: 9}, {x: 2, y: 8}, {x: 2, y: 7}, {x: 1, y: 7}, {x: 1, y: 6}, {x: 1, y: 5}, {x: 0, y: 5}, {x: 0, y: 4}, {x: 1, y: 4}, {x: 1, y: 3}, {x: 0, y: 3}, {x: 0, y: 2}], "30", "", "")
    
      const gameState = createGameState(snek)
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // down is death in four turns, up is freedom
    }
  })
  // because of PossibleMoves adjustment for duel otherSnakes, this fails. Can't get otherSnake to go right at the moment, so skipping
  it.skip('does not walk into a space that will soon have no exit', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 5, y: 3}, {x: 5, y: 4}, {x: 4, y: 4}, {x: 4, y: 5}, {x: 5, y: 5}, {x: 5, y: 6}, {x: 5, y: 7}, {x: 6, y: 7}, {x: 7, y: 7}], "30", "", "")
    
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 30, [{x: 2, y: 4}, {x: 2, y: 3}, {x: 1, y: 3}, {x: 1, y: 2}, {x: 2, y: 2}, {x: 2, y: 1}, {x: 2, y: 0}, {x: 3, y: 0}, {x: 3, y: 1}, {x: 3, y: 2}, {x: 4, y: 2}, {x: 5, y: 2}, {x: 6, y: 2}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 3, y: 5}]
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("right") // Left brings us closer to otherSnek & likely traps us in with him if he moves where he ought to, escape right
    }
  })
  it('does not move into a space it thinks it can get a kill if guessing wrong will soon kill it', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 90, [{x: 10, y: 2}, {x: 9, y: 2}, {x: 9, y: 3}, {x: 9, y: 4}, {x: 9, y: 5}, {x: 9, y: 6}, {x: 9, y: 7}, {x: 8, y: 7}, {x: 7, y: 7}, {x: 7, y: 6}, {x: 7, y: 5}, {x: 6, y: 5}, {x: 6, y: 6}, {x: 5, y: 6}, {x: 5, y: 5}, {x: 4, y: 5}, {x: 3, y: 5}], "30", "", "")
    
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 8, y: 0}, {x: 8, y: 1}, {x: 7, y: 1}, {x: 6, y: 1}, {x: 5, y: 1}, {x: 4, y: 1}, {x: 3, y: 1}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4}, {x: 2, y: 5}, {x: 2, y: 6}, {x: 2, y: 7}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      // const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 90, [{x: 2, y: 6}, {x: 2, y: 7}, {x: 2, y: 8}, {x: 2, y: 9}, {x: 3, y: 9}, {x: 4, y: 9}, {x: 5, y: 9}, {x: 5, y: 10}, {x: 6, y: 10}, {x: 7, y: 10}], "30", "", "")
      // gameState.board.snakes.push(otherSnek2) // so we don't treat it as a duel, otherwise not relevant to test

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // Down traps us if otherSnek doesn't go right towards us
    }
  })
  it('does not commit suicide in order to tie another snake', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 70, [{x: 5, y: 7}, {x: 6, y: 7}, {x: 6, y: 8}, {x: 6, y: 9}, {x: 5, y: 9}, {x: 4, y: 9}, {x: 4, y: 8}, {x: 4, y: 7}, {x: 3, y: 7}, {x: 3, y: 8}, {x: 3, y: 9}, {x: 3, y: 10}, {x: 2, y: 10}, {x: 1, y: 10}, {x: 0, y: 10}, {x: 0, y: 9}, {x: 1, y: 9}, {x: 2, y: 9}, {x: 2, y: 8}, {x: 2, y: 7}, {x: 2, y: 6}, {x: 3, y: 6}, {x: 4, y: 6}, {x: 5, y: 6}], "30", "", "")
    
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 2, [{x: 3, y: 3}, {x: 4, y: 3}, {x: 5, y: 3}, {x: 6, y: 3}, {x: 7, y: 3}, {x: 8, y: 3}, {x: 8, y: 4}, {x: 8, y: 5}, {x: 8, y: 6}, {x: 8, y: 7}, {x: 9, y: 7}, {x: 9, y: 6}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 0, y: 1}, {x: 3, y: 0}]

      createHazardRow(gameState.board, 0)
      createHazardRow(gameState.board, 1)
      createHazardRow(gameState.board, 10)
      createHazardRow(gameState.board, 9)
      createHazardColumn(gameState.board, 0)
      createHazardColumn(gameState.board, 10)

      gameState.turn = 162

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("down") // Up just makes us tie with otherSnek next turn, clear move down
    }
  })
})

describe('updateGameState tests', () => {
  it('updates game state to kill & remove snakes that have starved', () => {
      const snek = new Battlesnake("snek", "snek", 10, [{x: 9, y: 10}, {x: 9, y: 9}, {x: 9, y: 8}], "30", "", "")
      
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 92, [{x: 5, y: 8}, {x: 5, y: 7}, {x: 5, y: 6}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 92, [{x: 0, y: 10}, {x: 0, y: 9}, {x: 0, y: 8}], "30", "", "")
      gameState.board.snakes.push(otherSnek2)

      const otherSnek3 = new Battlesnake("otherSnek3", "otherSnek3", 5, [{x: 2, y: 7}, {x: 2, y: 8}, {x: 3, y: 8}], "30", "", "")
      gameState.board.snakes.push(otherSnek3)

      const otherSnek4 = new Battlesnake("otherSnek4", "otherSnek4", 1, [{x: 10, y: 0}, {x: 9, y: 0}, {x: 8, y: 0}], "30", "", "")
      gameState.board.snakes.push(otherSnek4)

      createHazardRow(gameState.board, 10)

      let board2d = new Board2d(gameState)

      moveSnake(gameState, snek, board2d, Direction.Left) // this should starve the snake out due to hazard
      moveSnake(gameState, otherSnek, board2d, Direction.Up) // this snake should be safe moving any direction
      moveSnake(gameState, otherSnek2, board2d, Direction.Right) // this snake has enough health not to starve if it moves into hazard
      moveSnake(gameState, otherSnek3, board2d, Direction.Right) // this snake would starve moving into hazard, but shouldn't starve moving into not hazard
      moveSnake(gameState, otherSnek4, board2d, Direction.Up) // this snake will starve, even though up is a valid direction

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
    const snek = new Battlesnake("snek", "snek", 10, [{x: 5, y: 5}, {x: 5, y: 4}, {x: 5, y: 3}], "30", "", "")
    
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 100, [{x: 4, y: 8}, {x: 5, y: 8}, {x: 6, y: 8}, {x: 6, y: 9}, {x: 6, y: 9}], "30", "", "") // snake has just eaten
    gameState.board.snakes.push(otherSnek)

    gameState.board.food = [{x: 5, y: 6}, {x: 5, y: 4}]

    let board2d = new Board2d(gameState)

    moveSnake(gameState, snek, board2d, Direction.Up) // snek should get the food at (5,6)
    moveSnake(gameState, otherSnek, board2d, Direction.Down)

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
    const snek = new Battlesnake("snek", "snek", 92, [{x: 10, y: 8}, {x: 10, y: 9}, {x: 10, y: 10}], "30", "", "")
    
    const gameState = createGameState(snek)

    const snekOpponent = new Battlesnake("snekOpponent", "snekOpponent", 92, [{x: 10, y: 6}, {x: 10, y: 5}, {x: 10, y: 4}, {x: 10, y: 3}], "30", "", "")
    gameState.board.snakes.push(snekOpponent)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 92, [{x: 8, y: 8}, {x: 8, y: 9}, {x: 8, y: 10}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    const otherSnekOpponent = new Battlesnake("otherSnekOpponent", "otherSnekOpponent", 1, [{x: 8, y: 6}, {x: 8, y: 5}, {x: 8, y: 4}, {x: 8, y: 3}], "30", "", "")
    gameState.board.snakes.push(otherSnekOpponent)

    const hazardSnek = new Battlesnake("hazardSnek", "hazardSnek", 92, [{x: 0, y: 8}, {x: 0, y: 9}, {x: 0, y: 10}], "30", "", "")
    gameState.board.snakes.push(hazardSnek)

    const hazardSnekOpponent = new Battlesnake("hazardSnekOpponent", "hazardSnekOpponent", 10, [{x: 0, y: 6}, {x: 0, y: 5}, {x: 0, y: 4}], "30", "", "")
    gameState.board.snakes.push(hazardSnekOpponent)

    const newSnek = new Battlesnake("newSnek", "newSnek", 100, [{x: 6, y: 8}, {x: 6, y: 9}, {x: 6, y: 10}, {x: 6, y: 10}], "30", "", "") // just eaten
    gameState.board.snakes.push(newSnek)

    const newSnekOpponent = new Battlesnake("newSnekOpponent", "newSnekOpponent", 92, [{x: 6, y: 6}, {x: 6, y: 5}, {x: 6, y: 4}], "30", "", "")
    gameState.board.snakes.push(newSnekOpponent)
    
    const lastSnek = new Battlesnake("lastSnek", "lastSnek", 92, [{x: 4, y: 8}, {x: 4, y: 9}, {x: 4, y: 10}], "30", "", "")
    gameState.board.snakes.push(lastSnek)

    const lastSnekOpponent = new Battlesnake("lastSnekOpponent", "lastSnekOpponent", 92, [{x: 4, y: 6}, {x: 4, y: 5}, {x: 4, y: 4}], "30", "", "")
    gameState.board.snakes.push(lastSnekOpponent)

    createHazardColumn(gameState.board, 0)

    let board2d = new Board2d(gameState)

    moveSnake(gameState, snek, board2d, Direction.Down) // snek moves down to die at the jaws of snekOpponent, who is larger
    moveSnake(gameState, snekOpponent, board2d, Direction.Up) // snekOpponent moves up to kill snek, who is smaller
    moveSnake(gameState, otherSnek, board2d, Direction.Down) // otherSnek moves down, but doesn't die to otherSnekOpponent, who starves first
    moveSnake(gameState, otherSnekOpponent, board2d, Direction.Up) // otherSnekOpponent moves up & tries to kill otherSnek, but starves first & dies
    moveSnake(gameState, hazardSnek, board2d, Direction.Down) // hazardSnake moves down & lives thanks to hazardSnekOpponent dying before they can collide
    moveSnake(gameState, hazardSnekOpponent, board2d, Direction.Up) // hazardSnekOpponent moves up & starves before colliding with hazardSnek
    moveSnake(gameState, newSnek, board2d, Direction.Down) // newSnek moves down to kill newSnekOpponent, since it just grew by eating this turn
    moveSnake(gameState, newSnekOpponent, board2d, Direction.Up) // newSnekOpponent moves up to die to newSnek, who is now one larger since newSnekOpponent did not eat this turn
    moveSnake(gameState, lastSnek, board2d, Direction.Down) // lastSnek moves down to die in a mutual kiss of death with lastSnekOpponent
    moveSnake(gameState, lastSnekOpponent, board2d, Direction.Up) // lastSnekOpponent moves up to die in a mutual kiss of death with lastSnek

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
    const snek = new Battlesnake("snek", "snek", 10, [{x: 9, y: 10}, {x: 9, y: 9}, {x: 9, y: 8}], "30", "", "")
    
    const gameState = createGameState(snek)

    const snekOpponent = new Battlesnake("snekOpponent", "snekOpponent", 92, [{x: 10, y: 10}, {x: 10, y: 9}, {x: 10, y: 8}], "30", "", "")
    gameState.board.snakes.push(snekOpponent)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 92, [{x: 1, y: 9}, {x: 1, y: 10}, {x: 0, y: 10}, {x: 0, y: 9}, {x: 0, y: 8}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    const hazardSnek = new Battlesnake("hazardSnek", "hazardSnek", 5, [{x: 3, y: 0}, {x: 3, y: 1}, {x: 4, y: 1}, {x: 5, y: 1}], "30", "", "")
    gameState.board.snakes.push(hazardSnek)

    const hazardSnekOpponent = new Battlesnake("hazardSnekOpponent", "hazardSnekOpponent", 100, [{x: 4, y: 0}, {x: 5, y: 0}, {x: 6, y: 0}, {x: 6, y: 0}], "30", "", "")
    gameState.board.snakes.push(hazardSnekOpponent)

    const starvingSnek = new Battlesnake("starvingSnek", "starvingSnek", 1, [{x: 5, y: 5}, {x: 6, y: 5}, {x: 7, y: 5}, {x: 8, y: 5}], "30", "", "")
    gameState.board.snakes.push(starvingSnek)

    const starvingSnekOpponent = new Battlesnake("starvingSnekOpponent", "starvingSnekOpponent", 90, [{x: 5, y: 6}, {x: 6, y: 6}, {x: 7, y: 6}, {x: 8, y: 6}], "30", "", "")
    gameState.board.snakes.push(starvingSnekOpponent)

    createHazardRow(gameState.board, 0)

    let board2d = new Board2d(gameState)

    moveSnake(gameState, snek, board2d, Direction.Left) // snek will avoid colliding with snekOpponent by moving its head left
    moveSnake(gameState, snekOpponent, board2d, Direction.Left) // otherSnek will collide with snek's neck at (1,9) - note that because snek also moves, this won't be a head-to-head
    moveSnake(gameState, otherSnek, board2d, Direction.Left) // otherSnek is right of its body, it will die if it moves left
    moveSnake(gameState, hazardSnek, board2d, Direction.Left) // hazardSnek will die after turning left into one more turn of hazard
    moveSnake(gameState, hazardSnekOpponent, board2d, Direction.Left) // hazardSnekOpponent should live as hazardSnek will starve before it collides with its body left
    moveSnake(gameState, starvingSnek, board2d, Direction.Left) // starvingSnek will starve next turn no matter what
    moveSnake(gameState, starvingSnekOpponent, board2d, Direction.Down) // starvingSnekOpponent should live as starvingSnek will starve before this collision happens

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
      for (let i: number = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 90, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 6, y: 10}, {x: 7, y: 10}, {x: 8, y: 10}, {x: 9, y: 10}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 2, y: 1}, {x: 6, y: 6}]

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("down") // food is down, we should get it even if we don't really need it (we're not king snake)
    }
  })
  it('acquires food when starving and adjacent to it', () => {
    for (let i: number = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 5, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 6, y: 10}, {x: 7, y: 10}, {x: 8, y: 10}, {x: 9, y: 10}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 2, y: 1}, {x: 6, y: 6}]

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("down") // food is down, we should get it especially if we really need it
    }
  })
  // very much a valid test but currently failing because it thinks it can bait otherSnek into dying by not taking the food
  it.skip('does not avoid food in order to hunt another snake', () => {
    for (let i: number = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 90, [{x: 9, y: 9}, {x: 8, y: 9}, {x: 7, y: 9}, {x: 6, y: 9}, {x: 5, y: 9}, {x: 4, y: 9}, {x: 3, y: 9}, {x: 3, y: 10}, {x: 2, y: 10}, {x: 1, y: 10}, {x: 0, y: 10}, {x: 0, y: 9}, {x: 0, y: 8}, {x: 1, y: 8}, {x: 2, y: 8}, {x: 3, y: 8}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 9, y: 7}, {x: 9, y: 6}, {x: 8, y: 6}, {x: 8, y: 7}, {x: 8, y: 8}, {x: 7, y: 8}, {x: 6, y: 8}, {x: 6, y: 7}, {x: 6, y: 6}, {x: 6, y: 5}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 9, y: 8}, {x: 10, y: 10}, {x: 10, y: 2}, {x: 10, y: 3}, {x: 1, y: 9}, {x: 0, y: 6}, {x: 2, y: 2}]

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("down") // down is a kill cell, we shouldn't avoid it just because we're king snake & don't want to eat - that defeats the purpose of king snake
    }
  })
  it('does not seek out food under normal solo circumstances', () => {
    for (let i: number = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 90, [{x: 6, y: 7}, {x: 6, y: 6}, {x: 6, y: 5}, {x: 5, y: 5}, {x: 5, y: 4}, {x: 5, y: 3}, {x: 5, y: 2}], "30", "", "")
      const gameState = createGameState(snek)

      gameState.board.food = [{x: 7, y: 7}]

      gameState.game.ruleset.name = "solo" // necessary to not break evaluation function in a solo game

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("right") // food is bad for solo snake, should want to go anywhere but here
    }
  })
  it('acquires food even along walls', () => {
    for (let i: number = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 90, [{x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 1, y: 4}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 2, y: 10}, {x: 3, y: 10}, {x: 4, y: 10}, {x: 5, y: 10}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 0, y: 1}]

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("left") // food is straight left, should seek it out
    }
  })
  it('acquires food even in corners', () => {
    for (let i: number = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 90, [{x: 1, y: 0}, {x: 2, y: 0}, {x: 3, y: 0}, {x: 4, y: 0}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 2, y: 10}, {x: 3, y: 10}, {x: 4, y: 10}, {x: 5, y: 10}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 0, y: 0}]

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("left") // food is straight left, should seek it out even in a corner
    }
  })
  it('acquires food when dueling as soon as it can', () => {
    for (let i: number = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 97, [{x: 2, y: 4}, {x: 2, y: 5}, {x: 1, y: 5}, {x: 1, y: 6}, {x: 2, y: 6}, {x: 3, y: 6}, {x: 4, y: 6}, {x: 5, y: 6}, {x: 5, y: 5}, {x: 6, y: 5}, {x: 6, y: 6}, {x: 6, y: 7}, {x: 5, y: 7}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 70, [{x: 7, y: 3}, {x: 8, y: 3}, {x: 8, y: 2}, {x: 9, y: 2}, {x: 9, y: 1}, {x: 8, y: 1}, {x: 7, y: 1}, {x: 6, y: 1}, {x: 5, y: 1}, {x: 4, y: 1}, {x: 4, y: 2}, {x: 5, y: 2}, {x: 5, y: 3}, {x: 6, y: 3}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 3, y: 0}, {x: 3, y: 4}, {x: 4, y: 8}, {x: 10, y: 10}, {x: 10, y: 9}, {x: 10, y: 0}]
      createHazardRow(gameState.board, 0)
      createHazardRow(gameState.board, 1)
      createHazardRow(gameState.board, 8)
      createHazardRow(gameState.board, 9)
      createHazardRow(gameState.board, 10)
      createHazardColumn(gameState.board, 10)

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("right") // not getting the food at 3,4 immediately is silly & brings the chance of otherSnek getting it
    }
  })
  it('acquires food when in foursnake as soon as it can', () => {
    for (let i: number = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 97, [{x: 5, y: 4}, {x: 5, y: 3}, {x: 5, y: 2}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 70, [{x: 7, y: 6}, {x: 8, y: 6}, {x: 8, y: 5}, {x: 9, y: 5}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 70, [{x: 0, y: 5}, {x: 0, y: 4}, {x: 1, y: 4}, {x: 1, y: 5}], "30", "", "")
      gameState.board.snakes.push(otherSnek2)

      const otherSnek3 = new Battlesnake("otherSnek3", "otherSnek3", 70, [{x: 7, y: 8}, {x: 6, y: 8}, {x: 5, y: 8}, {x: 5, y: 9}], "30", "", "")
      gameState.board.snakes.push(otherSnek3)

      gameState.board.food = [{x: 1, y: 7}, {x: 6, y: 10}, {x: 7, y: 10}, {x: 6, y: 2}, {x: 5, y: 5}]

      gameState.turn = 3 // this is very early on when no snakes have eaten much

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // there is no good justification for not getting this early food & risking another snake getting it
    }
  })
  it('still seeks acquiring food when large enough to no longer want food, but low on health', () => {
    for (let i: number = 0; i < 3; i++) {
      // 30 health: snake is wanting for health, so will seek food
      const snek = new Battlesnake("snek", "snek", 30, [{x: 8, y: 8}, {x: 8, y: 7}, {x: 8, y: 6}, {x: 8, y: 5}, {x: 8, y: 4}, {x: 8, y: 3}, {x: 8, y: 2}, {x: 9, y: 2}, {x: 9, y: 3}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 80, [{x: 5, y: 5}, {x: 6, y: 5}, {x: 7, y: 5}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 80, [{x: 0, y: 5}, {x: 0, y: 4}, {x: 1, y: 4}], "30", "", "")
      gameState.board.snakes.push(otherSnek2)

      gameState.board.food = [{x: 9, y: 9}]

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("left") // we're low on food, should seek it out by going either right or up
    }
  })
  it('acquires starting food', () => { // starting food is diagonal from starting position, in one of four directions
    for (let i: number = 0; i < 4; i++) {
      const snek = new Battlesnake("snek", "snek", 100, [{x: 1, y: 9}, {x: 1, y: 9}, {x: 1, y: 9}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 100, [{x: 1, y: 1}, {x: 1, y: 1}, {x: 1, y: 1}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 100, [{x: 9, y: 1}, {x: 9, y: 1}, {x: 9, y: 1}], "30", "", "")
      gameState.board.snakes.push(otherSnek2)

      const otherSnek3 = new Battlesnake("otherSnek2", "otherSnek3", 100, [{x: 9, y: 9}, {x: 9, y: 9}, {x: 9, y: 9}], "30", "", "")
      gameState.board.snakes.push(otherSnek3)

      gameState.turn = 0

      gameState.board.food = [{x: 8, y: 10}, {x: 2, y: 2}, {x: 8, y: 2}, {x: 5, y: 5}]

      switch(i) {
        case 0:
          gameState.board.food.push({x: 0, y: 10})
          break
        case 1:
          gameState.board.food.push({x: 0, y: 8})
          break
        case 2:
          gameState.board.food.push({x: 2, y: 10})
          break
        default: //case 3:
          gameState.board.food.push({x: 2, y: 8})
          break
      }

      let moveResponse: MoveResponse = move(gameState)
      moveSnake(gameState, gameState.you, new Board2d(gameState), stringToDirection(moveResponse.move))
      updateGameStateAfterMove(gameState)
      moveResponse = move(gameState)
      moveSnake(gameState, gameState.you, new Board2d(gameState), stringToDirection(moveResponse.move))
      updateGameStateAfterMove(gameState)

      expect(gameState.you.length).toBe(4) // for any starting food spawns, should always retrieve them. Always be length 4 after two moves.
    }
  })
})

describe('move gameState tests', () => {
  it('does not modify a gameState after calculating a move', () => {
    const snek = new Battlesnake("snek", "snek", 30, [{x: 5, y: 5}, {x: 5, y: 4}, {x: 5, y: 3}, {x: 5, y: 2}], "30", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 2, y: 10}, {x: 3, y: 10}, {x: 4, y: 10}, {x: 5, y: 10}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    gameState.board.food = [{x: 6, y: 5}, {x: 4, y: 4}]
    gameState.board.hazards = [{x: 0, y: 0}, {x: 10, y: 10}]
    
    move(gameState)

    expect(snek.head.x).toBe(5)
    expect(snek.head.y).toBe(5)
    expect(snek.body[1].x).toBe(5)
    expect(snek.body[1].y).toBe(4)
    expect(snek.body[2].x).toBe(5)
    expect(snek.body[2].y).toBe(3)
    expect(snek.body[3].x).toBe(5)
    expect(snek.body[3].y).toBe(2)

    expect(otherSnek.body[0].x).toBe(2)
    expect(otherSnek.body[0].y).toBe(10)
    expect(otherSnek.body[1].x).toBe(3)
    expect(otherSnek.body[1].y).toBe(10)
    expect(otherSnek.body[2].x).toBe(4)
    expect(otherSnek.body[2].y).toBe(10)
    expect(otherSnek.body[3].x).toBe(5)
    expect(otherSnek.body[3].y).toBe(10)

    expect(gameState.board.food[0].x).toBe(6)
    expect(gameState.board.food[0].y).toBe(5)
    expect(gameState.board.food[1].x).toBe(4)
    expect(gameState.board.food[1].y).toBe(4)

    expect(gameState.board.hazards[0].x).toBe(0)
    expect(gameState.board.hazards[0].y).toBe(0)
    expect(gameState.board.hazards[1].x).toBe(10)
    expect(gameState.board.hazards[1].y).toBe(10)

    expect(gameState.turn).toBe(30)
  })
})

describe('hazard walls tests', () => {
  it('can accurately map the left, right, top, & bottom hazard walls', () => {
    const snek = new Battlesnake("snek", "snek", 30, [{x: 5, y: 5}, {x: 5, y: 4}, {x: 5, y: 3}, {x: 5, y: 2}], "30", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 2, y: 10}, {x: 3, y: 10}, {x: 4, y: 10}, {x: 5, y: 10}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    createHazardRow(gameState.board, 0)
    createHazardRow(gameState.board, 1)
    createHazardRow(gameState.board, 2)
    createHazardRow(gameState.board, 9)
    createHazardRow(gameState.board, 10)

    createHazardColumn(gameState.board, 0)
    createHazardColumn(gameState.board, 1)
    createHazardColumn(gameState.board, 2)
    createHazardColumn(gameState.board, 3)
    createHazardColumn(gameState.board, 4)
    createHazardColumn(gameState.board, 5)
    createHazardColumn(gameState.board, 6)

    let hazardWalls: HazardWalls = new HazardWalls(gameState)

    expect(hazardWalls.up).toBe(9)
    expect(hazardWalls.down).toBe(2)
    expect(hazardWalls.left).toBe(6)
    expect(hazardWalls.right).toBe(undefined)
  })
  it('can accurately map the hazard walls in a game with no hazard', () => {
    const snek = new Battlesnake("snek", "snek", 30, [{x: 5, y: 5}, {x: 5, y: 4}, {x: 5, y: 3}, {x: 5, y: 2}], "30", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 2, y: 10}, {x: 3, y: 10}, {x: 4, y: 10}, {x: 5, y: 10}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    let hazardWalls: HazardWalls = new HazardWalls(gameState)

    expect(hazardWalls.up).toBe(undefined)
    expect(hazardWalls.down).toBe(undefined)
    expect(hazardWalls.left).toBe(undefined)
    expect(hazardWalls.right).toBe(undefined)
  })
  it('can accurately map the hazard walls in a game with just hazard', () => {
    const snek = new Battlesnake("snek", "snek", 30, [{x: 5, y: 5}, {x: 5, y: 4}, {x: 5, y: 3}, {x: 5, y: 2}], "30", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 2, y: 10}, {x: 3, y: 10}, {x: 4, y: 10}, {x: 5, y: 10}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    createHazardRow(gameState.board, 0)
    createHazardRow(gameState.board, 1)
    createHazardRow(gameState.board, 2)
    createHazardRow(gameState.board, 3)
    createHazardRow(gameState.board, 4)
    createHazardRow(gameState.board, 5)
    createHazardRow(gameState.board, 6)
    createHazardRow(gameState.board, 7)
    createHazardRow(gameState.board, 8)
    createHazardRow(gameState.board, 9)
    createHazardRow(gameState.board, 10)

    createHazardColumn(gameState.board, 0)
    createHazardColumn(gameState.board, 1)
    createHazardColumn(gameState.board, 2)
    createHazardColumn(gameState.board, 3)
    createHazardColumn(gameState.board, 4)
    createHazardColumn(gameState.board, 5)
    createHazardColumn(gameState.board, 6)
    createHazardColumn(gameState.board, 7)
    createHazardColumn(gameState.board, 8)
    createHazardColumn(gameState.board, 9)
    createHazardColumn(gameState.board, 10)

    let hazardWalls: HazardWalls = new HazardWalls(gameState)

    expect(hazardWalls.up).toBe(10)
    expect(hazardWalls.down).toBe(10)
    expect(hazardWalls.left).toBe(10)
    expect(hazardWalls.right).toBe(10)
  })
  it('can accurately determine the center of the board with hazard', () => {
    const snek = new Battlesnake("snek", "snek", 30, [{x: 5, y: 5}, {x: 5, y: 4}, {x: 5, y: 3}, {x: 5, y: 2}], "30", "", "")
    const gameState = createGameState(snek)

    createHazardRow(gameState.board, 0)
    createHazardRow(gameState.board, 1)
    createHazardRow(gameState.board, 2)
    createHazardRow(gameState.board, 7)
    createHazardRow(gameState.board, 8)
    createHazardRow(gameState.board, 9)
    createHazardRow(gameState.board, 10)

    createHazardColumn(gameState.board, 0)
    createHazardColumn(gameState.board, 7)
    createHazardColumn(gameState.board, 8)
    createHazardColumn(gameState.board, 9)
    createHazardColumn(gameState.board, 10)

    let hazardWalls: HazardWalls = new HazardWalls(gameState)
    let centers = calculateCenterWithHazard(gameState, hazardWalls)

    expect(centers.centerX).toBe(3) // 0 for left hazard wall, 7 for right, makes (0 + 7) / 2 = 3 (rounded down)
    expect(centers.centerY).toBe(4) // 2 for bottom hazard wall, 7 for top, makes (2 + 7) / 2 = 4 (rounded down)
  })
  it('can accurately determine the center of the board without hazard', () => {
    const snek = new Battlesnake("snek", "snek", 30, [{x: 5, y: 5}, {x: 5, y: 4}, {x: 5, y: 3}, {x: 5, y: 2}], "30", "", "")
    const gameState = createGameState(snek)

    let hazardWalls: HazardWalls = new HazardWalls(gameState)
    let centers = calculateCenterWithHazard(gameState, hazardWalls)

    expect(centers.centerX).toBe(5)
    expect(centers.centerY).toBe(5)
  })
  it('can accurately determine the center of the board with just hazard', () => {
    const snek = new Battlesnake("snek", "snek", 30, [{x: 5, y: 5}, {x: 5, y: 4}, {x: 5, y: 3}, {x: 5, y: 2}], "30", "", "")
    const gameState = createGameState(snek)

    createHazardRow(gameState.board, 0)
    createHazardRow(gameState.board, 1)
    createHazardRow(gameState.board, 2)
    createHazardRow(gameState.board, 3)
    createHazardRow(gameState.board, 4)
    createHazardRow(gameState.board, 5)
    createHazardRow(gameState.board, 6)
    createHazardRow(gameState.board, 7)
    createHazardRow(gameState.board, 8)
    createHazardRow(gameState.board, 9)
    createHazardRow(gameState.board, 10)

    createHazardColumn(gameState.board, 0)
    createHazardColumn(gameState.board, 1)
    createHazardColumn(gameState.board, 2)
    createHazardColumn(gameState.board, 3)
    createHazardColumn(gameState.board, 4)
    createHazardColumn(gameState.board, 5)
    createHazardColumn(gameState.board, 6)
    createHazardColumn(gameState.board, 7)
    createHazardColumn(gameState.board, 8)
    createHazardColumn(gameState.board, 9)
    createHazardColumn(gameState.board, 10)

    let hazardWalls: HazardWalls = new HazardWalls(gameState)
    let centers = calculateCenterWithHazard(gameState, hazardWalls)

    expect(centers.centerX).toBe(5)
    expect(centers.centerY).toBe(5)
  })
  // sadly this test isn't quite right - look to replace it with another better example
  it.skip('prioritizes being adjacent to hazard walls when duelling another snake in hazard', () => {
    for (let i: number = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 90, [{x: 4, y: 6}, {x: 4, y: 5}, {x: 5, y: 5}, {x: 5, y: 6}, {x: 6, y: 6}, {x: 7, y: 6}, {x: 7, y: 5}, {x: 6, y: 5}, {x: 6, y: 4}, {x: 6, y: 3}, {x: 5, y: 3}, {x: 5, y: 4}, {x: 4, y: 4}, {x: 4, y: 3}, {x: 3, y: 3}, {x: 3, y: 4}, {x: 3, y: 5}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 60, [{x: 1, y: 3}, {x: 2, y: 3}, {x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}, {x: 2, y: 1}, {x: 2, y: 0}, {x: 3, y: 0}, {x: 4, y: 0}, {x: 5, y: 0}, {x: 6, y: 0}, {x: 6, y: 1}, {x: 7, y: 1}, {x: 8, y: 1}, {x: 8, y: 2}, {x: 8, y: 3}, {x: 8, y: 4}, {x: 8, y: 5}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 0, y: 1}, {x: 0, y: 6}]

      createHazardColumn(gameState.board, 0)
      createHazardColumn(gameState.board, 1)
      createHazardColumn(gameState.board, 2)
      createHazardColumn(gameState.board, 9)
      createHazardColumn(gameState.board, 10)

      createHazardRow(gameState.board, 0)
      createHazardRow(gameState.board, 9)
      createHazardRow(gameState.board, 10)


      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("left") // left will put us on the hazard wall
    }
  })
})

describe('face off tests', () => {
  it('closes the distance from a faceoff position', () => {
    for (let i: number = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 70, [{x: 1, y: 6}, {x: 2, y: 6}, {x: 3, y: 6}, {x: 4, y: 6}, {x: 5, y: 6}, {x: 6, y: 6}, {x: 7, y: 6}, {x: 7, y: 5}, {x: 7, y: 4}, {x: 8, y: 4}, {x: 8, y: 3}, {x: 7, y: 3}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 70, [{x: 1, y: 4}, {x: 1, y: 3}, {x: 2, y: 3}, {x: 3, y: 3}, {x: 3, y: 4}, {x: 4, y: 4}, {x: 4, y: 3}, {x: 4, y: 2}, {x: 5, y: 2}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("down") // down closes the gap in a face off
    }
  })
})

describe('sandwich tests', () => {
  it('avoids being sandwiched', () => {
    for (let i: number = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 70, [{x: 5, y: 2}, {x: 5, y: 1}, {x: 4, y: 1}, {x: 3, y: 1}, {x: 2, y: 1}, {x: 1, y: 1}, {x: 0, y: 1}, {x: 0, y: 0}, {x: 1, y: 0}, {x: 2, y: 0}, {x: 3, y: 0}, {x: 4, y: 0}, {x: 5, y: 0}, {x: 6, y: 0}, {x: 7, y: 0}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 70, [{x: 4, y: 3}, {x: 3, y: 3}, {x: 2, y: 3}, {x: 1, y: 3}, {x: 1, y: 4}, {x: 1, y: 5}, {x: 1, y : 6}, {x: 1, y: 7}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 70, [{x: 6, y: 3}, {x: 7, y: 3}, {x: 8, y: 3}, {x: 9, y: 3}, {x: 10, y: 3}], "30", "", "")
      gameState.board.snakes.push(otherSnek2)

      gameState.board.food = [{x: 5, y: 3}] // food to try to tempt snek into the sandwich

      let moveResponse: MoveResponse = move(gameState)
      // both otherSnek & otherSnek2 are in KissOfDeath3to1Avoidance situations with snek, & should go up. If snek also goes up, it will be sandwiched - it should go left or right
      expect(moveResponse.move).not.toBe("up")
    }
  })
})

describe('SnakeScore hash key tests', () => {
  it('can correctly create a hashKey out of a snake score', () => {
    let snakeScore = new SnakeScore(500, 8, FoodCountTier.less7, HazardCountTier.less31, 4, 4, "1.0.0")
    let snakeScoreHash = snakeScore.hashKey()

    expect(snakeScoreHash).toBe("8;2;1;4;4")
  })
  it('can correctly create a SnakeScore out of a hash key', () => {
    let snakeScoreHash = "15;3;0;3;4"
    let snakeScore = getSnakeScoreFromHashKey(snakeScoreHash, 500)

    expect(snakeScore).toBeDefined()
    if (snakeScore !== undefined) {
      expect(snakeScore.snakeLength).toBe(15)
      expect(snakeScore.foodCountTier).toBe(FoodCountTier.lots)
      expect(snakeScore.hazardCountTier).toBe(HazardCountTier.zero)
      expect(snakeScore.snakeCount).toBe(3)
      expect(snakeScore.depth).toBe(4)
    }
  })
})

describe('Voronoi diagram tests', () => {
  it('can correctly map out a Voronoi diagram given no snakes of equal length & no food', () => {
    const snek = new Battlesnake("snek", "snek", 70, [{x: 1, y: 1}, {x: 2, y: 1}, {x: 2, y: 0}], "30", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 70, [{x: 4, y: 4}, {x: 3, y: 4}, {x: 2, y: 4}, {x: 1, y: 4}, {x: 0, y: 4}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    // as a POC, make the game board small
    gameState.board.height = 5
    gameState.board.width = 5

    let board2d: Board2d = new Board2d(gameState, true)

    let reachableCells = calculateReachableCells(gameState, board2d)
    let snekReachableCells = reachableCells[snek.id]
    let otherSnekReachableCells = reachableCells[otherSnek.id]

    expect(snekReachableCells).toBeDefined()
    expect(otherSnekReachableCells).toBeDefined()

    if (snekReachableCells !== undefined) {
      expect(snekReachableCells).toBe(14)
    }
    if (otherSnekReachableCells !== undefined) {
      expect(otherSnekReachableCells).toBe(11)
    }
  })
  it('can consider hazard when plotting Voronoi diagram', () => {
    const snek = new Battlesnake("snek", "snek", 20, [{x: 2, y: 2}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 1, y: 4}], "30", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 3, y: 2}, {x: 3, y: 1}, {x: 3, y: 0}, {x: 4, y: 0}, {x: 4, y: 1}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    gameState.board.height = 5
    gameState.board.width = 5

    // hazards make it harder for snek to Voronoi points with its low health, but it still gates otherSnek off from reaching them
    createHazardRow(gameState.board, 4)
    createHazardColumn(gameState.board, 0)

    let board2d: Board2d = new Board2d(gameState, true)

    let reachableCells = calculateReachableCells(gameState, board2d)
    let snekReachableCells = reachableCells[snek.id]
    let otherSnekReachableCells = reachableCells[otherSnek.id]

    expect(snekReachableCells).toBeDefined()
    expect(otherSnekReachableCells).toBeDefined()

    if (snekReachableCells !== undefined) {
      expect(snekReachableCells).toBeCloseTo(12.4) // can reach 10 non-hazards, & 6 hazards. 7th, final hazard in top left corner unreachable due to health. 10*1 + 6*0.4 = 12.4
    }
    if (otherSnekReachableCells !== undefined) {
      expect(otherSnekReachableCells).toBeCloseTo(6.8) // can reach 6 non-hazards, & 2 hazards. 6*1 + 2*0.4 = 6.8
    }
  })
  it('correctly determines whether we can escape through tail when food increases our length', () => {
    const snek = new Battlesnake("snek", "snek", 70, [{x: 2, y: 0}, {x: 2, y: 1}, {x: 1, y: 1}, {x: 0, y: 1}, {x: 0, y: 2}, {x: 1, y: 2}], "30", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 70, [{x: 3, y: 1}, {x: 4, y: 1}, {x: 5, y: 1}, {x: 5, y: 2}, {x: 6, y: 2}, {x: 7, y: 2}, {x: 7, y: 3}, {x: 8, y: 3}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 70, [{x: 3, y: 5}, {x: 2, y: 5}, {x: 2, y: 4}, {x: 1, y: 4}, {x: 1, y: 3}, {x: 2, y: 3}, {x: 3, y: 3}, {x: 4, y: 3}, {x: 5, y: 3}], "30", "", "")
    gameState.board.snakes.push(otherSnek2)

    gameState.game.ruleset.settings.hazardDamagePerTurn = 0

    gameState.turn = 84

    gameState.board.food = [{x: 0, y: 0}, {x: 8, y: 0}, {x: 4, y: 4}, {x: 6, y: 6}]

    let board2d = new Board2d(gameState, true)

    let reachableCells = calculateReachableCells(gameState, board2d)
    let snekReachableCells = reachableCells[snek.id]

    expect(snekReachableCells).toBeDefined()

    if (snekReachableCells !== undefined) {
      expect(snekReachableCells).toBe(3) // can reach own cell, one left, & the left corner. No escape through tail.
    }
  })
})

describe('Voronoi tests', () => {
  it('chooses to follow after a move that grants it the most Voronoi coverage', () => {
    const snek = new Battlesnake("snek", "snek", 70, [{x: 1, y: 7}, {x: 2, y: 7}, {x: 3, y: 7}, {x: 3, y: 8}, {x: 4, y: 8}, {x: 4, y: 9}, {x: 5, y: 9}, {x: 5, y: 8}, {x: 6, y: 8}, {x: 7, y: 8}, {x: 7, y: 9}, {x: 8, y: 9}, {x: 9, y: 9}, {x: 9, y: 10}, {x: 10, y: 10}, {x: 10, y: 9}, {x: 10, y: 8}, {x: 9, y: 8}, {x: 8, y: 8}, {x: 8, y: 7}, {x: 8, y: 6}, {x: 8, y: 5}, {x: 7, y: 5}, {x: 7, y: 6}, {x: 6, y: 6}, {x: 5, y: 6}, {x: 5, y: 7}, {x: 4, y: 7}, {x: 4, y: 6}, {x: 3, y: 6}, {x: 3, y: 5}, {x: 2, y: 5}], "30", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 70, [{x: 0, y: 6}, {x: 0, y: 5}, {x: 0, y: 4}, {x: 0, y: 3}, {x: 0, y: 2}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 1, y: 4}, {x: 2, y: 4}, {x: 3, y: 4}, {x: 3, y: 3}, {x: 2, y: 3}, {x: 2, y: 2}, {x: 3, y: 2}, {x: 4, y: 2}, {x: 5, y: 2}, {x: 5, y: 3}, {x: 5, y: 4}, {x: 4, y: 4}, {x: 4, y: 5}, {x: 5, y: 5}, {x: 6, y: 5}, {x: 6, y: 4}, {x: 6, y: 3}, {x: 6, y: 2}, {x: 6, y: 1}, {x: 5, y: 1}, {x: 4, y: 1}, {x: 3, y: 1}, {x: 2, y: 1}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    gameState.board.food = [{x: 0, y: 8}, {x: 0, y: 10}, {x: 10, y: 7}, {x: 7, y: 2}]

    gameState.game.ruleset.settings.hazardDamagePerTurn = 0
    gameState.turn = 380

    let moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("down") // left & up both strand Jaguar in a corner in so many moves. Voronoi should be smart enough to let Jaguar know that
    // down lets me continue to chase my tail in a way that will enable me to eat the majority of the tiles on the board.
  })
})

describe('Prolonging death tests', () => { // tests to ensure Jaguar tries to survive as long as possible even when death seems inevitable
  it('chooses a few turns of hazard & a likely murder over an immediate tie death', () => {
    const snek = new Battlesnake("snek", "snek", 69, [{x: 10, y: 9}, {x: 9, y: 9}, {x: 8, y: 9}, {x: 8, y: 8}, {x: 8, y: 7}, {x: 7, y: 7}, {x: 7, y: 8}], "30", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 89, [{x: 9, y: 8}, {x: 9, y: 7}, {x: 9, y: 6}, {x: 9, y: 5}, {x: 8, y: 5}, {x: 7, y: 5}, {x: 6, y: 5}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 72, [{x: 6, y: 7}, {x: 5, y: 7}, {x: 4, y: 7}, {x: 4, y: 6}, {x: 4, y: 5}, {x: 4, y: 4}, {x: 4, y: 3}, {x: 4, y: 2}], "30", "", "")
    gameState.board.snakes.push(otherSnek2)

    const otherSnek3 = new Battlesnake("otherSnek3", "otherSnek3", 76, [{x: 6, y: 9}, {x: 5, y: 9}, {x: 4, y: 9}, {x: 3, y: 9}, {x: 2, y: 9}, {x: 1, y: 9}, {x: 1, y: 8}, {x: 2, y: 8}], "30", "", "")
    gameState.board.snakes.push(otherSnek3)

    gameState.turn = 69
    gameState.board.food = [{x: 0, y: 0}, {x: 8, y: 1}]

    createHazardRow(gameState.board, 10)
    createHazardColumn(gameState.board, 10)

    let moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("up") // down kills us against otherSnek 100%, up will starve us & likely get us murdered in a few turns but at least isn't instant death
  })
})
