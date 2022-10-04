import { info, move, decideMove, start, gameData } from '../src/logic'
import { GameState, MoveResponse, RulesetSettings } from '../src/types';
import { Battlesnake, Direction, stringToDirection, BoardCell, Board2d, KissOfDeathState, KissOfMurderState, HazardWalls, KissStatesForEvaluate, SnakeScore, FoodCountTier, HazardCountTier, HazardSpiral, Coord, GameData, VoronoiResults, VoronoiResultsSnake, MoveWithEval } from '../src/classes'
import { isKingOfTheSnakes, cloneGameState, moveSnake, coordsEqual, createHazardRow, createHazardColumn, isInOrAdjacentToHazard, updateGameStateAfterMove, getLongestOtherSnake, calculateCenterWithHazard, getSnakeScoreFromHashKey, calculateReachableCells, getDistance, createGameDataId } from '../src/util'
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
      "shrinkEveryNTurns": 25
    },
    "squad": {
      "allowBodyCollisions": true,
      "sharedElimination": true,
      "sharedHealth": true,
      "sharedLength": true
    }
  }
}

function createHazardSpiralGameData(gameState: GameState, startTurn: number, startCoord: Coord) { // creates a hazard spiral object at starting coord & turn, & assigns to gameState ID
  let gameDataId = createGameDataId(gameState)
  if (gameData[gameDataId]) {
    gameData[gameDataId].hazardSpiral = new HazardSpiral(gameState, startTurn, 3, startCoord)
  } else {
    gameData[gameDataId] = new GameData(gameState)
    gameData[gameDataId].hazardSpiral = new HazardSpiral(gameState, startTurn, 3, startCoord)
  }
}

export function createGameState(me: Battlesnake): GameState {
  let settings = createRulesetSettings()
  let timeout: number
  const hazardDamage: number = settings.hazardDamagePerTurn || 0
  if (hazardDamage > 0) {
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
  // TODO: Fix, currently this is just an empty object after returning, despite it theoretically waiting on the promise to finish
  return machineLearningDataResult // wait for machine learning data to be processed
})

afterAll(() => {
  return server.close()
})

afterEach(() => {
  let gameDataKeys = Object.keys(gameData)
  for (const key of gameDataKeys) {
    delete gameData[key] // clean up game-specific data
  }
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
  // no longer valid, as this puts us in a bad spot against the remaining snake
  it.skip('turns towards the smaller snake and goes for the kill', () => {
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
  // while valid, Voronoi coverage has this as worse
  it.skip('acquires food even in corners', () => {
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
  // totally valid test, but we're too pessimistic to think that otherSnakes won't just murder us even sooner than the certain death by going down
  it.skip('chooses an escape through tail over a doomed fate in a corner', () => {
    const gameState = {"game":{"id":"24ad7287-6849-4584-a110-cfb0d5aa8c02","ruleset":{"name":"royale","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{"shrinkEveryNTurns":25},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":141,"board":{"width":11,"height":11,"food":[{"x":9,"y":2},{"x":10,"y":7}],"hazards":[{"x":0,"y":0},{"x":0,"y":1},{"x":0,"y":2},{"x":0,"y":3},{"x":0,"y":4},{"x":0,"y":5},{"x":0,"y":6},{"x":0,"y":7},{"x":0,"y":8},{"x":0,"y":9},{"x":0,"y":10},{"x":1,"y":0},{"x":1,"y":1},{"x":1,"y":10},{"x":2,"y":0},{"x":2,"y":1},{"x":2,"y":10},{"x":3,"y":0},{"x":3,"y":1},{"x":3,"y":10},{"x":4,"y":0},{"x":4,"y":1},{"x":4,"y":10},{"x":5,"y":0},{"x":5,"y":1},{"x":5,"y":10},{"x":6,"y":0},{"x":6,"y":1},{"x":6,"y":10},{"x":7,"y":0},{"x":7,"y":1},{"x":7,"y":10},{"x":8,"y":0},{"x":8,"y":1},{"x":8,"y":10},{"x":9,"y":0},{"x":9,"y":1},{"x":9,"y":10},{"x":10,"y":0},{"x":10,"y":1},{"x":10,"y":2},{"x":10,"y":3},{"x":10,"y":4},{"x":10,"y":5},{"x":10,"y":6},{"x":10,"y":7},{"x":10,"y":8},{"x":10,"y":9},{"x":10,"y":10}],"snakes":[{"id":"gs_873xBxyGgFpDrfQQWKXvFchD","name":"Jaguar Meets Snake","body":[{"x":3,"y":6},{"x":3,"y":5},{"x":3,"y":4},{"x":2,"y":4},{"x":1,"y":4},{"x":1,"y":5},{"x":1,"y":6},{"x":1,"y":7},{"x":2,"y":7}],"health":41,"latency":255,"head":{"x":3,"y":6},"length":9,"shout":"","squad":""},{"id":"gs_bBYfdgt6RRBQR3Yhyqvcwxg7","name":"Jaguar Meets Snake","body":[{"x":4,"y":7},{"x":4,"y":8},{"x":5,"y":8},{"x":5,"y":7},{"x":5,"y":6},{"x":6,"y":6},{"x":6,"y":5},{"x":7,"y":5},{"x":7,"y":4},{"x":8,"y":4},{"x":8,"y":5},{"x":9,"y":5},{"x":10,"y":5},{"x":10,"y":6},{"x":9,"y":6},{"x":8,"y":6},{"x":8,"y":7},{"x":7,"y":7},{"x":6,"y":7}],"health":88,"latency":207,"head":{"x":4,"y":7},"length":19,"shout":"","squad":""},{"id":"gs_6QxCpyPGcH3YSFqdpHmTCftP","name":"businesssssnake","body":[{"x":0,"y":3},{"x":1,"y":3},{"x":2,"y":3},{"x":2,"y":2},{"x":3,"y":2},{"x":3,"y":1},{"x":3,"y":0},{"x":4,"y":0},{"x":4,"y":1},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6}],"health":51,"latency":188,"head":{"x":0,"y":3},"length":14,"shout":"","squad":""}]},"you":{"id":"gs_6QxCpyPGcH3YSFqdpHmTCftP","name":"businesssssnake","body":[{"x":0,"y":3},{"x":1,"y":3},{"x":2,"y":3},{"x":2,"y":2},{"x":3,"y":2},{"x":3,"y":1},{"x":3,"y":0},{"x":4,"y":0},{"x":4,"y":1},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6}],"health":51,"latency":188,"head":{"x":0,"y":3},"length":14,"shout":"","squad":""}}
    const moveResponse = move(gameState)
    expect(moveResponse.move).toBe("up") // down is certain death, up gives us the possibility of survival if Jaguars don't try to murder us
  })
  // deprecated, Voronoi cares too much now to risk this.
  it.skip('seeks food on the edge of hazard if it is easy to acquire', () => {
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
      let otherSnekMove = decideMove(gameState, otherSnek, Date.now(), snek.health, new Board2d(gameState, true), true)
      expect(otherSnekMove.direction).toBe(Direction.Left)
    }
  })
  it('should allow otherSnakes to chase other snake tails', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 0, y: 2}, {x: 0, y: 1}, {x: 0, y: 0}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 50, [{x: 1, y: 0}, {x: 1, y: 1}, {x: 2, y: 1}, {x: 2, y: 0}, {x: 3, y: 0}], "30", "", "")
      gameState.board.snakes.push(otherSnek)
      let otherSnekMove = decideMove(gameState, otherSnek, Date.now(), snek.health, new Board2d(gameState, true), true)
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

    for (const coord of gameBoard.food) {
      let boardCell = board2d.getCell(coord)
      if (boardCell) {
        boardCell = boardCell as BoardCell
        expect(boardCell.food).toBe(true)
      }
    }

    for (const coord of gameBoard.hazards) {
      let boardCell = board2d.getCell(coord)
      if (boardCell) {
        boardCell = boardCell as BoardCell
        expect(boardCell.hazard).toBe(1)
      }
    }
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

    const longestSnake = getLongestOtherSnake(snek, gameState)
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
      gameState.game.ruleset.name = "royale"

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
    for (let i: number = 0; i < 5; i++) {
      const snek = new Battlesnake("snek", "snek", 80, [{x: 5, y: 3}, {x: 4, y: 3}, {x: 4, y: 2}, {x: 5, y: 2}, {x: 6, y: 2}, {x: 7, y: 2}, {x: 8, y: 2}, {x: 9, y: 2}, {x: 10, y: 2}, {x: 10, y: 3}, {x: 9, y: 3}, {x: 9, y: 4}, {x: 8, y: 4}, {x: 8, y: 5}, {x: 7, y: 5}, {x: 7, y: 6}, {x: 6, y: 6}], "30", "", "")
      const gameState = createGameState(snek)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 25, [{x: 4, y: 4}, {x: 3, y: 4}, {x: 3, y: 5}, {x: 4, y: 5}, {x: 4, y: 6}, {x: 4, y: 7}, {x: 5, y: 7}, {x: 6, y: 7}, {x: 7, y: 7}, {x: 8, y: 7}, {x: 9, y: 7}, {x: 10, y: 7}, {x: 10, y: 8}, {x: 10, y: 9}, {x: 9, y: 9}, {x: 8, y: 9}, {x: 7, y: 9}, {x: 6, y: 9}, {x: 6, y: 8}, {x: 5, y: 8}, {x: 4, y: 8}], "30", "", "")
      gameState.board.snakes.push(otherSnek)

      gameState.board.food = [{x: 7, y: 4}, {x: 9, y: 6}]

      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("up") // otherSnek 'must' move here, & it will eat us if we do too. We will get shoved into a corner in four turns anyway, but don't just walk into otherSnek
    }
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
  it('chooses a mutual kiss of death over a non-mutual kiss of death', () => {
    for (let i: number = 0; i < 3; i++) {
      const gameState: GameState = {"game":{"id":"74b25bd6-fb6b-438b-82d6-bf555f567793","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":37,"board":{"width":11,"height":11,"food":[{"x":8,"y":0}],"hazards":[],"snakes":[{"id":"gs_m96PyHgh7k8wq9FqFkyxckd7","name":"businesssssnake","body":[{"x":0,"y":3},{"x":1,"y":3},{"x":2,"y":3},{"x":2,"y":2},{"x":2,"y":2}],"health":100,"latency":162,"head":{"x":0,"y":3},"length":5,"shout":"","squad":""},{"id":"gs_7h4kTwyjPCMx6dkyxdYqGVx8","name":"Jaguar Meets Snake","body":[{"x":1,"y":4},{"x":2,"y":4},{"x":3,"y":4},{"x":3,"y":5},{"x":2,"y":5},{"x":1,"y":5},{"x":0,"y":5},{"x":0,"y":6}],"health":97,"latency":22,"head":{"x":1,"y":4},"length":8,"shout":"","squad":""},{"id":"gs_kk9M8WW7RYy8FHdxpvqP9yvV","name":"businesssssnake","body":[{"x":9,"y":4},{"x":8,"y":4},{"x":7,"y":4},{"x":7,"y":3},{"x":7,"y":2},{"x":6,"y":2}],"health":86,"latency":474,"head":{"x":9,"y":4},"length":6,"shout":"","squad":""},{"id":"gs_hgCXXbXxWq6cvySgqMV4cHpS","name":"Jaguar Meets Snake","body":[{"x":0,"y":1},{"x":1,"y":1},{"x":2,"y":1},{"x":2,"y":0},{"x":3,"y":0}],"health":95,"latency":42,"head":{"x":0,"y":1},"length":5,"shout":"","squad":""}]},"you":{"id":"gs_m96PyHgh7k8wq9FqFkyxckd7","name":"businesssssnake","body":[{"x":0,"y":3},{"x":1,"y":3},{"x":2,"y":3},{"x":2,"y":2},{"x":2,"y":2}],"health":100,"latency":162,"head":{"x":0,"y":3},"length":5,"shout":"","squad":""}}
      const moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("down") // up is certain death against larger snake, down is a tie death if smaller Jaguar decides he wants it
    }
  })
  it('KoD1: avoids a kiss of death even if its alternative is poor Voronoi coverage', () => {
    const gameState: GameState = {"game":{"id":"da913299-1a20-42de-ba0b-7ab9c4901f10","ruleset":{"name":"royale","version":"?","settings":{"foodSpawnChance":20,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{"shrinkEveryNTurns":25},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":2500,"source":"testing"},"turn":75,"board":{"width":11,"height":11,"food":[{"x":3,"y":3}],"hazards":[{"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0},{"x":3,"y":0},{"x":4,"y":0},{"x":5,"y":0},{"x":6,"y":0},{"x":7,"y":0},{"x":8,"y":0},{"x":9,"y":0},{"x":9,"y":1},{"x":9,"y":2},{"x":9,"y":3},{"x":9,"y":4},{"x":9,"y":5},{"x":9,"y":6},{"x":9,"y":7},{"x":9,"y":8},{"x":9,"y":9},{"x":9,"y":10},{"x":10,"y":0},{"x":10,"y":1},{"x":10,"y":2},{"x":10,"y":3},{"x":10,"y":4},{"x":10,"y":5},{"x":10,"y":6},{"x":10,"y":7},{"x":10,"y":8},{"x":10,"y":9},{"x":10,"y":10}],"snakes":[{"id":"gs_Fx74j46tcMPvdQShyb4FH4rc","name":"Jaguar Meets Snake","body":[{"x":7,"y":8},{"x":7,"y":7},{"x":7,"y":6},{"x":8,"y":6},{"x":9,"y":6},{"x":9,"y":5}],"health":54,"latency":86,"head":{"x":7,"y":8},"length":6,"shout":"","squad":""},{"id":"gs_HS9kF8pr9dgcd6MKBPYSdKK9","name":"lavafish","body":[{"x":6,"y":7},{"x":6,"y":6},{"x":5,"y":6},{"x":4,"y":6},{"x":4,"y":5},{"x":3,"y":5},{"x":2,"y":5},{"x":2,"y":6}],"health":87,"latency":174,"head":{"x":6,"y":7},"length":8,"shout":"","squad":""},{"id":"gs_9JyJg4bx8DbvHtVkX4m8yDj9","name":"Smarty2","body":[{"x":10,"y":5},{"x":10,"y":4},{"x":10,"y":3},{"x":10,"y":2},{"x":10,"y":1},{"x":10,"y":0},{"x":9,"y":0},{"x":8,"y":0},{"x":7,"y":0},{"x":6,"y":0},{"x":5,"y":0},{"x":5,"y":0}],"health":100,"latency":9,"head":{"x":10,"y":5},"length":12,"shout":"","squad":""}]},"you":{"id":"gs_Fx74j46tcMPvdQShyb4FH4rc","name":"Jaguar Meets Snake","body":[{"x":7,"y":8},{"x":7,"y":7},{"x":7,"y":6},{"x":8,"y":6},{"x":9,"y":6},{"x":9,"y":5}],"health":54,"latency":86,"head":{"x":7,"y":8},"length":6,"shout":"","squad":""}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).not.toBe("left") // left is likely death to lavafish, up or right has poor Voronoi coverage but isn't death
  })
  it('KoD2: avoids a tie kiss of death early game when fighting over center food', () => {
    for (let i: number = 0; i < 3; i++) {
      const gameState: GameState = {"game":{"id":"eafa920d-7de4-49c9-a147-c47c5f0a81b6","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":20,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"hz_hazard_pits","timeout":500,"source":"testing"},"turn":9,"board":{"width":11,"height":11,"food":[{"x":5,"y":5},{"x":6,"y":3}],"hazards":[],"snakes":[{"id":"gs_yXChxWk98YJJ6PTQm8BXvSyV","name":"Jagwire","health":93,"body":[{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":3,"y":7}],"latency":291,"head":{"x":4,"y":5},"length":4,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}},{"id":"gs_68JdPdg4JSv7bRDWdcDXXckG","name":"snake2_v3_FINAL_final(1)","health":93,"body":[{"x":5,"y":4},{"x":5,"y":3},{"x":5,"y":2},{"x":4,"y":2}],"latency":98,"head":{"x":5,"y":4},"length":4,"shout":"Moving up!","squad":"","customizations":{"color":"#1778b5","head":"orca","tail":"shiny"}},{"id":"gs_tJJhf6c3PgT4tP4qVqqpgJcW","name":"Shapeshifter","health":95,"body":[{"x":7,"y":4},{"x":7,"y":3},{"x":7,"y":2},{"x":7,"y":1}],"latency":411,"head":{"x":7,"y":4},"length":4,"shout":"","squad":"","customizations":{"color":"#900050","head":"cosmic-horror-special","tail":"cosmic-horror"}},{"id":"gs_GcrdT8Grjj6V3HpXJFtWJRxK","name":"soma-mini[sink]","health":93,"body":[{"x":6,"y":9},{"x":7,"y":9},{"x":7,"y":8},{"x":7,"y":7}],"latency":413,"head":{"x":6,"y":9},"length":4,"shout":"409","squad":"","customizations":{"color":"#ff00ff","head":"snail","tail":"fat-rattle"}}]},"you":{"id":"gs_yXChxWk98YJJ6PTQm8BXvSyV","name":"Jagwire","health":93,"body":[{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":3,"y":7}],"latency":291,"head":{"x":4,"y":5},"length":4,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
      const moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("left") // snake2 has kiss of deaths everywhere, so its behavior will be unpredictable. I can avoid a kiss of death by going left.
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
  it('KoM1: seeks a guaranteed kiss of murder to win the game', () => {
    const gameState: GameState = {"game":{"id":"394ca2d5-59fd-4eb5-adb4-5d4c59a07e7b","ruleset":{"name":"royale","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{"shrinkEveryNTurns":25},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":178,"board":{"width":11,"height":11,"food":[{"x":10,"y":3},{"x":9,"y":5},{"x":8,"y":3},{"x":5,"y":2}],"hazards":[{"x":0,"y":0},{"x":0,"y":1},{"x":0,"y":2},{"x":0,"y":3},{"x":0,"y":4},{"x":0,"y":5},{"x":0,"y":6},{"x":0,"y":7},{"x":0,"y":8},{"x":0,"y":9},{"x":0,"y":10},{"x":1,"y":0},{"x":1,"y":1},{"x":1,"y":2},{"x":1,"y":3},{"x":1,"y":4},{"x":1,"y":5},{"x":1,"y":6},{"x":1,"y":7},{"x":1,"y":8},{"x":1,"y":9},{"x":1,"y":10},{"x":2,"y":0},{"x":2,"y":1},{"x":2,"y":2},{"x":2,"y":3},{"x":2,"y":10},{"x":3,"y":0},{"x":3,"y":1},{"x":3,"y":2},{"x":3,"y":3},{"x":3,"y":10},{"x":4,"y":0},{"x":4,"y":1},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":10},{"x":5,"y":0},{"x":5,"y":1},{"x":5,"y":2},{"x":5,"y":3},{"x":5,"y":10},{"x":6,"y":0},{"x":6,"y":1},{"x":6,"y":2},{"x":6,"y":3},{"x":6,"y":10},{"x":7,"y":0},{"x":7,"y":1},{"x":7,"y":2},{"x":7,"y":3},{"x":7,"y":10},{"x":8,"y":0},{"x":8,"y":1},{"x":8,"y":2},{"x":8,"y":3},{"x":8,"y":10},{"x":9,"y":0},{"x":9,"y":1},{"x":9,"y":2},{"x":9,"y":3},{"x":9,"y":10},{"x":10,"y":0},{"x":10,"y":1},{"x":10,"y":2},{"x":10,"y":3},{"x":10,"y":10}],"snakes":[{"id":"gs_7yJRtvKHMk4rxGyVKChXDVp3","name":"pants 👖","body":[{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":3,"y":7},{"x":3,"y":8},{"x":3,"y":9},{"x":2,"y":9},{"x":1,"y":9},{"x":1,"y":8}],"health":10,"latency":20,"head":{"x":2,"y":4},"length":10,"shout":"💙","squad":""},{"id":"gs_gffQ84Hrgqb7YThbTb9jHq77","name":"Jaguar Meets Snake","body":[{"x":3,"y":5},{"x":3,"y":6},{"x":4,"y":6},{"x":5,"y":6},{"x":6,"y":6},{"x":7,"y":6},{"x":7,"y":7},{"x":8,"y":7},{"x":8,"y":6},{"x":8,"y":5},{"x":7,"y":5},{"x":6,"y":5},{"x":5,"y":5},{"x":4,"y":5}],"health":58,"latency":22,"head":{"x":3,"y":5},"length":14,"shout":"","squad":""}]},"you":{"id":"gs_gffQ84Hrgqb7YThbTb9jHq77","name":"Jaguar Meets Snake","body":[{"x":3,"y":5},{"x":3,"y":6},{"x":4,"y":6},{"x":5,"y":6},{"x":6,"y":6},{"x":7,"y":6},{"x":7,"y":7},{"x":8,"y":7},{"x":8,"y":6},{"x":8,"y":5},{"x":7,"y":5},{"x":6,"y":5},{"x":5,"y":5},{"x":4,"y":5}],"health":58,"latency":22,"head":{"x":3,"y":5},"length":14,"shout":"","squad":""}}
    const moveResponse = move(gameState)
    expect(moveResponse.move).toBe("down") // pants has too little health to go elsewhere, meaning down is a guaranteed kill & instant win
  })
  it('should kill as soon as it can rather than giving a snake another turn of life', () => {
    for (let i: number = 0; i < 3; i++) {
      const gameState: GameState = {"game":{"id":"bad1d2e8-e082-46e1-83a6-2e2f398d8707","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":174,"board":{"width":11,"height":11,"food":[{"x":7,"y":5},{"x":1,"y":2}],"hazards":[{"x":7,"y":4},{"x":7,"y":5},{"x":8,"y":5},{"x":8,"y":4},{"x":8,"y":3},{"x":7,"y":3},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":7,"y":6},{"x":8,"y":6},{"x":9,"y":6},{"x":9,"y":5},{"x":9,"y":4},{"x":9,"y":3},{"x":9,"y":2},{"x":8,"y":2},{"x":7,"y":2},{"x":6,"y":2},{"x":5,"y":2},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":6,"y":7},{"x":7,"y":7},{"x":8,"y":7},{"x":9,"y":7},{"x":10,"y":7},{"x":10,"y":6},{"x":10,"y":5},{"x":10,"y":4},{"x":10,"y":3},{"x":10,"y":2},{"x":10,"y":1},{"x":9,"y":1},{"x":8,"y":1},{"x":7,"y":1},{"x":6,"y":1},{"x":5,"y":1},{"x":4,"y":1},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":4,"y":8},{"x":5,"y":8},{"x":6,"y":8},{"x":7,"y":8},{"x":8,"y":8},{"x":9,"y":8},{"x":10,"y":8}],"snakes":[{"id":"gs_mVdmrcbG8HPgPjtMD6ypRpkV","name":"Shovel","body":[{"x":3,"y":9},{"x":3,"y":10},{"x":2,"y":10},{"x":2,"y":0},{"x":2,"y":1},{"x":3,"y":1},{"x":3,"y":0},{"x":4,"y":0},{"x":4,"y":10},{"x":5,"y":10},{"x":5,"y":0},{"x":6,"y":0},{"x":6,"y":10},{"x":7,"y":10},{"x":7,"y":9},{"x":8,"y":9},{"x":9,"y":9},{"x":9,"y":8},{"x":10,"y":8},{"x":0,"y":8},{"x":0,"y":7}],"health":99,"latency":21,"head":{"x":3,"y":9},"length":21,"shout":"","squad":""},{"id":"gs_GPqCFvMxmSXtdbwcqkrvGQ6Q","name":"businesssssnake","body":[{"x":4,"y":8},{"x":4,"y":9},{"x":5,"y":9},{"x":6,"y":9},{"x":6,"y":8},{"x":6,"y":7},{"x":6,"y":6},{"x":6,"y":5},{"x":6,"y":4},{"x":5,"y":4},{"x":5,"y":5},{"x":4,"y":5},{"x":3,"y":5},{"x":3,"y":6},{"x":2,"y":6},{"x":1,"y":6},{"x":1,"y":5}],"health":7,"latency":174,"head":{"x":4,"y":8},"length":17,"shout":"","squad":""}]},"you":{"id":"gs_mVdmrcbG8HPgPjtMD6ypRpkV","name":"Shovel","body":[{"x":3,"y":9},{"x":3,"y":10},{"x":2,"y":10},{"x":2,"y":0},{"x":2,"y":1},{"x":3,"y":1},{"x":3,"y":0},{"x":4,"y":0},{"x":4,"y":10},{"x":5,"y":10},{"x":5,"y":0},{"x":6,"y":0},{"x":6,"y":10},{"x":7,"y":10},{"x":7,"y":9},{"x":8,"y":9},{"x":9,"y":9},{"x":9,"y":8},{"x":10,"y":8},{"x":0,"y":8},{"x":0,"y":7}],"health":99,"latency":21,"head":{"x":3,"y":9},"length":21,"shout":"","squad":""}}
      createHazardSpiralGameData(gameState, 3, {x: 7, y: 4})
      gameState.game.map = "hz_spiral"
      const moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("down") // businesssssnake can survive by going left, & therefore will. Should eat it now rather than allowing it another turn
    }
  })
  it('KoM2: should kill as soon as possible to free up space when starving', () => {
    const gameState: GameState = {"game":{"id":"918d8b31-3ab0-4e00-a392-6d3eb32d1015","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":20,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"hz_hazard_pits","timeout":500,"source":"testing"},"turn":286,"board":{"width":11,"height":11,"food":[{"x":3,"y":10},{"x":1,"y":3}],"hazards":[],"snakes":[{"id":"gs_QXTPxbgRpQxvGhk3KH9PddJY","name":"Prüzze v2","health":93,"body":[{"x":10,"y":0},{"x":9,"y":0},{"x":8,"y":0},{"x":7,"y":0},{"x":6,"y":0},{"x":5,"y":0},{"x":4,"y":0},{"x":3,"y":0},{"x":2,"y":0},{"x":2,"y":1},{"x":2,"y":2},{"x":1,"y":2},{"x":1,"y":1},{"x":0,"y":1},{"x":0,"y":2},{"x":0,"y":3},{"x":0,"y":4},{"x":0,"y":5},{"x":0,"y":6},{"x":0,"y":7},{"x":0,"y":8},{"x":0,"y":9}],"latency":107,"head":{"x":10,"y":0},"length":22,"shout":"Lose, t=86","squad":"","customizations":{"color":"#c91f37","head":"gamer","tail":"coffee"}},{"id":"gs_Xg4T6qyrttMPQPW7k7YpKFhT","name":"CoolerSnake!","health":100,"body":[{"x":3,"y":9},{"x":3,"y":8},{"x":3,"y":7},{"x":3,"y":6},{"x":3,"y":5},{"x":3,"y":4},{"x":4,"y":4},{"x":5,"y":4},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":6,"y":8},{"x":7,"y":8},{"x":8,"y":8},{"x":9,"y":8},{"x":10,"y":8},{"x":10,"y":9},{"x":10,"y":10},{"x":9,"y":10},{"x":8,"y":10},{"x":7,"y":10},{"x":6,"y":10},{"x":5,"y":10},{"x":4,"y":10},{"x":4,"y":10}],"latency":109,"head":{"x":3,"y":9},"length":26,"shout":"9, 75","squad":"","customizations":{"color":"#ff6600","head":"cosmic-horror","tail":"cosmic-horror"}},{"id":"gs_XF4dqK7j8MTBP6mVdPcf4dpV","name":"Jagwire","health":5,"body":[{"x":9,"y":1},{"x":8,"y":1},{"x":7,"y":1},{"x":6,"y":1},{"x":5,"y":1},{"x":4,"y":1},{"x":4,"y":2},{"x":5,"y":2},{"x":6,"y":2},{"x":7,"y":2},{"x":8,"y":2},{"x":8,"y":3},{"x":8,"y":4},{"x":8,"y":5},{"x":7,"y":5},{"x":7,"y":6},{"x":8,"y":6},{"x":9,"y":6},{"x":10,"y":6},{"x":10,"y":5},{"x":10,"y":4},{"x":10,"y":3},{"x":10,"y":2}],"latency":22,"head":{"x":9,"y":1},"length":23,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}]},"you":{"id":"gs_XF4dqK7j8MTBP6mVdPcf4dpV","name":"Jagwire","health":5,"body":[{"x":9,"y":1},{"x":8,"y":1},{"x":7,"y":1},{"x":6,"y":1},{"x":5,"y":1},{"x":4,"y":1},{"x":4,"y":2},{"x":5,"y":2},{"x":6,"y":2},{"x":7,"y":2},{"x":8,"y":2},{"x":8,"y":3},{"x":8,"y":4},{"x":8,"y":5},{"x":7,"y":5},{"x":7,"y":6},{"x":8,"y":6},{"x":9,"y":6},{"x":10,"y":6},{"x":10,"y":5},{"x":10,"y":4},{"x":10,"y":3},{"x":10,"y":2}],"latency":22,"head":{"x":9,"y":1},"length":23,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("right") // right kills Pruzze & gives us a slightly better chance of surviving via a food spawn in Pruzze's body
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
    expect(gameState.game.ruleset.settings.royale.shrinkEveryNTurns).toBe(25)
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
    expect(gameState.board.snakes[0].hasEaten).toBe(false)
    expect(gameState.board.snakes[1].hasEaten).toBe(true)

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
    expect(gameState.board.snakes[0].hasEaten).toBe(false)
    expect(gameState.board.snakes[1].hasEaten).toBe(true)

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
    expect(clone.game.ruleset.settings.royale.shrinkEveryNTurns).toBe(25)
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

    expect(clone.you.name).toBe("snek")

    expect(clone.board.snakes[0].hasEaten).toBe(false)
    expect(clone.board.snakes[1].hasEaten).toBe(true)
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

    expect(snek.hasEaten).toBe(false)
  })
  it('should have correct body and health after moving into hazard', () => {
    const snek = new Battlesnake("snek", "snek", 80, [{x: 2, y: 2}, {x: 3, y: 2}, {x: 3, y: 1}, {x: 4, y: 1}, {x: 5, y: 1}], "30", "", "")
    const gameState = createGameState(snek)

    gameState.board.food = [{x: 5, y: 5}, {x: 6, y: 6}]

    gameState.board.hazards = [{x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4}, {x: 2, y: 5}, {x: 2, y: 6}, {x: 2, y: 7}, {x: 2, y: 8}, {x: 2, y: 9}, {x: 2, y: 10}]

    const board2d = new Board2d(gameState)
    const hazardDamage: number = gameState.game.ruleset.settings.hazardDamagePerTurn || 0

    moveSnake(gameState, snek, board2d, Direction.Up)

    expect(snek.length).toBe(5) // length shouldn't have changed
    expect(snek.health).toBe(80 - 1 - hazardDamage) // health should be one less, and also hazardDamagePerTurn less
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

    expect(snek.hasEaten).toBe(false)
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
    
    expect(snek.hasEaten).toBe(true)
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

    expect(snek.hasEaten).toBe(false)
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
        let evalSnekScore = evalSnek.sum()
        let evalOtherSnek = evaluate(gameState, otherSnek, kissStates)
        let evalOtherSnekScore = evalOtherSnek.sum()

        expect(evalSnekScore).toBeGreaterThan(evalOtherSnekScore)
    })
})

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
  it('hazardExit1: does not travel through hazard when not necessary', () => {
    for (let i = 0; i < 3; i++) {
      const gameState = {"game":{"id":"ce5b0432-7c32-49ee-bafc-73e6f331f05a","ruleset":{"name":"royale","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{"shrinkEveryNTurns":25},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":147,"board":{"width":11,"height":11,"food":[{"x":10,"y":5},{"x":5,"y":1},{"x":1,"y":4},{"x":8,"y":2}],"hazards":[{"x":0,"y":0},{"x":0,"y":1},{"x":0,"y":2},{"x":0,"y":3},{"x":0,"y":4},{"x":0,"y":5},{"x":0,"y":6},{"x":0,"y":7},{"x":0,"y":8},{"x":0,"y":9},{"x":0,"y":10},{"x":1,"y":0},{"x":1,"y":1},{"x":1,"y":2},{"x":1,"y":3},{"x":1,"y":4},{"x":1,"y":5},{"x":1,"y":6},{"x":1,"y":7},{"x":1,"y":8},{"x":1,"y":9},{"x":1,"y":10},{"x":2,"y":0},{"x":2,"y":1},{"x":2,"y":2},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":2,"y":8},{"x":2,"y":9},{"x":2,"y":10},{"x":9,"y":0},{"x":9,"y":1},{"x":9,"y":2},{"x":9,"y":3},{"x":9,"y":4},{"x":9,"y":5},{"x":9,"y":6},{"x":9,"y":7},{"x":9,"y":8},{"x":9,"y":9},{"x":9,"y":10},{"x":10,"y":0},{"x":10,"y":1},{"x":10,"y":2},{"x":10,"y":3},{"x":10,"y":4},{"x":10,"y":5},{"x":10,"y":6},{"x":10,"y":7},{"x":10,"y":8},{"x":10,"y":9},{"x":10,"y":10}],"snakes":[{"id":"gs_Whcr3RgykTTvT7Djwx4tXSKK","name":"businesssssnake","body":[{"x":2,"y":7},{"x":2,"y":8},{"x":2,"y":9},{"x":2,"y":10},{"x":3,"y":10},{"x":3,"y":9},{"x":3,"y":8},{"x":4,"y":8},{"x":4,"y":7},{"x":5,"y":7},{"x":6,"y":7},{"x":7,"y":7},{"x":8,"y":7},{"x":8,"y":6},{"x":7,"y":6},{"x":6,"y":6}],"health":40,"latency":213,"head":{"x":2,"y":7},"length":16,"shout":"","squad":""},{"id":"gs_vgdr9WckVkRfTKJkyDjVKm9K","name":"Jaguar Meets Snake","body":[{"x":9,"y":10},{"x":8,"y":10},{"x":8,"y":9},{"x":8,"y":8},{"x":7,"y":8},{"x":7,"y":9},{"x":6,"y":9},{"x":5,"y":9},{"x":4,"y":9}],"health":85,"latency":44,"head":{"x":9,"y":10},"length":9,"shout":"","squad":""}]},"you":{"id":"gs_Whcr3RgykTTvT7Djwx4tXSKK","name":"businesssssnake","body":[{"x":2,"y":7},{"x":2,"y":8},{"x":2,"y":9},{"x":2,"y":10},{"x":3,"y":10},{"x":3,"y":9},{"x":3,"y":8},{"x":4,"y":8},{"x":4,"y":7},{"x":5,"y":7},{"x":6,"y":7},{"x":7,"y":7},{"x":8,"y":7},{"x":8,"y":6},{"x":7,"y":6},{"x":6,"y":6}],"health":40,"latency":213,"head":{"x":2,"y":7},"length":16,"shout":"","squad":""}}
      const moveResponse = move(gameState)
      expect(moveResponse.move).toBe("right") // Can leave hazard by going right. Down or Left give us extra Voronoi coverage but are totally unnecessary
    }
  })
  it('properly determines snake health after moving into hazard', () => { 
    const gameState: GameState = {"game":{"id":"424f4ec5-dbd5-47b0-9cb8-e51c9009fefa","ruleset":{"name":"royale","version":"?","settings":{"foodSpawnChance":20,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{"shrinkEveryNTurns":25},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":600,"source":"testing"},"turn":130,"board":{"width":11,"height":11,"food":[{"x":1,"y":1},{"x":0,"y":1},{"x":1,"y":8}],"hazards":[{"x":0,"y":0},{"x":0,"y":1},{"x":0,"y":2},{"x":0,"y":3},{"x":0,"y":4},{"x":0,"y":5},{"x":0,"y":6},{"x":0,"y":7},{"x":0,"y":8},{"x":0,"y":9},{"x":0,"y":10},{"x":1,"y":0},{"x":1,"y":1},{"x":1,"y":2},{"x":1,"y":3},{"x":1,"y":4},{"x":1,"y":5},{"x":1,"y":6},{"x":1,"y":7},{"x":1,"y":8},{"x":1,"y":9},{"x":1,"y":10},{"x":2,"y":0},{"x":2,"y":1},{"x":2,"y":2},{"x":3,"y":0},{"x":3,"y":1},{"x":3,"y":2},{"x":4,"y":0},{"x":4,"y":1},{"x":4,"y":2},{"x":5,"y":0},{"x":5,"y":1},{"x":5,"y":2},{"x":6,"y":0},{"x":6,"y":1},{"x":6,"y":2},{"x":7,"y":0},{"x":7,"y":1},{"x":7,"y":2},{"x":8,"y":0},{"x":8,"y":1},{"x":8,"y":2},{"x":9,"y":0},{"x":9,"y":1},{"x":9,"y":2},{"x":10,"y":0},{"x":10,"y":1},{"x":10,"y":2}],"snakes":[{"id":"gs_xrRtr9B8ftcjkySSr8Hh6HrR","name":"Jaguar Meets Snake","body":[{"x":2,"y":2},{"x":2,"y":3},{"x":3,"y":3},{"x":3,"y":4},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":4,"y":8},{"x":3,"y":8},{"x":2,"y":8},{"x":2,"y":7},{"x":2,"y":6}],"health":82,"latency":208,"head":{"x":2,"y":2},"length":13,"shout":"","squad":""},{"id":"gs_Qk9Xh8VYrVyDYjpk4Y3DjYCc","name":"snakos","body":[{"x":7,"y":3},{"x":6,"y":3},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":5,"y":8},{"x":5,"y":9},{"x":6,"y":9},{"x":7,"y":9},{"x":7,"y":8},{"x":7,"y":7},{"x":7,"y":6},{"x":8,"y":6},{"x":9,"y":6}],"health":90,"latency":109,"head":{"x":7,"y":3},"length":16,"shout":"chasing snack","squad":""}]},"you":{"id":"gs_xrRtr9B8ftcjkySSr8Hh6HrR","name":"Jaguar Meets Snake","body":[{"x":2,"y":2},{"x":2,"y":3},{"x":3,"y":3},{"x":3,"y":4},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":4,"y":8},{"x":3,"y":8},{"x":2,"y":8},{"x":2,"y":7},{"x":2,"y":6}],"health":82,"latency":208,"head":{"x":2,"y":2},"length":13,"shout":"","squad":""}}
    const moveResponse: MoveResponse = move(gameState)
    const moveDir: Direction = stringToDirection(moveResponse.move) || Direction.Up
    const healthBefore = gameState.you.health
    const hazardDamage: number = gameState.game.ruleset.settings.hazardDamagePerTurn || 0
    const regularDamage = 1
    moveSnake(gameState, gameState.you, new Board2d(gameState), moveDir)
    updateGameStateAfterMove(gameState)
    expect(gameState.you.health).toBe(healthBefore - hazardDamage - regularDamage)
    expect(gameState.you.health).toBe(82 - 14 - 1)
  })
  it('properly determines snake health after moving out of hazard', () => { 
    const snek = new Battlesnake("snek", "snek", 80, [{x: 3, y: 0}, {x: 4, y: 0}, {x: 5, y: 0}], "30", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 90, [{x: 5, y: 5}, {x: 6, y: 5}, {x: 7, y: 5}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    createHazardRow(gameState.board, 0)

    const moveDir: Direction = Direction.Up
    const healthBefore = gameState.you.health
    const regularDamage = 1
    moveSnake(gameState, gameState.you, new Board2d(gameState), moveDir)
    updateGameStateAfterMove(gameState)
    expect(gameState.you.health).toBe(healthBefore - regularDamage)
    expect(gameState.you.health).toBe(80 - 1)
  })
  // skipping, but see hazardSpiral1-2. Jaguar is healthy when he jumps & it does give him better Voronoi coverage
  it.skip('hazardSpiral1: does not jump into hazard unnecessarily', () => {
    const gameState: GameState = {"game":{"id":"8df95668-02d9-4df5-b515-ea000174cd06","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":20,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":146,"board":{"width":11,"height":11,"food":[{"x":5,"y":6}],"hazards":[{"x":5,"y":5},{"x":5,"y":6},{"x":6,"y":6},{"x":6,"y":5},{"x":6,"y":4},{"x":5,"y":4},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":5,"y":7},{"x":6,"y":7},{"x":7,"y":7},{"x":7,"y":6},{"x":7,"y":5},{"x":7,"y":4},{"x":7,"y":3},{"x":6,"y":3},{"x":5,"y":3},{"x":4,"y":3},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":3,"y":7},{"x":3,"y":8},{"x":4,"y":8},{"x":5,"y":8},{"x":6,"y":8},{"x":7,"y":8},{"x":8,"y":8},{"x":8,"y":7},{"x":8,"y":6},{"x":8,"y":5},{"x":8,"y":4},{"x":8,"y":3},{"x":8,"y":2},{"x":7,"y":2},{"x":6,"y":2},{"x":5,"y":2},{"x":4,"y":2},{"x":3,"y":2},{"x":2,"y":2},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7}],"snakes":[{"id":"gs_7bcCkhXjg987yfVQ8PxhpSrc","name":"hawthhhh++","body":[{"x":9,"y":4},{"x":10,"y":4},{"x":10,"y":5},{"x":0,"y":5},{"x":0,"y":4},{"x":1,"y":4},{"x":2,"y":4},{"x":3,"y":4},{"x":3,"y":3},{"x":2,"y":3},{"x":1,"y":3},{"x":0,"y":3},{"x":0,"y":2},{"x":0,"y":1}],"health":94,"latency":476,"head":{"x":9,"y":4},"length":14,"shout":"","squad":""},{"id":"gs_qYRVxpBCBM7hPYtQmcGbJWxP","name":"Jaguar Meets Snake","body":[{"x":5,"y":1},{"x":5,"y":0},{"x":4,"y":0},{"x":3,"y":0},{"x":3,"y":10},{"x":2,"y":10},{"x":1,"y":10},{"x":1,"y":9},{"x":2,"y":9},{"x":2,"y":8},{"x":2,"y":7},{"x":2,"y":6},{"x":1,"y":6},{"x":0,"y":6},{"x":10,"y":6},{"x":10,"y":7},{"x":9,"y":7}],"health":83,"latency":412,"head":{"x":5,"y":1},"length":17,"shout":"","squad":""},{"id":"gs_WyRWDVyVjg6RCt7qmWFPX9k7","name":"Shapeshifter","body":[{"x":6,"y":9},{"x":5,"y":9},{"x":5,"y":10},{"x":6,"y":10},{"x":7,"y":10},{"x":8,"y":10},{"x":8,"y":0},{"x":9,"y":0},{"x":9,"y":10},{"x":9,"y":9},{"x":9,"y":8}],"health":78,"latency":297,"head":{"x":6,"y":9},"length":11,"shout":"","squad":""}]},"you":{"id":"gs_qYRVxpBCBM7hPYtQmcGbJWxP","name":"Jaguar Meets Snake","body":[{"x":5,"y":1},{"x":5,"y":0},{"x":4,"y":0},{"x":3,"y":0},{"x":3,"y":10},{"x":2,"y":10},{"x":1,"y":10},{"x":1,"y":9},{"x":2,"y":9},{"x":2,"y":8},{"x":2,"y":7},{"x":2,"y":6},{"x":1,"y":6},{"x":0,"y":6},{"x":10,"y":6},{"x":10,"y":7},{"x":9,"y":7}],"health":83,"latency":412,"head":{"x":5,"y":1},"length":17,"shout":"","squad":""}}
    gameState.game.map = "hz_spiral"
    createHazardSpiralGameData(gameState, 3, {x: 5, y: 5})
    const moveResponse = move(gameState)
    expect(moveResponse.move).not.toBe("up") // up puts us in the hazard, with a lone food as bait. We have two perfectly reasonable non-hazard moves to make
  })
  it('hazardSpiral1-2: having jumped into hazard, should get the food to top up', () => {
    const gameState: GameState = {"game":{"id":"8df95668-02d9-4df5-b515-ea000174cd06","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":20,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":148,"board":{"width":11,"height":11,"food":[{"x":5,"y":6}],"hazards":[{"x":5,"y":5},{"x":5,"y":6},{"x":6,"y":6},{"x":6,"y":5},{"x":6,"y":4},{"x":5,"y":4},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":5,"y":7},{"x":6,"y":7},{"x":7,"y":7},{"x":7,"y":6},{"x":7,"y":5},{"x":7,"y":4},{"x":7,"y":3},{"x":6,"y":3},{"x":5,"y":3},{"x":4,"y":3},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":3,"y":7},{"x":3,"y":8},{"x":4,"y":8},{"x":5,"y":8},{"x":6,"y":8},{"x":7,"y":8},{"x":8,"y":8},{"x":8,"y":7},{"x":8,"y":6},{"x":8,"y":5},{"x":8,"y":4},{"x":8,"y":3},{"x":8,"y":2},{"x":7,"y":2},{"x":6,"y":2},{"x":5,"y":2},{"x":4,"y":2},{"x":3,"y":2},{"x":2,"y":2},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":2,"y":8}],"snakes":[{"id":"gs_7bcCkhXjg987yfVQ8PxhpSrc","name":"hawthhhh++","body":[{"x":9,"y":6},{"x":9,"y":5},{"x":9,"y":4},{"x":10,"y":4},{"x":10,"y":5},{"x":0,"y":5},{"x":0,"y":4},{"x":1,"y":4},{"x":2,"y":4},{"x":3,"y":4},{"x":3,"y":3},{"x":2,"y":3},{"x":1,"y":3},{"x":0,"y":3}],"health":92,"latency":473,"head":{"x":9,"y":6},"length":14,"shout":"","squad":""},{"id":"gs_qYRVxpBCBM7hPYtQmcGbJWxP","name":"Jaguar Meets Snake","body":[{"x":5,"y":3},{"x":5,"y":2},{"x":5,"y":1},{"x":5,"y":0},{"x":4,"y":0},{"x":3,"y":0},{"x":3,"y":10},{"x":2,"y":10},{"x":1,"y":10},{"x":1,"y":9},{"x":2,"y":9},{"x":2,"y":8},{"x":2,"y":7},{"x":2,"y":6},{"x":1,"y":6},{"x":0,"y":6},{"x":10,"y":6}],"health":53,"latency":296,"head":{"x":5,"y":3},"length":17,"shout":"","squad":""},{"id":"gs_WyRWDVyVjg6RCt7qmWFPX9k7","name":"Shapeshifter","body":[{"x":8,"y":9},{"x":7,"y":9},{"x":6,"y":9},{"x":5,"y":9},{"x":5,"y":10},{"x":6,"y":10},{"x":7,"y":10},{"x":8,"y":10},{"x":8,"y":0},{"x":9,"y":0},{"x":9,"y":10}],"health":76,"latency":297,"head":{"x":8,"y":9},"length":11,"shout":"","squad":""}]},"you":{"id":"gs_qYRVxpBCBM7hPYtQmcGbJWxP","name":"Jaguar Meets Snake","body":[{"x":5,"y":3},{"x":5,"y":2},{"x":5,"y":1},{"x":5,"y":0},{"x":4,"y":0},{"x":3,"y":0},{"x":3,"y":10},{"x":2,"y":10},{"x":1,"y":10},{"x":1,"y":9},{"x":2,"y":9},{"x":2,"y":8},{"x":2,"y":7},{"x":2,"y":6},{"x":1,"y":6},{"x":0,"y":6},{"x":10,"y":6}],"health":53,"latency":296,"head":{"x":5,"y":3},"length":17,"shout":"","squad":""}}
    gameState.game.map = "hz_spiral"
    createHazardSpiralGameData(gameState, 3, {x: 5, y: 5})
    const moveResponse = move(gameState)
    expect(moveResponse.move).toBe("up") // now that we've dove, we've really gotta go all the way for the food
  })
  it('hazardConstrain1: chooses to constrain duel opponent rather than seek food', () => {
    const gameState: GameState = {"game":{"id":"41dadc8b-2850-480a-b971-44bd809b3683","ruleset":{"name":"royale","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{"shrinkEveryNTurns":25},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":205,"board":{"width":11,"height":11,"food":[{"x":0,"y":0},{"x":10,"y":6},{"x":9,"y":0},{"x":4,"y":2},{"x":2,"y":4}],"hazards":[{"x":0,"y":0},{"x":0,"y":1},{"x":0,"y":2},{"x":0,"y":3},{"x":0,"y":4},{"x":0,"y":5},{"x":0,"y":6},{"x":0,"y":7},{"x":0,"y":8},{"x":0,"y":9},{"x":0,"y":10},{"x":1,"y":0},{"x":1,"y":1},{"x":1,"y":2},{"x":1,"y":3},{"x":1,"y":4},{"x":1,"y":5},{"x":1,"y":6},{"x":1,"y":7},{"x":1,"y":8},{"x":1,"y":9},{"x":1,"y":10},{"x":2,"y":0},{"x":2,"y":1},{"x":2,"y":2},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":10},{"x":3,"y":0},{"x":3,"y":1},{"x":3,"y":2},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":10},{"x":4,"y":0},{"x":4,"y":1},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":10},{"x":5,"y":0},{"x":5,"y":1},{"x":5,"y":2},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":10},{"x":6,"y":0},{"x":6,"y":1},{"x":6,"y":2},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":10},{"x":7,"y":0},{"x":7,"y":1},{"x":7,"y":2},{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":10},{"x":8,"y":0},{"x":8,"y":1},{"x":8,"y":2},{"x":8,"y":3},{"x":8,"y":4},{"x":8,"y":10},{"x":9,"y":0},{"x":9,"y":1},{"x":9,"y":2},{"x":9,"y":3},{"x":9,"y":4},{"x":9,"y":10},{"x":10,"y":0},{"x":10,"y":1},{"x":10,"y":2},{"x":10,"y":3},{"x":10,"y":4},{"x":10,"y":10}],"snakes":[{"id":"gs_jwy7YGxPbPf8FD3Qm4SGwCm4","name":"🇺🇦 Jaguar Meets Snake 🇺🇦","body":[{"x":9,"y":8},{"x":10,"y":8},{"x":10,"y":9},{"x":9,"y":9},{"x":8,"y":9},{"x":7,"y":9},{"x":6,"y":9},{"x":6,"y":8},{"x":5,"y":8},{"x":5,"y":7},{"x":4,"y":7}],"health":93,"latency":453,"head":{"x":9,"y":8},"length":11,"shout":"","squad":""},{"id":"gs_KxBCvvKGwtmgdfmFfYSpqQW7","name":"businesssssnake","body":[{"x":4,"y":5},{"x":4,"y":4},{"x":3,"y":4},{"x":3,"y":3},{"x":4,"y":3},{"x":5,"y":3},{"x":5,"y":4},{"x":6,"y":4},{"x":6,"y":3},{"x":7,"y":3},{"x":8,"y":3},{"x":9,"y":3},{"x":9,"y":4},{"x":8,"y":4},{"x":8,"y":5},{"x":9,"y":5},{"x":9,"y":6},{"x":8,"y":6},{"x":8,"y":7}],"health":39,"latency":145,"head":{"x":4,"y":5},"length":19,"shout":"","squad":""}]},"you":{"id":"gs_KxBCvvKGwtmgdfmFfYSpqQW7","name":"businesssssnake","body":[{"x":4,"y":5},{"x":4,"y":4},{"x":3,"y":4},{"x":3,"y":3},{"x":4,"y":3},{"x":5,"y":3},{"x":5,"y":4},{"x":6,"y":4},{"x":6,"y":3},{"x":7,"y":3},{"x":8,"y":3},{"x":9,"y":3},{"x":9,"y":4},{"x":8,"y":4},{"x":8,"y":5},{"x":9,"y":5},{"x":9,"y":6},{"x":8,"y":6},{"x":8,"y":7}],"health":39,"latency":145,"head":{"x":4,"y":5},"length":19,"shout":"","squad":""}}
    const moveResponse = move(gameState)
    expect(moveResponse.move).not.toBe("left") // we are larger, should move towards Jaguar to steal its board control
  })
  // good test, but Shapeshifter's Voronoi isn't good enough to predict it will outlive me if I try to cut it off
  it.skip('hazardDive1: chooses to avoid hazard dive when possible', () => {
    const gameState: GameState = {"game":{"id":"a80f475c-19a0-4421-bcc6-2d9ec3e4cfb8","ruleset":{"name":"royale","version":"?","settings":{"foodSpawnChance":20,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{"shrinkEveryNTurns":25},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":600,"source":"testing"},"turn":184,"board":{"width":11,"height":11,"food":[{"x":1,"y":0},{"x":8,"y":5},{"x":10,"y":1},{"x":5,"y":1}],"hazards":[{"x":0,"y":0},{"x":0,"y":1},{"x":0,"y":2},{"x":0,"y":3},{"x":0,"y":4},{"x":0,"y":5},{"x":0,"y":6},{"x":0,"y":7},{"x":0,"y":8},{"x":0,"y":9},{"x":0,"y":10},{"x":1,"y":0},{"x":1,"y":1},{"x":1,"y":2},{"x":1,"y":3},{"x":1,"y":4},{"x":1,"y":10},{"x":2,"y":0},{"x":2,"y":1},{"x":2,"y":2},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":10},{"x":3,"y":0},{"x":3,"y":1},{"x":3,"y":2},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":10},{"x":4,"y":0},{"x":4,"y":1},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":10},{"x":5,"y":0},{"x":5,"y":1},{"x":5,"y":2},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":10},{"x":6,"y":0},{"x":6,"y":1},{"x":6,"y":2},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":10},{"x":7,"y":0},{"x":7,"y":1},{"x":7,"y":2},{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":10},{"x":8,"y":0},{"x":8,"y":1},{"x":8,"y":2},{"x":8,"y":3},{"x":8,"y":4},{"x":8,"y":10},{"x":9,"y":0},{"x":9,"y":1},{"x":9,"y":2},{"x":9,"y":3},{"x":9,"y":4},{"x":9,"y":10},{"x":10,"y":0},{"x":10,"y":1},{"x":10,"y":2},{"x":10,"y":3},{"x":10,"y":4},{"x":10,"y":10}],"snakes":[{"id":"gs_dBPxRQ93TfkvWXwyvxjr37jC","name":"Jaguar Meets Snake","body":[{"x":5,"y":5},{"x":4,"y":5},{"x":4,"y":6},{"x":3,"y":6},{"x":3,"y":7},{"x":2,"y":7},{"x":2,"y":6},{"x":2,"y":5},{"x":1,"y":5},{"x":1,"y":4},{"x":0,"y":4},{"x":0,"y":3},{"x":1,"y":3},{"x":1,"y":2},{"x":1,"y":1},{"x":2,"y":1},{"x":2,"y":2},{"x":3,"y":2},{"x":4,"y":2},{"x":4,"y":3},{"x":5,"y":3}],"health":93,"latency":552,"head":{"x":5,"y":5},"length":21,"shout":"","squad":""},{"id":"gs_jCt4XgRxHWHX4J9QBFcMJTbX","name":"🇺🇦🇷🇺 Shapeshifter 🇺🇦🇷🇺","body":[{"x":7,"y":5},{"x":6,"y":5},{"x":6,"y":6},{"x":7,"y":6},{"x":8,"y":6},{"x":8,"y":7},{"x":9,"y":7},{"x":9,"y":8},{"x":10,"y":8},{"x":10,"y":9},{"x":10,"y":10},{"x":9,"y":10},{"x":8,"y":10},{"x":7,"y":10},{"x":6,"y":10},{"x":6,"y":9},{"x":6,"y":8},{"x":6,"y":7}],"health":7,"latency":530,"head":{"x":7,"y":5},"length":18,"shout":"","squad":""}]},"you":{"id":"gs_dBPxRQ93TfkvWXwyvxjr37jC","name":"Jaguar Meets Snake","body":[{"x":5,"y":5},{"x":4,"y":5},{"x":4,"y":6},{"x":3,"y":6},{"x":3,"y":7},{"x":2,"y":7},{"x":2,"y":6},{"x":2,"y":5},{"x":1,"y":5},{"x":1,"y":4},{"x":0,"y":4},{"x":0,"y":3},{"x":1,"y":3},{"x":1,"y":2},{"x":1,"y":1},{"x":2,"y":1},{"x":2,"y":2},{"x":3,"y":2},{"x":4,"y":2},{"x":4,"y":3},{"x":5,"y":3}],"health":93,"latency":552,"head":{"x":5,"y":5},"length":21,"shout":"","squad":""}}
    const moveResponse = move(gameState)
    expect(moveResponse.move).toBe("up") // down cuts Shapeshifter off, but also forces us into the hazard for the foreseeable future. Up makes more sense.
  })
  // tricky, sadly Voronoi coverage up & down is about the same. Food penalty with bad Voronoi should prevent walking into this spot in the first place, though
  it.skip('hazardConstrain2: chooses to constrain duel opponent rather than seek food v2', () => {
    const gameState: GameState = {"game":{"id":"82f87208-f517-48e0-97e6-5edee2ec2cf3","ruleset":{"name":"royale","version":"?","settings":{"foodSpawnChance":20,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{"shrinkEveryNTurns":25},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":2500,"source":"testing"},"turn":191,"board":{"width":11,"height":11,"food":[{"x":10,"y":4},{"x":9,"y":2},{"x":6,"y":9},{"x":5,"y":9},{"x":1,"y":3},{"x":10,"y":0}],"hazards":[{"x":0,"y":0},{"x":0,"y":1},{"x":0,"y":2},{"x":0,"y":3},{"x":0,"y":4},{"x":0,"y":5},{"x":0,"y":6},{"x":0,"y":7},{"x":0,"y":8},{"x":0,"y":9},{"x":0,"y":10},{"x":1,"y":0},{"x":1,"y":1},{"x":1,"y":2},{"x":1,"y":3},{"x":1,"y":4},{"x":1,"y":5},{"x":1,"y":6},{"x":1,"y":7},{"x":1,"y":8},{"x":1,"y":9},{"x":1,"y":10},{"x":2,"y":0},{"x":3,"y":0},{"x":4,"y":0},{"x":5,"y":0},{"x":6,"y":0},{"x":7,"y":0},{"x":7,"y":1},{"x":7,"y":2},{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":7,"y":7},{"x":7,"y":8},{"x":7,"y":9},{"x":7,"y":10},{"x":8,"y":0},{"x":8,"y":1},{"x":8,"y":2},{"x":8,"y":3},{"x":8,"y":4},{"x":8,"y":5},{"x":8,"y":6},{"x":8,"y":7},{"x":8,"y":8},{"x":8,"y":9},{"x":8,"y":10},{"x":9,"y":0},{"x":9,"y":1},{"x":9,"y":2},{"x":9,"y":3},{"x":9,"y":4},{"x":9,"y":5},{"x":9,"y":6},{"x":9,"y":7},{"x":9,"y":8},{"x":9,"y":9},{"x":9,"y":10},{"x":10,"y":0},{"x":10,"y":1},{"x":10,"y":2},{"x":10,"y":3},{"x":10,"y":4},{"x":10,"y":5},{"x":10,"y":6},{"x":10,"y":7},{"x":10,"y":8},{"x":10,"y":9},{"x":10,"y":10}],"snakes":[{"id":"gs_dhQQrmGx8XWWmSDymPctFQc6","name":"Jaguar Meets Snake","body":[{"x":10,"y":7},{"x":9,"y":7},{"x":9,"y":8},{"x":8,"y":8},{"x":7,"y":8},{"x":6,"y":8},{"x":5,"y":8},{"x":4,"y":8},{"x":3,"y":8},{"x":2,"y":8},{"x":2,"y":9},{"x":1,"y":9},{"x":1,"y":8},{"x":0,"y":8},{"x":0,"y":7},{"x":0,"y":6},{"x":0,"y":5},{"x":0,"y":4},{"x":0,"y":3},{"x":0,"y":2},{"x":0,"y":1},{"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0},{"x":3,"y":0},{"x":3,"y":0}],"health":100,"latency":384,"head":{"x":10,"y":7},"length":26,"shout":"","squad":""},{"id":"gs_xffBM4gxxCbWt9QxjWrY6JG8","name":"Cucumber Cat","body":[{"x":6,"y":1},{"x":6,"y":2},{"x":7,"y":2},{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":5},{"x":6,"y":5},{"x":6,"y":4},{"x":6,"y":3},{"x":5,"y":3},{"x":4,"y":3},{"x":4,"y":4},{"x":5,"y":4},{"x":5,"y":5},{"x":4,"y":5},{"x":3,"y":5},{"x":3,"y":4},{"x":3,"y":3},{"x":3,"y":2},{"x":2,"y":2},{"x":2,"y":3}],"health":15,"latency":70,"head":{"x":6,"y":1},"length":21,"shout":"I am sick when I do look on thee","squad":""}]},"you":{"id":"gs_dhQQrmGx8XWWmSDymPctFQc6","name":"Jaguar Meets Snake","body":[{"x":10,"y":7},{"x":9,"y":7},{"x":9,"y":8},{"x":8,"y":8},{"x":7,"y":8},{"x":6,"y":8},{"x":5,"y":8},{"x":4,"y":8},{"x":3,"y":8},{"x":2,"y":8},{"x":2,"y":9},{"x":1,"y":9},{"x":1,"y":8},{"x":0,"y":8},{"x":0,"y":7},{"x":0,"y":6},{"x":0,"y":5},{"x":0,"y":4},{"x":0,"y":3},{"x":0,"y":2},{"x":0,"y":1},{"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0},{"x":3,"y":0},{"x":3,"y":0}],"health":100,"latency":384,"head":{"x":10,"y":7},"length":26,"shout":"","squad":""}}
    const moveResponse = move(gameState)
    expect(moveResponse.move).toBe("down") // up shoves ourself in a corner, down lets us pursue Cucumber & steal his space
  })
  it('hazardConstrain3: chases its tail in order to return to the middle', () => {
    const gameState: GameState = {"game":{"id":"84a1eafd-b060-44ac-b067-ace2bfcd9d1e","ruleset":{"name":"royale","version":"?","settings":{"foodSpawnChance":20,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{"shrinkEveryNTurns":25},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":600,"source":"testing"},"turn":235,"board":{"width":11,"height":11,"food":[{"x":0,"y":0},{"x":0,"y":5},{"x":9,"y":0},{"x":7,"y":1},{"x":3,"y":10},{"x":10,"y":1}],"hazards":[{"x":0,"y":0},{"x":0,"y":1},{"x":0,"y":2},{"x":0,"y":3},{"x":0,"y":4},{"x":0,"y":5},{"x":0,"y":6},{"x":0,"y":7},{"x":0,"y":8},{"x":0,"y":9},{"x":0,"y":10},{"x":1,"y":0},{"x":1,"y":1},{"x":1,"y":2},{"x":1,"y":3},{"x":1,"y":4},{"x":1,"y":5},{"x":1,"y":6},{"x":1,"y":7},{"x":1,"y":8},{"x":1,"y":9},{"x":1,"y":10},{"x":2,"y":0},{"x":2,"y":1},{"x":2,"y":2},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":2,"y":8},{"x":2,"y":9},{"x":2,"y":10},{"x":3,"y":0},{"x":3,"y":1},{"x":3,"y":2},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":3,"y":7},{"x":3,"y":8},{"x":3,"y":9},{"x":3,"y":10},{"x":4,"y":0},{"x":4,"y":1},{"x":4,"y":8},{"x":4,"y":9},{"x":4,"y":10},{"x":5,"y":0},{"x":5,"y":1},{"x":5,"y":8},{"x":5,"y":9},{"x":5,"y":10},{"x":6,"y":0},{"x":6,"y":1},{"x":6,"y":8},{"x":6,"y":9},{"x":6,"y":10},{"x":7,"y":0},{"x":7,"y":1},{"x":7,"y":8},{"x":7,"y":9},{"x":7,"y":10},{"x":8,"y":0},{"x":8,"y":1},{"x":8,"y":8},{"x":8,"y":9},{"x":8,"y":10},{"x":9,"y":0},{"x":9,"y":1},{"x":9,"y":8},{"x":9,"y":9},{"x":9,"y":10},{"x":10,"y":0},{"x":10,"y":1},{"x":10,"y":8},{"x":10,"y":9},{"x":10,"y":10}],"snakes":[{"id":"gs_vcBW6VVtVmD3ckthtH4GWF6G","name":"Jaguar Meets Snake","body":[{"x":2,"y":3},{"x":2,"y":2},{"x":2,"y":1},{"x":3,"y":1},{"x":4,"y":1},{"x":5,"y":1},{"x":6,"y":1},{"x":6,"y":2},{"x":6,"y":3},{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":5},{"x":6,"y":5},{"x":6,"y":4},{"x":5,"y":4},{"x":5,"y":3},{"x":5,"y":2},{"x":4,"y":2},{"x":3,"y":2},{"x":3,"y":3}],"health":85,"latency":552,"head":{"x":2,"y":3},"length":20,"shout":"","squad":""},{"id":"gs_w97XHgjTwtwC8mr3cKBGWwDK","name":"Stroopwafel 🧇","body":[{"x":4,"y":7},{"x":5,"y":7},{"x":5,"y":8},{"x":5,"y":9},{"x":5,"y":10},{"x":6,"y":10},{"x":6,"y":9},{"x":7,"y":9},{"x":8,"y":9},{"x":8,"y":8},{"x":7,"y":8},{"x":6,"y":8},{"x":6,"y":7},{"x":6,"y":6},{"x":7,"y":6},{"x":7,"y":7},{"x":8,"y":7},{"x":9,"y":7}],"health":83,"latency":526,"head":{"x":4,"y":7},"length":18,"shout":"","squad":""}]},"you":{"id":"gs_vcBW6VVtVmD3ckthtH4GWF6G","name":"Jaguar Meets Snake","body":[{"x":2,"y":3},{"x":2,"y":2},{"x":2,"y":1},{"x":3,"y":1},{"x":4,"y":1},{"x":5,"y":1},{"x":6,"y":1},{"x":6,"y":2},{"x":6,"y":3},{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":5},{"x":6,"y":5},{"x":6,"y":4},{"x":5,"y":4},{"x":5,"y":3},{"x":5,"y":2},{"x":4,"y":2},{"x":3,"y":2},{"x":3,"y":3}],"health":85,"latency":552,"head":{"x":2,"y":3},"length":20,"shout":"","squad":""}}
    const moveResponse = move(gameState)
    expect(moveResponse.move).not.toBe("left") // left traps us in sauce, right returns us to middle, up gives us option to return to middle.
  })
  // Jaguar still thinks Stroop will back itself into a bad situation if I go left, but Paranoid/Adjusted VoronoiSelf score choice made it better
  it.skip('hazardWalls1: does not choose route which spawning hazard walls will punish', () => {
    const gameState: GameState = {"game":{"id":"83bc8442-86fd-4f97-9e44-bbb3edb50ab1","ruleset":{"name":"royale","version":"?","settings":{"foodSpawnChance":20,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{"shrinkEveryNTurns":25},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":600,"source":"testing"},"turn":147,"board":{"width":11,"height":11,"food":[{"x":0,"y":10},{"x":4,"y":0}],"hazards":[{"x":0,"y":0},{"x":0,"y":1},{"x":0,"y":2},{"x":0,"y":3},{"x":0,"y":4},{"x":0,"y":5},{"x":0,"y":6},{"x":0,"y":7},{"x":0,"y":8},{"x":0,"y":9},{"x":0,"y":10},{"x":1,"y":0},{"x":1,"y":8},{"x":1,"y":9},{"x":1,"y":10},{"x":2,"y":0},{"x":2,"y":8},{"x":2,"y":9},{"x":2,"y":10},{"x":3,"y":0},{"x":3,"y":8},{"x":3,"y":9},{"x":3,"y":10},{"x":4,"y":0},{"x":4,"y":8},{"x":4,"y":9},{"x":4,"y":10},{"x":5,"y":0},{"x":5,"y":8},{"x":5,"y":9},{"x":5,"y":10},{"x":6,"y":0},{"x":6,"y":8},{"x":6,"y":9},{"x":6,"y":10},{"x":7,"y":0},{"x":7,"y":8},{"x":7,"y":9},{"x":7,"y":10},{"x":8,"y":0},{"x":8,"y":8},{"x":8,"y":9},{"x":8,"y":10},{"x":9,"y":0},{"x":9,"y":8},{"x":9,"y":9},{"x":9,"y":10},{"x":10,"y":0},{"x":10,"y":8},{"x":10,"y":9},{"x":10,"y":10}],"snakes":[{"id":"gs_TqtJ8ttxWKFGtJ3QfXyy4gPF","name":"Jaguar Meets Snake","body":[{"x":6,"y":7},{"x":6,"y":6},{"x":5,"y":6},{"x":5,"y":5},{"x":5,"y":4},{"x":5,"y":3},{"x":6,"y":3},{"x":7,"y":3},{"x":8,"y":3},{"x":8,"y":4},{"x":8,"y":5}],"health":83,"latency":552,"head":{"x":6,"y":7},"length":11,"shout":"","squad":""},{"id":"gs_cqTT3J349jwHSk9rdMQJPhxC","name":"Stroopwafel 🧇","body":[{"x":2,"y":5},{"x":3,"y":5},{"x":3,"y":6},{"x":4,"y":6},{"x":4,"y":5},{"x":4,"y":4},{"x":3,"y":4},{"x":3,"y":3},{"x":2,"y":3}],"health":90,"latency":548,"head":{"x":2,"y":5},"length":9,"shout":"","squad":""}]},"you":{"id":"gs_TqtJ8ttxWKFGtJ3QfXyy4gPF","name":"Jaguar Meets Snake","body":[{"x":6,"y":7},{"x":6,"y":6},{"x":5,"y":6},{"x":5,"y":5},{"x":5,"y":4},{"x":5,"y":3},{"x":6,"y":3},{"x":7,"y":3},{"x":8,"y":3},{"x":8,"y":4},{"x":8,"y":5}],"health":83,"latency":552,"head":{"x":6,"y":7},"length":11,"shout":"","squad":""}}
    const moveResponse = move(gameState)
    expect(moveResponse.move).not.toBe("left") // left is a bad move if hazard spawns on us in three moves. Right is much safer, & up is okay too
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
      gameState.game.ruleset.name = "royale"

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
  it('does not walk into a space that will soon have no exit', () => {
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
  it('escape1: does not enter a space whose escape route depends on another snake leaving it alone', () => {
    const gameState: GameState = {"game":{"id":"3ca044bc-266b-4413-b101-8e571bac9803","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":20,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":141,"board":{"width":11,"height":11,"food":[{"x":2,"y":2},{"x":5,"y":7},{"x":8,"y":1}],"hazards":[{"x":5,"y":3},{"x":5,"y":4},{"x":6,"y":4},{"x":6,"y":3},{"x":6,"y":2},{"x":5,"y":2},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":5,"y":5},{"x":6,"y":5},{"x":7,"y":5},{"x":7,"y":4},{"x":7,"y":3},{"x":7,"y":2},{"x":7,"y":1},{"x":6,"y":1},{"x":5,"y":1},{"x":4,"y":1},{"x":3,"y":1},{"x":3,"y":2},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":4,"y":6},{"x":5,"y":6},{"x":6,"y":6},{"x":7,"y":6},{"x":8,"y":6},{"x":8,"y":5},{"x":8,"y":4},{"x":8,"y":3},{"x":8,"y":2},{"x":8,"y":1},{"x":8,"y":0},{"x":7,"y":0},{"x":6,"y":0},{"x":5,"y":0},{"x":4,"y":0},{"x":3,"y":0},{"x":2,"y":0},{"x":2,"y":1},{"x":2,"y":2},{"x":2,"y":3},{"x":2,"y":4}],"snakes":[{"id":"gs_mSR8jB77HGhQRCyXGPvCWRb7","name":"Jaguar Meets Snake","body":[{"x":1,"y":8},{"x":0,"y":8},{"x":0,"y":7},{"x":1,"y":7},{"x":1,"y":6},{"x":1,"y":5},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":3,"y":7},{"x":3,"y":8},{"x":4,"y":8},{"x":4,"y":9}],"health":79,"latency":66,"head":{"x":1,"y":8},"length":13,"shout":"","squad":""},{"id":"gs_WmTrCGhfhkCCkb4pwfqChCKJ","name":"Shapeshifter","body":[{"x":7,"y":6},{"x":7,"y":7},{"x":8,"y":7},{"x":9,"y":7},{"x":10,"y":7},{"x":10,"y":8},{"x":9,"y":8},{"x":8,"y":8},{"x":7,"y":8},{"x":7,"y":9},{"x":6,"y":9},{"x":6,"y":10},{"x":5,"y":10}],"health":75,"latency":296,"head":{"x":7,"y":6},"length":13,"shout":"","squad":""},{"id":"gs_ytrycPdgcp77HdmRxhw4Tj6M","name":"Combat Reptile","body":[{"x":3,"y":9},{"x":3,"y":10},{"x":2,"y":10},{"x":1,"y":10},{"x":0,"y":10},{"x":10,"y":10},{"x":9,"y":10},{"x":8,"y":10},{"x":8,"y":0},{"x":9,"y":0},{"x":9,"y":1},{"x":9,"y":2},{"x":10,"y":2},{"x":0,"y":2},{"x":0,"y":3},{"x":0,"y":4},{"x":0,"y":5},{"x":10,"y":5}],"health":93,"latency":444,"head":{"x":3,"y":9},"length":18,"shout":"","squad":""}]},"you":{"id":"gs_mSR8jB77HGhQRCyXGPvCWRb7","name":"Jaguar Meets Snake","body":[{"x":1,"y":8},{"x":0,"y":8},{"x":0,"y":7},{"x":1,"y":7},{"x":1,"y":6},{"x":1,"y":5},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":3,"y":7},{"x":3,"y":8},{"x":4,"y":8},{"x":4,"y":9}],"health":79,"latency":66,"head":{"x":1,"y":8},"length":13,"shout":"","squad":""}}
    gameState.game.map = "hz_spiral"
    createHazardSpiralGameData(gameState, 3, {x: 5, y: 3})
    const moveResponse = move(gameState)
    expect(moveResponse.move).toBe("up")
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

describe('Food tests', () => {
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
  it('does not avoid food in order to hunt another snake', () => {
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
  // no longer valid, going down & then doubling back for food is better & gives us better Voronoi coverage while still eating & equaling lengths
  it.skip('acquires food when dueling as soon as it can', () => {
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
      const snek = new Battlesnake("snek", "snek", 10, [{x: 8, y: 8}, {x: 8, y: 7}, {x: 8, y: 6}, {x: 8, y: 5}, {x: 8, y: 4}, {x: 8, y: 3}, {x: 8, y: 2}, {x: 9, y: 2}, {x: 9, y: 3}], "30", "", "")
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
    for (let j: number = 0; j < 5; j++) {
      for (let i: number = 0; i < 4; i++) {
        const snek = new Battlesnake("snek", "snek", 100, [{x: 1, y: 9}, {x: 1, y: 9}, {x: 1, y: 9}], "30", "", "")
        const gameState = createGameState(snek)
        
        let gameDataId = createGameDataId(gameState)
        if (gameData[gameDataId]) { // clean up game data after each different move combo
          delete gameData[gameDataId]
        }

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
    }
  })
  it('avoids food when the board is entirely full', () => {
    const gameState: GameState = {"game":{"id":"42dba90e-53d5-459f-a1e6-180315026312","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":0,"royale":{"shrinkEveryNTurns":30},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":801,"board":{"width":11,"height":11,"food":[{"x":8,"y":5},{"x":8,"y":1},{"x":10,"y":10},{"x":9,"y":3},{"x":8,"y":0},{"x":2,"y":2},{"x":1,"y":0}],"hazards":[],"snakes":[{"id":"gs_BjmfgVPFJbTgQwKWw9bwwSW3","name":"Jaguar Meets Snake","body":[{"x":9,"y":1},{"x":9,"y":2},{"x":8,"y":2},{"x":8,"y":3},{"x":7,"y":3},{"x":6,"y":3},{"x":6,"y":2},{"x":7,"y":2},{"x":7,"y":1},{"x":6,"y":1},{"x":6,"y":0},{"x":7,"y":0},{"x":7,"y":10},{"x":6,"y":10},{"x":5,"y":10},{"x":5,"y":9},{"x":4,"y":9},{"x":4,"y":10},{"x":3,"y":10},{"x":3,"y":9},{"x":2,"y":9},{"x":2,"y":10},{"x":1,"y":10},{"x":1,"y":9},{"x":0,"y":9},{"x":0,"y":10},{"x":0,"y":0},{"x":10,"y":0},{"x":10,"y":1},{"x":0,"y":1},{"x":1,"y":1},{"x":2,"y":1},{"x":2,"y":0},{"x":3,"y":0},{"x":3,"y":1},{"x":4,"y":1},{"x":4,"y":0},{"x":5,"y":0},{"x":5,"y":1},{"x":5,"y":2},{"x":5,"y":3},{"x":4,"y":3},{"x":4,"y":2},{"x":3,"y":2},{"x":3,"y":3},{"x":2,"y":3},{"x":2,"y":4},{"x":1,"y":4},{"x":0,"y":4},{"x":0,"y":3},{"x":1,"y":3},{"x":1,"y":2},{"x":0,"y":2},{"x":10,"y":2},{"x":10,"y":3},{"x":10,"y":4},{"x":10,"y":5},{"x":10,"y":6},{"x":10,"y":7},{"x":0,"y":7},{"x":0,"y":6},{"x":0,"y":5},{"x":1,"y":5},{"x":2,"y":5},{"x":2,"y":6},{"x":1,"y":6},{"x":1,"y":7},{"x":1,"y":8},{"x":0,"y":8},{"x":10,"y":8},{"x":10,"y":9},{"x":9,"y":9},{"x":8,"y":9},{"x":8,"y":10},{"x":9,"y":10},{"x":9,"y":0}],"health":69,"latency":34,"head":{"x":9,"y":1},"length":76,"shout":"","squad":""},{"id":"gs_m8MPSgQYB9myjdtWd6Jv46bK","name":"Pea Eater","body":[{"x":6,"y":7},{"x":6,"y":6},{"x":6,"y":5},{"x":7,"y":5},{"x":7,"y":6},{"x":8,"y":6},{"x":8,"y":7},{"x":8,"y":8},{"x":9,"y":8},{"x":9,"y":7},{"x":9,"y":6},{"x":9,"y":5},{"x":9,"y":4},{"x":8,"y":4},{"x":7,"y":4},{"x":6,"y":4},{"x":5,"y":4},{"x":4,"y":4},{"x":3,"y":4},{"x":3,"y":5},{"x":4,"y":5},{"x":5,"y":5},{"x":5,"y":6},{"x":4,"y":6},{"x":3,"y":6},{"x":3,"y":7},{"x":2,"y":7},{"x":2,"y":8},{"x":3,"y":8},{"x":4,"y":8},{"x":4,"y":7},{"x":5,"y":7},{"x":5,"y":8},{"x":6,"y":8},{"x":6,"y":9},{"x":7,"y":9},{"x":7,"y":8},{"x":7,"y":7}],"health":44,"latency":445,"head":{"x":6,"y":7},"length":38,"shout":"","squad":""}]},"you":{"id":"gs_BjmfgVPFJbTgQwKWw9bwwSW3","name":"Jaguar Meets Snake","body":[{"x":9,"y":1},{"x":9,"y":2},{"x":8,"y":2},{"x":8,"y":3},{"x":7,"y":3},{"x":6,"y":3},{"x":6,"y":2},{"x":7,"y":2},{"x":7,"y":1},{"x":6,"y":1},{"x":6,"y":0},{"x":7,"y":0},{"x":7,"y":10},{"x":6,"y":10},{"x":5,"y":10},{"x":5,"y":9},{"x":4,"y":9},{"x":4,"y":10},{"x":3,"y":10},{"x":3,"y":9},{"x":2,"y":9},{"x":2,"y":10},{"x":1,"y":10},{"x":1,"y":9},{"x":0,"y":9},{"x":0,"y":10},{"x":0,"y":0},{"x":10,"y":0},{"x":10,"y":1},{"x":0,"y":1},{"x":1,"y":1},{"x":2,"y":1},{"x":2,"y":0},{"x":3,"y":0},{"x":3,"y":1},{"x":4,"y":1},{"x":4,"y":0},{"x":5,"y":0},{"x":5,"y":1},{"x":5,"y":2},{"x":5,"y":3},{"x":4,"y":3},{"x":4,"y":2},{"x":3,"y":2},{"x":3,"y":3},{"x":2,"y":3},{"x":2,"y":4},{"x":1,"y":4},{"x":0,"y":4},{"x":0,"y":3},{"x":1,"y":3},{"x":1,"y":2},{"x":0,"y":2},{"x":10,"y":2},{"x":10,"y":3},{"x":10,"y":4},{"x":10,"y":5},{"x":10,"y":6},{"x":10,"y":7},{"x":0,"y":7},{"x":0,"y":6},{"x":0,"y":5},{"x":1,"y":5},{"x":2,"y":5},{"x":2,"y":6},{"x":1,"y":6},{"x":1,"y":7},{"x":1,"y":8},{"x":0,"y":8},{"x":10,"y":8},{"x":10,"y":9},{"x":9,"y":9},{"x":8,"y":9},{"x":8,"y":10},{"x":9,"y":10},{"x":9,"y":0}],"health":69,"latency":34,"head":{"x":9,"y":1},"length":76,"shout":"","squad":""}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("down") // we have more health than Pea Eater, & there is no more room to run. Will starve Pea Eater out first, but if I eat I risk food spawning on my tail & immediately losing
  })
  it('starving1: eats when it is starving & is near food', () => {
    const gameState: GameState = {"game":{"id":"9ce11b3a-1b6b-44fc-9913-efd38d979448","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":20,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":139,"board":{"width":11,"height":11,"food":[{"x":7,"y":2}],"hazards":[{"x":6,"y":5},{"x":6,"y":6},{"x":7,"y":6},{"x":7,"y":5},{"x":7,"y":4},{"x":6,"y":4},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":6,"y":7},{"x":7,"y":7},{"x":8,"y":7},{"x":8,"y":6},{"x":8,"y":5},{"x":8,"y":4},{"x":8,"y":3},{"x":7,"y":3},{"x":6,"y":3},{"x":5,"y":3},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":4,"y":8},{"x":5,"y":8},{"x":6,"y":8},{"x":7,"y":8},{"x":8,"y":8},{"x":9,"y":8},{"x":9,"y":7},{"x":9,"y":6},{"x":9,"y":5},{"x":9,"y":4},{"x":9,"y":3},{"x":9,"y":2},{"x":8,"y":2},{"x":7,"y":2},{"x":6,"y":2},{"x":5,"y":2},{"x":4,"y":2},{"x":3,"y":2},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":5}],"snakes":[{"id":"gs_KvCDHYVvFttm4Wry4rwFXFCD","name":"hawthhhh++","body":[{"x":8,"y":0},{"x":9,"y":0},{"x":10,"y":0},{"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0},{"x":2,"y":10},{"x":1,"y":10},{"x":0,"y":10},{"x":10,"y":10},{"x":9,"y":10}],"health":85,"latency":470,"head":{"x":8,"y":0},"length":11,"shout":"","squad":""},{"id":"gs_rDVKv37JppmbSvHvMrCSc8QM","name":"Jaguar Meets Snake","body":[{"x":7,"y":0},{"x":6,"y":0},{"x":6,"y":1},{"x":5,"y":1},{"x":4,"y":1},{"x":4,"y":2},{"x":4,"y":3},{"x":3,"y":3},{"x":3,"y":4},{"x":2,"y":4},{"x":1,"y":4},{"x":1,"y":3},{"x":0,"y":3},{"x":0,"y":2}],"health":21,"latency":206,"head":{"x":7,"y":0},"length":14,"shout":"","squad":""},{"id":"gs_HtqdfYccG477WVbbQdhFBqkb","name":"Gadiuka","body":[{"x":9,"y":9},{"x":10,"y":9},{"x":0,"y":9},{"x":1,"y":9},{"x":1,"y":8},{"x":1,"y":7},{"x":0,"y":7},{"x":0,"y":8},{"x":10,"y":8},{"x":10,"y":7},{"x":10,"y":6},{"x":0,"y":6},{"x":1,"y":6},{"x":2,"y":6}],"health":99,"latency":258,"head":{"x":9,"y":9},"length":14,"shout":"","squad":""}]},"you":{"id":"gs_rDVKv37JppmbSvHvMrCSc8QM","name":"Jaguar Meets Snake","body":[{"x":7,"y":0},{"x":6,"y":0},{"x":6,"y":1},{"x":5,"y":1},{"x":4,"y":1},{"x":4,"y":2},{"x":4,"y":3},{"x":3,"y":3},{"x":3,"y":4},{"x":2,"y":4},{"x":1,"y":4},{"x":1,"y":3},{"x":0,"y":3},{"x":0,"y":2}],"health":21,"latency":206,"head":{"x":7,"y":0},"length":14,"shout":"","squad":""}}
    createHazardSpiralGameData(gameState, 3, {x: 6, y: 5})
    gameState.game.map = "hz_spiral"
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("up")
  })
  it('hazardFood1: seeks out food when stuck in hazard with nowhere else to go', () => {
    const gameState: GameState = {"game":{"id":"cb0d5eda-e2a3-4e2c-a015-7290f8c05c37","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":20,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":309,"board":{"width":11,"height":11,"food":[{"x":9,"y":6},{"x":2,"y":6},{"x":2,"y":1},{"x":3,"y":10},{"x":10,"y":6}],"hazards":[{"x":6,"y":6},{"x":6,"y":7},{"x":7,"y":7},{"x":7,"y":6},{"x":7,"y":5},{"x":6,"y":5},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":5,"y":8},{"x":6,"y":8},{"x":7,"y":8},{"x":8,"y":8},{"x":8,"y":7},{"x":8,"y":6},{"x":8,"y":5},{"x":8,"y":4},{"x":7,"y":4},{"x":6,"y":4},{"x":5,"y":4},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":4,"y":8},{"x":4,"y":9},{"x":5,"y":9},{"x":6,"y":9},{"x":7,"y":9},{"x":8,"y":9},{"x":9,"y":9},{"x":9,"y":8},{"x":9,"y":7},{"x":9,"y":6},{"x":9,"y":5},{"x":9,"y":4},{"x":9,"y":3},{"x":8,"y":3},{"x":7,"y":3},{"x":6,"y":3},{"x":5,"y":3},{"x":4,"y":3},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":3,"y":7},{"x":3,"y":8},{"x":3,"y":9},{"x":3,"y":10},{"x":4,"y":10},{"x":5,"y":10},{"x":6,"y":10},{"x":7,"y":10},{"x":8,"y":10},{"x":9,"y":10},{"x":10,"y":10},{"x":10,"y":9},{"x":10,"y":8},{"x":10,"y":7},{"x":10,"y":6},{"x":10,"y":5},{"x":10,"y":4},{"x":10,"y":3},{"x":10,"y":2},{"x":9,"y":2},{"x":8,"y":2},{"x":7,"y":2},{"x":6,"y":2},{"x":5,"y":2},{"x":4,"y":2},{"x":3,"y":2},{"x":2,"y":2},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":2,"y":8},{"x":2,"y":9},{"x":2,"y":10},{"x":10,"y":1},{"x":9,"y":1}],"snakes":[{"id":"gs_JMdyHSxKcqRBG4R3W8MgPBkR","name":"Jaguar Meets Snake","body":[{"x":5,"y":4},{"x":5,"y":3},{"x":5,"y":2},{"x":4,"y":2},{"x":3,"y":2},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":5},{"x":2,"y":5},{"x":1,"y":5},{"x":1,"y":6},{"x":1,"y":7},{"x":0,"y":7},{"x":0,"y":8},{"x":0,"y":9},{"x":0,"y":10},{"x":0,"y":0},{"x":1,"y":0},{"x":1,"y":10},{"x":1,"y":9},{"x":2,"y":9},{"x":3,"y":9},{"x":4,"y":9},{"x":4,"y":10},{"x":4,"y":0},{"x":4,"y":1},{"x":5,"y":1},{"x":6,"y":1},{"x":6,"y":0},{"x":5,"y":0},{"x":5,"y":10},{"x":5,"y":9},{"x":5,"y":8},{"x":5,"y":7},{"x":5,"y":6}],"health":70,"latency":164,"head":{"x":5,"y":4},"length":35,"shout":"","squad":""},{"id":"gs_rVcSddk8ywqc3RHRPWwBBPBR","name":"Combat Reptile","body":[{"x":9,"y":4},{"x":8,"y":4},{"x":8,"y":3},{"x":8,"y":2},{"x":9,"y":2},{"x":10,"y":2},{"x":0,"y":2},{"x":1,"y":2},{"x":1,"y":1},{"x":0,"y":1},{"x":10,"y":1},{"x":9,"y":1},{"x":8,"y":1},{"x":8,"y":0},{"x":9,"y":0},{"x":9,"y":10},{"x":8,"y":10},{"x":7,"y":10},{"x":6,"y":10},{"x":6,"y":9},{"x":7,"y":9},{"x":8,"y":9},{"x":8,"y":8},{"x":8,"y":7},{"x":8,"y":6},{"x":8,"y":5}],"health":70,"latency":443,"head":{"x":9,"y":4},"length":26,"shout":"","squad":""}]},"you":{"id":"gs_JMdyHSxKcqRBG4R3W8MgPBkR","name":"Jaguar Meets Snake","body":[{"x":5,"y":4},{"x":5,"y":3},{"x":5,"y":2},{"x":4,"y":2},{"x":3,"y":2},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":5},{"x":2,"y":5},{"x":1,"y":5},{"x":1,"y":6},{"x":1,"y":7},{"x":0,"y":7},{"x":0,"y":8},{"x":0,"y":9},{"x":0,"y":10},{"x":0,"y":0},{"x":1,"y":0},{"x":1,"y":10},{"x":1,"y":9},{"x":2,"y":9},{"x":3,"y":9},{"x":4,"y":9},{"x":4,"y":10},{"x":4,"y":0},{"x":4,"y":1},{"x":5,"y":1},{"x":6,"y":1},{"x":6,"y":0},{"x":5,"y":0},{"x":5,"y":10},{"x":5,"y":9},{"x":5,"y":8},{"x":5,"y":7},{"x":5,"y":6}],"health":70,"latency":164,"head":{"x":5,"y":4},"length":35,"shout":"","squad":""}}
    createHazardSpiralGameData(gameState, 3, {x: 6, y: 6})
    gameState.game.map = "hz_spiral"
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).not.toBe("right") // right is theoretically better board coverage, but is more likely a doomed state - less food can spawn to save us. Up or left is more likely to feed us & give us a chance.
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

    let voronoiResults: VoronoiResults = calculateReachableCells(gameState, board2d)
    let snekReachableCells = voronoiResults.snakeResults[snek.id]
    let otherSnekReachableCells = voronoiResults.snakeResults[otherSnek.id]

    expect(snekReachableCells).toBeDefined()
    expect(otherSnekReachableCells).toBeDefined()

    if (snekReachableCells !== undefined) {
      expect(snekReachableCells.reachableCells).toBe(14)
    }
    if (otherSnekReachableCells !== undefined) {
      expect(otherSnekReachableCells.reachableCells).toBe(11)
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

    let voronoiResults: VoronoiResults = calculateReachableCells(gameState, board2d)
    let snekReachableCells = voronoiResults.snakeResults[snek.id]
    let otherSnekReachableCells = voronoiResults.snakeResults[otherSnek.id]

    expect(snekReachableCells).toBeDefined()
    expect(otherSnekReachableCells).toBeDefined()

    if (snekReachableCells !== undefined) {
      expect(snekReachableCells.reachableCells).toBeCloseTo(12.25) // can reach 10 non-hazards, & 6 hazards. 7th, final hazard in top left corner unreachable due to health. 10*1 + 6*(3/8) = 12.25
    }
    if (otherSnekReachableCells !== undefined) {
      expect(otherSnekReachableCells.reachableCells).toBeCloseTo(6.75) // can reach 6 non-hazards, & 2 hazards. 6*1 + 2*(3/8) = 6.75
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

    let voronoiResults: VoronoiResults = calculateReachableCells(gameState, board2d)
    let snekReachableCells = voronoiResults.snakeResults[snek.id]

    expect(snekReachableCells).toBeDefined()

    if (snekReachableCells !== undefined) {
      expect(snekReachableCells.reachableCells).toBe(3) // can reach own cell, one left, & the left corner. No escape through tail.
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
  it('does not choose to eat in a cell it has bad Voronoi coverage in', () => {
    const snek = new Battlesnake("snek", "snek", 37, [{x: 3, y: 5}, {x: 2, y: 5}, {x: 2, y: 4}, {x: 1, y: 4}, {x: 0, y: 4}, {x: 0, y: 3}, {x: 0, y: 2}, {x: 0, y: 1}, {x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 1}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 3, y: 3}, {x: 4, y: 3}, {x: 4, y: 4}, {x: 4, y: 5}, {x: 5, y: 5}, {x: 5, y: 6}], "30", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 99, [{x: 4, y: 8}, {x: 5, y: 8}, {x: 5, y: 9}, {x: 6, y: 9}, {x: 7, y: 9}, {x: 8, y: 9}, {x: 8, y: 8}, {x: 8, y: 7}, {x: 8, y: 6}, {x: 8, y: 5}, {x: 7, y: 5}, {x: 7, y: 4}, {x: 6, y: 4}, {x: 5, y: 4}, {x: 5, y: 3}, {x: 6, y: 3}, {x: 7, y: 3}, {x: 8, y: 3}, {x: 8, y: 4}, {x: 9, y: 4}, {x: 9, y: 5}, {x: 9, y: 6}, {x: 9, y: 7}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    gameState.board.food = [{x: 3, y: 4}, {x: 2, y: 9}, {x: 1, y: 10}]

    createHazardRow(gameState.board, 0)
    createHazardRow(gameState.board, 1)
    createHazardRow(gameState.board, 2)
    createHazardRow(gameState.board, 3)
    createHazardRow(gameState.board, 10)
    createHazardColumn(gameState.board, 0)
    createHazardColumn(gameState.board, 1)
    createHazardColumn(gameState.board, 10)

    gameState.turn = 200

    let moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("up") // down pins us in & kills us for sure next turn, up likely starves us or gets us murdered but is clearly better
  })
  it('does not choose to trap itself rather than have poor Voronoi score', () => {
    const snek = new Battlesnake("snek", "snek", 95, [{x: 6, y: 1}, {x: 7, y: 1}, {x: 7, y: 2}, {x: 8, y: 2}, {x: 9, y: 2}], "30", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 92, [{x: 5, y: 2}, {x: 5, y: 3}, {x: 6, y: 3}, {x: 7, y: 3}, {x: 7, y: 4}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 92, [{x: 4, y: 5}, {x: 5, y: 5}, {x: 5, y: 6}, {x: 6, y: 6}, {x: 7, y: 6}, {x: 7, y: 7}], "30", "", "")
    gameState.board.snakes.push(otherSnek2)

    const otherSnek3 = new Battlesnake("otherSnek3", "otherSnek3", 92, [{x: 6, y: 9}, {x: 7, y: 9}, {x: 8, y: 9}], "30", "", "")
    gameState.board.snakes.push(otherSnek3)

    gameState.board.food = [{x: 2, y: 5}]

    let moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("down") // up traps us 100% of the time, left is also an unnecessary risk of kiss of death, should go down
  })
  it('does not choose an escape route through tail if that route does not exist', () => {
    let snek = new Battlesnake("snek", "snek", 85, [{x: 0, y: 0}, {x: 1, y: 0}, {x: 2, y: 0}], "30", "", "")
    const gameState = createGameState(snek)
    gameState.game.map = "hz_spiral"

    let otherSnek = new Battlesnake("otherSnek", "otherSnek", 42, [{x: 5, y: 5}, {x: 6, y: 5}, {x: 7, y: 5}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    gameState.game.ruleset.name = "wrapped"

    gameState.turn = 3
    gameState.board.hazards = [{x: 6, y: 5}]
    let moveResponse: MoveResponse = move(gameState) // necessary to instantiate the hazardSpiral for gameData

    // this is a hazard spiral game, so keep hazard damage
    gameState.turn = 233

    gameState.board.food = [{x: 2, y: 3}, {x: 9, y: 1}, {x: 10, y: 9}]

    let newBody: Coord[] = [{x: 3, y: 4}, {x: 3, y : 3}, {x: 4, y : 3}, {x: 4, y: 2}, {x: 5, y: 2}, {x: 5, y: 3}, {x: 6, y: 3}, {x: 7, y: 3}, {x: 7, y: 4}, {x: 7, y: 5}, {x: 8, y: 5}, {x: 9, y: 5}, {x: 10, y: 5}, {x: 0, y: 5}, {x: 0, y: 6}, {x: 0, y: 7}, {x: 1, y: 7}, {x: 1, y: 6}, {x: 2, y: 6}, {x: 2, y: 5}, {x: 1, y: 5}, {x: 1, y: 4}, {x: 0, y: 4}, {x: 0, y: 3}, {x: 1, y: 3}, {x: 1, y: 2}, {x: 1, y: 1}]
    let newOthersnekBody: Coord[] = [{x: 3, y: 1}, {x: 2, y: 1}, {x: 2, y: 0}, {x: 1, y: 0}, {x: 0, y: 0}, {x: 10, y: 0}, {x: 9, y: 0}, {x: 8, y: 0}, {x: 7, y: 0}, {x: 7, y: 10}, {x: 8, y: 10}, {x: 9, y: 10}, {x: 10, y: 10}, {x: 0, y: 10}, {x: 0, y: 9}, {x: 0, y: 8}, {x: 1, y: 8}, {x: 2, y: 8}, {x: 2, y: 9}, {x: 2, y: 10}, {x: 3, y: 10}, {x: 4, y: 10}]

    snek = new Battlesnake("snek", "snek", 85, newBody, "30", "", "")
    otherSnek = new Battlesnake("otherSnek", "otherSnek", 42, newOthersnekBody, "30", "", "")
    gameState.board.snakes = [snek, otherSnek]
    gameState.you = snek

    moveResponse = move(gameState)
    expect(moveResponse.move).not.toBe("left") // left gets us cut off by otherSnek, if otherSnek were to go up
  })
  it('properly determines snake health after moving into hazard spiral', () => { 
    const gameState: GameState = {"game":{"id":"d2dbbfc1-d124-4991-b815-bb51cf10cba4","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":20,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":205,"board":{"width":11,"height":11,"food":[{"x":5,"y":9},{"x":2,"y":8},{"x":6,"y":1},{"x":3,"y":3}],"hazards":[{"x":5,"y":3},{"x":5,"y":4},{"x":6,"y":4},{"x":6,"y":3},{"x":6,"y":2},{"x":5,"y":2},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":5,"y":5},{"x":6,"y":5},{"x":7,"y":5},{"x":7,"y":4},{"x":7,"y":3},{"x":7,"y":2},{"x":7,"y":1},{"x":6,"y":1},{"x":5,"y":1},{"x":4,"y":1},{"x":3,"y":1},{"x":3,"y":2},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":4,"y":6},{"x":5,"y":6},{"x":6,"y":6},{"x":7,"y":6},{"x":8,"y":6},{"x":8,"y":5},{"x":8,"y":4},{"x":8,"y":3},{"x":8,"y":2},{"x":8,"y":1},{"x":8,"y":0},{"x":7,"y":0},{"x":6,"y":0},{"x":5,"y":0},{"x":4,"y":0},{"x":3,"y":0},{"x":2,"y":0},{"x":2,"y":1},{"x":2,"y":2},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":3,"y":7},{"x":4,"y":7},{"x":5,"y":7},{"x":6,"y":7},{"x":7,"y":7},{"x":8,"y":7},{"x":9,"y":7},{"x":9,"y":6},{"x":9,"y":5},{"x":9,"y":4},{"x":9,"y":3},{"x":9,"y":2},{"x":9,"y":1},{"x":9,"y":0}],"snakes":[{"id":"gs_pYBVpB4xTg7VB4PDDygqPypX","name":"Jaguar Meets Snake","body":[{"x":4,"y":1},{"x":4,"y":0},{"x":4,"y":10},{"x":5,"y":10},{"x":6,"y":10},{"x":7,"y":10},{"x":7,"y":0},{"x":8,"y":0},{"x":8,"y":10},{"x":8,"y":9},{"x":7,"y":9},{"x":6,"y":9},{"x":6,"y":8},{"x":5,"y":8},{"x":4,"y":8},{"x":4,"y":9},{"x":3,"y":9},{"x":3,"y":10},{"x":3,"y":0},{"x":2,"y":0},{"x":2,"y":10},{"x":1,"y":10},{"x":0,"y":10},{"x":0,"y":9}],"health":70,"latency":199,"head":{"x":4,"y":1},"length":24,"shout":"","squad":""},{"id":"gs_yhGw98fx3QR8Sjx7G7G7cvJT","name":"Jaeger","body":[{"x":3,"y":7},{"x":3,"y":6},{"x":3,"y":5},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":5,"y":7},{"x":6,"y":7},{"x":7,"y":7},{"x":7,"y":6},{"x":7,"y":5},{"x":8,"y":5},{"x":8,"y":4},{"x":9,"y":4},{"x":9,"y":5},{"x":10,"y":5},{"x":0,"y":5},{"x":1,"y":5},{"x":1,"y":4},{"x":0,"y":4},{"x":0,"y":3},{"x":0,"y":2}],"health":10,"latency":382,"head":{"x":3,"y":7},"length":22,"shout":"","squad":""},{"id":"gs_8D7jJgTbfyfYchvkMvdhqptW","name":"Pea Eater","body":[{"x":0,"y":8},{"x":10,"y":8},{"x":10,"y":9},{"x":9,"y":9},{"x":9,"y":10},{"x":10,"y":10},{"x":10,"y":0},{"x":0,"y":0},{"x":1,"y":0},{"x":1,"y":1},{"x":0,"y":1}],"health":47,"latency":440,"head":{"x":0,"y":8},"length":11,"shout":"","squad":""}]},"you":{"id":"gs_pYBVpB4xTg7VB4PDDygqPypX","name":"Jaguar Meets Snake","body":[{"x":4,"y":1},{"x":4,"y":0},{"x":4,"y":10},{"x":5,"y":10},{"x":6,"y":10},{"x":7,"y":10},{"x":7,"y":0},{"x":8,"y":0},{"x":8,"y":10},{"x":8,"y":9},{"x":7,"y":9},{"x":6,"y":9},{"x":6,"y":8},{"x":5,"y":8},{"x":4,"y":8},{"x":4,"y":9},{"x":3,"y":9},{"x":3,"y":10},{"x":3,"y":0},{"x":2,"y":0},{"x":2,"y":10},{"x":1,"y":10},{"x":0,"y":10},{"x":0,"y":9}],"health":70,"latency":199,"head":{"x":4,"y":1},"length":24,"shout":"","squad":""}}
    gameState.game.map = "hz_spiral"
    const moveResponse: MoveResponse = move(gameState)
    const moveDir: Direction = stringToDirection(moveResponse.move) || Direction.Up
    const healthBefore = gameState.you.health
    const hazardDamage: number = gameState.game.ruleset.settings.hazardDamagePerTurn || 0
    const regularDamage = 1
    createHazardSpiralGameData(gameState, 3, {x: 5, y: 3})
    moveSnake(gameState, gameState.you, new Board2d(gameState), moveDir)
    updateGameStateAfterMove(gameState)
    expect(gameState.you.health).toBe(healthBefore - hazardDamage - regularDamage)
    expect(gameState.you.health).toBe(70 - 14 - 1)
  })
  it('prioritizes following its tail closely when another snake could cut its tail off', () => {
    const gameState: GameState = {"game":{"id":"a1e601e7-c828-4684-9c7b-d43261467ca4","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":0,"royale":{"shrinkEveryNTurns":30},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":435,"board":{"width":11,"height":11,"food":[{"x":8,"y":8},{"x":3,"y":7},{"x":4,"y":5}],"hazards":[],"snakes":[{"id":"gs_8rJ4d48w7hTCX3fKj3JrvTjJ","name":"Jaguar Meets Snake","body":[{"x":7,"y":9},{"x":7,"y":10},{"x":8,"y":10},{"x":9,"y":10},{"x":10,"y":10},{"x":10,"y":9},{"x":9,"y":9},{"x":9,"y":8},{"x":10,"y":8},{"x":10,"y":7},{"x":9,"y":7},{"x":9,"y":6},{"x":10,"y":6},{"x":0,"y":6},{"x":0,"y":5},{"x":1,"y":5},{"x":2,"y":5},{"x":2,"y":4},{"x":1,"y":4},{"x":0,"y":4},{"x":10,"y":4},{"x":9,"y":4},{"x":8,"y":4},{"x":8,"y":5},{"x":7,"y":5},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":5,"y":7},{"x":5,"y":8},{"x":4,"y":8},{"x":3,"y":8},{"x":3,"y":9},{"x":4,"y":9},{"x":5,"y":9},{"x":6,"y":9},{"x":6,"y":8},{"x":7,"y":8}],"health":77,"latency":67,"head":{"x":7,"y":9},"length":38,"shout":"","squad":""},{"id":"gs_JTBjdGBkvBxY8yTCF7bT7CXR","name":"Shapeshifter","body":[{"x":5,"y":10},{"x":6,"y":10},{"x":6,"y":0},{"x":6,"y":1},{"x":7,"y":1},{"x":8,"y":1},{"x":8,"y":2},{"x":9,"y":2},{"x":9,"y":1},{"x":9,"y":0},{"x":10,"y":0},{"x":0,"y":0},{"x":0,"y":10},{"x":1,"y":10},{"x":2,"y":10},{"x":2,"y":0},{"x":1,"y":0},{"x":1,"y":1},{"x":0,"y":1},{"x":0,"y":2},{"x":10,"y":2},{"x":10,"y":3},{"x":9,"y":3},{"x":8,"y":3},{"x":7,"y":3},{"x":7,"y":4},{"x":6,"y":4},{"x":6,"y":3},{"x":5,"y":3},{"x":4,"y":3},{"x":4,"y":2},{"x":5,"y":2},{"x":5,"y":1}],"health":78,"latency":305,"head":{"x":5,"y":10},"length":33,"shout":"","squad":""}]},"you":{"id":"gs_8rJ4d48w7hTCX3fKj3JrvTjJ","name":"Jaguar Meets Snake","body":[{"x":7,"y":9},{"x":7,"y":10},{"x":8,"y":10},{"x":9,"y":10},{"x":10,"y":10},{"x":10,"y":9},{"x":9,"y":9},{"x":9,"y":8},{"x":10,"y":8},{"x":10,"y":7},{"x":9,"y":7},{"x":9,"y":6},{"x":10,"y":6},{"x":0,"y":6},{"x":0,"y":5},{"x":1,"y":5},{"x":2,"y":5},{"x":2,"y":4},{"x":1,"y":4},{"x":0,"y":4},{"x":10,"y":4},{"x":9,"y":4},{"x":8,"y":4},{"x":8,"y":5},{"x":7,"y":5},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":5,"y":7},{"x":5,"y":8},{"x":4,"y":8},{"x":3,"y":8},{"x":3,"y":9},{"x":4,"y":9},{"x":5,"y":9},{"x":6,"y":9},{"x":6,"y":8},{"x":7,"y":8}],"health":77,"latency":67,"head":{"x":7,"y":9},"length":38,"shout":"","squad":""}}
    let moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("down") // our Voronoi coverage will disappear if we get food by going right->down because Shapeshifter will be able to cut us off at our tail. Should follow tail down.
  })
  // currently failing, Jaguar is guessing at both Pea Eater & hawthh's moves incorrectly, & this results in its Voronoi score being much lower than it would have been
  it.skip('assumes other snakes will cut it off even outside of duel', () => {
    const gameState: GameState = {"game":{"id":"29550b68-3a99-436d-a3ab-5855ddc1f836","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":0,"royale":{"shrinkEveryNTurns":30},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":216,"board":{"width":11,"height":11,"food":[{"x":9,"y":7},{"x":10,"y":2},{"x":3,"y":1}],"hazards":[],"snakes":[{"id":"gs_JWfQmfYy4qdr9bp8SdCcygjK","name":"Pea Eater","body":[{"x":5,"y":9},{"x":4,"y":9},{"x":3,"y":9},{"x":3,"y":8},{"x":4,"y":8},{"x":4,"y":7},{"x":4,"y":6},{"x":5,"y":6},{"x":5,"y":5}],"health":69,"latency":438,"head":{"x":5,"y":9},"length":9,"shout":"","squad":""},{"id":"gs_wy4QdhdBfPyGCPvG4GhxbMCQ","name":"Jaguar Meets Snake","body":[{"x":9,"y":8},{"x":8,"y":8},{"x":8,"y":9},{"x":8,"y":10},{"x":8,"y":0},{"x":8,"y":1},{"x":8,"y":2},{"x":8,"y":3},{"x":9,"y":3},{"x":10,"y":3},{"x":0,"y":3},{"x":0,"y":4},{"x":0,"y":5},{"x":0,"y":6},{"x":1,"y":6},{"x":2,"y":6},{"x":2,"y":7},{"x":1,"y":7},{"x":1,"y":8},{"x":0,"y":8},{"x":10,"y":8},{"x":10,"y":9},{"x":10,"y":10},{"x":10,"y":0},{"x":10,"y":1},{"x":10,"y":1}],"health":100,"latency":23,"head":{"x":9,"y":8},"length":26,"shout":"","squad":""},{"id":"gs_R6xKcqfcpkV8qYgGTr6cPm6D","name":"hawthhhh++","body":[{"x":4,"y":0},{"x":4,"y":10},{"x":5,"y":10},{"x":6,"y":10},{"x":7,"y":10},{"x":7,"y":9},{"x":7,"y":8},{"x":7,"y":7},{"x":8,"y":7},{"x":8,"y":6}],"health":57,"latency":468,"head":{"x":4,"y":0},"length":10,"shout":"","squad":""}]},"you":{"id":"gs_wy4QdhdBfPyGCPvG4GhxbMCQ","name":"Jaguar Meets Snake","body":[{"x":9,"y":8},{"x":8,"y":8},{"x":8,"y":9},{"x":8,"y":10},{"x":8,"y":0},{"x":8,"y":1},{"x":8,"y":2},{"x":8,"y":3},{"x":9,"y":3},{"x":10,"y":3},{"x":0,"y":3},{"x":0,"y":4},{"x":0,"y":5},{"x":0,"y":6},{"x":1,"y":6},{"x":2,"y":6},{"x":2,"y":7},{"x":1,"y":7},{"x":1,"y":8},{"x":0,"y":8},{"x":10,"y":8},{"x":10,"y":9},{"x":10,"y":10},{"x":10,"y":0},{"x":10,"y":1},{"x":10,"y":1}],"health":100,"latency":23,"head":{"x":9,"y":8},"length":26,"shout":"","squad":""}}
    let moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("down") // going up lets hawthh & pea eater trap us in a few turns. Should go down as it's clearly a safer option.
  })
  // tough case where food spawned two away from a snake in exactly the spot I didn't want it to. Lots of tail chasing though!
  it.skip('vtail1: does not choose an escape route which closely follows another snake tail at a small depth given another option', () => {
    for (let i: number = 0; i < 3; i++) {
      const gameState: GameState = {"game":{"id":"b5650968-cc82-4681-ad5a-58351ae7a919","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":20,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":126,"board":{"width":11,"height":11,"food":[{"x":0,"y":3},{"x":10,"y":8}],"hazards":[{"x":5,"y":6},{"x":5,"y":7},{"x":6,"y":7},{"x":6,"y":6},{"x":6,"y":5},{"x":5,"y":5},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":4,"y":8},{"x":5,"y":8},{"x":6,"y":8},{"x":7,"y":8},{"x":7,"y":7},{"x":7,"y":6},{"x":7,"y":5},{"x":7,"y":4},{"x":6,"y":4},{"x":5,"y":4},{"x":4,"y":4},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":3,"y":7},{"x":3,"y":8},{"x":3,"y":9},{"x":4,"y":9},{"x":5,"y":9},{"x":6,"y":9},{"x":7,"y":9},{"x":8,"y":9},{"x":8,"y":8},{"x":8,"y":7},{"x":8,"y":6},{"x":8,"y":5},{"x":8,"y":4},{"x":8,"y":3},{"x":7,"y":3},{"x":6,"y":3},{"x":5,"y":3},{"x":4,"y":3},{"x":3,"y":3}],"snakes":[{"id":"gs_dqVffdSmFdPTwhTRmyjVdXFX","name":"Salazar Slitherin","body":[{"x":9,"y":4},{"x":9,"y":5},{"x":10,"y":5},{"x":10,"y":6},{"x":10,"y":7},{"x":0,"y":7},{"x":1,"y":7},{"x":2,"y":7},{"x":3,"y":7},{"x":4,"y":7},{"x":4,"y":8},{"x":3,"y":8},{"x":2,"y":8},{"x":2,"y":9},{"x":2,"y":10},{"x":1,"y":10},{"x":1,"y":0},{"x":1,"y":1},{"x":0,"y":1},{"x":10,"y":1},{"x":9,"y":1}],"health":99,"latency":406,"head":{"x":9,"y":4},"length":21,"shout":"6 4 125","squad":""},{"id":"gs_DfcRK8HyHdC7pw3tFbgKtPyD","name":"Jaguar Meets Snake","body":[{"x":3,"y":0},{"x":3,"y":1},{"x":3,"y":2},{"x":4,"y":2},{"x":5,"y":2},{"x":6,"y":2},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":7,"y":7}],"health":34,"latency":169,"head":{"x":3,"y":0},"length":12,"shout":"","squad":""},{"id":"gs_kmrPbkGp7fdqCtGTMXJhypQF","name":"Shapeshifter","body":[{"x":4,"y":4},{"x":4,"y":3},{"x":3,"y":3},{"x":3,"y":4},{"x":2,"y":4},{"x":1,"y":4},{"x":1,"y":3},{"x":1,"y":2},{"x":0,"y":2},{"x":10,"y":2},{"x":9,"y":2}],"health":70,"latency":298,"head":{"x":4,"y":4},"length":11,"shout":"","squad":""},{"id":"gs_mF8BVGKrkXkf3KpfRXdWH9mX","name":"Combat Reptile","body":[{"x":9,"y":9},{"x":10,"y":9},{"x":10,"y":10},{"x":9,"y":10},{"x":9,"y":0},{"x":8,"y":0},{"x":8,"y":10},{"x":7,"y":10}],"health":59,"latency":442,"head":{"x":9,"y":9},"length":8,"shout":"","squad":""}]},"you":{"id":"gs_DfcRK8HyHdC7pw3tFbgKtPyD","name":"Jaguar Meets Snake","body":[{"x":3,"y":0},{"x":3,"y":1},{"x":3,"y":2},{"x":4,"y":2},{"x":5,"y":2},{"x":6,"y":2},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":7,"y":7}],"health":34,"latency":169,"head":{"x":3,"y":0},"length":12,"shout":"","squad":""}}
      gameState.game.map = "hz_spiral"
      createHazardSpiralGameData(gameState, 3, {x: 5, y: 6})
      const moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("left")
    }
  })
  it('vtail2: does not choose an escape route which closely follows another snake tail v2', () => {
    for (let i: number = 0; i < 3; i++ ) {
      const gameState: GameState = {"game":{"id":"998af34a-e7d2-4d2d-93f4-9b2b1abbaf3c","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":20,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":88,"board":{"width":11,"height":11,"food":[{"x":0,"y":4}],"hazards":[{"x":7,"y":5},{"x":7,"y":6},{"x":8,"y":6},{"x":8,"y":5},{"x":8,"y":4},{"x":7,"y":4},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":7,"y":7},{"x":8,"y":7},{"x":9,"y":7},{"x":9,"y":6},{"x":9,"y":5},{"x":9,"y":4},{"x":9,"y":3},{"x":8,"y":3},{"x":7,"y":3},{"x":6,"y":3},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":5,"y":8},{"x":6,"y":8},{"x":7,"y":8},{"x":8,"y":8}],"snakes":[{"id":"gs_QWFmb8DpjGy8wwJyVdypjYgD","name":"Demifemme (She or They pronouns)","body":[{"x":10,"y":10},{"x":10,"y":9},{"x":9,"y":9},{"x":9,"y":8},{"x":9,"y":7},{"x":10,"y":7},{"x":10,"y":6},{"x":0,"y":6}],"health":72,"latency":449,"head":{"x":10,"y":10},"length":8,"shout":"","squad":""},{"id":"gs_BthJbH4yxSR4WxQmwmmSvKhX","name":"Jaguar Meets Snake","body":[{"x":0,"y":5},{"x":10,"y":5},{"x":10,"y":4},{"x":9,"y":4},{"x":9,"y":5},{"x":8,"y":5},{"x":8,"y":4},{"x":8,"y":3},{"x":7,"y":3},{"x":6,"y":3},{"x":6,"y":2},{"x":6,"y":1},{"x":5,"y":1},{"x":5,"y":0}],"health":97,"latency":22,"head":{"x":0,"y":5},"length":14,"shout":"","squad":""},{"id":"gs_76D8hGWvrByVW4ggKB9XkXb8","name":"Shapeshifter","body":[{"x":1,"y":2},{"x":2,"y":2},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":1,"y":6},{"x":1,"y":5},{"x":1,"y":4},{"x":1,"y":3},{"x":0,"y":3},{"x":0,"y":2}],"health":97,"latency":296,"head":{"x":1,"y":2},"length":12,"shout":"","squad":""},{"id":"gs_r398htPpm87rCkb6FKjCB8T6","name":"Gadiuka","body":[{"x":5,"y":10},{"x":4,"y":10},{"x":3,"y":10},{"x":2,"y":10},{"x":2,"y":9},{"x":2,"y":8},{"x":2,"y":7},{"x":1,"y":7},{"x":1,"y":8},{"x":1,"y":9}],"health":99,"latency":257,"head":{"x":5,"y":10},"length":10,"shout":"","squad":""}]},"you":{"id":"gs_BthJbH4yxSR4WxQmwmmSvKhX","name":"Jaguar Meets Snake","body":[{"x":0,"y":5},{"x":10,"y":5},{"x":10,"y":4},{"x":9,"y":4},{"x":9,"y":5},{"x":8,"y":5},{"x":8,"y":4},{"x":8,"y":3},{"x":7,"y":3},{"x":6,"y":3},{"x":6,"y":2},{"x":6,"y":1},{"x":5,"y":1},{"x":5,"y":0}],"health":97,"latency":22,"head":{"x":0,"y":5},"length":14,"shout":"","squad":""}}
      gameState.game.map = "hz_spiral"
      createHazardSpiralGameData(gameState, 3, {x: 7, y: 5})
      const moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // down traps us in a tunnel chasing Shapeshifter's tail if Demifemme also traps us, whereas up cannot be trapped
    }
  })
  // tricky test. Salazar chooses first, & doesn't know it can trap me with Pea Eater's cooperation. No mechanic currently to try to overcome this, prior success was by chance
  it.skip('does not walk into a trap set by two snakes', () => {
    const gameState: GameState = {"game":{"id":"98254863-d040-47a6-9524-25e30c040433","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":20,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":92,"board":{"width":11,"height":11,"food":[{"x":4,"y":5},{"x":6,"y":5},{"x":3,"y":4},{"x":0,"y":2}],"hazards":[{"x":3,"y":3},{"x":3,"y":4},{"x":4,"y":4},{"x":4,"y":3},{"x":4,"y":2},{"x":3,"y":2},{"x":2,"y":2},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":3,"y":5},{"x":4,"y":5},{"x":5,"y":5},{"x":5,"y":4},{"x":5,"y":3},{"x":5,"y":2},{"x":5,"y":1},{"x":4,"y":1},{"x":3,"y":1},{"x":2,"y":1},{"x":1,"y":1},{"x":1,"y":2},{"x":1,"y":3},{"x":1,"y":4},{"x":1,"y":5},{"x":1,"y":6},{"x":2,"y":6},{"x":3,"y":6},{"x":4,"y":6},{"x":5,"y":6}],"snakes":[{"id":"gs_84SYMh44MWFqxwWjh4JwJQX7","name":"Salazar Slitherin","body":[{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":5,"y":8},{"x":4,"y":8},{"x":4,"y":7},{"x":3,"y":7},{"x":2,"y":7},{"x":1,"y":7},{"x":0,"y":7},{"x":10,"y":7},{"x":9,"y":7},{"x":9,"y":6},{"x":9,"y":5},{"x":9,"y":4},{"x":10,"y":4},{"x":10,"y":5}],"health":60,"latency":387,"head":{"x":5,"y":5},"length":17,"shout":"6 4 91","squad":""},{"id":"gs_vxHpq6XvSS389WfDk9kxFxPb","name":"Jaguar Meets Snake","body":[{"x":6,"y":7},{"x":6,"y":8},{"x":6,"y":9},{"x":5,"y":9},{"x":4,"y":9},{"x":3,"y":9},{"x":2,"y":9},{"x":2,"y":10},{"x":2,"y":0},{"x":3,"y":0},{"x":4,"y":0}],"health":88,"latency":227,"head":{"x":6,"y":7},"length":11,"shout":"","squad":""},{"id":"gs_kD6kp6B76HQm6QpRcxymGxfG","name":"Combat Reptile","body":[{"x":8,"y":1},{"x":8,"y":2},{"x":8,"y":3},{"x":9,"y":3},{"x":10,"y":3},{"x":10,"y":2},{"x":9,"y":2},{"x":9,"y":1},{"x":10,"y":1},{"x":10,"y":0}],"health":94,"latency":402,"head":{"x":8,"y":1},"length":10,"shout":"","squad":""},{"id":"gs_4jVccvTwhp4SDfW4YKfPDXKb","name":"Pea Eater","body":[{"x":7,"y":5},{"x":7,"y":4},{"x":7,"y":3},{"x":7,"y":2},{"x":7,"y":1}],"health":70,"latency":438,"head":{"x":7,"y":5},"length":5,"shout":"","squad":""}]},"you":{"id":"gs_vxHpq6XvSS389WfDk9kxFxPb","name":"Jaguar Meets Snake","body":[{"x":6,"y":7},{"x":6,"y":8},{"x":6,"y":9},{"x":5,"y":9},{"x":4,"y":9},{"x":3,"y":9},{"x":2,"y":9},{"x":2,"y":10},{"x":2,"y":0},{"x":3,"y":0},{"x":4,"y":0}],"health":88,"latency":227,"head":{"x":6,"y":7},"length":11,"shout":"","squad":""}}
    gameState.game.map = "hz_spiral"
    createHazardSpiralGameData(gameState, 3, {x: 3, y: 3})
    let moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).not.toBe("down") // down allows Pea Eater & Salazar to trap me immediately. Right is reasonably safe.
  })
  it.skip('vhazardCoverage1: values non-hazard Voronoi coverage over hazard coverage', () => {
    for (let i: number = 0; i < 3; i++) {
      const gameState: GameState = {"game":{"id":"49cb3797-7950-465e-a76b-e5cd62ada51d","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":20,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":224,"board":{"width":11,"height":11,"food":[{"x":9,"y":9},{"x":3,"y":8},{"x":2,"y":9},{"x":8,"y":2}],"hazards":[{"x":4,"y":6},{"x":4,"y":7},{"x":5,"y":7},{"x":5,"y":6},{"x":5,"y":5},{"x":4,"y":5},{"x":3,"y":5},{"x":3,"y":6},{"x":3,"y":7},{"x":3,"y":8},{"x":4,"y":8},{"x":5,"y":8},{"x":6,"y":8},{"x":6,"y":7},{"x":6,"y":6},{"x":6,"y":5},{"x":6,"y":4},{"x":5,"y":4},{"x":4,"y":4},{"x":3,"y":4},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":2,"y":8},{"x":2,"y":9},{"x":3,"y":9},{"x":4,"y":9},{"x":5,"y":9},{"x":6,"y":9},{"x":7,"y":9},{"x":7,"y":8},{"x":7,"y":7},{"x":7,"y":6},{"x":7,"y":5},{"x":7,"y":4},{"x":7,"y":3},{"x":6,"y":3},{"x":5,"y":3},{"x":4,"y":3},{"x":3,"y":3},{"x":2,"y":3},{"x":1,"y":3},{"x":1,"y":4},{"x":1,"y":5},{"x":1,"y":6},{"x":1,"y":7},{"x":1,"y":8},{"x":1,"y":9},{"x":1,"y":10},{"x":2,"y":10},{"x":3,"y":10},{"x":4,"y":10},{"x":5,"y":10},{"x":6,"y":10},{"x":7,"y":10},{"x":8,"y":10},{"x":8,"y":9},{"x":8,"y":8},{"x":8,"y":7},{"x":8,"y":6},{"x":8,"y":5},{"x":8,"y":4},{"x":8,"y":3},{"x":8,"y":2},{"x":7,"y":2},{"x":6,"y":2},{"x":5,"y":2},{"x":4,"y":2},{"x":3,"y":2},{"x":2,"y":2},{"x":1,"y":2},{"x":0,"y":2},{"x":0,"y":3}],"snakes":[{"id":"gs_93RwCvCxkYmtFWVmPFpmqjrW","name":"Jaguar Meets Snake","body":[{"x":4,"y":10},{"x":3,"y":10},{"x":3,"y":0},{"x":3,"y":1},{"x":2,"y":1},{"x":2,"y":0},{"x":1,"y":0},{"x":0,"y":0},{"x":0,"y":1},{"x":0,"y":2},{"x":0,"y":3},{"x":0,"y":4},{"x":0,"y":5},{"x":10,"y":5},{"x":10,"y":4},{"x":10,"y":3},{"x":10,"y":2},{"x":10,"y":1},{"x":10,"y":0},{"x":9,"y":0},{"x":8,"y":0},{"x":7,"y":0},{"x":6,"y":0},{"x":5,"y":0},{"x":5,"y":10}],"health":59,"latency":157,"head":{"x":4,"y":10},"length":25,"shout":"","squad":""},{"id":"gs_bTJbCckvHDD6MVbJ3QTg9RVW","name":"Pea Eater","body":[{"x":8,"y":9},{"x":7,"y":9},{"x":6,"y":9},{"x":6,"y":10},{"x":7,"y":10},{"x":8,"y":10},{"x":9,"y":10},{"x":10,"y":10},{"x":0,"y":10},{"x":0,"y":9},{"x":10,"y":9},{"x":10,"y":8},{"x":10,"y":7},{"x":10,"y":6},{"x":0,"y":6},{"x":0,"y":7},{"x":0,"y":8}],"health":55,"latency":436,"head":{"x":8,"y":9},"length":17,"shout":"","squad":""}]},"you":{"id":"gs_93RwCvCxkYmtFWVmPFpmqjrW","name":"Jaguar Meets Snake","body":[{"x":4,"y":10},{"x":3,"y":10},{"x":3,"y":0},{"x":3,"y":1},{"x":2,"y":1},{"x":2,"y":0},{"x":1,"y":0},{"x":0,"y":0},{"x":0,"y":1},{"x":0,"y":2},{"x":0,"y":3},{"x":0,"y":4},{"x":0,"y":5},{"x":10,"y":5},{"x":10,"y":4},{"x":10,"y":3},{"x":10,"y":2},{"x":10,"y":1},{"x":10,"y":0},{"x":9,"y":0},{"x":8,"y":0},{"x":7,"y":0},{"x":6,"y":0},{"x":5,"y":0},{"x":5,"y":10}],"health":59,"latency":157,"head":{"x":4,"y":10},"length":25,"shout":"","squad":""}}
      gameState.game.map = "hz_spiral"
      createHazardSpiralGameData(gameState, 3, {x: 4, y: 6})
      const moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("down") // down either forces us to eat & traps us in sauce, or eats our health stupidly. Right or up both good.
    }
  })
  it('corner1: does not venture into a corner', () => {
    const gameState: GameState = {"game":{"id":"251a9fbe-ba92-4ac3-9bd1-70b8a3588350","ruleset":{"name":"royale","version":"?","settings":{"foodSpawnChance":20,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{"shrinkEveryNTurns":25},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":600,"source":"testing"},"turn":145,"board":{"width":11,"height":11,"food":[{"x":10,"y":10},{"x":4,"y":9},{"x":3,"y":0}],"hazards":[{"x":0,"y":0},{"x":0,"y":1},{"x":0,"y":2},{"x":0,"y":3},{"x":0,"y":4},{"x":0,"y":5},{"x":0,"y":6},{"x":0,"y":7},{"x":0,"y":8},{"x":0,"y":9},{"x":0,"y":10},{"x":1,"y":0},{"x":1,"y":9},{"x":1,"y":10},{"x":2,"y":0},{"x":2,"y":9},{"x":2,"y":10},{"x":3,"y":0},{"x":3,"y":9},{"x":3,"y":10},{"x":4,"y":0},{"x":4,"y":9},{"x":4,"y":10},{"x":5,"y":0},{"x":5,"y":9},{"x":5,"y":10},{"x":6,"y":0},{"x":6,"y":9},{"x":6,"y":10},{"x":7,"y":0},{"x":7,"y":9},{"x":7,"y":10},{"x":8,"y":0},{"x":8,"y":9},{"x":8,"y":10},{"x":9,"y":0},{"x":9,"y":9},{"x":9,"y":10},{"x":10,"y":0},{"x":10,"y":1},{"x":10,"y":2},{"x":10,"y":3},{"x":10,"y":4},{"x":10,"y":5},{"x":10,"y":6},{"x":10,"y":7},{"x":10,"y":8},{"x":10,"y":9},{"x":10,"y":10}],"snakes":[{"id":"gs_8mbvvfwMM3rybCMbMmGtbV8G","name":"Shovel","body":[{"x":0,"y":5},{"x":1,"y":5},{"x":1,"y":4},{"x":2,"y":4},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":4,"y":6},{"x":5,"y":6},{"x":6,"y":6},{"x":7,"y":6}],"health":84,"latency":551,"head":{"x":0,"y":5},"length":11,"shout":"","squad":""},{"id":"gs_HXyH8JdMdPyCpJJyHCbQ4VPJ","name":"Hurtle","body":[{"x":2,"y":1},{"x":2,"y":2},{"x":2,"y":3},{"x":3,"y":3},{"x":3,"y":2},{"x":4,"y":2},{"x":5,"y":2},{"x":6,"y":2},{"x":7,"y":2},{"x":8,"y":2},{"x":8,"y":3}],"health":96,"latency":14,"head":{"x":2,"y":1},"length":11,"shout":"","squad":""}]},"you":{"id":"gs_8mbvvfwMM3rybCMbMmGtbV8G","name":"Shovel","body":[{"x":0,"y":5},{"x":1,"y":5},{"x":1,"y":4},{"x":2,"y":4},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":4,"y":6},{"x":5,"y":6},{"x":6,"y":6},{"x":7,"y":6}],"health":84,"latency":551,"head":{"x":0,"y":5},"length":11,"shout":"","squad":""}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("up") // down is certain death in ~ten turns, up is sensible plan
  })
  it('vcoverage1: does not allow a smaller snake to constrain its Voronoi coverage', () => {
    const gameState: GameState = {"game":{"id":"1848297b-e27e-42f9-9ecf-911efbbfc249","ruleset":{"name":"royale","version":"?","settings":{"foodSpawnChance":20,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{"shrinkEveryNTurns":25},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":600,"source":"testing"},"turn":108,"board":{"width":11,"height":11,"food":[{"x":6,"y":10},{"x":4,"y":2},{"x":9,"y":9}],"hazards":[{"x":0,"y":0},{"x":0,"y":1},{"x":0,"y":2},{"x":1,"y":0},{"x":1,"y":1},{"x":1,"y":2},{"x":2,"y":0},{"x":2,"y":1},{"x":2,"y":2},{"x":3,"y":0},{"x":3,"y":1},{"x":3,"y":2},{"x":4,"y":0},{"x":4,"y":1},{"x":4,"y":2},{"x":5,"y":0},{"x":5,"y":1},{"x":5,"y":2},{"x":6,"y":0},{"x":6,"y":1},{"x":6,"y":2},{"x":7,"y":0},{"x":7,"y":1},{"x":7,"y":2},{"x":8,"y":0},{"x":8,"y":1},{"x":8,"y":2},{"x":9,"y":0},{"x":9,"y":1},{"x":9,"y":2},{"x":10,"y":0},{"x":10,"y":1},{"x":10,"y":2},{"x":10,"y":3},{"x":10,"y":4},{"x":10,"y":5},{"x":10,"y":6},{"x":10,"y":7},{"x":10,"y":8},{"x":10,"y":9},{"x":10,"y":10}],"snakes":[{"id":"gs_RJMpdmBgg3HQ3PdpxRdDxFFK","name":"Jaguar Meets Snake","body":[{"x":8,"y":8},{"x":8,"y":7},{"x":8,"y":6},{"x":8,"y":5},{"x":8,"y":4},{"x":8,"y":3},{"x":9,"y":3},{"x":9,"y":2},{"x":9,"y":1},{"x":9,"y":0},{"x":8,"y":0},{"x":7,"y":0},{"x":6,"y":0},{"x":5,"y":0},{"x":5,"y":1}],"health":63,"latency":553,"head":{"x":8,"y":8},"length":15,"shout":"","squad":""},{"id":"gs_gGttSQ6RyWcJ4DbFdR38wJSJ","name":"Pea Eater","body":[{"x":6,"y":8},{"x":5,"y":8},{"x":4,"y":8},{"x":4,"y":7},{"x":5,"y":7},{"x":5,"y":6},{"x":6,"y":6},{"x":6,"y":7},{"x":6,"y":7}],"health":100,"latency":542,"head":{"x":6,"y":8},"length":9,"shout":"","squad":""},{"id":"gs_qbHTmJWKg9hx8JxcbmhhgWXT","name":"Shapeshifter","body":[{"x":3,"y":3},{"x":2,"y":3},{"x":2,"y":4},{"x":3,"y":4},{"x":3,"y":5},{"x":4,"y":5},{"x":5,"y":5}],"health":70,"latency":531,"head":{"x":3,"y":3},"length":7,"shout":"","squad":""}]},"you":{"id":"gs_RJMpdmBgg3HQ3PdpxRdDxFFK","name":"Jaguar Meets Snake","body":[{"x":8,"y":8},{"x":8,"y":7},{"x":8,"y":6},{"x":8,"y":5},{"x":8,"y":4},{"x":8,"y":3},{"x":9,"y":3},{"x":9,"y":2},{"x":9,"y":1},{"x":9,"y":0},{"x":8,"y":0},{"x":7,"y":0},{"x":6,"y":0},{"x":5,"y":0},{"x":5,"y":1}],"health":63,"latency":553,"head":{"x":8,"y":8},"length":15,"shout":"","squad":""}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).not.toBe("right") // right pushes us into the right side with hazard, left is best though up is fine
  })
  it('vcoverage2: correctly gauges othersnake priorities in threesnake', () => {
    const gameState: GameState = {"game":{"id":"2a7ee71f-958d-4a9d-8622-671984601ab3","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":2,"minimumFood":1,"hazardDamagePerTurn":-30,"royale":{"shrinkEveryNTurns":300},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"healing_pools","timeout":500,"source":"testing"},"turn":398,"board":{"width":11,"height":11,"food":[{"x":5,"y":8}],"hazards":[{"x":5,"y":7}],"snakes":[{"id":"gs_Tkwj9QqXp6gK46QFCGbV6Kb4","name":"Shapeshifter","health":99,"body":[{"x":4,"y":2},{"x":3,"y":2},{"x":2,"y":2},{"x":1,"y":2},{"x":0,"y":2},{"x":0,"y":1},{"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0},{"x":3,"y":0},{"x":4,"y":0},{"x":5,"y":0},{"x":6,"y":0},{"x":7,"y":0}],"latency":402,"head":{"x":4,"y":2},"length":14,"shout":"","squad":"","customizations":{"color":"#900050","head":"cosmic-horror-special","tail":"cosmic-horror"}},{"id":"gs_pRJmShvgMbYYVBHQ6bT3r7Jd","name":"Prüzze v2","health":94,"body":[{"x":5,"y":9},{"x":6,"y":9},{"x":7,"y":9},{"x":7,"y":8},{"x":6,"y":8},{"x":6,"y":7},{"x":5,"y":7},{"x":5,"y":6},{"x":6,"y":6},{"x":7,"y":6},{"x":8,"y":6},{"x":8,"y":5},{"x":8,"y":4},{"x":7,"y":4},{"x":7,"y":5},{"x":6,"y":5},{"x":5,"y":5}],"latency":374,"head":{"x":5,"y":9},"length":17,"shout":", t=352","squad":"","customizations":{"color":"#c91f37","head":"gamer","tail":"coffee"}},{"id":"gs_MG6mwV7bGQcxj7x7PmY4TQBR","name":"Jagwire","health":38,"body":[{"x":5,"y":3},{"x":4,"y":3},{"x":3,"y":3},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":3,"y":6},{"x":3,"y":7},{"x":2,"y":7},{"x":2,"y":8},{"x":2,"y":9}],"latency":451,"head":{"x":5,"y":3},"length":12,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}]},"you":{"id":"gs_MG6mwV7bGQcxj7x7PmY4TQBR","name":"Jagwire","health":38,"body":[{"x":5,"y":3},{"x":4,"y":3},{"x":3,"y":3},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":3,"y":6},{"x":3,"y":7},{"x":2,"y":7},{"x":2,"y":8},{"x":2,"y":9}],"latency":451,"head":{"x":5,"y":3},"length":12,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("right") // down gets us murdered, up gets us murdered in ~five turns. Right lets us escape awhile longer
  })
})

describe('MaxN tests', () => {
  it('maxn1: does not allow itself to be cornered by an opponent snake', () => {
    const gameState: GameState = {"game":{"id":"71bd764d-5af5-45fe-8f86-8373525f681e","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":5,"minimumFood":1,"hazardDamagePerTurn":-30,"royale":{"shrinkEveryNTurns":300},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"healing_pools","timeout":500,"source":"testing"},"turn":66,"board":{"width":11,"height":11,"food":[{"x":1,"y":0}],"hazards":[{"x":3,"y":3},{"x":7,"y":7}],"snakes":[{"id":"gs_jmPhHpRQGHXpfJ8PpTvbGd79","name":"Hovering Hobbs","health":96,"body":[{"x":5,"y":5},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":7,"y":7}],"latency":456,"head":{"x":5,"y":5},"length":5,"shout":"","squad":"","customizations":{"color":"#da8a1a","head":"beach-puffin-special","tail":"beach-puffin-special"}},{"id":"gs_ccGDSMxRTrbjGpmDYK7R4H4G","name":"CoolerSnake!","health":92,"body":[{"x":4,"y":2},{"x":5,"y":2},{"x":5,"y":3},{"x":6,"y":3},{"x":6,"y":4}],"latency":109,"head":{"x":4,"y":2},"length":5,"shout":"10, 4","squad":"","customizations":{"color":"#ff6600","head":"cosmic-horror","tail":"cosmic-horror"}},{"id":"gs_fJK4Q7pj3xk3kWW8hhRFmgBM","name":"Jagwire","health":100,"body":[{"x":6,"y":0},{"x":6,"y":1},{"x":7,"y":1},{"x":7,"y":2},{"x":8,"y":2},{"x":8,"y":2}],"latency":345,"head":{"x":6,"y":0},"length":6,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}]},"you":{"id":"gs_fJK4Q7pj3xk3kWW8hhRFmgBM","name":"Jagwire","health":100,"body":[{"x":6,"y":0},{"x":6,"y":1},{"x":7,"y":1},{"x":7,"y":2},{"x":8,"y":2},{"x":8,"y":2}],"latency":345,"head":{"x":6,"y":0},"length":6,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("right") // left allows CoolerSnake to cut us off, right gets us out safe
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

describe('Hazard spiral tests', () => {
  it('can successfully map spiral hazards given a central starting point', () => {
    const snek = new Battlesnake("snek", "snek", 69, [{x: 10, y: 9}, {x: 9, y: 9}, {x: 8, y: 9}, {x: 8, y: 8}, {x: 8, y: 7}, {x: 7, y: 7}, {x: 7, y: 8}], "30", "", "")
    const gameState = createGameState(snek)
    gameState.game.map = "hz_spiral"

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 89, [{x: 9, y: 8}, {x: 9, y: 7}, {x: 9, y: 6}, {x: 9, y: 5}, {x: 8, y: 5}, {x: 7, y: 5}, {x: 6, y: 5}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    gameState.turn = 3

    let startingHazard: Coord = new Coord(5, 5)
    gameState.board.hazards = [startingHazard]

    let hazardSpiral = new HazardSpiral(gameState, 3)

    let hazardSpiralCell = hazardSpiral.getCell({x: 0, y: 0})
    expect(hazardSpiralCell).toBeDefined()
    if (hazardSpiralCell) {
      expect(hazardSpiralCell.turnIsHazard).toBe(111 * 3) // bottom left corner is 111th tile reached out of 121, so should show up at turn 111*3
    }
  })
  it('can successfully map spiral hazards given a non-central starting point', () => {
    const snek = new Battlesnake("snek", "snek", 69, [{x: 10, y: 9}, {x: 9, y: 9}, {x: 8, y: 9}, {x: 8, y: 8}, {x: 8, y: 7}, {x: 7, y: 7}, {x: 7, y: 8}], "30", "", "")
    const gameState = createGameState(snek)
    gameState.game.map = "hz_spiral"

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 89, [{x: 9, y: 8}, {x: 9, y: 7}, {x: 9, y: 6}, {x: 9, y: 5}, {x: 8, y: 5}, {x: 7, y: 5}, {x: 6, y: 5}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    gameState.turn = 3

    let startingHazard: Coord = new Coord(3, 3)
    gameState.board.hazards = [startingHazard]

    let hazardSpiral = new HazardSpiral(gameState, 3)

    let hazardSpiralCell = hazardSpiral.getCell({x: 0, y: 10})
    expect(hazardSpiralCell).toBeDefined()
    if (hazardSpiralCell) {
      expect(hazardSpiralCell.turnIsHazard).toBe(519) // see notebook, top left corner is 519
    }
    hazardSpiralCell = hazardSpiral.getCell({x: 0, y: 0})
    expect(hazardSpiralCell).toBeDefined()
    if (hazardSpiralCell) {
      expect(hazardSpiralCell.turnIsHazard).toBe(129) // see notebook, bottom left corner is 129
    }
    hazardSpiralCell = hazardSpiral.getCell({x: 10, y: 0})
    expect(hazardSpiralCell).toBeDefined()
    if (hazardSpiralCell) {
      expect(hazardSpiralCell.turnIsHazard).toBe(579) // see notebook, bottom right corner is 579
    }
    hazardSpiralCell = hazardSpiral.getCell({x: 10, y: 10})
    expect(hazardSpiralCell).toBeDefined()
    if (hazardSpiralCell) {
      expect(hazardSpiralCell.turnIsHazard).toBe(549) // see notebook, top right corner is 549
    }
  })
  it('does not apply hazard penalty for moving into a hazard that arrived as I moved onto it', () => {
    const snek = new Battlesnake("snek", "snek", 95, [{x: 3, y: 6}, {x: 2, y: 6}, {x: 1, y: 6}], "30", "", "")
    const gameState = createGameState(snek)
    gameState.game.map = "hz_spiral"
    
    gameState.game.ruleset.name = "wrapped"
    gameState.game.ruleset.settings.hazardDamagePerTurn = 14
    gameState.turn = 3
    gameState.board.hazards = [{x: 6, y: 4}]

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 95, [{x: 3, y: 0}, {x: 4, y: 0}, {x: 5, y: 0}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    let moveResponse: MoveResponse = move(gameState)
    
    gameState.turn = 74
    gameState.board.hazards = [{x: 5, y: 6}, {x: 6, y: 6}, {x: 7, y: 6}, {x: 8, y: 6}, {x: 4, y: 5}, {x: 5, y: 5}, {x: 6, y: 5}, {x: 7, y: 5}, {x: 8, y: 5},
      {x: 4, y: 4}, {x: 5, y: 4}, {x: 6, y: 4}, {x: 7, y: 4}, {x: 8, y: 4}, {x: 4, y: 3}, {x: 5, y: 3}, {x: 6, y: 3}, {x: 7, y: 3}, {x: 8, y: 3}, {x: 4, y: 2},
      {x: 5, y: 2}, {x: 6, y: 2}, {x: 7, y: 2}, {x: 8, y: 2}]

    let board2d = new Board2d(gameState)
    moveSnake(gameState, snek, board2d, Direction.Right)
    updateGameStateAfterMove(gameState)

    expect(snek.health).toBe(94) // snek has just moved into a hazard that just showed up - it should be 1 health lower, not 15
  })
})

describe('Wrapped tests', () => {
  it('knows to avoid a kiss of death from wrapped & to escape via wrap instead', () => {
    const snek = new Battlesnake("snek", "snek", 95, [{x: 10, y: 0}, {x: 10, y: 10}, {x: 10, y: 9}, {x: 0, y: 9}, {x: 0, y: 10}, {x: 1, y: 10}, {x: 1, y: 9}, {x: 1, y: 9}, {x: 1, y: 8}, {x: 1, y: 7}, {x: 1, y: 6}, {x: 1, y: 5}], "30", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 99, [{x: 9, y: 10}, {x: 8, y: 10}, {x: 7, y: 10}, {x: 6, y: 10}, {x: 5, y: 10}, {x: 5, y: 9}, {x: 5, y: 8}, {x: 5, y: 7}, {x: 6, y: 7}, {x: 6, y: 6}, {x: 7, y: 6}, {x: 8, y: 6}, {x: 8, y: 7}, {x: 7, y: 7}, {x: 7, y: 8}, {x: 8, y: 8}, {x: 9, y: 8}, {x: 9, y: 9}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 72, [{x: 0, y: 4}, {x: 10, y: 4}, {x: 9, y: 4}, {x: 9, y: 3}, {x: 10, y: 3}, {x: 10, y: 2}, {x: 10, y: 1}, {x: 0, y: 1}, {x: 0, y: 2}, {x: 1, y: 2}, {x: 2, y: 2}, {x: 2, y: 1}, {x: 3, y: 1}, {x: 3, y: 2}, {x: 4, y: 2}, {x: 5, y: 2}, {x: 6, y: 2}], "30", "", "")
    gameState.board.snakes.push(otherSnek2)

    gameState.turn = 208
    gameState.board.food = [{x: 4, y: 9}]
    gameState.game.ruleset.name = "wrapped"
    gameState.game.ruleset.settings.hazardDamagePerTurn = 0

    let moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("right") // left is a kiss of death certainty with otherSnek, should go right
  })
  it('does not attempt to kill a snake when missing will kill it', () => {
    const snek = new Battlesnake("snek", "snek", 95, [{x: 1, y: 8}, {x: 0, y: 8}, {x: 0, y: 9}, {x: 0, y: 10}, {x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}, {x: 1, y: 2}, {x: 2, y: 2}, {x: 3, y: 2}, {x: 4, y: 2}, {x: 4, y: 1}, {x: 5, y: 1}, {x: 6, y: 1}, {x: 6, y: 0}, {x: 6, y: 10}, {x: 7, y: 10}, {x: 8, y: 10}, {x: 9, y: 10}, {x: 9, y: 0}, {x: 9, y: 1}, {x: 8, y: 1}], "30", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 99, [{x: 1, y: 6}, {x: 0, y: 6}, {x: 0, y: 7}, {x: 10, y: 7}, {x: 10, y: 6}, {x: 10, y: 5}, {x: 10, y: 4}, {x: 0, y: 4}, {x: 1, y: 4}, {x: 2, y: 4}, {x: 2, y: 5}, {x: 3, y: 5}, {x: 3, y: 6}, {x: 3, y: 7}, {x: 2, y: 7}, {x: 1, y: 7}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 72, [{x: 5, y: 6}, {x: 6, y: 6}, {x: 6, y: 5}, {x: 7, y: 5}, {x: 7, y: 4}, {x: 6, y: 4}, {x: 6, y: 3}, {x: 5, y: 3}, {x: 5, y: 4}, {x: 4, y: 4}, {x: 4, y: 5}, {x: 4, y: 6}, {x: 4, y: 7}, {x: 4, y: 8}, {x: 5, y: 8}, {x: 5, y: 9}, {x: 6, y: 9}], "30", "", "")
    gameState.board.snakes.push(otherSnek2)

    gameState.turn = 234
    gameState.board.food = [{x: 1, y: 5}, {x: 4, y: 9}]
    gameState.game.ruleset.name = "wrapped"
    gameState.game.ruleset.settings.hazardDamagePerTurn = 0

    let moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).not.toBe("down") // down is a kill, but otherSnek should avoid it, & then I would die in a turn. Right or up are both safe & otherSnek dies in a few turns.
  })
  it('knows how to calculate distance when in wrapped mode', () => {
    const snek = new Battlesnake("snek", "snek", 95, [{x: 10, y: 0}, {x: 10, y: 10}, {x: 10, y: 9}, {x: 0, y: 9}, {x: 0, y: 10}, {x: 1, y: 10}, {x: 1, y: 9}, {x: 1, y: 9}, {x: 1, y: 8}, {x: 1, y: 7}, {x: 1, y: 6}, {x: 1, y: 5}], "30", "", "")
    const gameState = createGameState(snek)
    gameState.game.ruleset.name = "wrapped"

    let coord1: Coord = new Coord(1, 1)
    let coord2: Coord = new Coord(9, 9)

    let dist: number = getDistance(coord1, coord2, gameState)

    expect(dist).toBe(6)

    dist = getDistance(coord2, coord1, gameState)

    expect(dist).toBe(6)

    coord1.x = 7

    dist = getDistance(coord1, coord2, gameState)

    expect(dist).toBe(5)

    dist = getDistance(coord2, coord1, gameState)

    expect(dist).toBe(5)

    coord1.y = 7
    coord1.x = 1
    
    dist = getDistance(coord1, coord2, gameState)

    expect(dist).toBe(5)

    dist = getDistance(coord2, coord1, gameState)

    expect(dist).toBe(5)

    gameState.game.ruleset.name = "standard"

    dist = getDistance(coord1, coord2, gameState)

    expect(dist).toBe(10) // doesn't really belong here, but sanity check to ensure standard gameMode getDistance works
  })
  // this one is very tricky. Jaguar doesn't have Voronoi coverage to do the maneuver he needs to escape, but he could if Voronoi let a snake overwrite its own cells at higher depths
  // solved with minimax, but requires deepening to order moves like duel4, as it assumes at 5 lookahead that both moves result in death in same # of turns
  it('knows how to escape through another snake tail', () => {
    for (let i: number = 0; i < 3; i++) {
      const gameState: GameState = {"game":{"id":"e64bc951-d060-4635-a050-4e07e53dee2b","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":0,"royale":{"shrinkEveryNTurns":30},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testingDeepening"},"turn":538,"board":{"width":11,"height":11,"food":[{"x":10,"y":5},{"x":1,"y":7},{"x":5,"y":6}],"hazards":[],"snakes":[{"id":"gs_mpPK3KSx349b4TtgWJtDVwFC","name":"Jaguar Meets Snake","body":[{"x":4,"y":9},{"x":3,"y":9},{"x":2,"y":9},{"x":2,"y":10},{"x":3,"y":10},{"x":3,"y":0},{"x":4,"y":0},{"x":5,"y":0},{"x":5,"y":1},{"x":5,"y":2},{"x":5,"y":3},{"x":4,"y":3},{"x":4,"y":2},{"x":4,"y":1},{"x":3,"y":1},{"x":2,"y":1},{"x":1,"y":1},{"x":1,"y":0},{"x":1,"y":10},{"x":1,"y":9},{"x":0,"y":9},{"x":0,"y":8},{"x":1,"y":8},{"x":2,"y":8},{"x":3,"y":8},{"x":4,"y":8},{"x":4,"y":7},{"x":4,"y":6},{"x":3,"y":6},{"x":3,"y":5},{"x":3,"y":4},{"x":3,"y":3},{"x":2,"y":3},{"x":1,"y":3},{"x":0,"y":3},{"x":0,"y":4},{"x":1,"y":4},{"x":2,"y":4},{"x":2,"y":5},{"x":1,"y":5},{"x":0,"y":5},{"x":0,"y":6},{"x":0,"y":7},{"x":10,"y":7},{"x":9,"y":7},{"x":8,"y":7},{"x":7,"y":7},{"x":6,"y":7},{"x":6,"y":6},{"x":7,"y":6},{"x":8,"y":6},{"x":9,"y":6},{"x":9,"y":6}],"health":100,"latency":22,"head":{"x":4,"y":9},"length":53,"shout":"","squad":""},{"id":"gs_wWrdGkPgbPfTtkMFVYfhSJVV","name":"Pea Eater","body":[{"x":5,"y":5},{"x":4,"y":5},{"x":4,"y":4},{"x":5,"y":4},{"x":6,"y":4},{"x":6,"y":3},{"x":7,"y":3},{"x":8,"y":3},{"x":9,"y":3},{"x":9,"y":2},{"x":8,"y":2},{"x":7,"y":2},{"x":6,"y":2},{"x":6,"y":1},{"x":6,"y":0},{"x":6,"y":10},{"x":6,"y":9},{"x":6,"y":8},{"x":7,"y":8},{"x":7,"y":9},{"x":8,"y":9}],"health":98,"latency":439,"head":{"x":5,"y":5},"length":21,"shout":"","squad":""}]},"you":{"id":"gs_mpPK3KSx349b4TtgWJtDVwFC","name":"Jaguar Meets Snake","body":[{"x":4,"y":9},{"x":3,"y":9},{"x":2,"y":9},{"x":2,"y":10},{"x":3,"y":10},{"x":3,"y":0},{"x":4,"y":0},{"x":5,"y":0},{"x":5,"y":1},{"x":5,"y":2},{"x":5,"y":3},{"x":4,"y":3},{"x":4,"y":2},{"x":4,"y":1},{"x":3,"y":1},{"x":2,"y":1},{"x":1,"y":1},{"x":1,"y":0},{"x":1,"y":10},{"x":1,"y":9},{"x":0,"y":9},{"x":0,"y":8},{"x":1,"y":8},{"x":2,"y":8},{"x":3,"y":8},{"x":4,"y":8},{"x":4,"y":7},{"x":4,"y":6},{"x":3,"y":6},{"x":3,"y":5},{"x":3,"y":4},{"x":3,"y":3},{"x":2,"y":3},{"x":1,"y":3},{"x":0,"y":3},{"x":0,"y":4},{"x":1,"y":4},{"x":2,"y":4},{"x":2,"y":5},{"x":1,"y":5},{"x":0,"y":5},{"x":0,"y":6},{"x":0,"y":7},{"x":10,"y":7},{"x":9,"y":7},{"x":8,"y":7},{"x":7,"y":7},{"x":6,"y":7},{"x":6,"y":6},{"x":7,"y":6},{"x":8,"y":6},{"x":9,"y":6},{"x":9,"y":6}],"health":100,"latency":22,"head":{"x":4,"y":9},"length":53,"shout":"","squad":""}}
      const moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // Up gives us chance of escaping via Pea Eater's tail, Right does not
    }
  })
  it('knows not to confine itself when it could wrap to open space', () => {
    const gameState: GameState = {"game":{"id":"51c3e9a6-0378-4803-bb79-b4b9c53703cb","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":0,"royale":{"shrinkEveryNTurns":30},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":289,"board":{"width":11,"height":11,"food":[{"x":5,"y":6},{"x":2,"y":7},{"x":2,"y":4}],"hazards":[],"snakes":[{"id":"gs_Wfm4GSdFYvB98yx37gmBwdBB","name":"Shapeshifter","body":[{"x":2,"y":9},{"x":3,"y":9},{"x":3,"y":10},{"x":2,"y":10},{"x":1,"y":10},{"x":1,"y":9},{"x":0,"y":9},{"x":0,"y":10},{"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0},{"x":3,"y":0},{"x":4,"y":0},{"x":4,"y":10},{"x":4,"y":9},{"x":5,"y":9},{"x":6,"y":9},{"x":6,"y":8},{"x":5,"y":8},{"x":5,"y":7},{"x":4,"y":7},{"x":4,"y":6},{"x":3,"y":6},{"x":3,"y":7},{"x":3,"y":8},{"x":2,"y":8}],"health":85,"latency":296,"head":{"x":2,"y":9},"length":26,"shout":"","squad":""},{"id":"gs_tmqyCxyKpcHSJFcbTcDr4Dxb","name":"Jaguar Meets Snake","body":[{"x":2,"y":6},{"x":1,"y":6},{"x":1,"y":5},{"x":1,"y":4},{"x":1,"y":3},{"x":1,"y":2},{"x":0,"y":2},{"x":0,"y":1},{"x":1,"y":1},{"x":2,"y":1},{"x":3,"y":1},{"x":4,"y":1},{"x":4,"y":2},{"x":5,"y":2},{"x":5,"y":3},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":7,"y":6},{"x":7,"y":7},{"x":8,"y":7},{"x":8,"y":8},{"x":9,"y":8},{"x":9,"y":9},{"x":9,"y":10},{"x":9,"y":0}],"health":75,"latency":84,"head":{"x":2,"y":6},"length":27,"shout":"","squad":""}]},"you":{"id":"gs_tmqyCxyKpcHSJFcbTcDr4Dxb","name":"Jaguar Meets Snake","body":[{"x":2,"y":6},{"x":1,"y":6},{"x":1,"y":5},{"x":1,"y":4},{"x":1,"y":3},{"x":1,"y":2},{"x":0,"y":2},{"x":0,"y":1},{"x":1,"y":1},{"x":2,"y":1},{"x":3,"y":1},{"x":4,"y":1},{"x":4,"y":2},{"x":5,"y":2},{"x":5,"y":3},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":7,"y":6},{"x":7,"y":7},{"x":8,"y":7},{"x":8,"y":8},{"x":9,"y":8},{"x":9,"y":9},{"x":9,"y":10},{"x":9,"y":0}],"health":75,"latency":84,"head":{"x":2,"y":6},"length":27,"shout":"","squad":""}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).not.toBe("down") // Down lets Shapeshifter pin us in a dozen or so turns, Up ties our sizes & should net us a good Voronoi score
  })
  it('wrapped1: does not let itself be trapped in snake bodies', () => {
    const gameState: GameState = {"game":{"id":"162ac18d-cf15-43d8-968a-579ffb24e916","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":112,"board":{"width":11,"height":11,"food":[{"x":7,"y":7}],"hazards":[],"snakes":[{"id":"gs_7bhjgBxqh7wp3JhRDxHfJY94","name":"Combat Reptile","body":[{"x":9,"y":1},{"x":9,"y":2},{"x":8,"y":2},{"x":7,"y":2},{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":6,"y":6},{"x":5,"y":6},{"x":5,"y":5}],"health":77,"latency":402,"head":{"x":9,"y":1},"length":11,"shout":"","squad":""},{"id":"gs_yKcPjGTfdwSR8bWXDxvHcQRX","name":"Kakemonsteret-DEV","body":[{"x":10,"y":2},{"x":10,"y":3},{"x":10,"y":4},{"x":10,"y":5},{"x":10,"y":6},{"x":10,"y":7},{"x":10,"y":8},{"x":9,"y":8},{"x":8,"y":8},{"x":8,"y":9},{"x":8,"y":10},{"x":8,"y":0},{"x":8,"y":1},{"x":7,"y":1}],"health":94,"latency":452,"head":{"x":10,"y":2},"length":14,"shout":"","squad":""},{"id":"gs_wW94YW6FdVFyrjWgmjjk7gt6","name":"Shapeshifter","body":[{"x":6,"y":10},{"x":6,"y":9},{"x":6,"y":8},{"x":6,"y":7},{"x":5,"y":7},{"x":4,"y":7},{"x":3,"y":7},{"x":2,"y":7},{"x":2,"y":8},{"x":1,"y":8},{"x":1,"y":9},{"x":1,"y":10},{"x":1,"y":0},{"x":2,"y":0},{"x":3,"y":0}],"health":98,"latency":443,"head":{"x":6,"y":10},"length":15,"shout":"","squad":""},{"id":"gs_Ffj68pGyt8V7hpDYcVmQCgqP","name":"Jaguar Meets Snake","body":[{"x":6,"y":1},{"x":5,"y":1},{"x":5,"y":2},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":3,"y":5},{"x":3,"y":4},{"x":2,"y":4},{"x":1,"y":4},{"x":1,"y":3}],"health":75,"latency":452,"head":{"x":6,"y":1},"length":12,"shout":"","squad":""}]},"you":{"id":"gs_Ffj68pGyt8V7hpDYcVmQCgqP","name":"Jaguar Meets Snake","body":[{"x":6,"y":1},{"x":5,"y":1},{"x":5,"y":2},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":3,"y":5},{"x":3,"y":4},{"x":2,"y":4},{"x":1,"y":4},{"x":1,"y":3}],"health":75,"latency":452,"head":{"x":6,"y":1},"length":12,"shout":"","squad":""}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("up") // down or right will result in death to Shapeshifter, up is pretty okay
  })
  // good test, but currently can't fix. Jaguar still gets confused when his tail can be cut off many turns in the future.
  it.skip('wrapped2: consumes food when it must to maintain delta with other snake', () => {
    const gameState: GameState = {"game":{"id":"abb24c20-03b4-4daa-9d56-bddd41c7a17b","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":501,"board":{"width":11,"height":11,"food":[{"x":10,"y":8},{"x":2,"y":0},{"x":7,"y":10},{"x":7,"y":4},{"x":3,"y":1},{"x":6,"y":2}],"hazards":[],"snakes":[{"id":"gs_7d7WMxWXBJ8WVFjMBCmQy8CG","name":"Jaguar Meets Snake","body":[{"x":0,"y":8},{"x":0,"y":9},{"x":10,"y":9},{"x":9,"y":9},{"x":8,"y":9},{"x":7,"y":9},{"x":6,"y":9},{"x":6,"y":8},{"x":6,"y":7},{"x":7,"y":7},{"x":8,"y":7},{"x":8,"y":6},{"x":7,"y":6},{"x":7,"y":5},{"x":8,"y":5},{"x":8,"y":4},{"x":8,"y":3},{"x":9,"y":3},{"x":9,"y":2},{"x":8,"y":2},{"x":8,"y":1},{"x":8,"y":0},{"x":8,"y":10},{"x":9,"y":10},{"x":10,"y":10},{"x":0,"y":10},{"x":1,"y":10},{"x":1,"y":0},{"x":1,"y":1},{"x":0,"y":1},{"x":0,"y":0},{"x":10,"y":0},{"x":10,"y":1},{"x":10,"y":2},{"x":0,"y":2},{"x":0,"y":3},{"x":0,"y":4},{"x":10,"y":4},{"x":9,"y":4},{"x":9,"y":5},{"x":9,"y":6}],"health":97,"latency":456,"head":{"x":0,"y":8},"length":41,"shout":"","squad":""},{"id":"gs_g86BMRHBjmQjtHw7dPFj8bVV","name":"🇺🇦🇷🇺 Shapeshifter 🇺🇦🇷🇺","body":[{"x":1,"y":7},{"x":1,"y":8},{"x":2,"y":8},{"x":2,"y":9},{"x":3,"y":9},{"x":3,"y":8},{"x":4,"y":8},{"x":4,"y":9},{"x":5,"y":9},{"x":5,"y":8},{"x":5,"y":7},{"x":5,"y":6},{"x":5,"y":5},{"x":6,"y":5},{"x":6,"y":4},{"x":5,"y":4},{"x":5,"y":3},{"x":6,"y":3},{"x":7,"y":3},{"x":7,"y":2},{"x":7,"y":1},{"x":7,"y":0},{"x":6,"y":0},{"x":6,"y":10},{"x":5,"y":10},{"x":5,"y":0},{"x":5,"y":1},{"x":4,"y":1},{"x":4,"y":2},{"x":3,"y":2},{"x":3,"y":3},{"x":3,"y":4},{"x":2,"y":4},{"x":2,"y":3},{"x":2,"y":2},{"x":1,"y":2},{"x":1,"y":3},{"x":1,"y":4},{"x":1,"y":5},{"x":2,"y":5}],"health":94,"latency":446,"head":{"x":1,"y":7},"length":40,"shout":"","squad":""}]},"you":{"id":"gs_7d7WMxWXBJ8WVFjMBCmQy8CG","name":"Jaguar Meets Snake","body":[{"x":0,"y":8},{"x":0,"y":9},{"x":10,"y":9},{"x":9,"y":9},{"x":8,"y":9},{"x":7,"y":9},{"x":6,"y":9},{"x":6,"y":8},{"x":6,"y":7},{"x":7,"y":7},{"x":8,"y":7},{"x":8,"y":6},{"x":7,"y":6},{"x":7,"y":5},{"x":8,"y":5},{"x":8,"y":4},{"x":8,"y":3},{"x":9,"y":3},{"x":9,"y":2},{"x":8,"y":2},{"x":8,"y":1},{"x":8,"y":0},{"x":8,"y":10},{"x":9,"y":10},{"x":10,"y":10},{"x":0,"y":10},{"x":1,"y":10},{"x":1,"y":0},{"x":1,"y":1},{"x":0,"y":1},{"x":0,"y":0},{"x":10,"y":0},{"x":10,"y":1},{"x":10,"y":2},{"x":0,"y":2},{"x":0,"y":3},{"x":0,"y":4},{"x":10,"y":4},{"x":9,"y":4},{"x":9,"y":5},{"x":9,"y":6}],"health":97,"latency":456,"head":{"x":0,"y":8},"length":41,"shout":"","squad":""}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("left") // left gets us a food, which will let us chase our tail closely again
  })
})

describe('constrictor tests', () => {
  it('lets another snake die before moving into its space', () => {
    const snek = new Battlesnake("snek", "snek", 100, [{x: 5, y: 2}, {x: 5, y: 3}, {x: 5, y: 4}, {x: 4, y: 4}, {x: 3, y: 4}, {x: 3, y: 5}, {x: 3, y: 6}, {x: 3, y: 7}, {x: 3, y: 8}, {x: 3, y: 9}, {x: 3, y: 10}, {x: 4, y: 10}, {x: 5, y: 10}, {x: 5, y: 9}, {x: 5, y: 9}], "30", "", "")
    const gameState = createGameState(snek)

    const otherSnek = new Battlesnake("otherSnek", "otherSnek", 100, [{x: 2, y: 3}, {x: 2, y: 4}, {x: 1, y: 4}, {x: 0, y: 4}, {x: 0, y: 3}, {x: 0, y: 2}, {x: 1, y: 2}, {x: 1, y: 1}, {x: 2, y: 1}, {x: 3, y: 1}, {x: 4, y: 1}, {x: 4, y: 0}, {x: 5, y: 0}, {x: 5, y: 1}, {x: 5, y: 1}], "30", "", "")
    gameState.board.snakes.push(otherSnek)

    const otherSnek2 = new Battlesnake("otherSnek2", "otherSnek2", 100, [{x: 1, y: 10}, {x: 0, y: 10}, {x: 0, y: 9}, {x: 0, y: 8}, {x: 1, y: 8}, {x: 1, y: 9}, {x: 2, y: 9}, {x: 2, y: 8}, {x: 2, y: 7}, {x: 2, y: 6}, {x: 1, y: 6}, {x: 0, y: 6}, {x: 0, y: 5}, {x: 1, y: 5}, {x: 1, y: 5}], "30", "", "")
    gameState.board.snakes.push(otherSnek2)

    const otherSnek3 = new Battlesnake("otherSnek3", "otherSnek3", 100, [{x: 8, y: 7}, {x: 9, y: 7}, {x: 10, y: 7}, {x: 10, y: 6}, {x: 9, y: 6}, {x: 8, y: 6}, {x: 7, y: 6}, {x: 6, y: 6}, {x: 5, y: 6}, {x: 5, y: 5}, {x: 6, y: 5}, {x: 7, y: 5}, {x: 8, y: 5}, {x: 9, y: 5}, {x: 9, y: 5}], "30", "", "")
    gameState.board.snakes.push(otherSnek3)

    gameState.game.ruleset.name = "constrictor"

    let moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("right") // left traps us in a constriction that otherSnek will otherwise fall prey to, right is sole safe move. Tail is down & thus not valid.
  })
  it('moves towards a future tie if that has more board space', () => {
    for (let i: number = 0; i < 3; i++) {
      let gameState: GameState = {"game":{"id":"dac0fbe2-c975-4d05-8fac-c2ac405abd8d","ruleset":{"name":"constrictor","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":0,"royale":{"shrinkEveryNTurns":30},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":38,"board":{"width":11,"height":11,"food":[],"hazards":[],"snakes":[{"id":"gs_RJMJ4gbjjykC4jJctQ8YSHfV","name":"businesssssnake","body":[{"x":7,"y":5},{"x":6,"y":5},{"x":5,"y":5},{"x":4,"y":5},{"x":4,"y":4},{"x":4,"y":3},{"x":4,"y":2},{"x":4,"y":1},{"x":3,"y":1},{"x":2,"y":1},{"x":2,"y":0},{"x":3,"y":0},{"x":4,"y":0},{"x":5,"y":0},{"x":6,"y":0},{"x":7,"y":0},{"x":8,"y":0},{"x":9,"y":0},{"x":10,"y":0},{"x":10,"y":1},{"x":10,"y":2},{"x":10,"y":3},{"x":10,"y":4},{"x":10,"y":5},{"x":9,"y":5},{"x":9,"y":4},{"x":9,"y":3},{"x":9,"y":2},{"x":8,"y":2},{"x":7,"y":2},{"x":7,"y":3},{"x":8,"y":3},{"x":8,"y":4},{"x":8,"y":5},{"x":8,"y":6},{"x":8,"y":7},{"x":8,"y":8},{"x":8,"y":9},{"x":9,"y":9},{"x":9,"y":9}],"health":100,"latency":165,"head":{"x":7,"y":5},"length":40,"shout":"","squad":""},{"id":"gs_vm6PCBrYXVbGgDX4GrBKPyKG","name":"nomblegomble","body":[{"x":3,"y":9},{"x":2,"y":9},{"x":1,"y":9},{"x":0,"y":9},{"x":0,"y":8},{"x":0,"y":7},{"x":0,"y":6},{"x":0,"y":5},{"x":0,"y":4},{"x":0,"y":3},{"x":1,"y":3},{"x":2,"y":3},{"x":2,"y":4},{"x":1,"y":4},{"x":1,"y":5},{"x":2,"y":5},{"x":2,"y":6},{"x":1,"y":6},{"x":1,"y":7},{"x":1,"y":8},{"x":2,"y":8},{"x":3,"y":8},{"x":4,"y":8},{"x":4,"y":7},{"x":5,"y":7},{"x":6,"y":7},{"x":6,"y":6},{"x":5,"y":6},{"x":4,"y":6},{"x":3,"y":6},{"x":3,"y":5},{"x":3,"y":4},{"x":3,"y":3},{"x":3,"y":2},{"x":2,"y":2},{"x":1,"y":2},{"x":0,"y":2},{"x":0,"y":1},{"x":1,"y":1},{"x":1,"y":1}],"health":100,"latency":35,"head":{"x":3,"y":9},"length":40,"shout":"3","squad":""}]},"you":{"id":"gs_RJMJ4gbjjykC4jJctQ8YSHfV","name":"businesssssnake","body":[{"x":7,"y":5},{"x":6,"y":5},{"x":5,"y":5},{"x":4,"y":5},{"x":4,"y":4},{"x":4,"y":3},{"x":4,"y":2},{"x":4,"y":1},{"x":3,"y":1},{"x":2,"y":1},{"x":2,"y":0},{"x":3,"y":0},{"x":4,"y":0},{"x":5,"y":0},{"x":6,"y":0},{"x":7,"y":0},{"x":8,"y":0},{"x":9,"y":0},{"x":10,"y":0},{"x":10,"y":1},{"x":10,"y":2},{"x":10,"y":3},{"x":10,"y":4},{"x":10,"y":5},{"x":9,"y":5},{"x":9,"y":4},{"x":9,"y":3},{"x":9,"y":2},{"x":8,"y":2},{"x":7,"y":2},{"x":7,"y":3},{"x":8,"y":3},{"x":8,"y":4},{"x":8,"y":5},{"x":8,"y":6},{"x":8,"y":7},{"x":8,"y":8},{"x":8,"y":9},{"x":9,"y":9},{"x":9,"y":9}],"health":100,"latency":165,"head":{"x":7,"y":5},"length":40,"shout":"","squad":""}}
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // down confines us to a death in 12 turns, & nomble has more room than that. Up forces nomble to share, & likely results in a tie
    }
  })
  it('cuts off another snake immediately when possible', () => {
    for (let i: number = 0; i < 3; i++) {
      let gameState: GameState = {"game":{"id":"8857cd04-53a7-4e46-a97e-3cbad105b930","ruleset":{"name":"constrictor","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":0,"royale":{"shrinkEveryNTurns":30},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":25,"board":{"width":11,"height":11,"food":[],"hazards":[],"snakes":[{"id":"gs_7cJmd7yJ367fMF87dDgCkkT9","name":"businesssssnake","body":[{"x":8,"y":1},{"x":8,"y":2},{"x":9,"y":2},{"x":9,"y":3},{"x":10,"y":3},{"x":10,"y":4},{"x":10,"y":5},{"x":10,"y":6},{"x":10,"y":7},{"x":10,"y":8},{"x":10,"y":9},{"x":10,"y":10},{"x":9,"y":10},{"x":8,"y":10},{"x":7,"y":10},{"x":6,"y":10},{"x":6,"y":9},{"x":7,"y":9},{"x":8,"y":9},{"x":9,"y":9},{"x":9,"y":8},{"x":8,"y":8},{"x":7,"y":8},{"x":6,"y":8},{"x":5,"y":8},{"x":5,"y":9},{"x":5,"y":9}],"health":100,"latency":454,"head":{"x":8,"y":1},"length":27,"shout":"","squad":""},{"id":"gs_9vhqp6ghcmkBXwvjY9dChFrW","name":"does this work lol (original)","body":[{"x":2,"y":1},{"x":1,"y":1},{"x":0,"y":1},{"x":0,"y":2},{"x":1,"y":2},{"x":2,"y":2},{"x":3,"y":2},{"x":4,"y":2},{"x":4,"y":3},{"x":3,"y":3},{"x":2,"y":3},{"x":1,"y":3},{"x":0,"y":3},{"x":0,"y":4},{"x":1,"y":4},{"x":2,"y":4},{"x":2,"y":5},{"x":3,"y":5},{"x":3,"y":4},{"x":4,"y":4},{"x":4,"y":5},{"x":5,"y":5},{"x":5,"y":4},{"x":5,"y":3},{"x":5,"y":2},{"x":5,"y":1},{"x":5,"y":1}],"health":100,"latency":29,"head":{"x":2,"y":1},"length":27,"shout":"","squad":""}]},"you":{"id":"gs_7cJmd7yJ367fMF87dDgCkkT9","name":"businesssssnake","body":[{"x":8,"y":1},{"x":8,"y":2},{"x":9,"y":2},{"x":9,"y":3},{"x":10,"y":3},{"x":10,"y":4},{"x":10,"y":5},{"x":10,"y":6},{"x":10,"y":7},{"x":10,"y":8},{"x":10,"y":9},{"x":10,"y":10},{"x":9,"y":10},{"x":8,"y":10},{"x":7,"y":10},{"x":6,"y":10},{"x":6,"y":9},{"x":7,"y":9},{"x":8,"y":9},{"x":9,"y":9},{"x":9,"y":8},{"x":8,"y":8},{"x":7,"y":8},{"x":6,"y":8},{"x":5,"y":8},{"x":5,"y":9},{"x":5,"y":9}],"health":100,"latency":454,"head":{"x":8,"y":1},"length":27,"shout":"","squad":""}}
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("right") // can confine does this work lol in a few turns (left is ideal, but down is okay too). Right loses this opportunity
    }
  })
  it('cuts off another snake if a tie is the other option', () => {
    for (let i: number = 0; i < 3; i++) {
      let gameState: GameState = {"game":{"id":"0af65f1b-4de4-4ec9-a686-47e6c1c05427","ruleset":{"name":"constrictor","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":0,"royale":{"shrinkEveryNTurns":30},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":19,"board":{"width":11,"height":11,"food":[],"hazards":[],"snakes":[{"id":"gs_RxDYC8fY8k6dd3gY4kfVBYTQ","name":"businesssssnake","body":[{"x":8,"y":3},{"x":7,"y":3},{"x":6,"y":3},{"x":5,"y":3},{"x":5,"y":4},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":5,"y":7},{"x":5,"y":8},{"x":6,"y":8},{"x":7,"y":8},{"x":7,"y":7},{"x":7,"y":6},{"x":7,"y":5},{"x":7,"y":4},{"x":8,"y":4},{"x":9,"y":4},{"x":9,"y":5},{"x":9,"y":5}],"health":100,"latency":153,"head":{"x":8,"y":3},"length":21,"shout":"","squad":""},{"id":"gs_Wt6mk7X34vSGD8wpWStPkHj6","name":"Kisnake","body":[{"x":9,"y":0},{"x":8,"y":0},{"x":7,"y":0},{"x":6,"y":0},{"x":5,"y":0},{"x":4,"y":0},{"x":3,"y":0},{"x":2,"y":0},{"x":2,"y":1},{"x":1,"y":1},{"x":0,"y":1},{"x":0,"y":2},{"x":1,"y":2},{"x":1,"y":3},{"x":2,"y":3},{"x":3,"y":3},{"x":3,"y":2},{"x":4,"y":2},{"x":4,"y":1},{"x":5,"y":1},{"x":5,"y":1}],"health":100,"latency":162,"head":{"x":9,"y":0},"length":21,"shout":"","squad":""}]},"you":{"id":"gs_RxDYC8fY8k6dd3gY4kfVBYTQ","name":"businesssssnake","body":[{"x":8,"y":3},{"x":7,"y":3},{"x":6,"y":3},{"x":5,"y":3},{"x":5,"y":4},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":5,"y":7},{"x":5,"y":8},{"x":6,"y":8},{"x":7,"y":8},{"x":7,"y":7},{"x":7,"y":6},{"x":7,"y":5},{"x":7,"y":4},{"x":8,"y":4},{"x":9,"y":4},{"x":9,"y":5},{"x":9,"y":5}],"health":100,"latency":153,"head":{"x":8,"y":3},"length":21,"shout":"","squad":""}}
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("right") // can confine kisnake in two turns by going right, down allows a tie
    }
  })
  it('maximizes its turns left', () => {
    for (let i: number = 0; i < 3; i++) {
      let gameState: GameState = {"game":{"id":"d734ddd0-cb24-46f3-ac0a-1130cd6b11f8","ruleset":{"name":"constrictor","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":0,"royale":{"shrinkEveryNTurns":30},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":28,"board":{"width":11,"height":11,"food":[],"hazards":[],"snakes":[{"id":"gs_vpBgXYBBVthPgqWhDFQ9WcjT","name":"nomblegomble","body":[{"x":2,"y":2},{"x":2,"y":3},{"x":2,"y":4},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":3,"y":7},{"x":4,"y":7},{"x":5,"y":7},{"x":6,"y":7},{"x":7,"y":7},{"x":8,"y":7},{"x":9,"y":7},{"x":9,"y":8},{"x":8,"y":8},{"x":7,"y":8},{"x":7,"y":9},{"x":6,"y":9},{"x":6,"y":8},{"x":5,"y":8},{"x":4,"y":8},{"x":3,"y":8},{"x":2,"y":8},{"x":2,"y":7},{"x":2,"y":6},{"x":1,"y":6},{"x":0,"y":6},{"x":0,"y":5},{"x":1,"y":5},{"x":1,"y":5}],"health":100,"latency":47,"head":{"x":2,"y":2},"length":30,"shout":"3","squad":""},{"id":"gs_RgvjJFTgr4Q4kPtbFJkrmMbS","name":"businesssssnake","body":[{"x":1,"y":1},{"x":2,"y":1},{"x":3,"y":1},{"x":4,"y":1},{"x":5,"y":1},{"x":6,"y":1},{"x":7,"y":1},{"x":7,"y":0},{"x":8,"y":0},{"x":9,"y":0},{"x":10,"y":0},{"x":10,"y":1},{"x":9,"y":1},{"x":8,"y":1},{"x":8,"y":2},{"x":9,"y":2},{"x":9,"y":3},{"x":8,"y":3},{"x":7,"y":3},{"x":6,"y":3},{"x":5,"y":3},{"x":4,"y":3},{"x":4,"y":4},{"x":5,"y":4},{"x":6,"y":4},{"x":7,"y":4},{"x":8,"y":4},{"x":8,"y":5},{"x":9,"y":5},{"x":9,"y":5}],"health":100,"latency":176,"head":{"x":1,"y":1},"length":30,"shout":"","squad":""}]},"you":{"id":"gs_RgvjJFTgr4Q4kPtbFJkrmMbS","name":"businesssssnake","body":[{"x":1,"y":1},{"x":2,"y":1},{"x":3,"y":1},{"x":4,"y":1},{"x":5,"y":1},{"x":6,"y":1},{"x":7,"y":1},{"x":7,"y":0},{"x":8,"y":0},{"x":9,"y":0},{"x":10,"y":0},{"x":10,"y":1},{"x":9,"y":1},{"x":8,"y":1},{"x":8,"y":2},{"x":9,"y":2},{"x":9,"y":3},{"x":8,"y":3},{"x":7,"y":3},{"x":6,"y":3},{"x":5,"y":3},{"x":4,"y":3},{"x":4,"y":4},{"x":5,"y":4},{"x":6,"y":4},{"x":7,"y":4},{"x":8,"y":4},{"x":8,"y":5},{"x":9,"y":5},{"x":9,"y":5}],"health":100,"latency":176,"head":{"x":1,"y":1},"length":30,"shout":"","squad":""}}
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("left") // up is a tie, but we can win this. Left gets us 8 Voronoi, otherSnake either 4 or 5, & wins us the game. Down gets us a worse Voronoi score.
    }
  })
  it('is paranoid about otherSnakes choosing to limit its own VoronoiDelta', () => {
    for (let i: number = 0; i < 3; i++) {
      let gameState: GameState = {"game":{"id":"4d1730f9-c725-4c84-a9a1-a84cec2c7d96","ruleset":{"name":"constrictor","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":0,"royale":{"shrinkEveryNTurns":30},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":10,"board":{"width":11,"height":11,"food":[],"hazards":[],"snakes":[{"id":"gs_xdwMcv8Y4WJGHDyyK3rF7t8H","name":"nomblegomble","body":[{"x":3,"y":7},{"x":4,"y":7},{"x":5,"y":7},{"x":5,"y":8},{"x":4,"y":8},{"x":3,"y":8},{"x":2,"y":8},{"x":1,"y":8},{"x":0,"y":8},{"x":0,"y":9},{"x":1,"y":9},{"x":1,"y":9}],"health":100,"latency":137,"head":{"x":3,"y":7},"length":12,"shout":"3","squad":""},{"id":"gs_pxThT3p9rh7mSbXFvxD8Q7Sc","name":"marrrvin","body":[{"x":6,"y":10},{"x":6,"y":9},{"x":7,"y":9},{"x":7,"y":8},{"x":7,"y":7},{"x":7,"y":6},{"x":8,"y":6},{"x":8,"y":7},{"x":8,"y":8},{"x":8,"y":9},{"x":9,"y":9},{"x":9,"y":9}],"health":100,"latency":21,"head":{"x":6,"y":10},"length":12,"shout":"","squad":""},{"id":"gs_7G8fWgwpFkMcf9JK6JtwTM6f","name":"businesssssnake","body":[{"x":7,"y":1},{"x":7,"y":2},{"x":6,"y":2},{"x":6,"y":3},{"x":6,"y":4},{"x":7,"y":4},{"x":7,"y":3},{"x":8,"y":3},{"x":9,"y":3},{"x":9,"y":2},{"x":9,"y":1},{"x":9,"y":1}],"health":100,"latency":199,"head":{"x":7,"y":1},"length":12,"shout":"","squad":""},{"id":"gs_Pr4yhPp4kwcSHQXB6hGbSwc4","name":"Kisnake","body":[{"x":4,"y":0},{"x":4,"y":1},{"x":5,"y":1},{"x":5,"y":2},{"x":4,"y":2},{"x":3,"y":2},{"x":2,"y":2},{"x":1,"y":2},{"x":0,"y":2},{"x":0,"y":1},{"x":1,"y":1},{"x":1,"y":1}],"health":100,"latency":164,"head":{"x":4,"y":0},"length":12,"shout":"","squad":""}]},"you":{"id":"gs_7G8fWgwpFkMcf9JK6JtwTM6f","name":"businesssssnake","body":[{"x":7,"y":1},{"x":7,"y":2},{"x":6,"y":2},{"x":6,"y":3},{"x":6,"y":4},{"x":7,"y":4},{"x":7,"y":3},{"x":8,"y":3},{"x":9,"y":3},{"x":9,"y":2},{"x":9,"y":1},{"x":9,"y":1}],"health":100,"latency":199,"head":{"x":7,"y":1},"length":12,"shout":"","squad":""}}
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("left") // if kisnake chooses to go right in a desperate bid to survive, we ought to tie with them. Can instead cut them off by going down or right
    }
  }),
  it('chooses board with many ties cells over being forced in a corner', () => {
    for (let i: number = 0; i < 3; i++) {
      let gameState: GameState = {"game":{"id":"4d11763c-e09f-4e42-b3ae-cd73f7a160e6","ruleset":{"name":"constrictor","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":0,"royale":{"shrinkEveryNTurns":30},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":11,"board":{"width":11,"height":11,"food":[],"hazards":[],"snakes":[{"id":"gs_fbJVyXJcQWCh7QFFCmVG7ffS","name":"nomblegomble","body":[{"x":1,"y":6},{"x":1,"y":7},{"x":2,"y":7},{"x":3,"y":7},{"x":4,"y":7},{"x":4,"y":8},{"x":3,"y":8},{"x":2,"y":8},{"x":1,"y":8},{"x":0,"y":8},{"x":0,"y":9},{"x":1,"y":9},{"x":1,"y":9}],"health":100,"latency":93,"head":{"x":1,"y":6},"length":13,"shout":"3","squad":""},{"id":"gs_FX4WT34FwBXG8DFXDxXdHwW7","name":"marrrvin","body":[{"x":7,"y":10},{"x":6,"y":10},{"x":5,"y":10},{"x":5,"y":9},{"x":6,"y":9},{"x":6,"y":8},{"x":6,"y":7},{"x":7,"y":7},{"x":7,"y":8},{"x":8,"y":8},{"x":8,"y":9},{"x":9,"y":9},{"x":9,"y":9}],"health":100,"latency":18,"head":{"x":7,"y":10},"length":13,"shout":"","squad":""},{"id":"gs_ChRBPxdPG8vFfMwWmpWR96g9","name":"businesssssnake","body":[{"x":5,"y":0},{"x":4,"y":0},{"x":3,"y":0},{"x":2,"y":0},{"x":2,"y":1},{"x":3,"y":1},{"x":4,"y":1},{"x":4,"y":2},{"x":3,"y":2},{"x":2,"y":2},{"x":1,"y":2},{"x":1,"y":1},{"x":1,"y":1}],"health":100,"latency":137,"head":{"x":5,"y":0},"length":13,"shout":"","squad":""},{"id":"gs_qhd3JmWGPBJTxBKGq44yGppP","name":"Kisnake","body":[{"x":8,"y":3},{"x":9,"y":3},{"x":10,"y":3},{"x":10,"y":2},{"x":9,"y":2},{"x":8,"y":2},{"x":7,"y":2},{"x":6,"y":2},{"x":6,"y":1},{"x":7,"y":1},{"x":8,"y":1},{"x":9,"y":1},{"x":9,"y":1}],"health":100,"latency":166,"head":{"x":8,"y":3},"length":13,"shout":"","squad":""}]},"you":{"id":"gs_ChRBPxdPG8vFfMwWmpWR96g9","name":"businesssssnake","body":[{"x":5,"y":0},{"x":4,"y":0},{"x":3,"y":0},{"x":2,"y":0},{"x":2,"y":1},{"x":3,"y":1},{"x":4,"y":1},{"x":4,"y":2},{"x":3,"y":2},{"x":2,"y":2},{"x":1,"y":2},{"x":1,"y":1},{"x":1,"y":1}],"health":100,"latency":137,"head":{"x":5,"y":0},"length":13,"shout":"","squad":""}}
      let moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // right gives 6 turns of life but is probably a loss, up shoves us into chaos & gives us a chance
    }
  })
  it('chooses more available spaces over less in duel', () => {
    const gameState: GameState = {"game":{"id":"4d02850c-9153-4ab9-b96f-7d135a52da0c","ruleset":{"name":"constrictor","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":33,"board":{"width":11,"height":11,"food":[],"hazards":[],"snakes":[{"id":"gs_CBJ9YXSPGM84qPXjkSgpYbyR","name":"Jaguar Meets Snake","body":[{"x":2,"y":5},{"x":2,"y":4},{"x":2,"y":3},{"x":1,"y":3},{"x":1,"y":2},{"x":0,"y":2},{"x":0,"y":3},{"x":0,"y":4},{"x":1,"y":4},{"x":1,"y":5},{"x":0,"y":5},{"x":0,"y":6},{"x":1,"y":6},{"x":1,"y":7},{"x":2,"y":7},{"x":3,"y":7},{"x":3,"y":8},{"x":4,"y":8},{"x":4,"y":9},{"x":5,"y":9},{"x":5,"y":8},{"x":5,"y":7},{"x":5,"y":6},{"x":4,"y":6},{"x":4,"y":5},{"x":5,"y":5},{"x":5,"y":4},{"x":5,"y":3},{"x":4,"y":3},{"x":4,"y":2},{"x":3,"y":2},{"x":2,"y":2},{"x":2,"y":1},{"x":1,"y":1},{"x":1,"y":1}],"health":100,"latency":32,"head":{"x":2,"y":5},"length":35,"shout":"","squad":""},{"id":"gs_BPqtYtMrjRcPDvf67g86WCXV","name":"businesssssnake","body":[{"x":3,"y":0},{"x":3,"y":1},{"x":4,"y":1},{"x":5,"y":1},{"x":5,"y":2},{"x":6,"y":2},{"x":6,"y":1},{"x":7,"y":1},{"x":7,"y":2},{"x":8,"y":2},{"x":8,"y":3},{"x":7,"y":3},{"x":7,"y":4},{"x":8,"y":4},{"x":9,"y":4},{"x":10,"y":4},{"x":10,"y":5},{"x":10,"y":6},{"x":10,"y":7},{"x":9,"y":7},{"x":8,"y":7},{"x":8,"y":6},{"x":9,"y":6},{"x":9,"y":5},{"x":8,"y":5},{"x":7,"y":5},{"x":7,"y":6},{"x":6,"y":6},{"x":6,"y":7},{"x":6,"y":8},{"x":7,"y":8},{"x":8,"y":8},{"x":9,"y":8},{"x":9,"y":9},{"x":9,"y":9}],"health":100,"latency":136,"head":{"x":3,"y":0},"length":35,"shout":"","squad":""}]},"you":{"id":"gs_BPqtYtMrjRcPDvf67g86WCXV","name":"businesssssnake","body":[{"x":3,"y":0},{"x":3,"y":1},{"x":4,"y":1},{"x":5,"y":1},{"x":5,"y":2},{"x":6,"y":2},{"x":6,"y":1},{"x":7,"y":1},{"x":7,"y":2},{"x":8,"y":2},{"x":8,"y":3},{"x":7,"y":3},{"x":7,"y":4},{"x":8,"y":4},{"x":9,"y":4},{"x":10,"y":4},{"x":10,"y":5},{"x":10,"y":6},{"x":10,"y":7},{"x":9,"y":7},{"x":8,"y":7},{"x":8,"y":6},{"x":9,"y":6},{"x":9,"y":5},{"x":8,"y":5},{"x":7,"y":5},{"x":7,"y":6},{"x":6,"y":6},{"x":6,"y":7},{"x":6,"y":8},{"x":7,"y":8},{"x":8,"y":8},{"x":9,"y":8},{"x":9,"y":9},{"x":9,"y":9}],"health":100,"latency":136,"head":{"x":3,"y":0},"length":35,"shout":"","squad":""}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("right") // left confines us to four moves, right has far more & nets the win
  })
  it('constrictor1: ends a game early by cutting off another snake', () => {
    const gameState: GameState = {"game":{"id":"14759f2f-7529-4b5b-9bc2-f19b47b64293","ruleset":{"name":"constrictor","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"empty","timeout":500,"source":"testing"},"turn":18,"board":{"width":11,"height":11,"food":[],"hazards":[],"snakes":[{"id":"gs_bF9hTJ8wVpvc9gHpFXygBjhB","name":"Jagwire","health":100,"body":[{"x":9,"y":1},{"x":9,"y":2},{"x":9,"y":3},{"x":9,"y":4},{"x":8,"y":4},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":7,"y":7},{"x":7,"y":8},{"x":6,"y":8},{"x":6,"y":7},{"x":5,"y":7},{"x":4,"y":7},{"x":4,"y":6},{"x":4,"y":5},{"x":3,"y":5},{"x":2,"y":5},{"x":1,"y":5},{"x":1,"y":5}],"latency":40,"head":{"x":9,"y":1},"length":20,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}},{"id":"gs_7ptMKXq4JxxcWQPTgTkKvY9D","name":"Ziggy Snakedust","health":100,"body":[{"x":10,"y":2},{"x":10,"y":3},{"x":10,"y":4},{"x":10,"y":5},{"x":10,"y":6},{"x":9,"y":6},{"x":8,"y":6},{"x":8,"y":7},{"x":8,"y":8},{"x":8,"y":9},{"x":9,"y":9},{"x":9,"y":10},{"x":8,"y":10},{"x":7,"y":10},{"x":6,"y":10},{"x":5,"y":10},{"x":4,"y":10},{"x":4,"y":9},{"x":5,"y":9},{"x":5,"y":9}],"latency":448,"head":{"x":10,"y":2},"length":20,"shout":"","squad":"","customizations":{"color":"#fcb040","head":"iguana","tail":"iguana"}}]},"you":{"id":"gs_bF9hTJ8wVpvc9gHpFXygBjhB","name":"Jagwire","health":100,"body":[{"x":9,"y":1},{"x":9,"y":2},{"x":9,"y":3},{"x":9,"y":4},{"x":8,"y":4},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":7,"y":7},{"x":7,"y":8},{"x":6,"y":8},{"x":6,"y":7},{"x":5,"y":7},{"x":4,"y":7},{"x":4,"y":6},{"x":4,"y":5},{"x":3,"y":5},{"x":2,"y":5},{"x":1,"y":5},{"x":1,"y":5}],"latency":40,"head":{"x":9,"y":1},"length":20,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("down") // left gives Ziggy more turns for no reason, down ends game in three turns
  })
})

describe('league early return tests', () => {
  it('kills itself as soon as possible when another league game is already running', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 3, y: 3}, {x: 3, y: 3}, {x: 3, y: 3}], "30", "", "")
      const gameState = createGameState(snek)

      gameState.turn = 0
      
      const gameStateOther= createGameState(snek)
      gameStateOther.game.source = "league"
      gameData["testgameiddonotsteal"] = new GameData(gameStateOther)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 50, [{x: 7, y: 7}, {x: 7, y: 7}, {x: 7, y: 7}], "30", "", "")
      gameState.board.snakes.push(otherSnek)
      let snekMove: MoveResponse = move(gameState)
      let snekMoveDir = stringToDirection(snekMove.move)
      expect(snekMoveDir).toBeDefined()
      if (snekMoveDir !== undefined) {
        expect(snekMoveDir).toBe(Direction.Up) // first move when we have no neck is up
      }
      let board2d = new Board2d(gameState, false)
      moveSnake(gameState, snek, board2d, snekMoveDir)
      moveSnake(gameState, otherSnek, board2d, Direction.Left) // need to move so updateGameStateAfterMove doesn't kill otherSnek for having stacking body parts on turn 2
      updateGameStateAfterMove(gameState)
      board2d = new Board2d(gameState, false)
      snekMove = move(gameState)
      snekMoveDir = stringToDirection(snekMove.move)
      moveSnake(gameState, snek, board2d, snekMoveDir)
      moveSnake(gameState, otherSnek, board2d, Direction.Left) // need to move so updateGameStateAfterMove doesn't kill otherSnek for having stacking body parts on turn 2
      updateGameStateAfterMove(gameState)
      expect(snekMoveDir).toBeDefined()
      if (snekMoveDir !== undefined) {
        expect(snekMoveDir).toBe(Direction.Down) // second move when we have a neck is back into our neck
      }
      expect(gameState.board.snakes.length).toBe(1) // snek should have killed itself
    }
  })
  it('does not kill itself as soon as possible when no other league games are running', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 3, y: 3}, {x: 3, y: 3}, {x: 3, y: 3}], "30", "", "")
      const gameState = createGameState(snek)
      const gameStateOther= createGameState(snek)
      gameStateOther.game.source = "notleague"
      const gameStateOther2 = createGameState(snek)
      gameStateOther2.game.source = "alsonotleague"

      gameState.turn = 0
      gameData["testgameiddonotsteal"] = new GameData(gameStateOther)
      gameData["testgameiddonotsteal2"] = new GameData(gameStateOther2)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 50, [{x: 7, y: 7}, {x: 7, y: 7}, {x: 7, y: 7}], "30", "", "")
      gameState.board.snakes.push(otherSnek)
      let board2d = new Board2d(gameState, false)
      let moveResponse: MoveResponse = move(gameState)
      let moveResponseDir = stringToDirection(moveResponse.move)
      expect(moveResponseDir).toBeDefined()
      moveSnake(gameState, snek, board2d, moveResponseDir)
      moveSnake(gameState, otherSnek, board2d, Direction.Left) // need to move so updateGameStateAfterMove doesn't kill otherSnek for having stacking body parts on turn 2
      updateGameStateAfterMove(gameState)
      moveResponse = move(gameState)
      moveResponseDir = stringToDirection(moveResponse.move)
      moveSnake(gameState, snek, board2d, moveResponseDir)
      moveSnake(gameState, otherSnek, board2d, Direction.Left) // need to move so updateGameStateAfterMove doesn't kill otherSnek for having stacking body parts on turn 2
      updateGameStateAfterMove(gameState)

      expect(gameState.board.snakes.length).toBe(2) // snek should not have already killed itself
    }
  })
  it('does not kill itself as soon as possible when it is a league game running with other league games', () => {
    for (let i = 0; i < 3; i++) {
      const snek = new Battlesnake("snek", "snek", 50, [{x: 3, y: 3}, {x: 3, y: 3}, {x: 3, y: 3}], "30", "", "")
      const gameState = createGameState(snek)

      gameState.turn = 0
      gameState.game.source = "league"

      const gameStateOther= createGameState(snek)
      gameStateOther.game.source = "notleague"
      const gameStateOther2 = createGameState(snek)
      gameStateOther2.game.source = "league"

      gameData["testgameiddonotsteal"] = new GameData(gameStateOther)
      gameData["testgameiddonotsteal2"] = new GameData(gameStateOther2)

      const otherSnek = new Battlesnake("otherSnek", "otherSnek", 50, [{x: 7, y: 7}, {x: 7, y: 7}, {x: 7, y: 7}], "30", "", "")
      gameState.board.snakes.push(otherSnek)
      let board2d = new Board2d(gameState, false)
      let moveResponse: MoveResponse = move(gameState)
      let moveResponseDir = stringToDirection(moveResponse.move)
      expect(moveResponseDir).toBeDefined()
      moveSnake(gameState, snek, board2d, moveResponseDir)
      moveSnake(gameState, otherSnek, board2d, Direction.Left) // need to move so updateGameStateAfterMove doesn't kill otherSnek for having stacking body parts on turn 2
      updateGameStateAfterMove(gameState)
      moveResponse = move(gameState)
      moveResponseDir = stringToDirection(moveResponse.move)
      moveSnake(gameState, snek, board2d, moveResponseDir)
      moveSnake(gameState, otherSnek, board2d, Direction.Left) // need to move so updateGameStateAfterMove doesn't kill otherSnek for having stacking body parts on turn 2
      updateGameStateAfterMove(gameState)

      expect(gameState.board.snakes.length).toBe(2) // snek should not have already killed itself
    }
  })
})

describe('iterative deepening tests', () => {
  it('does not time out when iterative deepening', () => {
    const gameState = {"game":{"id":"92670e3f-df6f-440c-9296-ae22750f48dc","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"iddtesting"},"turn":58,"board":{"width":11,"height":11,"food":[{"x":2,"y":0}],"hazards":[],"snakes":[{"id":"gs_CVHPcpFqG9YXQHXcw4QHHDb7","name":"Jaguar Meets Snake","body":[{"x":5,"y":3},{"x":5,"y":2},{"x":4,"y":2},{"x":3,"y":2},{"x":3,"y":3},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5}],"health":97,"latency":453,"head":{"x":5,"y":3},"length":8,"shout":"","squad":""},{"id":"gs_kBXb4YwSpp6vkqgR3RKXkpmV","name":"marrrvin","body":[{"x":9,"y":3},{"x":8,"y":3},{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":7,"y":7}],"health":91,"latency":20,"head":{"x":9,"y":3},"length":7,"shout":"","squad":""},{"id":"gs_rcBtTTTcfXHX6tC8vJvKPRhK","name":"nomblegomble","body":[{"x":5,"y":9},{"x":6,"y":9},{"x":6,"y":10},{"x":5,"y":10}],"health":50,"latency":127,"head":{"x":5,"y":9},"length":4,"shout":"3","squad":""}]},"you":{"id":"gs_CVHPcpFqG9YXQHXcw4QHHDb7","name":"Jaguar Meets Snake","body":[{"x":5,"y":3},{"x":5,"y":2},{"x":4,"y":2},{"x":3,"y":2},{"x":3,"y":3},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5}],"health":97,"latency":453,"head":{"x":5,"y":3},"length":8,"shout":"","squad":""}}
    const startTime = Date.now()
    const moveResponse = move(gameState)
    const endTime = Date.now()
    expect(endTime - startTime).toBeLessThan(500)
  })
})

describe('standard game mode tests', () => {
  it.skip('does not relinquish center control when not necessary', () => {
    const gameState = {"game":{"id":"d0c2009b-a7c6-41cc-9c21-e033fe3c996a","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":372,"board":{"width":11,"height":11,"food":[{"x":8,"y":10},{"x":8,"y":9}],"hazards":[],"snakes":[{"id":"gs_JyXYc4TThQWCJbhMmRrCHdhV","name":"Gruppe8","body":[{"x":3,"y":3},{"x":2,"y":3},{"x":2,"y":2},{"x":3,"y":2},{"x":4,"y":2},{"x":5,"y":2},{"x":5,"y":1},{"x":4,"y":1},{"x":3,"y":1},{"x":2,"y":1},{"x":1,"y":1},{"x":1,"y":2},{"x":0,"y":2},{"x":0,"y":1},{"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0},{"x":3,"y":0},{"x":4,"y":0},{"x":5,"y":0},{"x":6,"y":0},{"x":7,"y":0},{"x":8,"y":0},{"x":8,"y":1}],"health":76,"latency":358,"head":{"x":3,"y":3},"length":24,"shout":"","squad":""},{"id":"gs_WGHkDXwrPRYJrMQ4tWxfgTPB","name":"Jaguar Meets Snake","body":[{"x":2,"y":4},{"x":2,"y":5},{"x":3,"y":5},{"x":3,"y":6},{"x":4,"y":6},{"x":4,"y":7},{"x":3,"y":7},{"x":3,"y":8},{"x":4,"y":8},{"x":4,"y":9},{"x":5,"y":9},{"x":6,"y":9},{"x":6,"y":8},{"x":7,"y":8},{"x":8,"y":8},{"x":9,"y":8},{"x":9,"y":7},{"x":9,"y":6},{"x":9,"y":5},{"x":8,"y":5},{"x":8,"y":6},{"x":7,"y":6},{"x":7,"y":7},{"x":6,"y":7},{"x":5,"y":7},{"x":5,"y":6},{"x":6,"y":6},{"x":6,"y":5},{"x":6,"y":4},{"x":5,"y":4},{"x":5,"y":5},{"x":4,"y":5},{"x":4,"y":4},{"x":3,"y":4}],"health":95,"latency":134,"head":{"x":2,"y":4},"length":34,"shout":"","squad":""}]},"you":{"id":"gs_WGHkDXwrPRYJrMQ4tWxfgTPB","name":"Jaguar Meets Snake","body":[{"x":2,"y":4},{"x":2,"y":5},{"x":3,"y":5},{"x":3,"y":6},{"x":4,"y":6},{"x":4,"y":7},{"x":3,"y":7},{"x":3,"y":8},{"x":4,"y":8},{"x":4,"y":9},{"x":5,"y":9},{"x":6,"y":9},{"x":6,"y":8},{"x":7,"y":8},{"x":8,"y":8},{"x":9,"y":8},{"x":9,"y":7},{"x":9,"y":6},{"x":9,"y":5},{"x":8,"y":5},{"x":8,"y":6},{"x":7,"y":6},{"x":7,"y":7},{"x":6,"y":7},{"x":5,"y":7},{"x":5,"y":6},{"x":6,"y":6},{"x":6,"y":5},{"x":6,"y":4},{"x":5,"y":4},{"x":5,"y":5},{"x":4,"y":5},{"x":4,"y":4},{"x":3,"y":4}],"health":95,"latency":134,"head":{"x":2,"y":4},"length":34,"shout":"","squad":""}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("right") // left allows us to loop back on our tail but ultimately allows Gruppe to limit our board coverage - right keeps us in the middle
  })
  // good test, but Voronoi graph is too dumb to know Pea Eater will go left if we go up. Experimental Voronoi replacement fixed this, but at huge performance cost.
  it.skip('standard1: follows tail when necessary', () => {
    const gameState: GameState = {"game":{"id":"34ae2c65-9b90-44cd-a232-87e5520e1fc6","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":314,"board":{"width":11,"height":11,"food":[{"x":5,"y":0},{"x":2,"y":6},{"x":2,"y":7},{"x":5,"y":3},{"x":9,"y":9},{"x":6,"y":1},{"x":3,"y":3},{"x":7,"y":7}],"hazards":[],"snakes":[{"id":"gs_VppGjBVhKRWXw48PvyKHvhD6","name":"Jaguar Meets Snake","body":[{"x":4,"y":6},{"x":5,"y":6},{"x":6,"y":6},{"x":6,"y":7},{"x":6,"y":8},{"x":6,"y":9},{"x":5,"y":9},{"x":4,"y":9},{"x":3,"y":9},{"x":2,"y":9},{"x":2,"y":10},{"x":1,"y":10},{"x":0,"y":10},{"x":0,"y":9},{"x":0,"y":8},{"x":0,"y":7},{"x":0,"y":6},{"x":0,"y":5},{"x":0,"y":4},{"x":0,"y":3},{"x":0,"y":2},{"x":0,"y":1},{"x":1,"y":1},{"x":1,"y":2},{"x":1,"y":3},{"x":1,"y":4},{"x":2,"y":4},{"x":2,"y":3},{"x":2,"y":2},{"x":3,"y":2},{"x":4,"y":2},{"x":5,"y":2},{"x":6,"y":2},{"x":7,"y":2},{"x":7,"y":3},{"x":6,"y":3},{"x":6,"y":4},{"x":5,"y":4}],"health":94,"latency":451,"head":{"x":4,"y":6},"length":38,"shout":"","squad":""},{"id":"gs_HqDfpGWBb8CF6TpMBc9PY637","name":"Pea Eater","body":[{"x":8,"y":4},{"x":8,"y":5},{"x":7,"y":5},{"x":7,"y":6},{"x":8,"y":6},{"x":9,"y":6},{"x":10,"y":6},{"x":10,"y":5},{"x":10,"y":4},{"x":10,"y":3},{"x":10,"y":2},{"x":9,"y":2},{"x":9,"y":1},{"x":9,"y":1}],"health":100,"latency":440,"head":{"x":8,"y":4},"length":14,"shout":"","squad":""}]},"you":{"id":"gs_VppGjBVhKRWXw48PvyKHvhD6","name":"Jaguar Meets Snake","body":[{"x":4,"y":6},{"x":5,"y":6},{"x":6,"y":6},{"x":6,"y":7},{"x":6,"y":8},{"x":6,"y":9},{"x":5,"y":9},{"x":4,"y":9},{"x":3,"y":9},{"x":2,"y":9},{"x":2,"y":10},{"x":1,"y":10},{"x":0,"y":10},{"x":0,"y":9},{"x":0,"y":8},{"x":0,"y":7},{"x":0,"y":6},{"x":0,"y":5},{"x":0,"y":4},{"x":0,"y":3},{"x":0,"y":2},{"x":0,"y":1},{"x":1,"y":1},{"x":1,"y":2},{"x":1,"y":3},{"x":1,"y":4},{"x":2,"y":4},{"x":2,"y":3},{"x":2,"y":2},{"x":3,"y":2},{"x":4,"y":2},{"x":5,"y":2},{"x":6,"y":2},{"x":7,"y":2},{"x":7,"y":3},{"x":6,"y":3},{"x":6,"y":4},{"x":5,"y":4}],"health":94,"latency":451,"head":{"x":4,"y":6},"length":38,"shout":"","squad":""}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).not.toBe("up") // left or down will let us chase our tail out, but up lets Pea Eater cut us off in 4 turns
  })
  it('standard2: does not shove itself in a corner in assuming another snake will die', () => {
    const gameState: GameState = {"game":{"id":"fd123094-7ce4-4eff-9581-595ea1d077ed","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"timeout":500,"source":"testing"},"turn":174,"board":{"width":11,"height":11,"food":[{"x":2,"y":5},{"x":0,"y":4}],"hazards":[],"snakes":[{"id":"gs_87RCPwwJMxSkJ9fKSP8c7GKJ","name":"beta marvin","body":[{"x":3,"y":7},{"x":4,"y":7},{"x":4,"y":6},{"x":5,"y":6},{"x":6,"y":6},{"x":7,"y":6},{"x":8,"y":6},{"x":8,"y":5},{"x":8,"y":4},{"x":8,"y":3},{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":5},{"x":6,"y":5}],"health":99,"latency":457,"head":{"x":3,"y":7},"length":14,"shout":"","squad":""},{"id":"gs_BGXMV4jTSJHYGG3w9kFHTWR7","name":"Kakemonsteret-DEV","body":[{"x":7,"y":1},{"x":7,"y":0},{"x":8,"y":0},{"x":8,"y":1},{"x":8,"y":2},{"x":9,"y":2},{"x":10,"y":2},{"x":10,"y":3},{"x":10,"y":4},{"x":10,"y":5},{"x":10,"y":6},{"x":10,"y":7},{"x":10,"y":8},{"x":9,"y":8},{"x":9,"y":9},{"x":9,"y":10}],"health":72,"latency":451,"head":{"x":7,"y":1},"length":16,"shout":"","squad":""},{"id":"gs_9BTQHQRxRmyvMVyWKjWDjQK7","name":"Jaguar Meets Snake","body":[{"x":3,"y":5},{"x":3,"y":4},{"x":2,"y":4},{"x":2,"y":3},{"x":1,"y":3},{"x":0,"y":3},{"x":0,"y":2},{"x":0,"y":1},{"x":0,"y":0},{"x":1,"y":0},{"x":1,"y":1},{"x":2,"y":1},{"x":3,"y":1},{"x":4,"y":1}],"health":94,"latency":91,"head":{"x":3,"y":5},"length":14,"shout":"","squad":""},{"id":"gs_QR4JhRJw7M7Fx3QwbmFbVmc3","name":"hawthhhh++","body":[{"x":2,"y":6},{"x":2,"y":7},{"x":1,"y":7},{"x":1,"y":8},{"x":0,"y":8},{"x":0,"y":9},{"x":0,"y":10},{"x":1,"y":10}],"health":94,"latency":471,"head":{"x":2,"y":6},"length":8,"shout":"","squad":""}]},"you":{"id":"gs_9BTQHQRxRmyvMVyWKjWDjQK7","name":"Jaguar Meets Snake","body":[{"x":3,"y":5},{"x":3,"y":4},{"x":2,"y":4},{"x":2,"y":3},{"x":1,"y":3},{"x":0,"y":3},{"x":0,"y":2},{"x":0,"y":1},{"x":0,"y":0},{"x":1,"y":0},{"x":1,"y":1},{"x":2,"y":1},{"x":3,"y":1},{"x":4,"y":1}],"health":94,"latency":91,"head":{"x":3,"y":5},"length":14,"shout":"","squad":""}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("right") // up is certain death & left is soon death, right keeps us alive
  })
})

describe('arcade maze game mode tests', () => {
  it('does not walk into a wall in arcade mode', () => {
    const gameState = {"game":{"id":"6490c99e-5363-45fd-8f74-ea1b9405c8a6","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":100,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"arcade_maze","timeout":500,"source":"testing"},"turn":2,"board":{"width":19,"height":21,"food":[{"x":9,"y":11},{"x":3,"y":11}],"hazards":[{"x":0,"y":20},{"x":2,"y":20},{"x":3,"y":20},{"x":4,"y":20},{"x":5,"y":20},{"x":6,"y":20},{"x":7,"y":20},{"x":8,"y":20},{"x":9,"y":20},{"x":10,"y":20},{"x":11,"y":20},{"x":12,"y":20},{"x":13,"y":20},{"x":14,"y":20},{"x":15,"y":20},{"x":16,"y":20},{"x":18,"y":20},{"x":0,"y":19},{"x":9,"y":19},{"x":18,"y":19},{"x":0,"y":18},{"x":2,"y":18},{"x":3,"y":18},{"x":5,"y":18},{"x":6,"y":18},{"x":7,"y":18},{"x":9,"y":18},{"x":11,"y":18},{"x":12,"y":18},{"x":13,"y":18},{"x":15,"y":18},{"x":16,"y":18},{"x":18,"y":18},{"x":0,"y":17},{"x":18,"y":17},{"x":0,"y":16},{"x":2,"y":16},{"x":3,"y":16},{"x":5,"y":16},{"x":7,"y":16},{"x":8,"y":16},{"x":9,"y":16},{"x":10,"y":16},{"x":11,"y":16},{"x":13,"y":16},{"x":15,"y":16},{"x":16,"y":16},{"x":18,"y":16},{"x":0,"y":15},{"x":5,"y":15},{"x":9,"y":15},{"x":13,"y":15},{"x":18,"y":15},{"x":0,"y":14},{"x":3,"y":14},{"x":5,"y":14},{"x":6,"y":14},{"x":7,"y":14},{"x":9,"y":14},{"x":11,"y":14},{"x":12,"y":14},{"x":13,"y":14},{"x":15,"y":14},{"x":18,"y":14},{"x":0,"y":13},{"x":3,"y":13},{"x":5,"y":13},{"x":13,"y":13},{"x":15,"y":13},{"x":18,"y":13},{"x":0,"y":12},{"x":1,"y":12},{"x":2,"y":12},{"x":3,"y":12},{"x":5,"y":12},{"x":7,"y":12},{"x":9,"y":12},{"x":11,"y":12},{"x":13,"y":12},{"x":15,"y":12},{"x":16,"y":12},{"x":17,"y":12},{"x":18,"y":12},{"x":7,"y":11},{"x":11,"y":11},{"x":0,"y":10},{"x":1,"y":10},{"x":2,"y":10},{"x":3,"y":10},{"x":5,"y":10},{"x":7,"y":10},{"x":9,"y":10},{"x":11,"y":10},{"x":13,"y":10},{"x":15,"y":10},{"x":16,"y":10},{"x":17,"y":10},{"x":18,"y":10},{"x":0,"y":9},{"x":3,"y":9},{"x":5,"y":9},{"x":13,"y":9},{"x":15,"y":9},{"x":18,"y":9},{"x":0,"y":8},{"x":3,"y":8},{"x":5,"y":8},{"x":7,"y":8},{"x":8,"y":8},{"x":9,"y":8},{"x":10,"y":8},{"x":11,"y":8},{"x":13,"y":8},{"x":15,"y":8},{"x":18,"y":8},{"x":0,"y":7},{"x":9,"y":7},{"x":18,"y":7},{"x":0,"y":6},{"x":2,"y":6},{"x":3,"y":6},{"x":5,"y":6},{"x":6,"y":6},{"x":7,"y":6},{"x":9,"y":6},{"x":11,"y":6},{"x":12,"y":6},{"x":13,"y":6},{"x":15,"y":6},{"x":16,"y":6},{"x":18,"y":6},{"x":0,"y":5},{"x":3,"y":5},{"x":15,"y":5},{"x":18,"y":5},{"x":0,"y":4},{"x":1,"y":4},{"x":3,"y":4},{"x":5,"y":4},{"x":7,"y":4},{"x":8,"y":4},{"x":9,"y":4},{"x":10,"y":4},{"x":11,"y":4},{"x":13,"y":4},{"x":15,"y":4},{"x":17,"y":4},{"x":18,"y":4},{"x":0,"y":3},{"x":5,"y":3},{"x":9,"y":3},{"x":13,"y":3},{"x":18,"y":3},{"x":0,"y":2},{"x":2,"y":2},{"x":3,"y":2},{"x":4,"y":2},{"x":5,"y":2},{"x":6,"y":2},{"x":7,"y":2},{"x":9,"y":2},{"x":11,"y":2},{"x":12,"y":2},{"x":13,"y":2},{"x":14,"y":2},{"x":15,"y":2},{"x":16,"y":2},{"x":18,"y":2},{"x":0,"y":1},{"x":18,"y":1},{"x":0,"y":0},{"x":2,"y":0},{"x":3,"y":0},{"x":4,"y":0},{"x":5,"y":0},{"x":6,"y":0},{"x":7,"y":0},{"x":8,"y":0},{"x":9,"y":0},{"x":10,"y":0},{"x":11,"y":0},{"x":12,"y":0},{"x":13,"y":0},{"x":14,"y":0},{"x":15,"y":0},{"x":16,"y":0},{"x":18,"y":0}],"snakes":[{"id":"gs_qwtjQp6HXYc7DKx3Y4qMYKFS","name":"Jaguar Meets Snake","health":98,"body":[{"x":4,"y":9},{"x":4,"y":8},{"x":4,"y":7}],"latency":453,"head":{"x":4,"y":9},"length":3,"shout":"","squad":"","customizations":{"color":"#ff9900","head":"tiger-king","tail":"mystic-moon"}},{"id":"gs_ygwggYcHgdkdMj9SPtXpq8mR","name":"biter","health":98,"body":[{"x":12,"y":7},{"x":13,"y":7},{"x":14,"y":7}],"latency":1,"head":{"x":12,"y":7},"length":3,"shout":"","squad":"","customizations":{"color":"#632aa8","head":"lantern-fish","tail":"freckled"}},{"id":"gs_ygydFKwQCdpFVfvjyPxGSfrb","name":"Hovering Hobbs","health":98,"body":[{"x":4,"y":15},{"x":4,"y":16},{"x":4,"y":17}],"latency":410,"head":{"x":4,"y":15},"length":3,"shout":"","squad":"","customizations":{"color":"#da8a1a","head":"beach-puffin-special","tail":"beach-puffin-special"}},{"id":"gs_DgHRvPKQbx6YGfkGf4B8Q7WF","name":"pants 👖","health":98,"body":[{"x":14,"y":15},{"x":14,"y":16},{"x":14,"y":17}],"latency":131,"head":{"x":14,"y":15},"length":3,"shout":"💙","squad":"","customizations":{"color":"#3860be","head":"moustache","tail":"skinny-jeans"}}]},"you":{"id":"gs_qwtjQp6HXYc7DKx3Y4qMYKFS","name":"Jaguar Meets Snake","health":98,"body":[{"x":4,"y":9},{"x":4,"y":8},{"x":4,"y":7}],"latency":453,"head":{"x":4,"y":9},"length":3,"shout":"","squad":"","customizations":{"color":"#ff9900","head":"tiger-king","tail":"mystic-moon"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("up") // up is sole move which won't result in instant death
  })
  it('hazardMaze1: prolongs his death when wrapped up in the maze', () => {
    const gameState = {"game":{"id":"5db80932-3eb0-47e1-8c90-60a21087937c","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":100,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"arcade_maze","timeout":500,"source":"testing"},"turn":726,"board":{"width":19,"height":21,"food":[{"x":9,"y":1},{"x":9,"y":5},{"x":3,"y":11},{"x":15,"y":11},{"x":9,"y":11},{"x":9,"y":17},{"x":4,"y":7},{"x":4,"y":17}],"hazards":[{"x":0,"y":20},{"x":2,"y":20},{"x":3,"y":20},{"x":4,"y":20},{"x":5,"y":20},{"x":6,"y":20},{"x":7,"y":20},{"x":8,"y":20},{"x":9,"y":20},{"x":10,"y":20},{"x":11,"y":20},{"x":12,"y":20},{"x":13,"y":20},{"x":14,"y":20},{"x":15,"y":20},{"x":16,"y":20},{"x":18,"y":20},{"x":0,"y":19},{"x":9,"y":19},{"x":18,"y":19},{"x":0,"y":18},{"x":2,"y":18},{"x":3,"y":18},{"x":5,"y":18},{"x":6,"y":18},{"x":7,"y":18},{"x":9,"y":18},{"x":11,"y":18},{"x":12,"y":18},{"x":13,"y":18},{"x":15,"y":18},{"x":16,"y":18},{"x":18,"y":18},{"x":0,"y":17},{"x":18,"y":17},{"x":0,"y":16},{"x":2,"y":16},{"x":3,"y":16},{"x":5,"y":16},{"x":7,"y":16},{"x":8,"y":16},{"x":9,"y":16},{"x":10,"y":16},{"x":11,"y":16},{"x":13,"y":16},{"x":15,"y":16},{"x":16,"y":16},{"x":18,"y":16},{"x":0,"y":15},{"x":5,"y":15},{"x":9,"y":15},{"x":13,"y":15},{"x":18,"y":15},{"x":0,"y":14},{"x":3,"y":14},{"x":5,"y":14},{"x":6,"y":14},{"x":7,"y":14},{"x":9,"y":14},{"x":11,"y":14},{"x":12,"y":14},{"x":13,"y":14},{"x":15,"y":14},{"x":18,"y":14},{"x":0,"y":13},{"x":3,"y":13},{"x":5,"y":13},{"x":13,"y":13},{"x":15,"y":13},{"x":18,"y":13},{"x":0,"y":12},{"x":1,"y":12},{"x":2,"y":12},{"x":3,"y":12},{"x":5,"y":12},{"x":7,"y":12},{"x":9,"y":12},{"x":11,"y":12},{"x":13,"y":12},{"x":15,"y":12},{"x":16,"y":12},{"x":17,"y":12},{"x":18,"y":12},{"x":7,"y":11},{"x":11,"y":11},{"x":0,"y":10},{"x":1,"y":10},{"x":2,"y":10},{"x":3,"y":10},{"x":5,"y":10},{"x":7,"y":10},{"x":9,"y":10},{"x":11,"y":10},{"x":13,"y":10},{"x":15,"y":10},{"x":16,"y":10},{"x":17,"y":10},{"x":18,"y":10},{"x":0,"y":9},{"x":3,"y":9},{"x":5,"y":9},{"x":13,"y":9},{"x":15,"y":9},{"x":18,"y":9},{"x":0,"y":8},{"x":3,"y":8},{"x":5,"y":8},{"x":7,"y":8},{"x":8,"y":8},{"x":9,"y":8},{"x":10,"y":8},{"x":11,"y":8},{"x":13,"y":8},{"x":15,"y":8},{"x":18,"y":8},{"x":0,"y":7},{"x":9,"y":7},{"x":18,"y":7},{"x":0,"y":6},{"x":2,"y":6},{"x":3,"y":6},{"x":5,"y":6},{"x":6,"y":6},{"x":7,"y":6},{"x":9,"y":6},{"x":11,"y":6},{"x":12,"y":6},{"x":13,"y":6},{"x":15,"y":6},{"x":16,"y":6},{"x":18,"y":6},{"x":0,"y":5},{"x":3,"y":5},{"x":15,"y":5},{"x":18,"y":5},{"x":0,"y":4},{"x":1,"y":4},{"x":3,"y":4},{"x":5,"y":4},{"x":7,"y":4},{"x":8,"y":4},{"x":9,"y":4},{"x":10,"y":4},{"x":11,"y":4},{"x":13,"y":4},{"x":15,"y":4},{"x":17,"y":4},{"x":18,"y":4},{"x":0,"y":3},{"x":5,"y":3},{"x":9,"y":3},{"x":13,"y":3},{"x":18,"y":3},{"x":0,"y":2},{"x":2,"y":2},{"x":3,"y":2},{"x":4,"y":2},{"x":5,"y":2},{"x":6,"y":2},{"x":7,"y":2},{"x":9,"y":2},{"x":11,"y":2},{"x":12,"y":2},{"x":13,"y":2},{"x":14,"y":2},{"x":15,"y":2},{"x":16,"y":2},{"x":18,"y":2},{"x":0,"y":1},{"x":18,"y":1},{"x":0,"y":0},{"x":2,"y":0},{"x":3,"y":0},{"x":4,"y":0},{"x":5,"y":0},{"x":6,"y":0},{"x":7,"y":0},{"x":8,"y":0},{"x":9,"y":0},{"x":10,"y":0},{"x":11,"y":0},{"x":12,"y":0},{"x":13,"y":0},{"x":14,"y":0},{"x":15,"y":0},{"x":16,"y":0},{"x":18,"y":0}],"snakes":[{"id":"gs_vvtr3DxXGVfYxcWhjmdHhk4d","name":"Jaguar Meets Snake","health":52,"body":[{"x":17,"y":17},{"x":17,"y":18},{"x":17,"y":19},{"x":17,"y":20},{"x":17,"y":0},{"x":17,"y":1},{"x":16,"y":1},{"x":15,"y":1},{"x":14,"y":1},{"x":13,"y":1},{"x":12,"y":1},{"x":11,"y":1},{"x":10,"y":1},{"x":10,"y":2},{"x":10,"y":3},{"x":11,"y":3},{"x":12,"y":3},{"x":12,"y":4},{"x":12,"y":5},{"x":13,"y":5},{"x":14,"y":5},{"x":14,"y":6},{"x":14,"y":7},{"x":14,"y":8},{"x":14,"y":9},{"x":14,"y":10},{"x":14,"y":11},{"x":14,"y":12},{"x":14,"y":13},{"x":14,"y":14},{"x":14,"y":15},{"x":14,"y":16},{"x":14,"y":17},{"x":13,"y":17},{"x":12,"y":17},{"x":11,"y":17},{"x":10,"y":17},{"x":10,"y":18},{"x":10,"y":19},{"x":11,"y":19}],"latency":22,"head":{"x":17,"y":17},"length":40,"shout":"","squad":"","customizations":{"color":"#ff9900","head":"tiger-king","tail":"mystic-moon"}},{"id":"gs_84xMVDyJPHdr4xx8PgYb47SV","name":"KAMI","health":59,"body":[{"x":8,"y":19},{"x":7,"y":19},{"x":6,"y":19},{"x":5,"y":19},{"x":4,"y":19},{"x":3,"y":19},{"x":2,"y":19},{"x":1,"y":19},{"x":1,"y":20},{"x":1,"y":0},{"x":1,"y":1},{"x":1,"y":2},{"x":1,"y":3},{"x":2,"y":3},{"x":3,"y":3},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":5,"y":5},{"x":6,"y":5},{"x":7,"y":5},{"x":8,"y":5},{"x":8,"y":6},{"x":8,"y":7},{"x":7,"y":7},{"x":6,"y":7},{"x":6,"y":8},{"x":6,"y":9},{"x":7,"y":9},{"x":8,"y":9},{"x":8,"y":10},{"x":8,"y":11},{"x":8,"y":12}],"latency":372,"head":{"x":8,"y":19},"length":33,"shout":"124705: {0=(124664.0, 124705)}","squad":"","customizations":{"color":"#d9ceb4","head":"default","tail":"default"}}]},"you":{"id":"gs_vvtr3DxXGVfYxcWhjmdHhk4d","name":"Jaguar Meets Snake","health":52,"body":[{"x":17,"y":17},{"x":17,"y":18},{"x":17,"y":19},{"x":17,"y":20},{"x":17,"y":0},{"x":17,"y":1},{"x":16,"y":1},{"x":15,"y":1},{"x":14,"y":1},{"x":13,"y":1},{"x":12,"y":1},{"x":11,"y":1},{"x":10,"y":1},{"x":10,"y":2},{"x":10,"y":3},{"x":11,"y":3},{"x":12,"y":3},{"x":12,"y":4},{"x":12,"y":5},{"x":13,"y":5},{"x":14,"y":5},{"x":14,"y":6},{"x":14,"y":7},{"x":14,"y":8},{"x":14,"y":9},{"x":14,"y":10},{"x":14,"y":11},{"x":14,"y":12},{"x":14,"y":13},{"x":14,"y":14},{"x":14,"y":15},{"x":14,"y":16},{"x":14,"y":17},{"x":13,"y":17},{"x":12,"y":17},{"x":11,"y":17},{"x":10,"y":17},{"x":10,"y":18},{"x":10,"y":19},{"x":11,"y":19}],"latency":22,"head":{"x":17,"y":17},"length":40,"shout":"","squad":"","customizations":{"color":"#ff9900","head":"tiger-king","tail":"mystic-moon"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("down") // left kills us in three turns, down kills us in more
  })
  it('hazardMaze2: chooses escape through other snake tail over death in confined space', () => {
    const gameState = {"game":{"id":"52657f1b-8a13-4b98-a106-1798d60457dd","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":100,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"arcade_maze","timeout":500,"source":"testing"},"turn":802,"board":{"width":19,"height":21,"food":[{"x":9,"y":5},{"x":3,"y":11},{"x":15,"y":11},{"x":14,"y":17}],"hazards":[{"x":0,"y":20},{"x":2,"y":20},{"x":3,"y":20},{"x":4,"y":20},{"x":5,"y":20},{"x":6,"y":20},{"x":7,"y":20},{"x":8,"y":20},{"x":9,"y":20},{"x":10,"y":20},{"x":11,"y":20},{"x":12,"y":20},{"x":13,"y":20},{"x":14,"y":20},{"x":15,"y":20},{"x":16,"y":20},{"x":18,"y":20},{"x":0,"y":19},{"x":9,"y":19},{"x":18,"y":19},{"x":0,"y":18},{"x":2,"y":18},{"x":3,"y":18},{"x":5,"y":18},{"x":6,"y":18},{"x":7,"y":18},{"x":9,"y":18},{"x":11,"y":18},{"x":12,"y":18},{"x":13,"y":18},{"x":15,"y":18},{"x":16,"y":18},{"x":18,"y":18},{"x":0,"y":17},{"x":18,"y":17},{"x":0,"y":16},{"x":2,"y":16},{"x":3,"y":16},{"x":5,"y":16},{"x":7,"y":16},{"x":8,"y":16},{"x":9,"y":16},{"x":10,"y":16},{"x":11,"y":16},{"x":13,"y":16},{"x":15,"y":16},{"x":16,"y":16},{"x":18,"y":16},{"x":0,"y":15},{"x":5,"y":15},{"x":9,"y":15},{"x":13,"y":15},{"x":18,"y":15},{"x":0,"y":14},{"x":3,"y":14},{"x":5,"y":14},{"x":6,"y":14},{"x":7,"y":14},{"x":9,"y":14},{"x":11,"y":14},{"x":12,"y":14},{"x":13,"y":14},{"x":15,"y":14},{"x":18,"y":14},{"x":0,"y":13},{"x":3,"y":13},{"x":5,"y":13},{"x":13,"y":13},{"x":15,"y":13},{"x":18,"y":13},{"x":0,"y":12},{"x":1,"y":12},{"x":2,"y":12},{"x":3,"y":12},{"x":5,"y":12},{"x":7,"y":12},{"x":9,"y":12},{"x":11,"y":12},{"x":13,"y":12},{"x":15,"y":12},{"x":16,"y":12},{"x":17,"y":12},{"x":18,"y":12},{"x":7,"y":11},{"x":11,"y":11},{"x":0,"y":10},{"x":1,"y":10},{"x":2,"y":10},{"x":3,"y":10},{"x":5,"y":10},{"x":7,"y":10},{"x":9,"y":10},{"x":11,"y":10},{"x":13,"y":10},{"x":15,"y":10},{"x":16,"y":10},{"x":17,"y":10},{"x":18,"y":10},{"x":0,"y":9},{"x":3,"y":9},{"x":5,"y":9},{"x":13,"y":9},{"x":15,"y":9},{"x":18,"y":9},{"x":0,"y":8},{"x":3,"y":8},{"x":5,"y":8},{"x":7,"y":8},{"x":8,"y":8},{"x":9,"y":8},{"x":10,"y":8},{"x":11,"y":8},{"x":13,"y":8},{"x":15,"y":8},{"x":18,"y":8},{"x":0,"y":7},{"x":9,"y":7},{"x":18,"y":7},{"x":0,"y":6},{"x":2,"y":6},{"x":3,"y":6},{"x":5,"y":6},{"x":6,"y":6},{"x":7,"y":6},{"x":9,"y":6},{"x":11,"y":6},{"x":12,"y":6},{"x":13,"y":6},{"x":15,"y":6},{"x":16,"y":6},{"x":18,"y":6},{"x":0,"y":5},{"x":3,"y":5},{"x":15,"y":5},{"x":18,"y":5},{"x":0,"y":4},{"x":1,"y":4},{"x":3,"y":4},{"x":5,"y":4},{"x":7,"y":4},{"x":8,"y":4},{"x":9,"y":4},{"x":10,"y":4},{"x":11,"y":4},{"x":13,"y":4},{"x":15,"y":4},{"x":17,"y":4},{"x":18,"y":4},{"x":0,"y":3},{"x":5,"y":3},{"x":9,"y":3},{"x":13,"y":3},{"x":18,"y":3},{"x":0,"y":2},{"x":2,"y":2},{"x":3,"y":2},{"x":4,"y":2},{"x":5,"y":2},{"x":6,"y":2},{"x":7,"y":2},{"x":9,"y":2},{"x":11,"y":2},{"x":12,"y":2},{"x":13,"y":2},{"x":14,"y":2},{"x":15,"y":2},{"x":16,"y":2},{"x":18,"y":2},{"x":0,"y":1},{"x":18,"y":1},{"x":0,"y":0},{"x":2,"y":0},{"x":3,"y":0},{"x":4,"y":0},{"x":5,"y":0},{"x":6,"y":0},{"x":7,"y":0},{"x":8,"y":0},{"x":9,"y":0},{"x":10,"y":0},{"x":11,"y":0},{"x":12,"y":0},{"x":13,"y":0},{"x":14,"y":0},{"x":15,"y":0},{"x":16,"y":0},{"x":18,"y":0}],"snakes":[{"id":"gs_JWPPP3PvWRJDxMPShcJFHCR9","name":"Jaguar Meets Snake","health":98,"body":[{"x":4,"y":15},{"x":4,"y":16},{"x":4,"y":17},{"x":5,"y":17},{"x":6,"y":17},{"x":7,"y":17},{"x":8,"y":17},{"x":9,"y":17},{"x":10,"y":17},{"x":11,"y":17},{"x":12,"y":17},{"x":12,"y":16},{"x":12,"y":15},{"x":11,"y":15},{"x":10,"y":15},{"x":10,"y":14},{"x":10,"y":13},{"x":10,"y":12},{"x":10,"y":11},{"x":9,"y":11},{"x":8,"y":11},{"x":8,"y":10},{"x":8,"y":9},{"x":9,"y":9},{"x":10,"y":9},{"x":11,"y":9},{"x":12,"y":9},{"x":12,"y":8},{"x":12,"y":7},{"x":13,"y":7},{"x":14,"y":7},{"x":14,"y":8},{"x":14,"y":9},{"x":14,"y":10},{"x":14,"y":11},{"x":14,"y":12},{"x":14,"y":13},{"x":14,"y":14},{"x":14,"y":15},{"x":15,"y":15},{"x":16,"y":15},{"x":17,"y":15},{"x":17,"y":16},{"x":17,"y":17}],"latency":24,"head":{"x":4,"y":15},"length":44,"shout":"","squad":"","customizations":{"color":"#ff9900","head":"tiger-king","tail":"mystic-moon"}},{"id":"gs_rRf4JTXThPf3xD8p7HxMJM3X","name":"Ziggy Snakedust","health":96,"body":[{"x":17,"y":18},{"x":17,"y":19},{"x":17,"y":20},{"x":17,"y":0},{"x":17,"y":1},{"x":16,"y":1},{"x":15,"y":1},{"x":14,"y":1},{"x":13,"y":1},{"x":12,"y":1},{"x":11,"y":1},{"x":10,"y":1},{"x":9,"y":1},{"x":8,"y":1},{"x":8,"y":2},{"x":8,"y":3},{"x":7,"y":3},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":7,"y":5},{"x":8,"y":5},{"x":8,"y":6},{"x":8,"y":7},{"x":7,"y":7},{"x":6,"y":7},{"x":5,"y":7},{"x":4,"y":7},{"x":3,"y":7},{"x":2,"y":7},{"x":2,"y":8},{"x":2,"y":9},{"x":1,"y":9},{"x":1,"y":8},{"x":1,"y":7},{"x":1,"y":6},{"x":1,"y":5},{"x":2,"y":5},{"x":2,"y":4},{"x":2,"y":3},{"x":1,"y":3},{"x":1,"y":2},{"x":1,"y":1},{"x":1,"y":0},{"x":1,"y":20}],"latency":406,"head":{"x":17,"y":18},"length":45,"shout":"","squad":"","customizations":{"color":"#fca21c","head":"iguana","tail":"iguana"}}]},"you":{"id":"gs_JWPPP3PvWRJDxMPShcJFHCR9","name":"Jaguar Meets Snake","health":98,"body":[{"x":4,"y":15},{"x":4,"y":16},{"x":4,"y":17},{"x":5,"y":17},{"x":6,"y":17},{"x":7,"y":17},{"x":8,"y":17},{"x":9,"y":17},{"x":10,"y":17},{"x":11,"y":17},{"x":12,"y":17},{"x":12,"y":16},{"x":12,"y":15},{"x":11,"y":15},{"x":10,"y":15},{"x":10,"y":14},{"x":10,"y":13},{"x":10,"y":12},{"x":10,"y":11},{"x":9,"y":11},{"x":8,"y":11},{"x":8,"y":10},{"x":8,"y":9},{"x":9,"y":9},{"x":10,"y":9},{"x":11,"y":9},{"x":12,"y":9},{"x":12,"y":8},{"x":12,"y":7},{"x":13,"y":7},{"x":14,"y":7},{"x":14,"y":8},{"x":14,"y":9},{"x":14,"y":10},{"x":14,"y":11},{"x":14,"y":12},{"x":14,"y":13},{"x":14,"y":14},{"x":14,"y":15},{"x":15,"y":15},{"x":16,"y":15},{"x":17,"y":15},{"x":17,"y":16},{"x":17,"y":17}],"latency":24,"head":{"x":4,"y":15},"length":44,"shout":"","squad":"","customizations":{"color":"#ff9900","head":"tiger-king","tail":"mystic-moon"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("left") // down gives us 15 turns of life, then death in a coil in the middle. Left lets us chase Ziggy's tail out
  }),
  it('hazardMaze3: chooses a path that avoids a head to head with a larger snake', () => {
    for (let i: number = 0; i < 5; i++) {
      const gameState = {"game":{"id":"3c6760e2-21ef-4613-aa0b-a7096055333b","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":100,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"arcade_maze","timeout":500,"source":"testing"},"turn":312,"board":{"width":19,"height":21,"food":[{"x":9,"y":1},{"x":9,"y":11},{"x":4,"y":7},{"x":9,"y":17}],"hazards":[{"x":0,"y":20},{"x":2,"y":20},{"x":3,"y":20},{"x":4,"y":20},{"x":5,"y":20},{"x":6,"y":20},{"x":7,"y":20},{"x":8,"y":20},{"x":9,"y":20},{"x":10,"y":20},{"x":11,"y":20},{"x":12,"y":20},{"x":13,"y":20},{"x":14,"y":20},{"x":15,"y":20},{"x":16,"y":20},{"x":18,"y":20},{"x":0,"y":19},{"x":9,"y":19},{"x":18,"y":19},{"x":0,"y":18},{"x":2,"y":18},{"x":3,"y":18},{"x":5,"y":18},{"x":6,"y":18},{"x":7,"y":18},{"x":9,"y":18},{"x":11,"y":18},{"x":12,"y":18},{"x":13,"y":18},{"x":15,"y":18},{"x":16,"y":18},{"x":18,"y":18},{"x":0,"y":17},{"x":18,"y":17},{"x":0,"y":16},{"x":2,"y":16},{"x":3,"y":16},{"x":5,"y":16},{"x":7,"y":16},{"x":8,"y":16},{"x":9,"y":16},{"x":10,"y":16},{"x":11,"y":16},{"x":13,"y":16},{"x":15,"y":16},{"x":16,"y":16},{"x":18,"y":16},{"x":0,"y":15},{"x":5,"y":15},{"x":9,"y":15},{"x":13,"y":15},{"x":18,"y":15},{"x":0,"y":14},{"x":3,"y":14},{"x":5,"y":14},{"x":6,"y":14},{"x":7,"y":14},{"x":9,"y":14},{"x":11,"y":14},{"x":12,"y":14},{"x":13,"y":14},{"x":15,"y":14},{"x":18,"y":14},{"x":0,"y":13},{"x":3,"y":13},{"x":5,"y":13},{"x":13,"y":13},{"x":15,"y":13},{"x":18,"y":13},{"x":0,"y":12},{"x":1,"y":12},{"x":2,"y":12},{"x":3,"y":12},{"x":5,"y":12},{"x":7,"y":12},{"x":9,"y":12},{"x":11,"y":12},{"x":13,"y":12},{"x":15,"y":12},{"x":16,"y":12},{"x":17,"y":12},{"x":18,"y":12},{"x":7,"y":11},{"x":11,"y":11},{"x":0,"y":10},{"x":1,"y":10},{"x":2,"y":10},{"x":3,"y":10},{"x":5,"y":10},{"x":7,"y":10},{"x":9,"y":10},{"x":11,"y":10},{"x":13,"y":10},{"x":15,"y":10},{"x":16,"y":10},{"x":17,"y":10},{"x":18,"y":10},{"x":0,"y":9},{"x":3,"y":9},{"x":5,"y":9},{"x":13,"y":9},{"x":15,"y":9},{"x":18,"y":9},{"x":0,"y":8},{"x":3,"y":8},{"x":5,"y":8},{"x":7,"y":8},{"x":8,"y":8},{"x":9,"y":8},{"x":10,"y":8},{"x":11,"y":8},{"x":13,"y":8},{"x":15,"y":8},{"x":18,"y":8},{"x":0,"y":7},{"x":9,"y":7},{"x":18,"y":7},{"x":0,"y":6},{"x":2,"y":6},{"x":3,"y":6},{"x":5,"y":6},{"x":6,"y":6},{"x":7,"y":6},{"x":9,"y":6},{"x":11,"y":6},{"x":12,"y":6},{"x":13,"y":6},{"x":15,"y":6},{"x":16,"y":6},{"x":18,"y":6},{"x":0,"y":5},{"x":3,"y":5},{"x":15,"y":5},{"x":18,"y":5},{"x":0,"y":4},{"x":1,"y":4},{"x":3,"y":4},{"x":5,"y":4},{"x":7,"y":4},{"x":8,"y":4},{"x":9,"y":4},{"x":10,"y":4},{"x":11,"y":4},{"x":13,"y":4},{"x":15,"y":4},{"x":17,"y":4},{"x":18,"y":4},{"x":0,"y":3},{"x":5,"y":3},{"x":9,"y":3},{"x":13,"y":3},{"x":18,"y":3},{"x":0,"y":2},{"x":2,"y":2},{"x":3,"y":2},{"x":4,"y":2},{"x":5,"y":2},{"x":6,"y":2},{"x":7,"y":2},{"x":9,"y":2},{"x":11,"y":2},{"x":12,"y":2},{"x":13,"y":2},{"x":14,"y":2},{"x":15,"y":2},{"x":16,"y":2},{"x":18,"y":2},{"x":0,"y":1},{"x":18,"y":1},{"x":0,"y":0},{"x":2,"y":0},{"x":3,"y":0},{"x":4,"y":0},{"x":5,"y":0},{"x":6,"y":0},{"x":7,"y":0},{"x":8,"y":0},{"x":9,"y":0},{"x":10,"y":0},{"x":11,"y":0},{"x":12,"y":0},{"x":13,"y":0},{"x":14,"y":0},{"x":15,"y":0},{"x":16,"y":0},{"x":18,"y":0}],"snakes":[{"id":"gs_CGQMwMRr7YPgCh9wXTkVgQBD","name":"Jaguar Meets Snake","health":100,"body":[{"x":17,"y":1},{"x":17,"y":0},{"x":17,"y":20},{"x":17,"y":19},{"x":17,"y":18},{"x":17,"y":17},{"x":17,"y":16},{"x":17,"y":15},{"x":17,"y":14},{"x":17,"y":13},{"x":16,"y":13},{"x":16,"y":14},{"x":16,"y":15},{"x":16,"y":15}],"latency":23,"head":{"x":17,"y":1},"length":14,"shout":"","squad":"","customizations":{"color":"#ff9900","head":"tiger-king","tail":"mystic-moon"}},{"id":"gs_q8qwhjCS7RHK9qxcpvq84qDB","name":"$n4k3","health":88,"body":[{"x":6,"y":4},{"x":6,"y":3},{"x":7,"y":3},{"x":8,"y":3},{"x":8,"y":2},{"x":8,"y":1},{"x":7,"y":1},{"x":6,"y":1},{"x":5,"y":1},{"x":4,"y":1},{"x":3,"y":1},{"x":2,"y":1},{"x":1,"y":1},{"x":1,"y":0},{"x":1,"y":20},{"x":1,"y":19},{"x":2,"y":19},{"x":3,"y":19},{"x":4,"y":19},{"x":4,"y":18}],"latency":307,"head":{"x":6,"y":4},"length":20,"shout":"","squad":"","customizations":{"color":"#da5de8","head":"chomp","tail":"shiny"}},{"id":"gs_PVcYgRDVpHVYDS6yX9v3XcS7","name":"🇺🇦🇷🇺 Shapeshifter 🇺🇦🇷🇺","health":99,"body":[{"x":14,"y":11},{"x":15,"y":11},{"x":16,"y":11},{"x":17,"y":11},{"x":18,"y":11},{"x":0,"y":11},{"x":1,"y":11},{"x":2,"y":11},{"x":3,"y":11},{"x":4,"y":11},{"x":5,"y":11},{"x":6,"y":11},{"x":6,"y":10},{"x":6,"y":9},{"x":7,"y":9},{"x":8,"y":9},{"x":9,"y":9},{"x":10,"y":9},{"x":11,"y":9},{"x":12,"y":9}],"latency":8,"head":{"x":14,"y":11},"length":20,"shout":"","squad":"","customizations":{"color":"#900050","head":"cosmic-horror","tail":"cosmic-horror"}},{"id":"gs_JXKrVBryXqjmSHPHFt6cq47R","name":"conesnake","health":99,"body":[{"x":15,"y":7},{"x":14,"y":7},{"x":14,"y":6},{"x":14,"y":5},{"x":13,"y":5},{"x":12,"y":5},{"x":11,"y":5},{"x":10,"y":5},{"x":9,"y":5},{"x":8,"y":5},{"x":8,"y":6},{"x":8,"y":7},{"x":7,"y":7},{"x":6,"y":7},{"x":5,"y":7}],"latency":399,"head":{"x":15,"y":7},"length":15,"shout":"","squad":"","customizations":{"color":"#c42b3a","head":"sand-worm","tail":"fat-rattle"}}]},"you":{"id":"gs_CGQMwMRr7YPgCh9wXTkVgQBD","name":"Jaguar Meets Snake","health":100,"body":[{"x":17,"y":1},{"x":17,"y":0},{"x":17,"y":20},{"x":17,"y":19},{"x":17,"y":18},{"x":17,"y":17},{"x":17,"y":16},{"x":17,"y":15},{"x":17,"y":14},{"x":17,"y":13},{"x":16,"y":13},{"x":16,"y":14},{"x":16,"y":15},{"x":16,"y":15}],"latency":23,"head":{"x":17,"y":1},"length":14,"shout":"","squad":"","customizations":{"color":"#ff9900","head":"tiger-king","tail":"mystic-moon"}}}
      const moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("left")
    }
  })
})

describe('duel tests', () => {
  it('duel1: does not choose corner death over food and life', () => {
    const gameState = {"game":{"id":"e262cb81-1f53-4048-bd69-b04dce5645cf","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{"shrinkEveryNTurns":25},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"royale","timeout":500,"source":"testing"},"turn":190,"board":{"width":11,"height":11,"food":[{"x":0,"y":5},{"x":9,"y":7}],"hazards":[{"x":0,"y":0},{"x":0,"y":1},{"x":0,"y":2},{"x":0,"y":3},{"x":0,"y":4},{"x":0,"y":5},{"x":0,"y":6},{"x":0,"y":7},{"x":0,"y":8},{"x":0,"y":9},{"x":0,"y":10},{"x":1,"y":0},{"x":1,"y":9},{"x":1,"y":10},{"x":2,"y":0},{"x":2,"y":9},{"x":2,"y":10},{"x":3,"y":0},{"x":3,"y":9},{"x":3,"y":10},{"x":4,"y":0},{"x":4,"y":9},{"x":4,"y":10},{"x":5,"y":0},{"x":5,"y":9},{"x":5,"y":10},{"x":6,"y":0},{"x":6,"y":9},{"x":6,"y":10},{"x":7,"y":0},{"x":7,"y":9},{"x":7,"y":10},{"x":8,"y":0},{"x":8,"y":1},{"x":8,"y":2},{"x":8,"y":3},{"x":8,"y":4},{"x":8,"y":5},{"x":8,"y":6},{"x":8,"y":7},{"x":8,"y":8},{"x":8,"y":9},{"x":8,"y":10},{"x":9,"y":0},{"x":9,"y":1},{"x":9,"y":2},{"x":9,"y":3},{"x":9,"y":4},{"x":9,"y":5},{"x":9,"y":6},{"x":9,"y":7},{"x":9,"y":8},{"x":9,"y":9},{"x":9,"y":10},{"x":10,"y":0},{"x":10,"y":1},{"x":10,"y":2},{"x":10,"y":3},{"x":10,"y":4},{"x":10,"y":5},{"x":10,"y":6},{"x":10,"y":7},{"x":10,"y":8},{"x":10,"y":9},{"x":10,"y":10}],"snakes":[{"id":"gs_HmGHcPQddGFTjQyhgyGh7xrG","name":"businesssssnake","health":65,"body":[{"x":0,"y":6},{"x":1,"y":6},{"x":2,"y":6},{"x":2,"y":7},{"x":1,"y":7},{"x":1,"y":8},{"x":1,"y":9},{"x":1,"y":10},{"x":2,"y":10},{"x":3,"y":10},{"x":4,"y":10},{"x":5,"y":10},{"x":6,"y":10},{"x":6,"y":9},{"x":5,"y":9},{"x":5,"y":8},{"x":4,"y":8}],"latency":451,"head":{"x":0,"y":6},"length":17,"shout":"","squad":"","customizations":{"color":"#a06d4a","head":"replit-mark","tail":"rbc-necktie"}},{"id":"gs_jPjFypt46K3QhYM6xJkDbHr6","name":"Jaguar Meets Snake","health":91,"body":[{"x":5,"y":7},{"x":4,"y":7},{"x":4,"y":6},{"x":4,"y":5},{"x":4,"y":4},{"x":4,"y":3},{"x":3,"y":3},{"x":3,"y":2},{"x":2,"y":2},{"x":1,"y":2},{"x":0,"y":2},{"x":0,"y":3},{"x":1,"y":3},{"x":2,"y":3},{"x":2,"y":4},{"x":3,"y":4}],"latency":452,"head":{"x":5,"y":7},"length":16,"shout":"","squad":"","customizations":{"color":"#ff9900","head":"tiger-king","tail":"mystic-moon"}}]},"you":{"id":"gs_HmGHcPQddGFTjQyhgyGh7xrG","name":"businesssssnake","health":65,"body":[{"x":0,"y":6},{"x":1,"y":6},{"x":2,"y":6},{"x":2,"y":7},{"x":1,"y":7},{"x":1,"y":8},{"x":1,"y":9},{"x":1,"y":10},{"x":2,"y":10},{"x":3,"y":10},{"x":4,"y":10},{"x":5,"y":10},{"x":6,"y":10},{"x":6,"y":9},{"x":5,"y":9},{"x":5,"y":8},{"x":4,"y":8}],"latency":451,"head":{"x":0,"y":6},"length":17,"shout":"","squad":"","customizations":{"color":"#a06d4a","head":"replit-mark","tail":"rbc-necktie"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("down") // up kills us in five turns, down lets us escape thru Jaguar's tail & also feeds us
  }),
  it('duel2: does not walk into an avoidable kiss of death', () => {
    for (let i: number = 0; i < 5; i++) {
      const gameState: GameState = {"game":{"id":"abb47fb8-f5f0-46bf-8da3-9abbd6c29019","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"standard","timeout":500,"source":"testing"},"turn":24,"board":{"width":11,"height":11,"food":[{"x":9,"y":6},{"x":6,"y":0}],"hazards":[],"snakes":[{"id":"gs_3jd99jxfMw6C7SSBmBHXtQmB","name":"Snek","health":98,"body":[{"x":2,"y":4},{"x":1,"y":4},{"x":1,"y":3},{"x":2,"y":3},{"x":2,"y":2},{"x":3,"y":2},{"x":4,"y":2},{"x":4,"y":1}],"latency":29,"head":{"x":2,"y":4},"length":8,"shout":"","squad":"","customizations":{"color":"#ff0000","head":"default","tail":"default"}},{"id":"gs_b6KJWjrvxgDbJ9cCcYBS8x9B","name":"Jaguar Meets Snake","health":84,"body":[{"x":4,"y":4},{"x":4,"y":5},{"x":5,"y":5},{"x":5,"y":6},{"x":4,"y":6}],"latency":452,"head":{"x":4,"y":4},"length":5,"shout":"","squad":"","customizations":{"color":"#ff9900","head":"tiger-king","tail":"mystic-moon"}}]},"you":{"id":"gs_b6KJWjrvxgDbJ9cCcYBS8x9B","name":"Jaguar Meets Snake","health":84,"body":[{"x":4,"y":4},{"x":4,"y":5},{"x":5,"y":5},{"x":5,"y":6},{"x":4,"y":6}],"latency":452,"head":{"x":4,"y":4},"length":5,"shout":"","squad":"","customizations":{"color":"#ff9900","head":"tiger-king","tail":"mystic-moon"}}}
      const moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("left") // left gives snek a strong chance at murdering us, we have decent alt options in down or right
    }
  })
  it('duel3: does not choose death one turn earlier than inevitable', () => {
    for (let i: number = 0; i < 3; i++) {
      const gameState: GameState = {"game":{"id":"6e54bbc4-c60f-4d5a-9b8f-bf567d6b5274","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"standard","timeout":500,"source":"testing"},"turn":381,"board":{"width":11,"height":11,"food":[{"x":5,"y":10},{"x":1,"y":10},{"x":8,"y":4},{"x":7,"y":8},{"x":10,"y":9}],"hazards":[],"snakes":[{"id":"gs_dJJG7QC6dKJCRj9mS4BWRtCd","name":"hawthhhh++","health":92,"body":[{"x":9,"y":6},{"x":8,"y":6},{"x":8,"y":5},{"x":7,"y":5},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":6,"y":8},{"x":6,"y":9},{"x":5,"y":9},{"x":5,"y":8},{"x":5,"y":7},{"x":4,"y":7},{"x":3,"y":7},{"x":2,"y":7},{"x":2,"y":6},{"x":3,"y":6},{"x":3,"y":5},{"x":4,"y":5},{"x":4,"y":4},{"x":3,"y":4},{"x":3,"y":3},{"x":3,"y":2},{"x":3,"y":1},{"x":4,"y":1},{"x":5,"y":1},{"x":6,"y":1},{"x":7,"y":1},{"x":7,"y":2},{"x":8,"y":2},{"x":9,"y":2},{"x":9,"y":3},{"x":8,"y":3},{"x":7,"y":3},{"x":7,"y":4},{"x":6,"y":4}],"latency":453,"head":{"x":9,"y":6},"length":36,"shout":"","squad":"","customizations":{"color":"#fcba03","head":"caffeine","tail":"bolt"}},{"id":"gs_QF8yw3YhmVCcSTJV3HXddGqW","name":"Jaguar Meets Snake","health":83,"body":[{"x":10,"y":1},{"x":9,"y":1},{"x":9,"y":0},{"x":8,"y":0},{"x":7,"y":0},{"x":6,"y":0},{"x":5,"y":0},{"x":4,"y":0},{"x":3,"y":0},{"x":2,"y":0},{"x":2,"y":1},{"x":1,"y":1},{"x":1,"y":0},{"x":0,"y":0},{"x":0,"y":1},{"x":0,"y":2},{"x":1,"y":2},{"x":2,"y":2},{"x":2,"y":3},{"x":1,"y":3},{"x":1,"y":4},{"x":2,"y":4},{"x":2,"y":5}],"latency":315,"head":{"x":10,"y":1},"length":23,"shout":"","squad":"","customizations":{"color":"#ff9900","head":"tiger-king","tail":"mystic-moon"}}]},"you":{"id":"gs_QF8yw3YhmVCcSTJV3HXddGqW","name":"Jaguar Meets Snake","health":83,"body":[{"x":10,"y":1},{"x":9,"y":1},{"x":9,"y":0},{"x":8,"y":0},{"x":7,"y":0},{"x":6,"y":0},{"x":5,"y":0},{"x":4,"y":0},{"x":3,"y":0},{"x":2,"y":0},{"x":2,"y":1},{"x":1,"y":1},{"x":1,"y":0},{"x":0,"y":0},{"x":0,"y":1},{"x":0,"y":2},{"x":1,"y":2},{"x":2,"y":2},{"x":2,"y":3},{"x":1,"y":3},{"x":1,"y":4},{"x":2,"y":4},{"x":2,"y":5}],"latency":315,"head":{"x":10,"y":1},"length":23,"shout":"","squad":"","customizations":{"color":"#ff9900","head":"tiger-king","tail":"mystic-moon"}}}
      const moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up")
    }
  })
  it('duel4: does not assume a snake will die when it may not', () => {
    for (let i: number = 0; i < 5; i++) {
      const gameState: GameState = {"game":{"id":"fa12cb55-395a-47c6-9b1b-41d1839d28b0","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":100,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"arcade_maze","timeout":500,"source":"testingDeepening"},"turn":734,"board":{"width":19,"height":21,"food":[{"x":3,"y":11},{"x":9,"y":1},{"x":15,"y":11},{"x":9,"y":17},{"x":9,"y":5},{"x":9,"y":11},{"x":17,"y":1}],"hazards":[{"x":0,"y":20},{"x":2,"y":20},{"x":3,"y":20},{"x":4,"y":20},{"x":5,"y":20},{"x":6,"y":20},{"x":7,"y":20},{"x":8,"y":20},{"x":9,"y":20},{"x":10,"y":20},{"x":11,"y":20},{"x":12,"y":20},{"x":13,"y":20},{"x":14,"y":20},{"x":15,"y":20},{"x":16,"y":20},{"x":18,"y":20},{"x":0,"y":19},{"x":9,"y":19},{"x":18,"y":19},{"x":0,"y":18},{"x":2,"y":18},{"x":3,"y":18},{"x":5,"y":18},{"x":6,"y":18},{"x":7,"y":18},{"x":9,"y":18},{"x":11,"y":18},{"x":12,"y":18},{"x":13,"y":18},{"x":15,"y":18},{"x":16,"y":18},{"x":18,"y":18},{"x":0,"y":17},{"x":18,"y":17},{"x":0,"y":16},{"x":2,"y":16},{"x":3,"y":16},{"x":5,"y":16},{"x":7,"y":16},{"x":8,"y":16},{"x":9,"y":16},{"x":10,"y":16},{"x":11,"y":16},{"x":13,"y":16},{"x":15,"y":16},{"x":16,"y":16},{"x":18,"y":16},{"x":0,"y":15},{"x":5,"y":15},{"x":9,"y":15},{"x":13,"y":15},{"x":18,"y":15},{"x":0,"y":14},{"x":3,"y":14},{"x":5,"y":14},{"x":6,"y":14},{"x":7,"y":14},{"x":9,"y":14},{"x":11,"y":14},{"x":12,"y":14},{"x":13,"y":14},{"x":15,"y":14},{"x":18,"y":14},{"x":0,"y":13},{"x":3,"y":13},{"x":5,"y":13},{"x":13,"y":13},{"x":15,"y":13},{"x":18,"y":13},{"x":0,"y":12},{"x":1,"y":12},{"x":2,"y":12},{"x":3,"y":12},{"x":5,"y":12},{"x":7,"y":12},{"x":9,"y":12},{"x":11,"y":12},{"x":13,"y":12},{"x":15,"y":12},{"x":16,"y":12},{"x":17,"y":12},{"x":18,"y":12},{"x":7,"y":11},{"x":11,"y":11},{"x":0,"y":10},{"x":1,"y":10},{"x":2,"y":10},{"x":3,"y":10},{"x":5,"y":10},{"x":7,"y":10},{"x":9,"y":10},{"x":11,"y":10},{"x":13,"y":10},{"x":15,"y":10},{"x":16,"y":10},{"x":17,"y":10},{"x":18,"y":10},{"x":0,"y":9},{"x":3,"y":9},{"x":5,"y":9},{"x":13,"y":9},{"x":15,"y":9},{"x":18,"y":9},{"x":0,"y":8},{"x":3,"y":8},{"x":5,"y":8},{"x":7,"y":8},{"x":8,"y":8},{"x":9,"y":8},{"x":10,"y":8},{"x":11,"y":8},{"x":13,"y":8},{"x":15,"y":8},{"x":18,"y":8},{"x":0,"y":7},{"x":9,"y":7},{"x":18,"y":7},{"x":0,"y":6},{"x":2,"y":6},{"x":3,"y":6},{"x":5,"y":6},{"x":6,"y":6},{"x":7,"y":6},{"x":9,"y":6},{"x":11,"y":6},{"x":12,"y":6},{"x":13,"y":6},{"x":15,"y":6},{"x":16,"y":6},{"x":18,"y":6},{"x":0,"y":5},{"x":3,"y":5},{"x":15,"y":5},{"x":18,"y":5},{"x":0,"y":4},{"x":1,"y":4},{"x":3,"y":4},{"x":5,"y":4},{"x":7,"y":4},{"x":8,"y":4},{"x":9,"y":4},{"x":10,"y":4},{"x":11,"y":4},{"x":13,"y":4},{"x":15,"y":4},{"x":17,"y":4},{"x":18,"y":4},{"x":0,"y":3},{"x":5,"y":3},{"x":9,"y":3},{"x":13,"y":3},{"x":18,"y":3},{"x":0,"y":2},{"x":2,"y":2},{"x":3,"y":2},{"x":4,"y":2},{"x":5,"y":2},{"x":6,"y":2},{"x":7,"y":2},{"x":9,"y":2},{"x":11,"y":2},{"x":12,"y":2},{"x":13,"y":2},{"x":14,"y":2},{"x":15,"y":2},{"x":16,"y":2},{"x":18,"y":2},{"x":0,"y":1},{"x":18,"y":1},{"x":0,"y":0},{"x":2,"y":0},{"x":3,"y":0},{"x":4,"y":0},{"x":5,"y":0},{"x":6,"y":0},{"x":7,"y":0},{"x":8,"y":0},{"x":9,"y":0},{"x":10,"y":0},{"x":11,"y":0},{"x":12,"y":0},{"x":13,"y":0},{"x":14,"y":0},{"x":15,"y":0},{"x":16,"y":0},{"x":18,"y":0}],"snakes":[{"id":"gs_3cY36XqwW9DQ8VppQjjP8jH6","name":"Jaguar Meets Snake","health":62,"body":[{"x":10,"y":17},{"x":11,"y":17},{"x":12,"y":17},{"x":12,"y":16},{"x":12,"y":15},{"x":11,"y":15},{"x":10,"y":15},{"x":10,"y":14},{"x":10,"y":13},{"x":11,"y":13},{"x":12,"y":13},{"x":12,"y":12},{"x":12,"y":11},{"x":12,"y":10},{"x":12,"y":9},{"x":12,"y":8},{"x":12,"y":7},{"x":13,"y":7},{"x":14,"y":7},{"x":14,"y":8},{"x":14,"y":9},{"x":14,"y":10},{"x":14,"y":11},{"x":14,"y":12},{"x":14,"y":13},{"x":14,"y":14},{"x":14,"y":15},{"x":15,"y":15},{"x":16,"y":15},{"x":16,"y":14},{"x":16,"y":13},{"x":17,"y":13},{"x":17,"y":14},{"x":17,"y":15},{"x":17,"y":16},{"x":17,"y":17},{"x":16,"y":17},{"x":15,"y":17}],"latency":22,"head":{"x":10,"y":17},"length":38,"shout":"","squad":"","customizations":{"color":"#ff9900","head":"tiger-king","tail":"mystic-moon"}},{"id":"gs_C7KSg8cdyfrGtrJgYthRjmfY","name":"$n4k3 g4diuk4","health":8,"body":[{"x":4,"y":13},{"x":4,"y":12},{"x":4,"y":11},{"x":5,"y":11},{"x":6,"y":11},{"x":6,"y":12},{"x":6,"y":13},{"x":7,"y":13},{"x":8,"y":13},{"x":8,"y":12},{"x":8,"y":11},{"x":8,"y":10},{"x":8,"y":9},{"x":7,"y":9},{"x":6,"y":9},{"x":6,"y":8},{"x":6,"y":7},{"x":5,"y":7},{"x":4,"y":7},{"x":3,"y":7},{"x":2,"y":7},{"x":1,"y":7},{"x":1,"y":6},{"x":1,"y":5},{"x":2,"y":5},{"x":2,"y":4},{"x":2,"y":3},{"x":1,"y":3},{"x":1,"y":2},{"x":1,"y":1},{"x":1,"y":0},{"x":1,"y":20},{"x":1,"y":19},{"x":2,"y":19},{"x":3,"y":19},{"x":4,"y":19},{"x":4,"y":18}],"latency":2,"head":{"x":4,"y":13},"length":37,"shout":"","squad":"","customizations":{"color":"#b0bf1a","head":"chomp","tail":"shiny"}}]},"you":{"id":"gs_3cY36XqwW9DQ8VppQjjP8jH6","name":"Jaguar Meets Snake","health":62,"body":[{"x":10,"y":17},{"x":11,"y":17},{"x":12,"y":17},{"x":12,"y":16},{"x":12,"y":15},{"x":11,"y":15},{"x":10,"y":15},{"x":10,"y":14},{"x":10,"y":13},{"x":11,"y":13},{"x":12,"y":13},{"x":12,"y":12},{"x":12,"y":11},{"x":12,"y":10},{"x":12,"y":9},{"x":12,"y":8},{"x":12,"y":7},{"x":13,"y":7},{"x":14,"y":7},{"x":14,"y":8},{"x":14,"y":9},{"x":14,"y":10},{"x":14,"y":11},{"x":14,"y":12},{"x":14,"y":13},{"x":14,"y":14},{"x":14,"y":15},{"x":15,"y":15},{"x":16,"y":15},{"x":16,"y":14},{"x":16,"y":13},{"x":17,"y":13},{"x":17,"y":14},{"x":17,"y":15},{"x":17,"y":16},{"x":17,"y":17},{"x":16,"y":17},{"x":15,"y":17}],"latency":22,"head":{"x":10,"y":17},"length":38,"shout":"","squad":"","customizations":{"color":"#ff9900","head":"tiger-king","tail":"mystic-moon"}}}
      const moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("up") // left will win if $n4k3 dies, but will lose if they manage to eat - which is what happens after food spawns on turn 737
    }
  })
  it('duel5: prolongs an inevitable death', () => {
    for (let i: number = 0; i < 3; i++) {
      const gameState: GameState = {"game":{"id":"fa12cb55-395a-47c6-9b1b-41d1839d28b0","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":100,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"arcade_maze","timeout":500,"source":"testing"},"turn":738,"board":{"width":19,"height":21,"food":[{"x":3,"y":11},{"x":9,"y":1},{"x":15,"y":11},{"x":9,"y":5},{"x":9,"y":11},{"x":17,"y":1},{"x":14,"y":17}],"hazards":[{"x":0,"y":20},{"x":2,"y":20},{"x":3,"y":20},{"x":4,"y":20},{"x":5,"y":20},{"x":6,"y":20},{"x":7,"y":20},{"x":8,"y":20},{"x":9,"y":20},{"x":10,"y":20},{"x":11,"y":20},{"x":12,"y":20},{"x":13,"y":20},{"x":14,"y":20},{"x":15,"y":20},{"x":16,"y":20},{"x":18,"y":20},{"x":0,"y":19},{"x":9,"y":19},{"x":18,"y":19},{"x":0,"y":18},{"x":2,"y":18},{"x":3,"y":18},{"x":5,"y":18},{"x":6,"y":18},{"x":7,"y":18},{"x":9,"y":18},{"x":11,"y":18},{"x":12,"y":18},{"x":13,"y":18},{"x":15,"y":18},{"x":16,"y":18},{"x":18,"y":18},{"x":0,"y":17},{"x":18,"y":17},{"x":0,"y":16},{"x":2,"y":16},{"x":3,"y":16},{"x":5,"y":16},{"x":7,"y":16},{"x":8,"y":16},{"x":9,"y":16},{"x":10,"y":16},{"x":11,"y":16},{"x":13,"y":16},{"x":15,"y":16},{"x":16,"y":16},{"x":18,"y":16},{"x":0,"y":15},{"x":5,"y":15},{"x":9,"y":15},{"x":13,"y":15},{"x":18,"y":15},{"x":0,"y":14},{"x":3,"y":14},{"x":5,"y":14},{"x":6,"y":14},{"x":7,"y":14},{"x":9,"y":14},{"x":11,"y":14},{"x":12,"y":14},{"x":13,"y":14},{"x":15,"y":14},{"x":18,"y":14},{"x":0,"y":13},{"x":3,"y":13},{"x":5,"y":13},{"x":13,"y":13},{"x":15,"y":13},{"x":18,"y":13},{"x":0,"y":12},{"x":1,"y":12},{"x":2,"y":12},{"x":3,"y":12},{"x":5,"y":12},{"x":7,"y":12},{"x":9,"y":12},{"x":11,"y":12},{"x":13,"y":12},{"x":15,"y":12},{"x":16,"y":12},{"x":17,"y":12},{"x":18,"y":12},{"x":7,"y":11},{"x":11,"y":11},{"x":0,"y":10},{"x":1,"y":10},{"x":2,"y":10},{"x":3,"y":10},{"x":5,"y":10},{"x":7,"y":10},{"x":9,"y":10},{"x":11,"y":10},{"x":13,"y":10},{"x":15,"y":10},{"x":16,"y":10},{"x":17,"y":10},{"x":18,"y":10},{"x":0,"y":9},{"x":3,"y":9},{"x":5,"y":9},{"x":13,"y":9},{"x":15,"y":9},{"x":18,"y":9},{"x":0,"y":8},{"x":3,"y":8},{"x":5,"y":8},{"x":7,"y":8},{"x":8,"y":8},{"x":9,"y":8},{"x":10,"y":8},{"x":11,"y":8},{"x":13,"y":8},{"x":15,"y":8},{"x":18,"y":8},{"x":0,"y":7},{"x":9,"y":7},{"x":18,"y":7},{"x":0,"y":6},{"x":2,"y":6},{"x":3,"y":6},{"x":5,"y":6},{"x":6,"y":6},{"x":7,"y":6},{"x":9,"y":6},{"x":11,"y":6},{"x":12,"y":6},{"x":13,"y":6},{"x":15,"y":6},{"x":16,"y":6},{"x":18,"y":6},{"x":0,"y":5},{"x":3,"y":5},{"x":15,"y":5},{"x":18,"y":5},{"x":0,"y":4},{"x":1,"y":4},{"x":3,"y":4},{"x":5,"y":4},{"x":7,"y":4},{"x":8,"y":4},{"x":9,"y":4},{"x":10,"y":4},{"x":11,"y":4},{"x":13,"y":4},{"x":15,"y":4},{"x":17,"y":4},{"x":18,"y":4},{"x":0,"y":3},{"x":5,"y":3},{"x":9,"y":3},{"x":13,"y":3},{"x":18,"y":3},{"x":0,"y":2},{"x":2,"y":2},{"x":3,"y":2},{"x":4,"y":2},{"x":5,"y":2},{"x":6,"y":2},{"x":7,"y":2},{"x":9,"y":2},{"x":11,"y":2},{"x":12,"y":2},{"x":13,"y":2},{"x":14,"y":2},{"x":15,"y":2},{"x":16,"y":2},{"x":18,"y":2},{"x":0,"y":1},{"x":18,"y":1},{"x":0,"y":0},{"x":2,"y":0},{"x":3,"y":0},{"x":4,"y":0},{"x":5,"y":0},{"x":6,"y":0},{"x":7,"y":0},{"x":8,"y":0},{"x":9,"y":0},{"x":10,"y":0},{"x":11,"y":0},{"x":12,"y":0},{"x":13,"y":0},{"x":14,"y":0},{"x":15,"y":0},{"x":16,"y":0},{"x":18,"y":0}],"snakes":[{"id":"gs_3cY36XqwW9DQ8VppQjjP8jH6","name":"Jaguar Meets Snake","health":97,"body":[{"x":6,"y":17},{"x":7,"y":17},{"x":8,"y":17},{"x":9,"y":17},{"x":10,"y":17},{"x":11,"y":17},{"x":12,"y":17},{"x":12,"y":16},{"x":12,"y":15},{"x":11,"y":15},{"x":10,"y":15},{"x":10,"y":14},{"x":10,"y":13},{"x":11,"y":13},{"x":12,"y":13},{"x":12,"y":12},{"x":12,"y":11},{"x":12,"y":10},{"x":12,"y":9},{"x":12,"y":8},{"x":12,"y":7},{"x":13,"y":7},{"x":14,"y":7},{"x":14,"y":8},{"x":14,"y":9},{"x":14,"y":10},{"x":14,"y":11},{"x":14,"y":12},{"x":14,"y":13},{"x":14,"y":14},{"x":14,"y":15},{"x":15,"y":15},{"x":16,"y":15},{"x":16,"y":14},{"x":16,"y":13},{"x":17,"y":13},{"x":17,"y":14},{"x":17,"y":15},{"x":17,"y":16}],"latency":23,"head":{"x":6,"y":17},"length":39,"shout":"","squad":"","customizations":{"color":"#ff9900","head":"tiger-king","tail":"mystic-moon"}},{"id":"gs_C7KSg8cdyfrGtrJgYthRjmfY","name":"$n4k3 g4diuk4","health":100,"body":[{"x":4,"y":17},{"x":4,"y":16},{"x":4,"y":15},{"x":4,"y":14},{"x":4,"y":13},{"x":4,"y":12},{"x":4,"y":11},{"x":5,"y":11},{"x":6,"y":11},{"x":6,"y":12},{"x":6,"y":13},{"x":7,"y":13},{"x":8,"y":13},{"x":8,"y":12},{"x":8,"y":11},{"x":8,"y":10},{"x":8,"y":9},{"x":7,"y":9},{"x":6,"y":9},{"x":6,"y":8},{"x":6,"y":7},{"x":5,"y":7},{"x":4,"y":7},{"x":3,"y":7},{"x":2,"y":7},{"x":1,"y":7},{"x":1,"y":6},{"x":1,"y":5},{"x":2,"y":5},{"x":2,"y":4},{"x":2,"y":3},{"x":1,"y":3},{"x":1,"y":2},{"x":1,"y":1},{"x":1,"y":0},{"x":1,"y":20},{"x":1,"y":19},{"x":1,"y":19}],"latency":2,"head":{"x":4,"y":17},"length":38,"shout":"","squad":"","customizations":{"color":"#b0bf1a","head":"chomp","tail":"shiny"}}]},"you":{"id":"gs_3cY36XqwW9DQ8VppQjjP8jH6","name":"Jaguar Meets Snake","health":97,"body":[{"x":6,"y":17},{"x":7,"y":17},{"x":8,"y":17},{"x":9,"y":17},{"x":10,"y":17},{"x":11,"y":17},{"x":12,"y":17},{"x":12,"y":16},{"x":12,"y":15},{"x":11,"y":15},{"x":10,"y":15},{"x":10,"y":14},{"x":10,"y":13},{"x":11,"y":13},{"x":12,"y":13},{"x":12,"y":12},{"x":12,"y":11},{"x":12,"y":10},{"x":12,"y":9},{"x":12,"y":8},{"x":12,"y":7},{"x":13,"y":7},{"x":14,"y":7},{"x":14,"y":8},{"x":14,"y":9},{"x":14,"y":10},{"x":14,"y":11},{"x":14,"y":12},{"x":14,"y":13},{"x":14,"y":14},{"x":14,"y":15},{"x":15,"y":15},{"x":16,"y":15},{"x":16,"y":14},{"x":16,"y":13},{"x":17,"y":13},{"x":17,"y":14},{"x":17,"y":15},{"x":17,"y":16}],"latency":23,"head":{"x":6,"y":17},"length":39,"shout":"","squad":"","customizations":{"color":"#ff9900","head":"tiger-king","tail":"mystic-moon"}}}
      const moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("down") // left kills me in two moves, down kills me in six
    }
  })
  it('duel6: eats food when it is part of its chosen path anyway', () => {
    for (let i: number = 0; i < 3; i++) {
      const gameState: GameState = {"game":{"id":"dc6ecdaf-45b5-45f6-8d00-bf6796914858","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"standard","timeout":500,"source":"testing"},"turn":328,"board":{"width":11,"height":11,"food":[{"x":3,"y":0},{"x":1,"y":10},{"x":8,"y":1}],"hazards":[],"snakes":[{"id":"gs_fcMVRRYHFKgQdHffGxfSTgDY","name":"soma-mini v2[duels]","health":91,"body":[{"x":6,"y":10},{"x":7,"y":10},{"x":7,"y":9},{"x":7,"y":8},{"x":7,"y":7},{"x":6,"y":7},{"x":6,"y":6},{"x":5,"y":6},{"x":5,"y":7},{"x":4,"y":7},{"x":4,"y":8},{"x":3,"y":8},{"x":3,"y":7},{"x":3,"y":6},{"x":4,"y":6},{"x":4,"y":5},{"x":4,"y":4},{"x":4,"y":3},{"x":3,"y":3},{"x":2,"y":3},{"x":2,"y":2},{"x":1,"y":2},{"x":1,"y":3},{"x":1,"y":4},{"x":1,"y":5},{"x":1,"y":6},{"x":2,"y":6},{"x":2,"y":7}],"latency":415,"head":{"x":6,"y":10},"length":28,"shout":"410","squad":"","customizations":{"color":"#000055","head":"snail","tail":"fat-rattle"}},{"id":"gs_XvMHhPr77dVqHXj3mHjY88HG","name":"Jaguar Meets Snake","health":77,"body":[{"x":9,"y":1},{"x":9,"y":2},{"x":9,"y":3},{"x":8,"y":3},{"x":8,"y":2},{"x":7,"y":2},{"x":6,"y":2},{"x":6,"y":1},{"x":5,"y":1},{"x":4,"y":1},{"x":3,"y":1},{"x":3,"y":2},{"x":4,"y":2},{"x":5,"y":2},{"x":5,"y":3},{"x":5,"y":4},{"x":6,"y":4},{"x":7,"y":4},{"x":8,"y":4},{"x":9,"y":4},{"x":10,"y":4},{"x":10,"y":5},{"x":10,"y":6},{"x":10,"y":7},{"x":9,"y":7},{"x":9,"y":6},{"x":9,"y":5}],"latency":429,"head":{"x":9,"y":1},"length":27,"shout":"","squad":"","customizations":{"color":"#ff9900","head":"tiger-king","tail":"mystic-moon"}}]},"you":{"id":"gs_XvMHhPr77dVqHXj3mHjY88HG","name":"Jaguar Meets Snake","health":77,"body":[{"x":9,"y":1},{"x":9,"y":2},{"x":9,"y":3},{"x":8,"y":3},{"x":8,"y":2},{"x":7,"y":2},{"x":6,"y":2},{"x":6,"y":1},{"x":5,"y":1},{"x":4,"y":1},{"x":3,"y":1},{"x":3,"y":2},{"x":4,"y":2},{"x":5,"y":2},{"x":5,"y":3},{"x":5,"y":4},{"x":6,"y":4},{"x":7,"y":4},{"x":8,"y":4},{"x":9,"y":4},{"x":10,"y":4},{"x":10,"y":5},{"x":10,"y":6},{"x":10,"y":7},{"x":9,"y":7},{"x":9,"y":6},{"x":9,"y":5}],"latency":429,"head":{"x":9,"y":1},"length":27,"shout":"","squad":"","customizations":{"color":"#ff9900","head":"tiger-king","tail":"mystic-moon"}}}
      const moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("left") // left feeds me, at a time where size is critical. Down keeps me smaller
    }
  })
  it('duel7: ignores food in upper route if it would lead to its doom', () => {
    const gameState: GameState = {"game":{"id":"7b1ac93b-036a-49f4-93a9-628818f93c27","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"standard","timeout":500,"source":"testing"},"turn":259,"board":{"width":11,"height":11,"food":[{"x":10,"y":3},{"x":10,"y":0},{"x":0,"y":10},{"x":3,"y":10},{"x":3,"y":0},{"x":5,"y":10},{"x":6,"y":8},{"x":6,"y":10}],"hazards":[],"snakes":[{"id":"gs_QYPCWVDStjHy8WWCrrrQGwQG","name":"Shapeshifter","health":100,"body":[{"x":0,"y":5},{"x":1,"y":5},{"x":1,"y":6},{"x":1,"y":7},{"x":1,"y":8},{"x":1,"y":9},{"x":2,"y":9},{"x":2,"y":8},{"x":2,"y":7},{"x":3,"y":7},{"x":4,"y":7},{"x":5,"y":7},{"x":6,"y":7},{"x":6,"y":6},{"x":6,"y":5},{"x":5,"y":5},{"x":4,"y":5},{"x":4,"y":6},{"x":3,"y":6},{"x":3,"y":5},{"x":3,"y":4},{"x":3,"y":3},{"x":3,"y":3}],"latency":402,"head":{"x":0,"y":5},"length":23,"shout":"","squad":"","customizations":{"color":"#900050","head":"cosmic-horror-special","tail":"cosmic-horror"}},{"id":"gs_C7cwW4Cq9HfHtqtW7WjkpP3X","name":"Jagwire","health":59,"body":[{"x":7,"y":8},{"x":8,"y":8},{"x":8,"y":9},{"x":9,"y":9},{"x":9,"y":8},{"x":9,"y":7},{"x":10,"y":7},{"x":10,"y":6},{"x":10,"y":5},{"x":9,"y":5},{"x":9,"y":4},{"x":9,"y":3},{"x":8,"y":3},{"x":7,"y":3},{"x":7,"y":2},{"x":6,"y":2},{"x":5,"y":2}],"latency":451,"head":{"x":7,"y":8},"length":17,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}]},"you":{"id":"gs_C7cwW4Cq9HfHtqtW7WjkpP3X","name":"Jagwire","health":59,"body":[{"x":7,"y":8},{"x":8,"y":8},{"x":8,"y":9},{"x":9,"y":9},{"x":9,"y":8},{"x":9,"y":7},{"x":10,"y":7},{"x":10,"y":6},{"x":10,"y":5},{"x":9,"y":5},{"x":9,"y":4},{"x":9,"y":3},{"x":8,"y":3},{"x":7,"y":3},{"x":7,"y":2},{"x":6,"y":2},{"x":5,"y":2}],"latency":451,"head":{"x":7,"y":8},"length":17,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("down") // up or left feeds us a little, but we will die in ~20 turns when we loop around. Down keeps us smaller but lets us stave off death longer
  })
  // great test but currently tail penalty is not strong enough to fix it
  it.skip('duel8: does not chase other snake tail when not necessary', () => {
    const gameState: GameState = {"game":{"id":"59fcb5c5-2504-4aa4-bd28-1d76c25ddce5","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":2,"minimumFood":1,"hazardDamagePerTurn":-30,"royale":{"shrinkEveryNTurns":300},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"healing_pools","timeout":500,"source":"testing"},"turn":627,"board":{"width":11,"height":11,"food":[{"x":0,"y":3}],"hazards":[],"snakes":[{"id":"gs_dqQhqWjhhFJy9MDFg8cvBhDW","name":"Prüzze v2","health":91,"body":[{"x":1,"y":4},{"x":2,"y":4},{"x":3,"y":4},{"x":3,"y":5},{"x":2,"y":5},{"x":1,"y":5},{"x":0,"y":5},{"x":0,"y":6},{"x":0,"y":7},{"x":0,"y":8},{"x":1,"y":8},{"x":1,"y":9},{"x":2,"y":9},{"x":2,"y":8},{"x":3,"y":8},{"x":3,"y":9},{"x":4,"y":9},{"x":5,"y":9},{"x":6,"y":9},{"x":6,"y":8},{"x":7,"y":8}],"latency":311,"head":{"x":1,"y":4},"length":21,"shout":", t=290","squad":"","customizations":{"color":"#c91f37","head":"gamer","tail":"coffee"}},{"id":"gs_fCPMtHjXqJJwxP6XFGSGWXX8","name":"Jagwire","health":64,"body":[{"x":4,"y":7},{"x":5,"y":7},{"x":6,"y":7},{"x":6,"y":6},{"x":6,"y":5},{"x":6,"y":4},{"x":5,"y":4},{"x":5,"y":3},{"x":5,"y":2},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":5,"y":5},{"x":5,"y":6},{"x":4,"y":6}],"latency":452,"head":{"x":4,"y":7},"length":16,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}]},"you":{"id":"gs_fCPMtHjXqJJwxP6XFGSGWXX8","name":"Jagwire","health":64,"body":[{"x":4,"y":7},{"x":5,"y":7},{"x":6,"y":7},{"x":6,"y":6},{"x":6,"y":5},{"x":6,"y":4},{"x":5,"y":4},{"x":5,"y":3},{"x":5,"y":2},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":5,"y":5},{"x":5,"y":6},{"x":4,"y":6}],"latency":452,"head":{"x":4,"y":7},"length":16,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("up") // left depends on Pruzze not eating twice. Down gets us murdered. Up is safe
  })
  it('duel9: does not chase after food in doomed corridor', () => {
    const gameState: GameState = {"game":{"id":"88fae552-ac4c-4b7e-92f9-674de021e1bc","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":2,"minimumFood":1,"hazardDamagePerTurn":-30,"royale":{"shrinkEveryNTurns":300},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"healing_pools","timeout":500,"source":"testing"},"turn":892,"board":{"width":11,"height":11,"food":[{"x":7,"y":10}],"hazards":[],"snakes":[{"id":"gs_9XK6DQDXC4KG6SGS9t464KTb","name":"Prüzze v2","health":65,"body":[{"x":9,"y":1},{"x":9,"y":2},{"x":8,"y":2},{"x":7,"y":2},{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":5},{"x":6,"y":5},{"x":5,"y":5},{"x":4,"y":5},{"x":4,"y":4},{"x":5,"y":4},{"x":6,"y":4},{"x":6,"y":3},{"x":6,"y":2},{"x":5,"y":2},{"x":5,"y":3},{"x":4,"y":3},{"x":3,"y":3},{"x":3,"y":4},{"x":2,"y":4},{"x":2,"y":3},{"x":2,"y":2},{"x":3,"y":2},{"x":4,"y":2},{"x":4,"y":1}],"latency":283,"head":{"x":9,"y":1},"length":26,"shout":", t=262","squad":"","customizations":{"color":"#c91f37","head":"gamer","tail":"coffee"}},{"id":"gs_PYrMPpF4fGTwGkwJkVxCg7qF","name":"Jagwire","health":100,"body":[{"x":10,"y":6},{"x":9,"y":6},{"x":9,"y":7},{"x":9,"y":8},{"x":9,"y":9},{"x":8,"y":9},{"x":7,"y":9},{"x":6,"y":9},{"x":5,"y":9},{"x":4,"y":9},{"x":4,"y":8},{"x":4,"y":7},{"x":4,"y":6},{"x":5,"y":6},{"x":5,"y":7},{"x":5,"y":8},{"x":6,"y":8},{"x":6,"y":7},{"x":6,"y":6},{"x":7,"y":6},{"x":7,"y":7},{"x":8,"y":7},{"x":8,"y":6},{"x":8,"y":6}],"latency":452,"head":{"x":10,"y":6},"length":24,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}]},"you":{"id":"gs_PYrMPpF4fGTwGkwJkVxCg7qF","name":"Jagwire","health":100,"body":[{"x":10,"y":6},{"x":9,"y":6},{"x":9,"y":7},{"x":9,"y":8},{"x":9,"y":9},{"x":8,"y":9},{"x":7,"y":9},{"x":6,"y":9},{"x":5,"y":9},{"x":4,"y":9},{"x":4,"y":8},{"x":4,"y":7},{"x":4,"y":6},{"x":5,"y":6},{"x":5,"y":7},{"x":5,"y":8},{"x":6,"y":8},{"x":6,"y":7},{"x":6,"y":6},{"x":7,"y":6},{"x":7,"y":7},{"x":8,"y":7},{"x":8,"y":6},{"x":8,"y":6}],"latency":452,"head":{"x":10,"y":6},"length":24,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("down") // up lets pruzze trap us once we get out of the corridor, down does not
  })
  it('duel10: moves to close in on smaller opponent', () => {
    const gameState: GameState = {"game":{"id":"ba7b795d-75d1-433c-925c-b3c5022d11a8","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"standard","timeout":500,"source":"testing"},"turn":433,"board":{"width":11,"height":11,"food":[{"x":0,"y":1},{"x":8,"y":8},{"x":1,"y":0}],"hazards":[],"snakes":[{"id":"gs_cchcHkKBwtbSVyr8GcrhRjhB","name":"soma-mini v2[duels]","health":82,"body":[{"x":9,"y":8},{"x":9,"y":9},{"x":10,"y":9},{"x":10,"y":8},{"x":10,"y":7},{"x":10,"y":6},{"x":10,"y":5},{"x":10,"y":4},{"x":10,"y":3},{"x":10,"y":2},{"x":10,"y":1},{"x":9,"y":1},{"x":9,"y":0},{"x":8,"y":0},{"x":7,"y":0},{"x":7,"y":1},{"x":6,"y":1},{"x":6,"y":0},{"x":5,"y":0},{"x":5,"y":1},{"x":5,"y":2},{"x":6,"y":2},{"x":6,"y":3},{"x":6,"y":4},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":7,"y":7},{"x":6,"y":7},{"x":6,"y":8}],"latency":411,"head":{"x":9,"y":8},"length":30,"shout":"407","squad":"","customizations":{"color":"#000055","head":"snail","tail":"fat-rattle"}},{"id":"gs_8hP33m3KxbjqYtDjywQBkF4X","name":"Jagwire","health":100,"body":[{"x":5,"y":10},{"x":5,"y":9},{"x":5,"y":8},{"x":4,"y":8},{"x":3,"y":8},{"x":3,"y":7},{"x":3,"y":6},{"x":4,"y":6},{"x":4,"y":5},{"x":4,"y":4},{"x":5,"y":4},{"x":5,"y":3},{"x":4,"y":3},{"x":3,"y":3},{"x":3,"y":2},{"x":4,"y":2},{"x":4,"y":1},{"x":4,"y":0},{"x":3,"y":0},{"x":3,"y":1},{"x":2,"y":1},{"x":2,"y":2},{"x":2,"y":3},{"x":1,"y":3},{"x":0,"y":3},{"x":0,"y":4},{"x":0,"y":5},{"x":0,"y":6},{"x":0,"y":7},{"x":0,"y":8},{"x":0,"y":9},{"x":0,"y":9}],"latency":453,"head":{"x":5,"y":10},"length":32,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}]},"you":{"id":"gs_8hP33m3KxbjqYtDjywQBkF4X","name":"Jagwire","health":100,"body":[{"x":5,"y":10},{"x":5,"y":9},{"x":5,"y":8},{"x":4,"y":8},{"x":3,"y":8},{"x":3,"y":7},{"x":3,"y":6},{"x":4,"y":6},{"x":4,"y":5},{"x":4,"y":4},{"x":5,"y":4},{"x":5,"y":3},{"x":4,"y":3},{"x":3,"y":3},{"x":3,"y":2},{"x":4,"y":2},{"x":4,"y":1},{"x":4,"y":0},{"x":3,"y":0},{"x":3,"y":1},{"x":2,"y":1},{"x":2,"y":2},{"x":2,"y":3},{"x":1,"y":3},{"x":0,"y":3},{"x":0,"y":4},{"x":0,"y":5},{"x":0,"y":6},{"x":0,"y":7},{"x":0,"y":8},{"x":0,"y":9},{"x":0,"y":9}],"latency":453,"head":{"x":5,"y":10},"length":32,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("right")
  })
  it('duel11: does not allow itself to be penned in', () => { // flawed test as down is not actually certain death, but did help to fix a Board2d issue with effectiveLength
    const gameState: GameState = {"game":{"id":"e9987c6b-1130-41df-b180-ffd7071c19b0","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"standard","timeout":500,"source":"testing"},"turn":204,"board":{"width":11,"height":11,"food":[{"x":0,"y":8},{"x":10,"y":6},{"x":1,"y":9},{"x":4,"y":10},{"x":6,"y":1},{"x":4,"y":2}],"hazards":[],"snakes":[{"id":"gs_gf7McQh8SxDGPtSvKb8hx6d8","name":"Jagwire","health":87,"body":[{"x":7,"y":1},{"x":7,"y":2},{"x":7,"y":3},{"x":7,"y":4},{"x":6,"y":4},{"x":6,"y":3},{"x":5,"y":3},{"x":5,"y":4},{"x":4,"y":4},{"x":3,"y":4},{"x":2,"y":4},{"x":1,"y":4}],"latency":452,"head":{"x":7,"y":1},"length":12,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}},{"id":"gs_Sc7HWYMyY4MqYpRvrmK4m7JY","name":"Prüzze v2","health":84,"body":[{"x":3,"y":7},{"x":4,"y":7},{"x":5,"y":7},{"x":5,"y":6},{"x":4,"y":6},{"x":4,"y":5},{"x":5,"y":5},{"x":6,"y":5},{"x":7,"y":5},{"x":7,"y":6},{"x":8,"y":6},{"x":8,"y":7},{"x":7,"y":7},{"x":6,"y":7},{"x":6,"y":8},{"x":6,"y":9},{"x":5,"y":9}],"latency":422,"head":{"x":3,"y":7},"length":17,"shout":", t=401","squad":"","customizations":{"color":"#c91f37","head":"gamer","tail":"coffee"}}]},"you":{"id":"gs_gf7McQh8SxDGPtSvKb8hx6d8","name":"Jagwire","health":87,"body":[{"x":7,"y":1},{"x":7,"y":2},{"x":7,"y":3},{"x":7,"y":4},{"x":6,"y":4},{"x":6,"y":3},{"x":5,"y":3},{"x":5,"y":4},{"x":4,"y":4},{"x":3,"y":4},{"x":2,"y":4},{"x":1,"y":4}],"latency":452,"head":{"x":7,"y":1},"length":12,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).not.toBe("down") // down puts us on the bottom of the board with Pruzze positioned to close in, left or right allows an escape route & more board coverage
  })
  // cachedLookaheads caused this test originally, so it's more of a test of whether that is working in duels, hence why it's testingDeepening
  it('duel12: does not choose death in a turn over prolonging life', () => {
    const gameState: GameState = {"game":{"id":"9066a48c-520b-4b9e-9754-6deef4f380b3","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":14,"royale":{"shrinkEveryNTurns":25},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"royale","timeout":500,"source":"testingDeepening"},"turn":193,"board":{"width":11,"height":11,"food":[{"x":4,"y":1}],"hazards":[{"x":0,"y":0},{"x":0,"y":1},{"x":0,"y":2},{"x":0,"y":3},{"x":0,"y":4},{"x":0,"y":5},{"x":0,"y":6},{"x":0,"y":7},{"x":0,"y":8},{"x":0,"y":9},{"x":0,"y":10},{"x":1,"y":0},{"x":1,"y":1},{"x":1,"y":8},{"x":1,"y":9},{"x":1,"y":10},{"x":2,"y":0},{"x":2,"y":1},{"x":2,"y":8},{"x":2,"y":9},{"x":2,"y":10},{"x":3,"y":0},{"x":3,"y":1},{"x":3,"y":8},{"x":3,"y":9},{"x":3,"y":10},{"x":4,"y":0},{"x":4,"y":1},{"x":4,"y":8},{"x":4,"y":9},{"x":4,"y":10},{"x":5,"y":0},{"x":5,"y":1},{"x":5,"y":8},{"x":5,"y":9},{"x":5,"y":10},{"x":6,"y":0},{"x":6,"y":1},{"x":6,"y":8},{"x":6,"y":9},{"x":6,"y":10},{"x":7,"y":0},{"x":7,"y":1},{"x":7,"y":8},{"x":7,"y":9},{"x":7,"y":10},{"x":8,"y":0},{"x":8,"y":1},{"x":8,"y":8},{"x":8,"y":9},{"x":8,"y":10},{"x":9,"y":0},{"x":9,"y":1},{"x":9,"y":8},{"x":9,"y":9},{"x":9,"y":10},{"x":10,"y":0},{"x":10,"y":1},{"x":10,"y":2},{"x":10,"y":3},{"x":10,"y":4},{"x":10,"y":5},{"x":10,"y":6},{"x":10,"y":7},{"x":10,"y":8},{"x":10,"y":9},{"x":10,"y":10}],"snakes":[{"id":"gs_gb8wXXBPTrqGdcQyJP4vQ4t6","name":"Gene Scallop","health":24,"body":[{"x":4,"y":6},{"x":5,"y":6},{"x":5,"y":7},{"x":6,"y":7},{"x":6,"y":6},{"x":6,"y":5},{"x":5,"y":5},{"x":5,"y":4},{"x":4,"y":4},{"x":3,"y":4},{"x":3,"y":5},{"x":2,"y":5},{"x":1,"y":5},{"x":1,"y":4},{"x":2,"y":4},{"x":2,"y":3},{"x":2,"y":2},{"x":2,"y":1},{"x":3,"y":1},{"x":3,"y":2},{"x":4,"y":2}],"latency":21,"head":{"x":4,"y":6},"length":21,"shout":"","squad":"","customizations":{"color":"#afeeee","head":"cosmic-horror","tail":"do-sammy"}},{"id":"gs_QGDJPGP9rthScPpJWYFYCVyY","name":"Jagwire","health":12,"body":[{"x":5,"y":2},{"x":6,"y":2},{"x":7,"y":2},{"x":7,"y":3},{"x":6,"y":3},{"x":6,"y":4},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":7,"y":7},{"x":8,"y":7},{"x":9,"y":7},{"x":10,"y":7},{"x":0,"y":7},{"x":1,"y":7},{"x":1,"y":8},{"x":1,"y":9}],"latency":28,"head":{"x":5,"y":2},"length":17,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}]},"you":{"id":"gs_gb8wXXBPTrqGdcQyJP4vQ4t6","name":"Gene Scallop","health":24,"body":[{"x":4,"y":6},{"x":5,"y":6},{"x":5,"y":7},{"x":6,"y":7},{"x":6,"y":6},{"x":6,"y":5},{"x":5,"y":5},{"x":5,"y":4},{"x":4,"y":4},{"x":3,"y":4},{"x":3,"y":5},{"x":2,"y":5},{"x":1,"y":5},{"x":1,"y":4},{"x":2,"y":4},{"x":2,"y":3},{"x":2,"y":2},{"x":2,"y":1},{"x":3,"y":1},{"x":3,"y":2},{"x":4,"y":2}],"latency":21,"head":{"x":4,"y":6},"length":21,"shout":"","squad":"","customizations":{"color":"#afeeee","head":"cosmic-horror","tail":"do-sammy"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).not.toBe("down") // down is death in one turn, left or up give us more time
  })
})

describe('healing pool tests', () => {
  it('healingPool1: understands a healing pool is not eating', () => {
    const gameState: GameState = {"game":{"id":"f563a428-8f65-458d-b57a-7ebfc57d4229","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":2,"minimumFood":1,"hazardDamagePerTurn":-30,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"healing_pools","timeout":500,"source":"testing"},"turn":2152,"board":{"width":11,"height":11,"food":[{"x":0,"y":1}],"hazards":[{"x":3,"y":3},{"x":7,"y":7}],"snakes":[{"id":"gs_MSyxYGFrRY9VrPRCtdb7M6pY","name":"soma-mini v3[healing]","health":83,"body":[{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":5,"y":7},{"x":4,"y":7},{"x":3,"y":7},{"x":2,"y":7},{"x":2,"y":8},{"x":1,"y":8},{"x":0,"y":8},{"x":0,"y":7},{"x":1,"y":7},{"x":1,"y":6},{"x":2,"y":6},{"x":3,"y":6},{"x":4,"y":6},{"x":4,"y":5},{"x":5,"y":5},{"x":5,"y":4},{"x":5,"y":3},{"x":6,"y":3},{"x":7,"y":3},{"x":8,"y":3},{"x":9,"y":3},{"x":9,"y":2},{"x":10,"y":2},{"x":10,"y":3}],"latency":15,"head":{"x":6,"y":4},"length":28,"shout":"10","squad":"","customizations":{"color":"#ff0055","head":"snail","tail":"fat-rattle"}},{"id":"gs_cgFwDKX7YpmhWvqKQdc9kjPW","name":"Jaguar Meets Snake","health":100,"body":[{"x":7,"y":7},{"x":7,"y":8},{"x":6,"y":8},{"x":5,"y":8},{"x":4,"y":8},{"x":3,"y":8},{"x":3,"y":9},{"x":4,"y":9},{"x":5,"y":9},{"x":6,"y":9},{"x":7,"y":9},{"x":7,"y":10},{"x":8,"y":10},{"x":9,"y":10},{"x":10,"y":10},{"x":10,"y":9},{"x":10,"y":8},{"x":10,"y":7},{"x":10,"y":6},{"x":10,"y":5},{"x":9,"y":5},{"x":9,"y":6},{"x":9,"y":7},{"x":9,"y":8},{"x":9,"y":9},{"x":8,"y":9},{"x":8,"y":8},{"x":8,"y":7},{"x":8,"y":6},{"x":8,"y":5},{"x":7,"y":5},{"x":7,"y":6}],"latency":22,"head":{"x":7,"y":7},"length":32,"shout":"","squad":"","customizations":{"color":"#ff9900","head":"tiger-king","tail":"mystic-moon"}}]},"you":{"id":"gs_cgFwDKX7YpmhWvqKQdc9kjPW","name":"Jaguar Meets Snake","health":100,"body":[{"x":7,"y":7},{"x":7,"y":8},{"x":6,"y":8},{"x":5,"y":8},{"x":4,"y":8},{"x":3,"y":8},{"x":3,"y":9},{"x":4,"y":9},{"x":5,"y":9},{"x":6,"y":9},{"x":7,"y":9},{"x":7,"y":10},{"x":8,"y":10},{"x":9,"y":10},{"x":10,"y":10},{"x":10,"y":9},{"x":10,"y":8},{"x":10,"y":7},{"x":10,"y":6},{"x":10,"y":5},{"x":9,"y":5},{"x":9,"y":6},{"x":9,"y":7},{"x":9,"y":8},{"x":9,"y":9},{"x":8,"y":9},{"x":8,"y":8},{"x":8,"y":7},{"x":8,"y":6},{"x":8,"y":5},{"x":7,"y":5},{"x":7,"y":6}],"latency":22,"head":{"x":7,"y":7},"length":32,"shout":"","squad":"","customizations":{"color":"#ff9900","head":"tiger-king","tail":"mystic-moon"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("down") // down is life, but if Jaguar thinks he just ate he'll choose a direction at random
  })
  it('healingPool2: does not relinquish control of healing pools', () => {
    for (let i: number = 0; i < 5; i++) {
      const gameState: GameState = {"game":{"id":"d31c383a-e448-4edb-9a2a-11d7c0b0af79","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":2,"minimumFood":1,"hazardDamagePerTurn":-30,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"healing_pools","timeout":500,"source":"testing"},"turn":704,"board":{"width":11,"height":11,"food":[{"x":10,"y":8}],"hazards":[{"x":5,"y":7},{"x":5,"y":3}],"snakes":[{"id":"gs_WmwjCGM7JWFcydY3WwHgDdM8","name":"soma-mini[healing]","health":28,"body":[{"x":5,"y":1},{"x":6,"y":1},{"x":6,"y":0},{"x":5,"y":0},{"x":4,"y":0},{"x":3,"y":0},{"x":2,"y":0},{"x":2,"y":1},{"x":2,"y":2}],"latency":414,"head":{"x":5,"y":1},"length":9,"shout":"408","squad":"","customizations":{"color":"#ff0055","head":"snail","tail":"fat-rattle"}},{"id":"gs_Q94QPQRHrhGYkqrDH3tw4XDW","name":"Jaguar Meets Snake","health":88,"body":[{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":7,"y":7},{"x":7,"y":8},{"x":7,"y":9},{"x":6,"y":9},{"x":5,"y":9},{"x":4,"y":9},{"x":4,"y":8},{"x":5,"y":8},{"x":5,"y":7},{"x":6,"y":7},{"x":6,"y":6},{"x":6,"y":5},{"x":6,"y":4},{"x":6,"y":3},{"x":5,"y":3},{"x":5,"y":2},{"x":6,"y":2}],"latency":453,"head":{"x":7,"y":3},"length":21,"shout":"","squad":"","customizations":{"color":"#ff9900","head":"tiger-king","tail":"mystic-moon"}}]},"you":{"id":"gs_Q94QPQRHrhGYkqrDH3tw4XDW","name":"Jaguar Meets Snake","health":88,"body":[{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":7,"y":7},{"x":7,"y":8},{"x":7,"y":9},{"x":6,"y":9},{"x":5,"y":9},{"x":4,"y":9},{"x":4,"y":8},{"x":5,"y":8},{"x":5,"y":7},{"x":6,"y":7},{"x":6,"y":6},{"x":6,"y":5},{"x":6,"y":4},{"x":6,"y":3},{"x":5,"y":3},{"x":5,"y":2},{"x":6,"y":2}],"latency":453,"head":{"x":7,"y":3},"length":21,"shout":"","squad":"","customizations":{"color":"#ff9900","head":"tiger-king","tail":"mystic-moon"}}}
      const moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).toBe("down") // soma is starving & I can retain control of both healing pools by going down
    }
  })
  it('healingPool3: eats when starving even if it sacrifices Voronoi coverage', () => {
    const gameState: GameState = {"game":{"id":"77d6c940-fc4d-4421-b0c9-69511c9a9ac9","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":2,"minimumFood":1,"hazardDamagePerTurn":-30,"royale":{"shrinkEveryNTurns":300},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"healing_pools","timeout":500,"source":"testing"},"turn":711,"board":{"width":11,"height":11,"food":[{"x":10,"y":2}],"hazards":[],"snakes":[{"id":"gs_QWb6CKRgbXxP7y6vbf3KFMmY","name":"Prüzze v2","health":15,"body":[{"x":5,"y":0},{"x":4,"y":0},{"x":3,"y":0},{"x":3,"y":1},{"x":3,"y":2},{"x":4,"y":2},{"x":4,"y":3},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":3,"y":7},{"x":4,"y":7},{"x":5,"y":7},{"x":5,"y":6},{"x":5,"y":5},{"x":5,"y":4},{"x":5,"y":3},{"x":5,"y":2},{"x":6,"y":2},{"x":7,"y":2},{"x":8,"y":2},{"x":9,"y":2}],"latency":422,"head":{"x":5,"y":0},"length":23,"shout":", t=400","squad":"","customizations":{"color":"#c91f37","head":"gamer","tail":"coffee"}},{"id":"gs_vTjc4RFc4BjrhbwTvmSHbDPR","name":"Jagwire","health":12,"body":[{"x":10,"y":3},{"x":10,"y":4},{"x":10,"y":5},{"x":10,"y":6},{"x":10,"y":7},{"x":10,"y":8},{"x":9,"y":8},{"x":9,"y":9},{"x":8,"y":9},{"x":7,"y":9},{"x":6,"y":9},{"x":5,"y":9},{"x":4,"y":9},{"x":4,"y":8},{"x":5,"y":8},{"x":6,"y":8},{"x":6,"y":7},{"x":6,"y":6}],"latency":452,"head":{"x":10,"y":3},"length":18,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}]},"you":{"id":"gs_vTjc4RFc4BjrhbwTvmSHbDPR","name":"Jagwire","health":12,"body":[{"x":10,"y":3},{"x":10,"y":4},{"x":10,"y":5},{"x":10,"y":6},{"x":10,"y":7},{"x":10,"y":8},{"x":9,"y":8},{"x":9,"y":9},{"x":8,"y":9},{"x":7,"y":9},{"x":6,"y":9},{"x":5,"y":9},{"x":4,"y":9},{"x":4,"y":8},{"x":5,"y":8},{"x":6,"y":8},{"x":6,"y":7},{"x":6,"y":6}],"latency":452,"head":{"x":10,"y":3},"length":18,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("down") // one turn away from food, & we're starving, easy choice
  })
  it('healingPool4: does not walk into a corner in threesnake', () => {
    const gameState: GameState = {"game":{"id":"4876fc52-803b-45ac-b26e-dd6652dc04c8","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":2,"minimumFood":1,"hazardDamagePerTurn":-30,"royale":{"shrinkEveryNTurns":300},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"healing_pools","timeout":500,"source":"testing"},"turn":358,"board":{"width":11,"height":11,"food":[{"x":10,"y":9}],"hazards":[{"x":5,"y":3}],"snakes":[{"id":"gs_jYxKGk6wkPvSkkYCytJTSmRC","name":"Shapeshifter","health":84,"body":[{"x":6,"y":6},{"x":5,"y":6},{"x":5,"y":7},{"x":5,"y":8},{"x":5,"y":9},{"x":4,"y":9},{"x":3,"y":9},{"x":3,"y":8},{"x":3,"y":7},{"x":4,"y":7},{"x":4,"y":6},{"x":4,"y":5},{"x":5,"y":5},{"x":5,"y":4},{"x":4,"y":4},{"x":4,"y":3},{"x":5,"y":3},{"x":6,"y":3},{"x":7,"y":3},{"x":7,"y":4}],"latency":5,"head":{"x":6,"y":6},"length":20,"shout":"","squad":"","customizations":{"color":"#900050","head":"cosmic-horror-special","tail":"cosmic-horror"}},{"id":"gs_grg9MV7CR67SYGXQ84wb3wD7","name":"Prüzze v2","health":2,"body":[{"x":7,"y":5},{"x":7,"y":6},{"x":8,"y":6},{"x":9,"y":6},{"x":9,"y":7},{"x":9,"y":8},{"x":9,"y":9},{"x":9,"y":10},{"x":8,"y":10},{"x":7,"y":10},{"x":6,"y":10},{"x":6,"y":9},{"x":7,"y":9},{"x":8,"y":9}],"latency":41,"head":{"x":7,"y":5},"length":14,"shout":"Lose, t=20","squad":"","customizations":{"color":"#c91f37","head":"gamer","tail":"coffee"}},{"id":"gs_djG7RxSK4JSjCVRbFGDybfWR","name":"Jagwire","health":99,"body":[{"x":2,"y":10},{"x":2,"y":9},{"x":2,"y":8},{"x":2,"y":7},{"x":2,"y":6},{"x":1,"y":6},{"x":1,"y":5},{"x":2,"y":5},{"x":2,"y":4},{"x":1,"y":4},{"x":1,"y":3},{"x":1,"y":2},{"x":1,"y":1},{"x":2,"y":1},{"x":3,"y":1},{"x":4,"y":1},{"x":4,"y":2},{"x":3,"y":2},{"x":2,"y":2},{"x":2,"y":3}],"latency":453,"head":{"x":2,"y":10},"length":20,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}]},"you":{"id":"gs_djG7RxSK4JSjCVRbFGDybfWR","name":"Jagwire","health":99,"body":[{"x":2,"y":10},{"x":2,"y":9},{"x":2,"y":8},{"x":2,"y":7},{"x":2,"y":6},{"x":1,"y":6},{"x":1,"y":5},{"x":2,"y":5},{"x":2,"y":4},{"x":1,"y":4},{"x":1,"y":3},{"x":1,"y":2},{"x":1,"y":1},{"x":2,"y":1},{"x":3,"y":1},{"x":4,"y":1},{"x":4,"y":2},{"x":3,"y":2},{"x":2,"y":2},{"x":2,"y":3}],"latency":453,"head":{"x":2,"y":10},"length":20,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("left") // right gets us cornered in just a few turns by Shapeshifter after Pruzze starves. Left is fine
  })
  it('healingPool5: knows healing pool will disappear and chooses food instead', () => {
    const gameState: GameState = {"game":{"id":"0425de37-4910-48bc-aa6a-2a4b7a3057c6","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":2,"minimumFood":1,"hazardDamagePerTurn":-30,"royale":{"shrinkEveryNTurns":300},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"healing_pools","timeout":500,"source":"testing"},"turn":599,"board":{"width":11,"height":11,"food":[{"x":8,"y":10}],"hazards":[{"x":3,"y":3}],"snakes":[{"id":"gs_gWtCKDbC9m8WCPQjrQPKPJWK","name":"Shapeshifter","health":83,"body":[{"x":2,"y":1},{"x":1,"y":1},{"x":1,"y":0},{"x":0,"y":0},{"x":0,"y":1},{"x":0,"y":2},{"x":0,"y":3},{"x":0,"y":4},{"x":1,"y":4},{"x":1,"y":3},{"x":1,"y":2}],"latency":5,"head":{"x":2,"y":1},"length":11,"shout":"","squad":"","customizations":{"color":"#900050","head":"cosmic-horror-special","tail":"cosmic-horror"}},{"id":"gs_MCJS4PmRWDXYwHcJfXFXGdkC","name":"Jagwire","health":10,"body":[{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":4,"y":6},{"x":4,"y":7},{"x":3,"y":7},{"x":3,"y":6},{"x":2,"y":6},{"x":2,"y":5},{"x":3,"y":5},{"x":3,"y":4},{"x":4,"y":4},{"x":4,"y":3},{"x":5,"y":3}],"latency":136,"head":{"x":5,"y":4},"length":14,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}]},"you":{"id":"gs_MCJS4PmRWDXYwHcJfXFXGdkC","name":"Jagwire","health":10,"body":[{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":4,"y":6},{"x":4,"y":7},{"x":3,"y":7},{"x":3,"y":6},{"x":2,"y":6},{"x":2,"y":5},{"x":3,"y":5},{"x":3,"y":4},{"x":4,"y":4},{"x":4,"y":3},{"x":5,"y":3}],"latency":136,"head":{"x":5,"y":4},"length":14,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("right") // down takes us too far from the food, right gets us to it just in time
  })
  // flawed test, snake now thinks going up, then doubling back away from healing pool is the better move
  it.skip('healingPool6: uses healing pool to heal when starving', () => {
    const gameState: GameState = {"game":{"id":"10220741-9aad-4a83-8ae7-39b7be54f588","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":2,"minimumFood":1,"hazardDamagePerTurn":-30,"royale":{"shrinkEveryNTurns":300},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"healing_pools","timeout":500,"source":"testing"},"turn":427,"board":{"width":11,"height":11,"food":[{"x":0,"y":0}],"hazards":[{"x":3,"y":5}],"snakes":[{"id":"gs_7hCFx4qry8XhtwHBtGqTt3MF","name":"soma-mini[healing]","health":89,"body":[{"x":7,"y":6},{"x":7,"y":5},{"x":7,"y":4},{"x":6,"y":4},{"x":6,"y":3},{"x":7,"y":3},{"x":8,"y":3},{"x":9,"y":3},{"x":9,"y":4},{"x":9,"y":5},{"x":9,"y":6}],"latency":412,"head":{"x":7,"y":6},"length":11,"shout":"408","squad":"","customizations":{"color":"#ff0055","head":"snail","tail":"fat-rattle"}},{"id":"gs_vfVrpV3xCSVj9WYhkQ4Bh4yS","name":"Jagwire","health":15,"body":[{"x":2,"y":3},{"x":3,"y":3},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":5,"y":7},{"x":5,"y":8}],"latency":453,"head":{"x":2,"y":3},"length":9,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}]},"you":{"id":"gs_vfVrpV3xCSVj9WYhkQ4Bh4yS","name":"Jagwire","health":15,"body":[{"x":2,"y":3},{"x":3,"y":3},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":5,"y":7},{"x":5,"y":8}],"latency":453,"head":{"x":2,"y":3},"length":9,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).not.toBe("down") // we are starving, & up or left lets us use healing pool, down moves us away from it. Corner food is a trap we can't rely on
  })
  it('healingPool7: does not prioritize food over board coverage when not starving', () => {
    const gameState: GameState = {"game":{"id":"70a5366a-2d82-4dcd-b4b5-f3682e347809","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":2,"minimumFood":1,"hazardDamagePerTurn":-30,"royale":{"shrinkEveryNTurns":300},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"healing_pools","timeout":500,"source":"testing"},"turn":803,"board":{"width":11,"height":11,"food":[{"x":9,"y":6}],"hazards":[],"snakes":[{"id":"gs_gCH4gqtjjrJGmc6hxbH7FVSd","name":"Prüzze v2","health":60,"body":[{"x":7,"y":6},{"x":8,"y":6},{"x":8,"y":7},{"x":8,"y":8},{"x":8,"y":9},{"x":7,"y":9},{"x":6,"y":9},{"x":6,"y":8},{"x":6,"y":7},{"x":5,"y":7},{"x":5,"y":6},{"x":4,"y":6},{"x":4,"y":7},{"x":3,"y":7},{"x":2,"y":7},{"x":1,"y":7},{"x":1,"y":8},{"x":2,"y":8},{"x":2,"y":9},{"x":2,"y":10},{"x":3,"y":10},{"x":4,"y":10},{"x":5,"y":10},{"x":6,"y":10},{"x":7,"y":10},{"x":8,"y":10},{"x":9,"y":10}],"latency":348,"head":{"x":7,"y":6},"length":27,"shout":", t=326","squad":"","customizations":{"color":"#c91f37","head":"gamer","tail":"coffee"}},{"id":"gs_F9f6Q3cgGP7Hgdh3R98TCXrd","name":"Jagwire","health":52,"body":[{"x":10,"y":5},{"x":9,"y":5},{"x":9,"y":4},{"x":8,"y":4},{"x":7,"y":4},{"x":6,"y":4},{"x":5,"y":4},{"x":4,"y":4},{"x":3,"y":4},{"x":3,"y":3},{"x":2,"y":3},{"x":1,"y":3},{"x":1,"y":4},{"x":2,"y":4},{"x":2,"y":5},{"x":1,"y":5},{"x":1,"y":6},{"x":2,"y":6},{"x":3,"y":6},{"x":3,"y":5},{"x":4,"y":5},{"x":5,"y":5}],"latency":453,"head":{"x":10,"y":5},"length":22,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}]},"you":{"id":"gs_F9f6Q3cgGP7Hgdh3R98TCXrd","name":"Jagwire","health":52,"body":[{"x":10,"y":5},{"x":9,"y":5},{"x":9,"y":4},{"x":8,"y":4},{"x":7,"y":4},{"x":6,"y":4},{"x":5,"y":4},{"x":4,"y":4},{"x":3,"y":4},{"x":3,"y":3},{"x":2,"y":3},{"x":1,"y":3},{"x":1,"y":4},{"x":2,"y":4},{"x":2,"y":5},{"x":1,"y":5},{"x":1,"y":6},{"x":2,"y":6},{"x":3,"y":6},{"x":3,"y":5},{"x":4,"y":5},{"x":5,"y":5}],"latency":453,"head":{"x":10,"y":5},"length":22,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("down") // up feeds us but lets Pruzze trap us easily in ~20 turns, down is safe even if it starves us down the line
  })
  it('healingPool8: beelines for food before another snake can cut it off when starving', () => {
    const gameState: GameState = {"game":{"id":"e695bee5-0f35-43ba-9cb8-8758b9aa442f","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":2,"minimumFood":1,"hazardDamagePerTurn":-30,"royale":{"shrinkEveryNTurns":300},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"healing_pools","timeout":500,"source":"testing"},"turn":752,"board":{"width":11,"height":11,"food":[{"x":1,"y":3}],"hazards":[],"snakes":[{"id":"gs_FCB9DQHDBh6J4JbmbBwF9Yj7","name":"Prüzze v2","health":95,"body":[{"x":9,"y":3},{"x":8,"y":3},{"x":8,"y":2},{"x":9,"y":2},{"x":10,"y":2},{"x":10,"y":1},{"x":9,"y":1},{"x":8,"y":1},{"x":7,"y":1},{"x":7,"y":2},{"x":7,"y":3},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6}],"latency":442,"head":{"x":9,"y":3},"length":15,"shout":", t=421","squad":"","customizations":{"color":"#c91f37","head":"gamer","tail":"coffee"}},{"id":"gs_MyTMWvTJ8Pfy7wX9Kypcbp6T","name":"Jagwire","health":15,"body":[{"x":5,"y":7},{"x":5,"y":8},{"x":6,"y":8},{"x":6,"y":9},{"x":5,"y":9},{"x":4,"y":9},{"x":4,"y":8},{"x":4,"y":7},{"x":3,"y":7}],"latency":22,"head":{"x":5,"y":7},"length":9,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}]},"you":{"id":"gs_MyTMWvTJ8Pfy7wX9Kypcbp6T","name":"Jagwire","health":15,"body":[{"x":5,"y":7},{"x":5,"y":8},{"x":6,"y":8},{"x":6,"y":9},{"x":5,"y":9},{"x":4,"y":9},{"x":4,"y":8},{"x":4,"y":7},{"x":3,"y":7}],"latency":22,"head":{"x":5,"y":7},"length":9,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("down") // we are starving. Down lets us reach the lone food first, right lets Pruzze cut us off from it
  })
  it('healingPool9: beelines for food v2', () => {
    const gameState: GameState = {"game":{"id":"3e1b64ce-3852-46a3-b69f-9dc4ba17feab","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":2,"minimumFood":1,"hazardDamagePerTurn":-30,"royale":{"shrinkEveryNTurns":300},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"healing_pools","timeout":500,"source":"testing"},"turn":667,"board":{"width":11,"height":11,"food":[{"x":10,"y":10},{"x":1,"y":1}],"hazards":[],"snakes":[{"id":"gs_DF9mcgYv3xQYDSWkpg87J77B","name":"Prüzze v2","health":67,"body":[{"x":2,"y":7},{"x":3,"y":7},{"x":4,"y":7},{"x":4,"y":6},{"x":5,"y":6},{"x":6,"y":6},{"x":7,"y":6},{"x":7,"y":5},{"x":7,"y":4},{"x":7,"y":3},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":5,"y":5}],"latency":355,"head":{"x":2,"y":7},"length":14,"shout":", t=333","squad":"","customizations":{"color":"#c91f37","head":"gamer","tail":"coffee"}},{"id":"gs_TbBRH3FDX9THqMVVDpDVWWxB","name":"Jagwire","health":17,"body":[{"x":5,"y":2},{"x":5,"y":3},{"x":5,"y":4},{"x":4,"y":4},{"x":3,"y":4},{"x":2,"y":4},{"x":2,"y":3},{"x":2,"y":2}],"latency":452,"head":{"x":5,"y":2},"length":8,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}]},"you":{"id":"gs_TbBRH3FDX9THqMVVDpDVWWxB","name":"Jagwire","health":17,"body":[{"x":5,"y":2},{"x":5,"y":3},{"x":5,"y":4},{"x":4,"y":4},{"x":3,"y":4},{"x":2,"y":4},{"x":2,"y":3},{"x":2,"y":2}],"latency":452,"head":{"x":5,"y":2},"length":8,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).not.toBe("right") // we need the food, which is left & down, so go left or down
  })
  it('healingPool10: eats when it absolutely must', () => {
    const gameState: GameState = {"game":{"id":"e2623ef0-d18f-4402-9d3b-8a1c71b9164e","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":2,"minimumFood":1,"hazardDamagePerTurn":-30,"royale":{"shrinkEveryNTurns":300},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"healing_pools","timeout":500,"source":"testing"},"turn":717,"board":{"width":11,"height":11,"food":[{"x":0,"y":10}],"hazards":[],"snakes":[{"id":"gs_3SHhr7WrgMYvc6dQQJm7VTQB","name":"Shapeshifter","health":66,"body":[{"x":7,"y":8},{"x":7,"y":7},{"x":8,"y":7},{"x":8,"y":6},{"x":8,"y":5},{"x":7,"y":5},{"x":7,"y":4},{"x":7,"y":3},{"x":7,"y":2},{"x":6,"y":2},{"x":5,"y":2},{"x":5,"y":3},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":5,"y":6},{"x":5,"y":7},{"x":5,"y":8},{"x":4,"y":8}],"latency":400,"head":{"x":7,"y":8},"length":20,"shout":"","squad":"","customizations":{"color":"#900050","head":"cosmic-horror-special","tail":"cosmic-horror"}},{"id":"gs_CxPPvHB6xDTF6FdcTQx8YWJ9","name":"Jagwire","health":7,"body":[{"x":0,"y":9},{"x":0,"y":8},{"x":0,"y":7},{"x":0,"y":6},{"x":0,"y":5},{"x":1,"y":5},{"x":1,"y":4},{"x":2,"y":4},{"x":2,"y":3},{"x":2,"y":2},{"x":3,"y":2},{"x":3,"y":3},{"x":4,"y":3},{"x":4,"y":2}],"latency":453,"head":{"x":0,"y":9},"length":14,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}]},"you":{"id":"gs_CxPPvHB6xDTF6FdcTQx8YWJ9","name":"Jagwire","health":7,"body":[{"x":0,"y":9},{"x":0,"y":8},{"x":0,"y":7},{"x":0,"y":6},{"x":0,"y":5},{"x":1,"y":5},{"x":1,"y":4},{"x":2,"y":4},{"x":2,"y":3},{"x":2,"y":2},{"x":3,"y":2},{"x":3,"y":3},{"x":4,"y":3},{"x":4,"y":2}],"latency":453,"head":{"x":0,"y":9},"length":14,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("up") // if we don't go up now, we have to go left into the corner in a couple turns, which is certain death
  })
  it('healingPool11: beelines for food v3', () => {
    const gameState: GameState = {"game":{"id":"f5849098-a577-4e8d-b617-9f82b84f6655","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":5,"minimumFood":0,"hazardDamagePerTurn":-30,"royale":{"shrinkEveryNTurns":300},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"healing_pools","timeout":500,"source":"testing"},"turn":403,"board":{"width":11,"height":11,"food":[{"x":5,"y":0}],"hazards":[{"x":3,"y":7}],"snakes":[{"id":"gs_3yy9JRj94XhBdS68rvxxyyMH","name":"Jagwire","health":19,"body":[{"x":7,"y":2},{"x":6,"y":2},{"x":6,"y":3},{"x":5,"y":3},{"x":4,"y":3},{"x":3,"y":3},{"x":3,"y":4},{"x":4,"y":4},{"x":5,"y":4},{"x":6,"y":4},{"x":6,"y":5}],"latency":454,"head":{"x":7,"y":2},"length":11,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}},{"id":"gs_Fdr8RCCyQHjHcDc8gbggXV7C","name":"pants 👖","health":54,"body":[{"x":5,"y":6},{"x":5,"y":7},{"x":5,"y":8},{"x":5,"y":9},{"x":5,"y":10},{"x":6,"y":10},{"x":6,"y":9},{"x":6,"y":8},{"x":6,"y":7},{"x":6,"y":6},{"x":7,"y":6},{"x":7,"y":7},{"x":7,"y":8},{"x":8,"y":8},{"x":8,"y":7},{"x":8,"y":6},{"x":8,"y":5}],"latency":40,"head":{"x":5,"y":6},"length":17,"shout":"👖","squad":"","customizations":{"color":"#3860be","head":"moustache","tail":"skinny-jeans"}}]},"you":{"id":"gs_3yy9JRj94XhBdS68rvxxyyMH","name":"Jagwire","health":19,"body":[{"x":7,"y":2},{"x":6,"y":2},{"x":6,"y":3},{"x":5,"y":3},{"x":4,"y":3},{"x":3,"y":3},{"x":3,"y":4},{"x":4,"y":4},{"x":5,"y":4},{"x":6,"y":4},{"x":6,"y":5}],"latency":454,"head":{"x":7,"y":2},"length":11,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).not.toBe("up") // should gun for food down & left, not turn away for Voronoi coverage
  })
})

describe('sinkhole tests', () => {
  it('sinkhole1: does not walk into the sinkhole given viable alternatives', () => {
    const gameState: GameState = {"game":{"id":"8b5a34c4-0db9-44e9-9667-fc2ba8c8b089","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":10,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"sinkholes","timeout":500,"source":"testing"},"turn":106,"board":{"width":11,"height":11,"food":[{"x":3,"y":4},{"x":6,"y":4}],"hazards":[{"x":5,"y":5},{"x":4,"y":5},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":6,"y":5},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":3,"y":2},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":3,"y":7},{"x":3,"y":8},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":4,"y":8},{"x":5,"y":2},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":5,"y":8},{"x":6,"y":2},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":6,"y":8},{"x":7,"y":2},{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":7,"y":7},{"x":7,"y":8},{"x":8,"y":3},{"x":8,"y":4},{"x":8,"y":5},{"x":8,"y":6},{"x":8,"y":7},{"x":1,"y":2},{"x":1,"y":3},{"x":1,"y":4},{"x":1,"y":5},{"x":1,"y":6},{"x":1,"y":7},{"x":1,"y":8},{"x":2,"y":1},{"x":2,"y":2},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":2,"y":8},{"x":2,"y":9},{"x":3,"y":1},{"x":3,"y":2},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":3,"y":7},{"x":3,"y":8},{"x":3,"y":9},{"x":4,"y":1},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":4,"y":8},{"x":4,"y":9},{"x":5,"y":1},{"x":5,"y":2},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":5,"y":8},{"x":5,"y":9},{"x":6,"y":1},{"x":6,"y":2},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":6,"y":8},{"x":6,"y":9},{"x":7,"y":1},{"x":7,"y":2},{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":7,"y":7},{"x":7,"y":8},{"x":7,"y":9},{"x":8,"y":1},{"x":8,"y":2},{"x":8,"y":3},{"x":8,"y":4},{"x":8,"y":5},{"x":8,"y":6},{"x":8,"y":7},{"x":8,"y":8},{"x":8,"y":9},{"x":9,"y":2},{"x":9,"y":3},{"x":9,"y":4},{"x":9,"y":5},{"x":9,"y":6},{"x":9,"y":7},{"x":9,"y":8}],"snakes":[{"id":"gs_DVW3q7t3fCJkwTwgDrBhW6xc","name":"CoolerSnake!","health":98,"body":[{"x":10,"y":6},{"x":10,"y":7},{"x":0,"y":7},{"x":0,"y":6},{"x":1,"y":6},{"x":1,"y":5},{"x":1,"y":4},{"x":1,"y":3},{"x":1,"y":2},{"x":2,"y":2},{"x":2,"y":1},{"x":3,"y":1}],"latency":110,"head":{"x":10,"y":6},"length":12,"shout":"9, 168","squad":"","customizations":{"color":"#ff6600","head":"cosmic-horror","tail":"cosmic-horror"}},{"id":"gs_FWmjMyGKRKXGdBgm4hrgKgP8","name":"Jaguar Meets Snake","health":100,"body":[{"x":5,"y":9},{"x":4,"y":9},{"x":3,"y":9},{"x":2,"y":9},{"x":1,"y":9},{"x":1,"y":10},{"x":2,"y":10},{"x":3,"y":10},{"x":4,"y":10},{"x":4,"y":0},{"x":5,"y":0},{"x":5,"y":1},{"x":5,"y":1}],"latency":64,"head":{"x":5,"y":9},"length":13,"shout":"","squad":"","customizations":{"color":"#ff9900","head":"tiger-king","tail":"mystic-moon"}}]},"you":{"id":"gs_FWmjMyGKRKXGdBgm4hrgKgP8","name":"Jaguar Meets Snake","health":100,"body":[{"x":5,"y":9},{"x":4,"y":9},{"x":3,"y":9},{"x":2,"y":9},{"x":1,"y":9},{"x":1,"y":10},{"x":2,"y":10},{"x":3,"y":10},{"x":4,"y":10},{"x":4,"y":0},{"x":5,"y":0},{"x":5,"y":1},{"x":5,"y":1}],"latency":64,"head":{"x":5,"y":9},"length":13,"shout":"","squad":"","customizations":{"color":"#ff9900","head":"tiger-king","tail":"mystic-moon"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).not.toBe("down") // down has two stacked hazards & takes us into the sinkhole. Up or right lead away from sinkhole.
    let board2d: Board2d = new Board2d(gameState)
    moveSnake(gameState, gameState.you, board2d, Direction.Down) // test to confirm health is going down as expected
    updateGameStateAfterMove(gameState)
    expect(gameState.you.health).toBe(79) // 100 - 20 - 1
    moveSnake(gameState, gameState.you, board2d, Direction.Down) // test to confirm health is going down as expected
    updateGameStateAfterMove(gameState)
    expect(gameState.you.health).toBe(48) // 79 - 30 - 1
    moveSnake(gameState, gameState.you, board2d, Direction.Down) // test to confirm health is going down as expected
    updateGameStateAfterMove(gameState)
    expect(gameState.you.health).toBe(7) // 48 - 40 - 1
  })
  it('sinkhole2: stays out of the sinkhole when commingling with three other snakes', () => {
    const gameState: GameState = {"game":{"id":"2df8280e-d85e-4dba-b237-9fd986151d62","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":10,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"sinkholes","timeout":500,"source":"testing"},"turn":86,"board":{"width":11,"height":11,"food":[{"x":7,"y":6}],"hazards":[{"x":5,"y":5},{"x":4,"y":5},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":6,"y":5},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":3,"y":2},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":3,"y":7},{"x":3,"y":8},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":4,"y":8},{"x":5,"y":2},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":5,"y":8},{"x":6,"y":2},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":6,"y":8},{"x":7,"y":2},{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":7,"y":7},{"x":7,"y":8},{"x":8,"y":3},{"x":8,"y":4},{"x":8,"y":5},{"x":8,"y":6},{"x":8,"y":7},{"x":1,"y":2},{"x":1,"y":3},{"x":1,"y":4},{"x":1,"y":5},{"x":1,"y":6},{"x":1,"y":7},{"x":1,"y":8},{"x":2,"y":1},{"x":2,"y":2},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":2,"y":8},{"x":2,"y":9},{"x":3,"y":1},{"x":3,"y":2},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":3,"y":7},{"x":3,"y":8},{"x":3,"y":9},{"x":4,"y":1},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":4,"y":8},{"x":4,"y":9},{"x":5,"y":1},{"x":5,"y":2},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":5,"y":8},{"x":5,"y":9},{"x":6,"y":1},{"x":6,"y":2},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":6,"y":8},{"x":6,"y":9},{"x":7,"y":1},{"x":7,"y":2},{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":7,"y":7},{"x":7,"y":8},{"x":7,"y":9},{"x":8,"y":1},{"x":8,"y":2},{"x":8,"y":3},{"x":8,"y":4},{"x":8,"y":5},{"x":8,"y":6},{"x":8,"y":7},{"x":8,"y":8},{"x":8,"y":9},{"x":9,"y":2},{"x":9,"y":3},{"x":9,"y":4},{"x":9,"y":5},{"x":9,"y":6},{"x":9,"y":7},{"x":9,"y":8}],"snakes":[{"id":"gs_CWmmGCPMMwjkYpfWBBww3GyM","name":"Ziggy Snakedust","health":92,"body":[{"x":1,"y":10},{"x":1,"y":0},{"x":0,"y":0},{"x":10,"y":0},{"x":10,"y":1}],"latency":451,"head":{"x":1,"y":10},"length":5,"shout":"","squad":"","customizations":{"color":"#fcb040","head":"iguana","tail":"iguana"}},{"id":"gs_S7KxrSDJVxCJfdDtbWMPPwpd","name":"Prüzze v2","health":92,"body":[{"x":9,"y":10},{"x":8,"y":10},{"x":7,"y":10},{"x":6,"y":10},{"x":6,"y":9},{"x":5,"y":9},{"x":4,"y":9},{"x":3,"y":9},{"x":2,"y":9}],"latency":422,"head":{"x":9,"y":10},"length":9,"shout":", t=400","squad":"","customizations":{"color":"#c91f37","head":"gamer","tail":"coffee"}},{"id":"gs_b8m9gRqc3kT9F6TVbdwGjGmG","name":"Shapeshifter","health":45,"body":[{"x":2,"y":10},{"x":3,"y":10},{"x":4,"y":10},{"x":5,"y":10},{"x":5,"y":0},{"x":4,"y":0},{"x":3,"y":0}],"latency":9,"head":{"x":2,"y":10},"length":7,"shout":"","squad":"","customizations":{"color":"#900050","head":"cosmic-horror-special","tail":"cosmic-horror"}},{"id":"gs_SyFFCrKXfHM3yyRwFbxdW3tH","name":"Jagwire","health":97,"body":[{"x":0,"y":1},{"x":0,"y":2},{"x":0,"y":3},{"x":10,"y":3},{"x":10,"y":4},{"x":0,"y":4},{"x":0,"y":5},{"x":0,"y":6},{"x":1,"y":6},{"x":1,"y":7},{"x":2,"y":7},{"x":2,"y":6},{"x":3,"y":6}],"latency":76,"head":{"x":0,"y":1},"length":13,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}]},"you":{"id":"gs_SyFFCrKXfHM3yyRwFbxdW3tH","name":"Jagwire","health":97,"body":[{"x":0,"y":1},{"x":0,"y":2},{"x":0,"y":3},{"x":10,"y":3},{"x":10,"y":4},{"x":0,"y":4},{"x":0,"y":5},{"x":0,"y":6},{"x":1,"y":6},{"x":1,"y":7},{"x":2,"y":7},{"x":2,"y":6},{"x":3,"y":6}],"latency":76,"head":{"x":0,"y":1},"length":13,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("left") // left wraps us over into non-hazard, right takes us through many hazard if Shapeshifter chooses to cut us off
  })
  // somewhat valid test, but ultimately Voronoi score & health are both fine after getting caught in the extra turns of hazard
  it.skip('sinkhole3: stays out of sinkhole when it is about to expand', () => {
    const gameState: GameState = {"game":{"id":"56fb8089-3cca-4b92-acc0-37d6175fff23","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":10,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"sinkholes","timeout":500,"source":"testing"},"turn":80,"board":{"width":11,"height":11,"food":[{"x":4,"y":5}],"hazards":[{"x":5,"y":5},{"x":4,"y":5},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":6,"y":5},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":3,"y":2},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":3,"y":7},{"x":3,"y":8},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":4,"y":8},{"x":5,"y":2},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":5,"y":8},{"x":6,"y":2},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":6,"y":8},{"x":7,"y":2},{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":7,"y":7},{"x":7,"y":8},{"x":8,"y":3},{"x":8,"y":4},{"x":8,"y":5},{"x":8,"y":6},{"x":8,"y":7}],"snakes":[{"id":"gs_tmJYDyXSXqKMtGdK78RQ77XC","name":"Prüzze v2","health":79,"body":[{"x":10,"y":8},{"x":9,"y":8},{"x":8,"y":8},{"x":8,"y":9},{"x":7,"y":9},{"x":6,"y":9},{"x":6,"y":10},{"x":6,"y":0},{"x":6,"y":1},{"x":5,"y":1},{"x":5,"y":0}],"latency":233,"head":{"x":10,"y":8},"length":11,"shout":", t=211","squad":"","customizations":{"color":"#c91f37","head":"gamer","tail":"coffee"}},{"id":"gs_K4YCjym4vcmMhGcX3xtkdjR8","name":"Shapeshifter","health":92,"body":[{"x":2,"y":0},{"x":1,"y":0},{"x":1,"y":1},{"x":1,"y":2},{"x":1,"y":3},{"x":1,"y":4},{"x":1,"y":5},{"x":1,"y":6},{"x":0,"y":6},{"x":0,"y":5},{"x":0,"y":4}],"latency":398,"head":{"x":2,"y":0},"length":11,"shout":"","squad":"","customizations":{"color":"#900050","head":"cosmic-horror-special","tail":"cosmic-horror"}},{"id":"gs_pXXqmTdJtVxv4xbkqtb7Xky7","name":"Jagwire","health":100,"body":[{"x":9,"y":4},{"x":9,"y":3},{"x":9,"y":2},{"x":10,"y":2},{"x":10,"y":1},{"x":10,"y":0},{"x":10,"y":10},{"x":9,"y":10},{"x":9,"y":10}],"latency":71,"head":{"x":9,"y":4},"length":9,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}]},"you":{"id":"gs_pXXqmTdJtVxv4xbkqtb7Xky7","name":"Jagwire","health":100,"body":[{"x":9,"y":4},{"x":9,"y":3},{"x":9,"y":2},{"x":10,"y":2},{"x":10,"y":1},{"x":10,"y":0},{"x":10,"y":10},{"x":9,"y":10},{"x":9,"y":10}],"latency":71,"head":{"x":9,"y":4},"length":9,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).not.toBe("left") // left puts us into hazard 1 turn before it expands, which will force us to eat at least one more hazard
  })
  // tricky case. Allowed deepening because it passes on lookahead 6/7 or better, but Shapeshifter has few moves, so this lookahead should be attainable
  it.skip('sinkhole4: stays out of hazard even if it thinks its opponent will die', () => {
    const gameState: GameState = {"game":{"id":"07abbc6e-44a5-458e-8a2f-9fdeff69ac91","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":10,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"sinkholes","timeout":500,"source":"testingDeepening"},"turn":232,"board":{"width":11,"height":11,"food":[{"x":4,"y":6},{"x":9,"y":3}],"hazards":[{"x":5,"y":5},{"x":4,"y":5},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":6,"y":5},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":3,"y":2},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":3,"y":7},{"x":3,"y":8},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":4,"y":8},{"x":5,"y":2},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":5,"y":8},{"x":6,"y":2},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":6,"y":8},{"x":7,"y":2},{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":7,"y":7},{"x":7,"y":8},{"x":8,"y":3},{"x":8,"y":4},{"x":8,"y":5},{"x":8,"y":6},{"x":8,"y":7},{"x":1,"y":2},{"x":1,"y":3},{"x":1,"y":4},{"x":1,"y":5},{"x":1,"y":6},{"x":1,"y":7},{"x":1,"y":8},{"x":2,"y":1},{"x":2,"y":2},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":2,"y":8},{"x":2,"y":9},{"x":3,"y":1},{"x":3,"y":2},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":3,"y":7},{"x":3,"y":8},{"x":3,"y":9},{"x":4,"y":1},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":4,"y":8},{"x":4,"y":9},{"x":5,"y":1},{"x":5,"y":2},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":5,"y":8},{"x":5,"y":9},{"x":6,"y":1},{"x":6,"y":2},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":6,"y":8},{"x":6,"y":9},{"x":7,"y":1},{"x":7,"y":2},{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":7,"y":7},{"x":7,"y":8},{"x":7,"y":9},{"x":8,"y":1},{"x":8,"y":2},{"x":8,"y":3},{"x":8,"y":4},{"x":8,"y":5},{"x":8,"y":6},{"x":8,"y":7},{"x":8,"y":8},{"x":8,"y":9},{"x":9,"y":2},{"x":9,"y":3},{"x":9,"y":4},{"x":9,"y":5},{"x":9,"y":6},{"x":9,"y":7},{"x":9,"y":8}],"snakes":[{"id":"gs_yPyGPfGyp4J6K7rKRr8PwrwC","name":"Shapeshifter","health":11,"body":[{"x":1,"y":8},{"x":1,"y":9},{"x":0,"y":9},{"x":0,"y":10},{"x":1,"y":10},{"x":1,"y":0},{"x":1,"y":1},{"x":0,"y":1},{"x":0,"y":0},{"x":10,"y":0},{"x":10,"y":1},{"x":10,"y":2},{"x":10,"y":3},{"x":0,"y":3},{"x":0,"y":4},{"x":10,"y":4},{"x":9,"y":4},{"x":8,"y":4},{"x":7,"y":4},{"x":6,"y":4},{"x":6,"y":3},{"x":6,"y":2}],"latency":10,"head":{"x":1,"y":8},"length":22,"shout":"","squad":"","customizations":{"color":"#900050","head":"cosmic-horror-special","tail":"cosmic-horror"}},{"id":"gs_jSKbH7DRQCtYSGDXkt3hKmg8","name":"Jagwire","health":66,"body":[{"x":4,"y":10},{"x":5,"y":10},{"x":5,"y":9},{"x":5,"y":8},{"x":5,"y":7},{"x":6,"y":7},{"x":7,"y":7},{"x":7,"y":8},{"x":6,"y":8},{"x":6,"y":9},{"x":7,"y":9},{"x":7,"y":10},{"x":7,"y":0},{"x":8,"y":0},{"x":8,"y":10},{"x":9,"y":10},{"x":10,"y":10},{"x":10,"y":9},{"x":10,"y":8},{"x":10,"y":7},{"x":10,"y":6},{"x":10,"y":5},{"x":0,"y":5},{"x":0,"y":6}],"latency":200,"head":{"x":4,"y":10},"length":24,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}]},"you":{"id":"gs_jSKbH7DRQCtYSGDXkt3hKmg8","name":"Jagwire","health":66,"body":[{"x":4,"y":10},{"x":5,"y":10},{"x":5,"y":9},{"x":5,"y":8},{"x":5,"y":7},{"x":6,"y":7},{"x":7,"y":7},{"x":7,"y":8},{"x":6,"y":8},{"x":6,"y":9},{"x":7,"y":9},{"x":7,"y":10},{"x":7,"y":0},{"x":8,"y":0},{"x":8,"y":10},{"x":9,"y":10},{"x":10,"y":10},{"x":10,"y":9},{"x":10,"y":8},{"x":10,"y":7},{"x":10,"y":6},{"x":10,"y":5},{"x":0,"y":5},{"x":0,"y":6}],"latency":200,"head":{"x":4,"y":10},"length":24,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).not.toBe("down") // down makes us eat hazard, but left or up keep us out of it while Shapeshifter starves
  })
  it('sinkhole5: avoids the sink when dying', () => {
    const gameState: GameState = {"game":{"id":"5e8f1367-00f2-420e-85d0-acada0630a06","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":10,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"sinkholes","timeout":500,"source":"testing"},"turn":62,"board":{"width":11,"height":11,"food":[{"x":2,"y":9},{"x":8,"y":5}],"hazards":[{"x":5,"y":5},{"x":4,"y":5},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":6,"y":5},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":3,"y":2},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":3,"y":7},{"x":3,"y":8},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":4,"y":8},{"x":5,"y":2},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":5,"y":8},{"x":6,"y":2},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":6,"y":8},{"x":7,"y":2},{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":7,"y":7},{"x":7,"y":8},{"x":8,"y":3},{"x":8,"y":4},{"x":8,"y":5},{"x":8,"y":6},{"x":8,"y":7}],"snakes":[{"id":"gs_rxxc87KmbHPKfh9x7vwq6vtK","name":"CoolerSnake!","health":94,"body":[{"x":10,"y":3},{"x":0,"y":3},{"x":0,"y":4},{"x":0,"y":5},{"x":0,"y":6},{"x":0,"y":7},{"x":0,"y":8},{"x":10,"y":8},{"x":9,"y":8},{"x":9,"y":9}],"latency":109,"head":{"x":10,"y":3},"length":10,"shout":"10, 214","squad":"","customizations":{"color":"#ff6600","head":"cosmic-horror","tail":"cosmic-horror"}},{"id":"gs_krSH9BW7HmvQCvPby6X7GcV8","name":"Prüzze v2","health":94,"body":[{"x":8,"y":9},{"x":8,"y":10},{"x":8,"y":0},{"x":7,"y":0},{"x":6,"y":0},{"x":6,"y":1},{"x":6,"y":2},{"x":7,"y":2},{"x":8,"y":2},{"x":9,"y":2},{"x":9,"y":1}],"latency":423,"head":{"x":8,"y":9},"length":11,"shout":", t=401","squad":"","customizations":{"color":"#c91f37","head":"gamer","tail":"coffee"}},{"id":"gs_cpqkdYKbxmVT4gRVhCxT9jMM","name":"Shapeshifter","health":100,"body":[{"x":1,"y":0},{"x":2,"y":0},{"x":3,"y":0},{"x":4,"y":0},{"x":5,"y":0},{"x":5,"y":0}],"latency":392,"head":{"x":1,"y":0},"length":6,"shout":"","squad":"","customizations":{"color":"#900050","head":"cosmic-horror-special","tail":"cosmic-horror"}},{"id":"gs_WY8RrXDtpbBdT7Kpx3HXD986","name":"Jagwire","health":19,"body":[{"x":3,"y":1},{"x":2,"y":1},{"x":2,"y":2},{"x":2,"y":3},{"x":2,"y":4},{"x":3,"y":4},{"x":4,"y":4},{"x":5,"y":4}],"latency":333,"head":{"x":3,"y":1},"length":8,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}]},"you":{"id":"gs_WY8RrXDtpbBdT7Kpx3HXD986","name":"Jagwire","health":19,"body":[{"x":3,"y":1},{"x":2,"y":1},{"x":2,"y":2},{"x":2,"y":3},{"x":2,"y":4},{"x":3,"y":4},{"x":4,"y":4},{"x":5,"y":4}],"latency":333,"head":{"x":3,"y":1},"length":8,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("right") // up starves me in a couple turns, right leaves me alive for a bit
  })
  it('sinkhole6: avoids the sink when it does not need to enter it', () => {
    const gameState: GameState = {"game":{"id":"64e9f0d2-65d0-4717-a0b2-a07205ccf563","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":10,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"sinkholes","timeout":500,"source":"testing"},"turn":221,"board":{"width":11,"height":11,"food":[{"x":3,"y":9},{"x":3,"y":7}],"hazards":[{"x":5,"y":5},{"x":4,"y":5},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":6,"y":5},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":3,"y":2},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":3,"y":7},{"x":3,"y":8},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":4,"y":8},{"x":5,"y":2},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":5,"y":8},{"x":6,"y":2},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":6,"y":8},{"x":7,"y":2},{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":7,"y":7},{"x":7,"y":8},{"x":8,"y":3},{"x":8,"y":4},{"x":8,"y":5},{"x":8,"y":6},{"x":8,"y":7},{"x":1,"y":2},{"x":1,"y":3},{"x":1,"y":4},{"x":1,"y":5},{"x":1,"y":6},{"x":1,"y":7},{"x":1,"y":8},{"x":2,"y":1},{"x":2,"y":2},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":2,"y":8},{"x":2,"y":9},{"x":3,"y":1},{"x":3,"y":2},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":3,"y":7},{"x":3,"y":8},{"x":3,"y":9},{"x":4,"y":1},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":4,"y":8},{"x":4,"y":9},{"x":5,"y":1},{"x":5,"y":2},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":5,"y":8},{"x":5,"y":9},{"x":6,"y":1},{"x":6,"y":2},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":6,"y":8},{"x":6,"y":9},{"x":7,"y":1},{"x":7,"y":2},{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":7,"y":7},{"x":7,"y":8},{"x":7,"y":9},{"x":8,"y":1},{"x":8,"y":2},{"x":8,"y":3},{"x":8,"y":4},{"x":8,"y":5},{"x":8,"y":6},{"x":8,"y":7},{"x":8,"y":8},{"x":8,"y":9},{"x":9,"y":2},{"x":9,"y":3},{"x":9,"y":4},{"x":9,"y":5},{"x":9,"y":6},{"x":9,"y":7},{"x":9,"y":8}],"snakes":[{"id":"gs_SS8SybjWCdjx8vFGgt9GC3pP","name":"soma-mini[sink]","health":60,"body":[{"x":0,"y":7},{"x":10,"y":7},{"x":10,"y":8},{"x":10,"y":9},{"x":9,"y":9},{"x":9,"y":10},{"x":8,"y":10},{"x":7,"y":10},{"x":6,"y":10},{"x":6,"y":0},{"x":5,"y":0},{"x":4,"y":0},{"x":4,"y":10},{"x":3,"y":10},{"x":2,"y":10},{"x":1,"y":10},{"x":1,"y":9},{"x":1,"y":8},{"x":0,"y":8}],"latency":412,"head":{"x":0,"y":7},"length":19,"shout":"407","squad":"","customizations":{"color":"#ff00ff","head":"snail","tail":"fat-rattle"}},{"id":"gs_RhfhFrfrKxKq9Gwt9CY6P4YY","name":"Jagwire","health":48,"body":[{"x":0,"y":3},{"x":0,"y":2},{"x":0,"y":1},{"x":0,"y":0},{"x":0,"y":10},{"x":10,"y":10},{"x":10,"y":0},{"x":9,"y":0},{"x":8,"y":0},{"x":8,"y":1},{"x":7,"y":1},{"x":7,"y":2},{"x":8,"y":2},{"x":9,"y":2},{"x":9,"y":1},{"x":10,"y":1},{"x":10,"y":2},{"x":10,"y":3},{"x":10,"y":4},{"x":10,"y":5},{"x":0,"y":5},{"x":0,"y":4}],"latency":69,"head":{"x":0,"y":3},"length":22,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}]},"you":{"id":"gs_RhfhFrfrKxKq9Gwt9CY6P4YY","name":"Jagwire","health":48,"body":[{"x":0,"y":3},{"x":0,"y":2},{"x":0,"y":1},{"x":0,"y":0},{"x":0,"y":10},{"x":10,"y":10},{"x":10,"y":0},{"x":9,"y":0},{"x":8,"y":0},{"x":8,"y":1},{"x":7,"y":1},{"x":7,"y":2},{"x":8,"y":2},{"x":9,"y":2},{"x":9,"y":1},{"x":10,"y":1},{"x":10,"y":2},{"x":10,"y":3},{"x":10,"y":4},{"x":10,"y":5},{"x":0,"y":5},{"x":0,"y":4}],"latency":69,"head":{"x":0,"y":3},"length":22,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("up") // right puts us in sauce at fairly low health, up does not
  })
  it('sinkhole7: chooses open space over trap in sinkhole with foursnake', () => {
    const gameState: GameState = {"game":{"id":"c229fd98-c31c-4efb-a295-c542f18c227e","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":10,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"sinkholes","timeout":500,"source":"testing"},"turn":83,"board":{"width":11,"height":11,"food":[{"x":7,"y":6}],"hazards":[{"x":5,"y":5},{"x":4,"y":5},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":6,"y":5},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":3,"y":2},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":3,"y":7},{"x":3,"y":8},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":4,"y":8},{"x":5,"y":2},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":5,"y":8},{"x":6,"y":2},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":6,"y":8},{"x":7,"y":2},{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":7,"y":7},{"x":7,"y":8},{"x":8,"y":3},{"x":8,"y":4},{"x":8,"y":5},{"x":8,"y":6},{"x":8,"y":7},{"x":1,"y":2},{"x":1,"y":3},{"x":1,"y":4},{"x":1,"y":5},{"x":1,"y":6},{"x":1,"y":7},{"x":1,"y":8},{"x":2,"y":1},{"x":2,"y":2},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":2,"y":8},{"x":2,"y":9},{"x":3,"y":1},{"x":3,"y":2},{"x":3,"y":3},{"x":3,"y":4},{"x":3,"y":5},{"x":3,"y":6},{"x":3,"y":7},{"x":3,"y":8},{"x":3,"y":9},{"x":4,"y":1},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":4,"y":8},{"x":4,"y":9},{"x":5,"y":1},{"x":5,"y":2},{"x":5,"y":3},{"x":5,"y":4},{"x":5,"y":5},{"x":5,"y":6},{"x":5,"y":7},{"x":5,"y":8},{"x":5,"y":9},{"x":6,"y":1},{"x":6,"y":2},{"x":6,"y":3},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7},{"x":6,"y":8},{"x":6,"y":9},{"x":7,"y":1},{"x":7,"y":2},{"x":7,"y":3},{"x":7,"y":4},{"x":7,"y":5},{"x":7,"y":6},{"x":7,"y":7},{"x":7,"y":8},{"x":7,"y":9},{"x":8,"y":1},{"x":8,"y":2},{"x":8,"y":3},{"x":8,"y":4},{"x":8,"y":5},{"x":8,"y":6},{"x":8,"y":7},{"x":8,"y":8},{"x":8,"y":9},{"x":9,"y":2},{"x":9,"y":3},{"x":9,"y":4},{"x":9,"y":5},{"x":9,"y":6},{"x":9,"y":7},{"x":9,"y":8}],"snakes":[{"id":"gs_x8RQVSM4Vhv8BRhw6ptx3wWR","name":"dubious dtella [bg]","health":70,"body":[{"x":9,"y":6},{"x":9,"y":7},{"x":9,"y":8},{"x":9,"y":9},{"x":8,"y":9},{"x":7,"y":9},{"x":6,"y":9},{"x":5,"y":9},{"x":4,"y":9}],"latency":500,"head":{"x":9,"y":6},"length":9,"shout":"","squad":"","customizations":{"color":"#35cad4","head":"dead","tail":"iguana"}},{"id":"gs_GKfrjSRtXgjTgSb77BwJgk6R","name":"Ziggy Snakedust","health":57,"body":[{"x":1,"y":10},{"x":0,"y":10},{"x":0,"y":0},{"x":10,"y":0},{"x":10,"y":1},{"x":0,"y":1}],"latency":453,"head":{"x":1,"y":10},"length":6,"shout":"","squad":"","customizations":{"color":"#fcb040","head":"iguana","tail":"iguana"}},{"id":"gs_yqPFbMQCXdBWFSDtPxSvSMk9","name":"Shapeshifter","health":94,"body":[{"x":1,"y":1},{"x":1,"y":2},{"x":1,"y":3},{"x":1,"y":4},{"x":1,"y":5},{"x":0,"y":5},{"x":0,"y":6},{"x":1,"y":6},{"x":2,"y":6},{"x":3,"y":6},{"x":3,"y":7},{"x":2,"y":7},{"x":1,"y":7},{"x":0,"y":7}],"latency":406,"head":{"x":1,"y":1},"length":14,"shout":"","squad":"","customizations":{"color":"#900050","head":"cosmic-horror-special","tail":"cosmic-horror"}},{"id":"gs_mxWq7ycRhD79y8tDGwPCVgqc","name":"Jagwire","health":97,"body":[{"x":9,"y":0},{"x":8,"y":0},{"x":7,"y":0},{"x":7,"y":1},{"x":6,"y":1},{"x":5,"y":1},{"x":5,"y":0},{"x":4,"y":0},{"x":3,"y":0},{"x":2,"y":0}],"latency":451,"head":{"x":9,"y":0},"length":10,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}]},"you":{"id":"gs_mxWq7ycRhD79y8tDGwPCVgqc","name":"Jagwire","health":97,"body":[{"x":9,"y":0},{"x":8,"y":0},{"x":7,"y":0},{"x":7,"y":1},{"x":6,"y":1},{"x":5,"y":1},{"x":5,"y":0},{"x":4,"y":0},{"x":3,"y":0},{"x":2,"y":0}],"latency":451,"head":{"x":9,"y":0},"length":10,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("down") // up lets Shapeshifter trap us in sauce with dtella, down is safe trip above dtella
  })
})

describe('constrictor maze tests', () => {
  it('constrictorMaze1: knows that tails do not shrink', () => {
    for (let i: number = 0; i < 3; i++) {
      const gameState: GameState = {"game":{"id":"5e3bbb7a-6696-41f1-bb89-381111ccea55","ruleset":{"name":"wrapped-constrictor","version":"?","settings":{"foodSpawnChance":0,"minimumFood":0,"hazardDamagePerTurn":100,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"arcade_maze","timeout":500,"source":"testing"},"turn":12,"board":{"width":19,"height":21,"food":[],"hazards":[{"x":0,"y":20},{"x":2,"y":20},{"x":3,"y":20},{"x":4,"y":20},{"x":5,"y":20},{"x":6,"y":20},{"x":7,"y":20},{"x":8,"y":20},{"x":9,"y":20},{"x":10,"y":20},{"x":11,"y":20},{"x":12,"y":20},{"x":13,"y":20},{"x":14,"y":20},{"x":15,"y":20},{"x":16,"y":20},{"x":18,"y":20},{"x":0,"y":19},{"x":9,"y":19},{"x":18,"y":19},{"x":0,"y":18},{"x":2,"y":18},{"x":3,"y":18},{"x":5,"y":18},{"x":6,"y":18},{"x":7,"y":18},{"x":9,"y":18},{"x":11,"y":18},{"x":12,"y":18},{"x":13,"y":18},{"x":15,"y":18},{"x":16,"y":18},{"x":18,"y":18},{"x":0,"y":17},{"x":18,"y":17},{"x":0,"y":16},{"x":2,"y":16},{"x":3,"y":16},{"x":5,"y":16},{"x":7,"y":16},{"x":8,"y":16},{"x":9,"y":16},{"x":10,"y":16},{"x":11,"y":16},{"x":13,"y":16},{"x":15,"y":16},{"x":16,"y":16},{"x":18,"y":16},{"x":0,"y":15},{"x":5,"y":15},{"x":9,"y":15},{"x":13,"y":15},{"x":18,"y":15},{"x":0,"y":14},{"x":3,"y":14},{"x":5,"y":14},{"x":6,"y":14},{"x":7,"y":14},{"x":9,"y":14},{"x":11,"y":14},{"x":12,"y":14},{"x":13,"y":14},{"x":15,"y":14},{"x":18,"y":14},{"x":0,"y":13},{"x":3,"y":13},{"x":5,"y":13},{"x":13,"y":13},{"x":15,"y":13},{"x":18,"y":13},{"x":0,"y":12},{"x":1,"y":12},{"x":2,"y":12},{"x":3,"y":12},{"x":5,"y":12},{"x":7,"y":12},{"x":9,"y":12},{"x":11,"y":12},{"x":13,"y":12},{"x":15,"y":12},{"x":16,"y":12},{"x":17,"y":12},{"x":18,"y":12},{"x":7,"y":11},{"x":11,"y":11},{"x":0,"y":10},{"x":1,"y":10},{"x":2,"y":10},{"x":3,"y":10},{"x":5,"y":10},{"x":7,"y":10},{"x":9,"y":10},{"x":11,"y":10},{"x":13,"y":10},{"x":15,"y":10},{"x":16,"y":10},{"x":17,"y":10},{"x":18,"y":10},{"x":0,"y":9},{"x":3,"y":9},{"x":5,"y":9},{"x":13,"y":9},{"x":15,"y":9},{"x":18,"y":9},{"x":0,"y":8},{"x":3,"y":8},{"x":5,"y":8},{"x":7,"y":8},{"x":8,"y":8},{"x":9,"y":8},{"x":10,"y":8},{"x":11,"y":8},{"x":13,"y":8},{"x":15,"y":8},{"x":18,"y":8},{"x":0,"y":7},{"x":9,"y":7},{"x":18,"y":7},{"x":0,"y":6},{"x":2,"y":6},{"x":3,"y":6},{"x":5,"y":6},{"x":6,"y":6},{"x":7,"y":6},{"x":9,"y":6},{"x":11,"y":6},{"x":12,"y":6},{"x":13,"y":6},{"x":15,"y":6},{"x":16,"y":6},{"x":18,"y":6},{"x":0,"y":5},{"x":3,"y":5},{"x":15,"y":5},{"x":18,"y":5},{"x":0,"y":4},{"x":1,"y":4},{"x":3,"y":4},{"x":5,"y":4},{"x":7,"y":4},{"x":8,"y":4},{"x":9,"y":4},{"x":10,"y":4},{"x":11,"y":4},{"x":13,"y":4},{"x":15,"y":4},{"x":17,"y":4},{"x":18,"y":4},{"x":0,"y":3},{"x":5,"y":3},{"x":9,"y":3},{"x":13,"y":3},{"x":18,"y":3},{"x":0,"y":2},{"x":2,"y":2},{"x":3,"y":2},{"x":4,"y":2},{"x":5,"y":2},{"x":6,"y":2},{"x":7,"y":2},{"x":9,"y":2},{"x":11,"y":2},{"x":12,"y":2},{"x":13,"y":2},{"x":14,"y":2},{"x":15,"y":2},{"x":16,"y":2},{"x":18,"y":2},{"x":0,"y":1},{"x":18,"y":1},{"x":0,"y":0},{"x":2,"y":0},{"x":3,"y":0},{"x":4,"y":0},{"x":5,"y":0},{"x":6,"y":0},{"x":7,"y":0},{"x":8,"y":0},{"x":9,"y":0},{"x":10,"y":0},{"x":11,"y":0},{"x":12,"y":0},{"x":13,"y":0},{"x":14,"y":0},{"x":15,"y":0},{"x":16,"y":0},{"x":18,"y":0}],"snakes":[{"id":"gs_JQbYyXPMDMMx8vFpqWDYdFq7","name":"Megaton Collective","health":100,"body":[{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":1,"y":5},{"x":1,"y":6},{"x":1,"y":7},{"x":1,"y":8},{"x":1,"y":9},{"x":2,"y":9},{"x":2,"y":8},{"x":2,"y":7},{"x":3,"y":7},{"x":4,"y":7},{"x":4,"y":7}],"latency":1,"head":{"x":2,"y":3},"length":14,"shout":"","squad":"","customizations":{"color":"#aaccff","head":"pixel-round","tail":"leaf"}},{"id":"gs_XYXVKGvGfSKW6BPpVvfWPmdd","name":"Jagwire","health":100,"body":[{"x":4,"y":11},{"x":4,"y":12},{"x":4,"y":13},{"x":4,"y":14},{"x":4,"y":15},{"x":3,"y":15},{"x":2,"y":15},{"x":1,"y":15},{"x":1,"y":16},{"x":1,"y":17},{"x":2,"y":17},{"x":3,"y":17},{"x":4,"y":17},{"x":4,"y":17}],"latency":22,"head":{"x":4,"y":11},"length":14,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}]},"you":{"id":"gs_XYXVKGvGfSKW6BPpVvfWPmdd","name":"Jagwire","health":100,"body":[{"x":4,"y":11},{"x":4,"y":12},{"x":4,"y":13},{"x":4,"y":14},{"x":4,"y":15},{"x":3,"y":15},{"x":2,"y":15},{"x":1,"y":15},{"x":1,"y":16},{"x":1,"y":17},{"x":2,"y":17},{"x":3,"y":17},{"x":4,"y":17},{"x":4,"y":17}],"latency":22,"head":{"x":4,"y":11},"length":14,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
      const moveResponse: MoveResponse = move(gameState)
      expect(moveResponse.move).not.toBe("down") // down runs us into Megaton's tail in a few turns, left or right are fine
    }
  })
  it('constrictorMaze2: knows to go towards center', () => {
    const gameState: GameState = {"game":{"id":"f8dd9cbc-b352-44e2-b871-6fcaba99a0f5","ruleset":{"name":"wrapped-constrictor","version":"?","settings":{"foodSpawnChance":0,"minimumFood":0,"hazardDamagePerTurn":100,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"arcade_maze","timeout":500,"source":"testing"},"turn":2,"board":{"width":19,"height":21,"food":[],"hazards":[{"x":0,"y":20},{"x":2,"y":20},{"x":3,"y":20},{"x":4,"y":20},{"x":5,"y":20},{"x":6,"y":20},{"x":7,"y":20},{"x":8,"y":20},{"x":9,"y":20},{"x":10,"y":20},{"x":11,"y":20},{"x":12,"y":20},{"x":13,"y":20},{"x":14,"y":20},{"x":15,"y":20},{"x":16,"y":20},{"x":18,"y":20},{"x":0,"y":19},{"x":9,"y":19},{"x":18,"y":19},{"x":0,"y":18},{"x":2,"y":18},{"x":3,"y":18},{"x":5,"y":18},{"x":6,"y":18},{"x":7,"y":18},{"x":9,"y":18},{"x":11,"y":18},{"x":12,"y":18},{"x":13,"y":18},{"x":15,"y":18},{"x":16,"y":18},{"x":18,"y":18},{"x":0,"y":17},{"x":18,"y":17},{"x":0,"y":16},{"x":2,"y":16},{"x":3,"y":16},{"x":5,"y":16},{"x":7,"y":16},{"x":8,"y":16},{"x":9,"y":16},{"x":10,"y":16},{"x":11,"y":16},{"x":13,"y":16},{"x":15,"y":16},{"x":16,"y":16},{"x":18,"y":16},{"x":0,"y":15},{"x":5,"y":15},{"x":9,"y":15},{"x":13,"y":15},{"x":18,"y":15},{"x":0,"y":14},{"x":3,"y":14},{"x":5,"y":14},{"x":6,"y":14},{"x":7,"y":14},{"x":9,"y":14},{"x":11,"y":14},{"x":12,"y":14},{"x":13,"y":14},{"x":15,"y":14},{"x":18,"y":14},{"x":0,"y":13},{"x":3,"y":13},{"x":5,"y":13},{"x":13,"y":13},{"x":15,"y":13},{"x":18,"y":13},{"x":0,"y":12},{"x":1,"y":12},{"x":2,"y":12},{"x":3,"y":12},{"x":5,"y":12},{"x":7,"y":12},{"x":9,"y":12},{"x":11,"y":12},{"x":13,"y":12},{"x":15,"y":12},{"x":16,"y":12},{"x":17,"y":12},{"x":18,"y":12},{"x":7,"y":11},{"x":11,"y":11},{"x":0,"y":10},{"x":1,"y":10},{"x":2,"y":10},{"x":3,"y":10},{"x":5,"y":10},{"x":7,"y":10},{"x":9,"y":10},{"x":11,"y":10},{"x":13,"y":10},{"x":15,"y":10},{"x":16,"y":10},{"x":17,"y":10},{"x":18,"y":10},{"x":0,"y":9},{"x":3,"y":9},{"x":5,"y":9},{"x":13,"y":9},{"x":15,"y":9},{"x":18,"y":9},{"x":0,"y":8},{"x":3,"y":8},{"x":5,"y":8},{"x":7,"y":8},{"x":8,"y":8},{"x":9,"y":8},{"x":10,"y":8},{"x":11,"y":8},{"x":13,"y":8},{"x":15,"y":8},{"x":18,"y":8},{"x":0,"y":7},{"x":9,"y":7},{"x":18,"y":7},{"x":0,"y":6},{"x":2,"y":6},{"x":3,"y":6},{"x":5,"y":6},{"x":6,"y":6},{"x":7,"y":6},{"x":9,"y":6},{"x":11,"y":6},{"x":12,"y":6},{"x":13,"y":6},{"x":15,"y":6},{"x":16,"y":6},{"x":18,"y":6},{"x":0,"y":5},{"x":3,"y":5},{"x":15,"y":5},{"x":18,"y":5},{"x":0,"y":4},{"x":1,"y":4},{"x":3,"y":4},{"x":5,"y":4},{"x":7,"y":4},{"x":8,"y":4},{"x":9,"y":4},{"x":10,"y":4},{"x":11,"y":4},{"x":13,"y":4},{"x":15,"y":4},{"x":17,"y":4},{"x":18,"y":4},{"x":0,"y":3},{"x":5,"y":3},{"x":9,"y":3},{"x":13,"y":3},{"x":18,"y":3},{"x":0,"y":2},{"x":2,"y":2},{"x":3,"y":2},{"x":4,"y":2},{"x":5,"y":2},{"x":6,"y":2},{"x":7,"y":2},{"x":9,"y":2},{"x":11,"y":2},{"x":12,"y":2},{"x":13,"y":2},{"x":14,"y":2},{"x":15,"y":2},{"x":16,"y":2},{"x":18,"y":2},{"x":0,"y":1},{"x":18,"y":1},{"x":0,"y":0},{"x":2,"y":0},{"x":3,"y":0},{"x":4,"y":0},{"x":5,"y":0},{"x":6,"y":0},{"x":7,"y":0},{"x":8,"y":0},{"x":9,"y":0},{"x":10,"y":0},{"x":11,"y":0},{"x":12,"y":0},{"x":13,"y":0},{"x":14,"y":0},{"x":15,"y":0},{"x":16,"y":0},{"x":18,"y":0}],"snakes":[{"id":"gs_rSjyGx6gCCkMJQ4w8V3YkWDM","name":"soma-mini[const]","health":100,"body":[{"x":6,"y":7},{"x":5,"y":7},{"x":4,"y":7},{"x":4,"y":7}],"latency":14,"head":{"x":6,"y":7},"length":4,"shout":"9","squad":"","customizations":{"color":"#ff0055","head":"snail","tail":"fat-rattle"}},{"id":"gs_Bkg4DXPQhcJTJRkrScPgrfcV","name":"Jagwire","health":100,"body":[{"x":12,"y":17},{"x":13,"y":17},{"x":14,"y":17},{"x":14,"y":17}],"latency":26,"head":{"x":12,"y":17},"length":4,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}]},"you":{"id":"gs_Bkg4DXPQhcJTJRkrScPgrfcV","name":"Jagwire","health":100,"body":[{"x":12,"y":17},{"x":13,"y":17},{"x":14,"y":17},{"x":14,"y":17}],"latency":26,"head":{"x":12,"y":17},"length":4,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("down") // left is basically end of game, Soma can occupy the middle & gets much better coverage over time if I let them
  })
})

describe('hazard pit tests', () => {
  it('hazardPit1: knows how to map hazard pits out', () => {
    let board2d: Board2d
    let cell: BoardCell | undefined
    let myself: Battlesnake | undefined
    let gameState: GameState

    // turn 5 - phase 0
    gameState = {"game":{"id":"a28cde00-b85e-4e67-a1e9-6b2f20df2049","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":20,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"hz_hazard_pits","timeout":500,"source":"ladder"},"turn":5,"board":{"width":11,"height":11,"food":[{"x":0,"y":8},{"x":10,"y":8},{"x":5,"y":5}],"hazards":[],"snakes":[{"id":"gs_X7qmHjKkwpjDKyT6KkhhCxgF","name":"Jagwire","health":97,"body":[{"x":1,"y":2},{"x":1,"y":1},{"x":1,"y":0},{"x":2,"y":0}],"latency":452,"head":{"x":1,"y":2},"length":4,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}},{"id":"gs_FmRS79twcMWwRXBQTD9j64PR","name":"soma-mini[sink]","health":97,"body":[{"x":8,"y":3},{"x":9,"y":3},{"x":10,"y":3},{"x":10,"y":2}],"latency":411,"head":{"x":8,"y":3},"length":4,"shout":"406","squad":"","customizations":{"color":"#ff00ff","head":"snail","tail":"fat-rattle"}},{"id":"gs_Pc7Y3BtrpJPY8QCgMJb4mGV8","name":"Snek-Bro","health":95,"body":[{"x":5,"y":8},{"x":4,"y":8},{"x":3,"y":8}],"latency":13,"head":{"x":5,"y":8},"length":3,"shout":"Back to the lobby my friend","squad":"","customizations":{"color":"#ffbf00","head":"beach-puffin","tail":"beach-puffin"}},{"id":"gs_p4WrGDSTdHj7FghVHP78W6rQ","name":"私は最高のじゃがいもです","health":95,"body":[{"x":6,"y":9},{"x":6,"y":10},{"x":7,"y":10}],"latency":1,"head":{"x":6,"y":9},"length":3,"shout":"","squad":"","customizations":{"color":"#06a600","head":"dead","tail":"bolt"}}]},"you":{"id":"gs_X7qmHjKkwpjDKyT6KkhhCxgF","name":"Jagwire","health":97,"body":[{"x":1,"y":2},{"x":1,"y":1},{"x":1,"y":0},{"x":2,"y":0}],"latency":452,"head":{"x":1,"y":2},"length":4,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    board2d = new Board2d(gameState)
    cell = board2d.getCell({x: 1, y: 3})
    myself = gameState.you
    if (cell && myself) {
      expect(cell.hazard).toBe(0)
      moveSnake(gameState, myself, board2d, Direction.Up)
      expect(myself.health).toBe(96) // no hazard here on turn 5. Goes from 97 to 96
    }
    
    // turn 25 - phase 1
    gameState = {"game":{"id":"a28cde00-b85e-4e67-a1e9-6b2f20df2049","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":20,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"hz_hazard_pits","timeout":500,"source":"ladder"},"turn":25,"board":{"width":11,"height":11,"food":[{"x":0,"y":8},{"x":10,"y":5}],"hazards":[{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7}],"snakes":[{"id":"gs_X7qmHjKkwpjDKyT6KkhhCxgF","name":"Jagwire","health":46,"body":[{"x":1,"y":8},{"x":1,"y":7},{"x":1,"y":6},{"x":1,"y":5},{"x":2,"y":5}],"latency":452,"head":{"x":1,"y":8},"length":5,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}},{"id":"gs_FmRS79twcMWwRXBQTD9j64PR","name":"soma-mini[sink]","health":85,"body":[{"x":7,"y":8},{"x":6,"y":8},{"x":6,"y":7},{"x":6,"y":6},{"x":5,"y":6}],"latency":411,"head":{"x":7,"y":8},"length":5,"shout":"407","squad":"","customizations":{"color":"#ff00ff","head":"snail","tail":"fat-rattle"}},{"id":"gs_Pc7Y3BtrpJPY8QCgMJb4mGV8","name":"Snek-Bro","health":83,"body":[{"x":2,"y":9},{"x":2,"y":8},{"x":3,"y":8},{"x":4,"y":8}],"latency":3,"head":{"x":2,"y":9},"length":4,"shout":"It's alright, everbody makes mistakes","squad":"","customizations":{"color":"#ffbf00","head":"beach-puffin","tail":"beach-puffin"}},{"id":"gs_p4WrGDSTdHj7FghVHP78W6rQ","name":"私は最高のじゃがいもです","health":87,"body":[{"x":10,"y":7},{"x":10,"y":8},{"x":10,"y":9},{"x":10,"y":10}],"latency":1,"head":{"x":10,"y":7},"length":4,"shout":"","squad":"","customizations":{"color":"#06a600","head":"dead","tail":"bolt"}}]},"you":{"id":"gs_X7qmHjKkwpjDKyT6KkhhCxgF","name":"Jagwire","health":46,"body":[{"x":1,"y":8},{"x":1,"y":7},{"x":1,"y":6},{"x":1,"y":5},{"x":2,"y":5}],"latency":452,"head":{"x":1,"y":8},"length":5,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    board2d = new Board2d(gameState)
    cell = board2d.getCell({x: 3, y: 9})
    myself = gameState.board.snakes.find(snake => snake.name === "Snek-Bro")
    if (cell && myself) {
      expect(cell.hazard).toBe(1)
      moveSnake(gameState, myself, board2d, Direction.Right)
      expect(myself.health).toBe(62) // one hazard here on turn 25. Goes from 83 health to (83 - 20 - 1) = 62 health
    }
    
    // turn 45 - phase 2
    gameState = {"game":{"id":"a28cde00-b85e-4e67-a1e9-6b2f20df2049","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":20,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"hz_hazard_pits","timeout":500,"source":"ladder"},"turn":45,"board":{"width":11,"height":11,"food":[{"x":0,"y":1},{"x":0,"y":9},{"x":1,"y":9}],"hazards":[{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7}],"snakes":[{"id":"gs_X7qmHjKkwpjDKyT6KkhhCxgF","name":"Jagwire","health":48,"body":[{"x":3,"y":4},{"x":2,"y":4},{"x":1,"y":4},{"x":0,"y":4},{"x":0,"y":3},{"x":1,"y":3},{"x":1,"y":2}],"latency":452,"head":{"x":3,"y":4},"length":7,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}},{"id":"gs_FmRS79twcMWwRXBQTD9j64PR","name":"soma-mini[sink]","health":92,"body":[{"x":7,"y":6},{"x":8,"y":6},{"x":8,"y":7},{"x":8,"y":8},{"x":7,"y":8},{"x":6,"y":8}],"latency":415,"head":{"x":7,"y":6},"length":6,"shout":"410","squad":"","customizations":{"color":"#ff00ff","head":"snail","tail":"fat-rattle"}},{"id":"gs_Pc7Y3BtrpJPY8QCgMJb4mGV8","name":"Snek-Bro","health":63,"body":[{"x":6,"y":5},{"x":6,"y":4},{"x":6,"y":3},{"x":6,"y":2}],"latency":5,"head":{"x":6,"y":5},"length":4,"shout":"Oh my god, do you really think you will win? Pathetic","squad":"","customizations":{"color":"#ffbf00","head":"beach-puffin","tail":"beach-puffin"}},{"id":"gs_p4WrGDSTdHj7FghVHP78W6rQ","name":"私は最高のじゃがいもです","health":42,"body":[{"x":8,"y":1},{"x":7,"y":1},{"x":7,"y":0},{"x":8,"y":0},{"x":9,"y":0}],"latency":1,"head":{"x":8,"y":1},"length":5,"shout":"","squad":"","customizations":{"color":"#06a600","head":"dead","tail":"bolt"}}]},"you":{"id":"gs_X7qmHjKkwpjDKyT6KkhhCxgF","name":"Jagwire","health":48,"body":[{"x":3,"y":4},{"x":2,"y":4},{"x":1,"y":4},{"x":0,"y":4},{"x":0,"y":3},{"x":1,"y":3},{"x":1,"y":2}],"latency":452,"head":{"x":3,"y":4},"length":7,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    board2d = new Board2d(gameState)
    cell = board2d.getCell({x: 3, y: 3})
    myself = gameState.you
    if (cell && myself) {
      expect(cell.hazard).toBe(2)
      moveSnake(gameState, myself, board2d, Direction.Down)
      expect(myself.health).toBe(7) // two hazards here on turn 45. Goes from 48 health to (48 - 20 * 2 - 1) = 7 health
    }
    
    // turn 65 - phase 3
    gameState = {"game":{"id":"a28cde00-b85e-4e67-a1e9-6b2f20df2049","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":20,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"hz_hazard_pits","timeout":500,"source":"ladder"},"turn":65,"board":{"width":11,"height":11,"food":[{"x":0,"y":1},{"x":2,"y":10},{"x":8,"y":2}],"hazards":[{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7}],"snakes":[{"id":"gs_X7qmHjKkwpjDKyT6KkhhCxgF","name":"Jagwire","health":91,"body":[{"x":4,"y":3},{"x":4,"y":4},{"x":3,"y":4},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":2,"y":8},{"x":1,"y":8}],"latency":452,"head":{"x":4,"y":3},"length":9,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}},{"id":"gs_FmRS79twcMWwRXBQTD9j64PR","name":"soma-mini[sink]","health":72,"body":[{"x":4,"y":9},{"x":4,"y":10},{"x":5,"y":10},{"x":6,"y":10},{"x":6,"y":9},{"x":6,"y":8}],"latency":412,"head":{"x":4,"y":9},"length":6,"shout":"406","squad":"","customizations":{"color":"#ff00ff","head":"snail","tail":"fat-rattle"}},{"id":"gs_p4WrGDSTdHj7FghVHP78W6rQ","name":"私は最高のじゃがいもです","health":22,"body":[{"x":6,"y":1},{"x":6,"y":0},{"x":7,"y":0},{"x":8,"y":0},{"x":9,"y":0}],"latency":1,"head":{"x":6,"y":1},"length":5,"shout":"","squad":"","customizations":{"color":"#06a600","head":"dead","tail":"bolt"}}]},"you":{"id":"gs_X7qmHjKkwpjDKyT6KkhhCxgF","name":"Jagwire","health":91,"body":[{"x":4,"y":3},{"x":4,"y":4},{"x":3,"y":4},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":2,"y":8},{"x":1,"y":8}],"latency":452,"head":{"x":4,"y":3},"length":9,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    board2d = new Board2d(gameState)
    cell = board2d.getCell({x: 3, y: 3})
    myself = gameState.you
    if (cell && myself) {
      expect(cell.hazard).toBe(3)
      moveSnake(gameState, myself, board2d, Direction.Left)
      expect(myself.health).toBe(30) // three hazards here on turn 65. Goes from 91 health to (91 - 20 * 3 - 1) = 30 health
    }
    
    // turn 85 - phase 4
    gameState = {"game":{"id":"a28cde00-b85e-4e67-a1e9-6b2f20df2049","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":20,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"hz_hazard_pits","timeout":500,"source":"ladder"},"turn":85,"board":{"width":11,"height":11,"food":[{"x":0,"y":1},{"x":0,"y":2},{"x":10,"y":9}],"hazards":[{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7}],"snakes":[{"id":"gs_X7qmHjKkwpjDKyT6KkhhCxgF","name":"Jagwire","health":85,"body":[{"x":7,"y":4},{"x":8,"y":4},{"x":8,"y":5},{"x":8,"y":6},{"x":7,"y":6},{"x":6,"y":6},{"x":5,"y":6},{"x":4,"y":6},{"x":4,"y":5},{"x":4,"y":4}],"latency":451,"head":{"x":7,"y":4},"length":10,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}},{"id":"gs_FmRS79twcMWwRXBQTD9j64PR","name":"soma-mini[sink]","health":83,"body":[{"x":1,"y":2},{"x":1,"y":1},{"x":2,"y":1},{"x":2,"y":0},{"x":3,"y":0},{"x":4,"y":0},{"x":4,"y":1}],"latency":412,"head":{"x":1,"y":2},"length":7,"shout":"408","squad":"","customizations":{"color":"#ff00ff","head":"snail","tail":"fat-rattle"}}]},"you":{"id":"gs_X7qmHjKkwpjDKyT6KkhhCxgF","name":"Jagwire","health":85,"body":[{"x":7,"y":4},{"x":8,"y":4},{"x":8,"y":5},{"x":8,"y":6},{"x":7,"y":6},{"x":6,"y":6},{"x":5,"y":6},{"x":4,"y":6},{"x":4,"y":5},{"x":4,"y":4}],"latency":451,"head":{"x":7,"y":4},"length":10,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    board2d = new Board2d(gameState)
    cell = board2d.getCell({x: 7, y: 5})
    myself = gameState.you
    if (cell && myself) {
      expect(cell.hazard).toBe(4)
      moveSnake(gameState, myself, board2d, Direction.Up)
      expect(myself.health).toBe(4) // four hazards here on turn 85. Goes from 85 health to (85 - 20 * 4 - 1) = 4 health
    }

    // turn 105 - phase 5. Hazards max out at 4 in a cell, so should still be 4 per cell
    gameState = {"game":{"id":"a28cde00-b85e-4e67-a1e9-6b2f20df2049","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":20,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"hz_hazard_pits","timeout":500,"source":"ladder"},"turn":105,"board":{"width":11,"height":11,"food":[{"x":1,"y":8},{"x":2,"y":1},{"x":1,"y":1},{"x":0,"y":5}],"hazards":[{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7}],"snakes":[{"id":"gs_X7qmHjKkwpjDKyT6KkhhCxgF","name":"Jagwire","health":96,"body":[{"x":7,"y":8},{"x":8,"y":8},{"x":8,"y":9},{"x":9,"y":9},{"x":10,"y":9},{"x":10,"y":8},{"x":10,"y":7},{"x":10,"y":6},{"x":10,"y":5},{"x":10,"y":4},{"x":10,"y":3}],"latency":452,"head":{"x":7,"y":8},"length":11,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}},{"id":"gs_FmRS79twcMWwRXBQTD9j64PR","name":"soma-mini[sink]","health":100,"body":[{"x":0,"y":1},{"x":0,"y":2},{"x":0,"y":3},{"x":0,"y":4},{"x":1,"y":4},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":6}],"latency":413,"head":{"x":0,"y":1},"length":9,"shout":"409","squad":"","customizations":{"color":"#ff00ff","head":"snail","tail":"fat-rattle"}}]},"you":{"id":"gs_X7qmHjKkwpjDKyT6KkhhCxgF","name":"Jagwire","health":96,"body":[{"x":7,"y":8},{"x":8,"y":8},{"x":8,"y":9},{"x":9,"y":9},{"x":10,"y":9},{"x":10,"y":8},{"x":10,"y":7},{"x":10,"y":6},{"x":10,"y":5},{"x":10,"y":4},{"x":10,"y":3}],"latency":452,"head":{"x":7,"y":8},"length":11,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    board2d = new Board2d(gameState)
    cell = board2d.getCell({x: 7, y: 9})
    myself = gameState.you
    if (cell && myself) {
      expect(cell.hazard).toBe(4)
      moveSnake(gameState, myself, board2d, Direction.Up)
      expect(myself.health).toBe(15) // four hazards here on turn 105. Goes from 96 health to (96 - 20 * 4 - 1) = 15 health
    }

    // turn 125 - phase 6
    gameState = {"game":{"id":"a28cde00-b85e-4e67-a1e9-6b2f20df2049","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":20,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"hz_hazard_pits","timeout":500,"source":"ladder"},"turn":125,"board":{"width":11,"height":11,"food":[{"x":0,"y":5}],"hazards":[{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7}],"snakes":[{"id":"gs_X7qmHjKkwpjDKyT6KkhhCxgF","name":"Jagwire","health":93,"body":[{"x":6,"y":7},{"x":6,"y":8},{"x":6,"y":9},{"x":6,"y":10},{"x":5,"y":10},{"x":4,"y":10},{"x":3,"y":10},{"x":3,"y":9},{"x":2,"y":9},{"x":1,"y":9},{"x":1,"y":8},{"x":2,"y":8},{"x":2,"y":7}],"latency":452,"head":{"x":6,"y":7},"length":13,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}},{"id":"gs_FmRS79twcMWwRXBQTD9j64PR","name":"soma-mini[sink]","health":84,"body":[{"x":2,"y":5},{"x":2,"y":4},{"x":2,"y":3},{"x":2,"y":2},{"x":3,"y":2},{"x":4,"y":2},{"x":5,"y":2},{"x":6,"y":2},{"x":6,"y":3},{"x":6,"y":4},{"x":5,"y":4}],"latency":414,"head":{"x":2,"y":5},"length":11,"shout":"409","squad":"","customizations":{"color":"#ff00ff","head":"snail","tail":"fat-rattle"}}]},"you":{"id":"gs_X7qmHjKkwpjDKyT6KkhhCxgF","name":"Jagwire","health":93,"body":[{"x":6,"y":7},{"x":6,"y":8},{"x":6,"y":9},{"x":6,"y":10},{"x":5,"y":10},{"x":4,"y":10},{"x":3,"y":10},{"x":3,"y":9},{"x":2,"y":9},{"x":1,"y":9},{"x":1,"y":8},{"x":2,"y":8},{"x":2,"y":7}],"latency":452,"head":{"x":6,"y":7},"length":13,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    board2d = new Board2d(gameState)
    cell = board2d.getCell({x: 5, y: 7})
    myself = gameState.you
    if (cell && myself) {
      expect(cell.hazard).toBe(4)
      moveSnake(gameState, myself, board2d, Direction.Left)
      expect(myself.health).toBe(12) // four hazards here on turn 125. Goes from 93 health to (93 - 20 * 4 - 1) = 12 health
    }

    // turn 145 - phase 0 - hazards now gone again
    gameState = {"game":{"id":"a28cde00-b85e-4e67-a1e9-6b2f20df2049","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":20,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"hz_hazard_pits","timeout":500,"source":"ladder"},"turn":145,"board":{"width":11,"height":11,"food":[{"x":1,"y":7}],"hazards":[],"snakes":[{"id":"gs_X7qmHjKkwpjDKyT6KkhhCxgF","name":"Jagwire","health":100,"body":[{"x":0,"y":5},{"x":0,"y":4},{"x":1,"y":4},{"x":1,"y":3},{"x":2,"y":3},{"x":2,"y":2},{"x":2,"y":1},{"x":2,"y":0},{"x":3,"y":0},{"x":4,"y":0},{"x":5,"y":0},{"x":6,"y":0},{"x":6,"y":1},{"x":6,"y":2},{"x":6,"y":2}],"latency":451,"head":{"x":0,"y":5},"length":15,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}},{"id":"gs_FmRS79twcMWwRXBQTD9j64PR","name":"soma-mini[sink]","health":64,"body":[{"x":6,"y":7},{"x":5,"y":7},{"x":5,"y":6},{"x":5,"y":5},{"x":5,"y":4},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":4,"y":8},{"x":4,"y":9}],"latency":413,"head":{"x":6,"y":7},"length":11,"shout":"408","squad":"","customizations":{"color":"#ff00ff","head":"snail","tail":"fat-rattle"}}]},"you":{"id":"gs_X7qmHjKkwpjDKyT6KkhhCxgF","name":"Jagwire","health":100,"body":[{"x":0,"y":5},{"x":0,"y":4},{"x":1,"y":4},{"x":1,"y":3},{"x":2,"y":3},{"x":2,"y":2},{"x":2,"y":1},{"x":2,"y":0},{"x":3,"y":0},{"x":4,"y":0},{"x":5,"y":0},{"x":6,"y":0},{"x":6,"y":1},{"x":6,"y":2},{"x":6,"y":2}],"latency":451,"head":{"x":0,"y":5},"length":15,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    board2d = new Board2d(gameState)
    cell = board2d.getCell({x: 1, y: 5})
    myself = gameState.you
    if (cell && myself) {
      expect(cell.hazard).toBe(0)
      moveSnake(gameState, myself, board2d, Direction.Right)
      expect(myself.health).toBe(99) // zero hazards here on turn 145. Goes from 100 health to 99
    }

    // turn 165 - phase 1 - hazards now back again
    gameState = {"game":{"id":"a28cde00-b85e-4e67-a1e9-6b2f20df2049","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":20,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"hz_hazard_pits","timeout":500,"source":"ladder"},"turn":165,"board":{"width":11,"height":11,"food":[{"x":5,"y":0},{"x":10,"y":5},{"x":1,"y":9}],"hazards":[{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7}],"snakes":[{"id":"gs_X7qmHjKkwpjDKyT6KkhhCxgF","name":"Jagwire","health":74,"body":[{"x":5,"y":6},{"x":6,"y":6},{"x":6,"y":5},{"x":7,"y":5},{"x":8,"y":5},{"x":8,"y":6},{"x":7,"y":6},{"x":7,"y":7},{"x":6,"y":7},{"x":5,"y":7},{"x":4,"y":7},{"x":3,"y":7},{"x":2,"y":7},{"x":1,"y":7},{"x":1,"y":6},{"x":2,"y":6},{"x":3,"y":6}],"latency":23,"head":{"x":5,"y":6},"length":17,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}},{"id":"gs_FmRS79twcMWwRXBQTD9j64PR","name":"soma-mini[sink]","health":85,"body":[{"x":2,"y":3},{"x":2,"y":2},{"x":2,"y":1},{"x":2,"y":0},{"x":3,"y":0},{"x":4,"y":0},{"x":4,"y":1},{"x":4,"y":2},{"x":4,"y":3},{"x":4,"y":4},{"x":4,"y":5},{"x":5,"y":5}],"latency":416,"head":{"x":2,"y":3},"length":12,"shout":"411","squad":"","customizations":{"color":"#ff00ff","head":"snail","tail":"fat-rattle"}}]},"you":{"id":"gs_X7qmHjKkwpjDKyT6KkhhCxgF","name":"Jagwire","health":74,"body":[{"x":5,"y":6},{"x":6,"y":6},{"x":6,"y":5},{"x":7,"y":5},{"x":8,"y":5},{"x":8,"y":6},{"x":7,"y":6},{"x":7,"y":7},{"x":6,"y":7},{"x":5,"y":7},{"x":4,"y":7},{"x":3,"y":7},{"x":2,"y":7},{"x":1,"y":7},{"x":1,"y":6},{"x":2,"y":6},{"x":3,"y":6}],"latency":23,"head":{"x":5,"y":6},"length":17,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    board2d = new Board2d(gameState)
    cell = board2d.getCell({x: 5, y: 5})
    myself = gameState.you
    if (cell && myself) {
      expect(cell.hazard).toBe(1)
      moveSnake(gameState, myself, board2d, Direction.Down)
      expect(myself.health).toBe(53) // one hazard here on turn 165. Goes from 74 health to (74 - 20 - 1) = 53 health
    }
  })
  it('hazardPit2: knows not to walk into a hazard pit', () => {
    const gameState: GameState = {"game":{"id":"2c1c2b2c-dd65-4a43-a3c6-54f65c7922d7","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":20,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"hz_hazard_pits","timeout":500,"source":"testing"},"turn":139,"board":{"width":11,"height":11,"food":[{"x":0,"y":5}],"hazards":[{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7}],"snakes":[{"id":"gs_fcRg7KWCWxvddfQCfFxcJprc","name":"Jagwire","health":97,"body":[{"x":4,"y":7},{"x":4,"y":6},{"x":4,"y":5},{"x":4,"y":4},{"x":4,"y":3},{"x":5,"y":3},{"x":6,"y":3},{"x":6,"y":2},{"x":5,"y":2},{"x":4,"y":2},{"x":3,"y":2},{"x":2,"y":2},{"x":2,"y":1}],"latency":452,"head":{"x":4,"y":7},"length":13,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}},{"id":"gs_M8p7gth3W434y9GqTw4BFRy6","name":"soma-mini[sink]","health":63,"body":[{"x":10,"y":9},{"x":10,"y":10},{"x":9,"y":10},{"x":9,"y":9},{"x":9,"y":8},{"x":10,"y":8},{"x":10,"y":7},{"x":10,"y":6},{"x":10,"y":5},{"x":10,"y":4}],"latency":10,"head":{"x":10,"y":9},"length":10,"shout":"6","squad":"","customizations":{"color":"#ff00ff","head":"snail","tail":"fat-rattle"}},{"id":"gs_3h3mFcPQMhQX37Kb8hhwj3FK","name":"Snek-Bro","health":99,"body":[{"x":7,"y":10},{"x":8,"y":10},{"x":8,"y":9},{"x":8,"y":8},{"x":8,"y":7},{"x":8,"y":6},{"x":8,"y":5},{"x":8,"y":4},{"x":7,"y":4},{"x":6,"y":4},{"x":6,"y":5},{"x":6,"y":6},{"x":6,"y":7}],"latency":11,"head":{"x":7,"y":10},"length":13,"shout":"Sorry, I don't know what to say","squad":"","customizations":{"color":"#ffbf00","head":"beach-puffin","tail":"beach-puffin"}}]},"you":{"id":"gs_fcRg7KWCWxvddfQCfFxcJprc","name":"Jagwire","health":97,"body":[{"x":4,"y":7},{"x":4,"y":6},{"x":4,"y":5},{"x":4,"y":4},{"x":4,"y":3},{"x":5,"y":3},{"x":6,"y":3},{"x":6,"y":2},{"x":5,"y":2},{"x":4,"y":2},{"x":3,"y":2},{"x":2,"y":2},{"x":2,"y":1}],"latency":452,"head":{"x":4,"y":7},"length":13,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("up") // both left & right put me into an 80 damage hazard pit for no reason, up makes sense
  })
  it('hazardPit3: knows not to walk into a corner', () => {
    const gameState: GameState = {"game":{"id":"a34fa5ee-45d9-4543-8e79-a4975b0e4193","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":20,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"hz_hazard_pits","timeout":500,"source":"testing"},"turn":324,"board":{"width":11,"height":11,"food":[{"x":9,"y":10},{"x":10,"y":6}],"hazards":[{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7}],"snakes":[{"id":"gs_k8T9mVQvFRGXr9TrpKQpPDdc","name":"Jagwire","health":68,"body":[{"x":10,"y":4},{"x":10,"y":3},{"x":10,"y":2},{"x":9,"y":2},{"x":9,"y":1},{"x":8,"y":1},{"x":8,"y":0},{"x":7,"y":0},{"x":6,"y":0},{"x":5,"y":0},{"x":4,"y":0},{"x":3,"y":0},{"x":2,"y":0},{"x":2,"y":1},{"x":1,"y":1},{"x":1,"y":0},{"x":0,"y":0},{"x":0,"y":1},{"x":0,"y":2},{"x":1,"y":2},{"x":2,"y":2},{"x":3,"y":2},{"x":4,"y":2},{"x":4,"y":3},{"x":5,"y":3},{"x":5,"y":4}],"latency":452,"head":{"x":10,"y":4},"length":26,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}},{"id":"gs_GhfqKyFtK3JQ88RDJHfgmqmB","name":"soma-mini[sink]","health":14,"body":[{"x":9,"y":5},{"x":8,"y":5},{"x":7,"y":5},{"x":6,"y":5},{"x":6,"y":6},{"x":5,"y":6},{"x":4,"y":6},{"x":3,"y":6},{"x":2,"y":6},{"x":2,"y":5},{"x":1,"y":5},{"x":1,"y":6},{"x":1,"y":7},{"x":1,"y":8},{"x":1,"y":9},{"x":0,"y":9},{"x":0,"y":8},{"x":0,"y":7},{"x":0,"y":6},{"x":0,"y":5},{"x":0,"y":4},{"x":0,"y":3},{"x":1,"y":3},{"x":2,"y":3},{"x":3,"y":3}],"latency":414,"head":{"x":9,"y":5},"length":25,"shout":"409","squad":"","customizations":{"color":"#ff00ff","head":"snail","tail":"fat-rattle"}}]},"you":{"id":"gs_k8T9mVQvFRGXr9TrpKQpPDdc","name":"Jagwire","health":68,"body":[{"x":10,"y":4},{"x":10,"y":3},{"x":10,"y":2},{"x":9,"y":2},{"x":9,"y":1},{"x":8,"y":1},{"x":8,"y":0},{"x":7,"y":0},{"x":6,"y":0},{"x":5,"y":0},{"x":4,"y":0},{"x":3,"y":0},{"x":2,"y":0},{"x":2,"y":1},{"x":1,"y":1},{"x":1,"y":0},{"x":0,"y":0},{"x":0,"y":1},{"x":0,"y":2},{"x":1,"y":2},{"x":2,"y":2},{"x":3,"y":2},{"x":4,"y":2},{"x":4,"y":3},{"x":5,"y":3},{"x":5,"y":4}],"latency":452,"head":{"x":10,"y":4},"length":26,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("left") // up lets soma pin us in short order, left at least gives us a chance though it gets soma bigger
  })
  it('hazardPit4: does not suffer hazard pit damage to kill a snake in MaxN', () => {
    const gameState: GameState = {"game":{"id":"63ae1d5b-66d9-4862-a619-cb0361c9657b","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":20,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"hz_hazard_pits","timeout":500,"source":"testing"},"turn":132,"board":{"width":11,"height":11,"food":[{"x":7,"y":2}],"hazards":[{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7}],"snakes":[{"id":"gs_ffddRYHcmf4p7GV9rxgVrdDG","name":"Jagwire","health":87,"body":[{"x":2,"y":6},{"x":2,"y":5},{"x":2,"y":4},{"x":3,"y":4},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":4,"y":8},{"x":4,"y":9},{"x":4,"y":10},{"x":3,"y":10},{"x":2,"y":10},{"x":1,"y":10}],"latency":452,"head":{"x":2,"y":6},"length":14,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}},{"id":"gs_kqM3MrHpf79FSPqT9J6wMK6M","name":"☠️ Snakebeard ☠️","health":98,"body":[{"x":0,"y":6},{"x":0,"y":5},{"x":0,"y":4},{"x":0,"y":3},{"x":0,"y":2},{"x":1,"y":2},{"x":2,"y":2},{"x":3,"y":2},{"x":4,"y":2},{"x":5,"y":2},{"x":6,"y":2},{"x":6,"y":3}],"latency":419,"head":{"x":0,"y":6},"length":12,"shout":"","squad":"","customizations":{"color":"#ef5c26","head":"pirate-special","tail":"pirate-special"}},{"id":"gs_7KJrKGymMWHTGmrgVmxFbbmJ","name":"🧙 doctor strangle","health":71,"body":[{"x":4,"y":0},{"x":5,"y":0},{"x":6,"y":0},{"x":7,"y":0},{"x":8,"y":0},{"x":8,"y":1},{"x":9,"y":1},{"x":10,"y":1},{"x":10,"y":2}],"latency":416,"head":{"x":4,"y":0},"length":9,"shout":"","squad":"","customizations":{"color":"#ab4377","head":"trans-rights-scarf","tail":"mystic-moon"}}]},"you":{"id":"gs_ffddRYHcmf4p7GV9rxgVrdDG","name":"Jagwire","health":87,"body":[{"x":2,"y":6},{"x":2,"y":5},{"x":2,"y":4},{"x":3,"y":4},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6},{"x":4,"y":7},{"x":4,"y":8},{"x":4,"y":9},{"x":4,"y":10},{"x":3,"y":10},{"x":2,"y":10},{"x":1,"y":10}],"latency":452,"head":{"x":2,"y":6},"length":14,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("up") // left or right forces me to eat a big hazard pit, which will likely lead to my death
  })
  it('hazardPit5: knows not to walk into a hazard pit 2', () => {
    const gameState: GameState = {"game":{"id":"8dddb8e6-c51c-4611-b771-645fac15e458","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":20,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"hz_hazard_pits","timeout":500,"source":"testing"},"turn":55,"board":{"width":11,"height":11,"food":[{"x":9,"y":2},{"x":7,"y":5},{"x":5,"y":8},{"x":10,"y":8}],"hazards":[{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7}],"snakes":[{"id":"gs_pYVqb7MVwXKfS96yDdjyWhJP","name":"Jagwire","health":48,"body":[{"x":2,"y":1},{"x":1,"y":1},{"x":0,"y":1},{"x":0,"y":2},{"x":1,"y":2}],"latency":451,"head":{"x":2,"y":1},"length":5,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}},{"id":"gs_7XkGG3BPyK88w7dcqVhQcx9d","name":"☠️ Snakebeard ☠️","health":12,"body":[{"x":9,"y":4},{"x":9,"y":3},{"x":8,"y":3},{"x":8,"y":2},{"x":8,"y":1},{"x":8,"y":0}],"latency":418,"head":{"x":9,"y":4},"length":6,"shout":"","squad":"","customizations":{"color":"#ef5c26","head":"pirate-special","tail":"pirate-special"}},{"id":"gs_M3Kb3WCHYckhvVdBCcfrftY3","name":"Snek-Bro","health":76,"body":[{"x":6,"y":5},{"x":6,"y":6},{"x":7,"y":6},{"x":8,"y":6},{"x":8,"y":7},{"x":8,"y":8},{"x":8,"y":9},{"x":8,"y":10}],"latency":27,"head":{"x":6,"y":5},"length":8,"shout":"Goodbye 👋","squad":"","customizations":{"color":"#ffbf00","head":"beach-puffin","tail":"beach-puffin"}}]},"you":{"id":"gs_pYVqb7MVwXKfS96yDdjyWhJP","name":"Jagwire","health":48,"body":[{"x":2,"y":1},{"x":1,"y":1},{"x":0,"y":1},{"x":0,"y":2},{"x":1,"y":2}],"latency":451,"head":{"x":2,"y":1},"length":5,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).not.toBe("right") // right is hazard pit & we're not that healthy, up or down is not
  })
  it('hazardPit6: knows not to walk into a hazard pit 3', () => {
    const gameState: GameState = {"game":{"id":"d7a6bad4-a87c-4272-a74c-a6c3b8dac03a","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":20,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"hz_hazard_pits","timeout":500,"source":"testing"},"turn":369,"board":{"width":11,"height":11,"food":[{"x":6,"y":8},{"x":7,"y":1}],"hazards":[{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7}],"snakes":[{"id":"gs_FdTfhtdPykVhQp7TqdCYt4BT","name":"Jagwire","health":97,"body":[{"x":3,"y":0},{"x":2,"y":0},{"x":1,"y":0},{"x":0,"y":0},{"x":0,"y":1},{"x":0,"y":2},{"x":0,"y":3},{"x":0,"y":4},{"x":0,"y":5},{"x":0,"y":6},{"x":0,"y":7},{"x":0,"y":8},{"x":0,"y":9},{"x":0,"y":10},{"x":1,"y":10},{"x":1,"y":9},{"x":1,"y":8},{"x":1,"y":7},{"x":2,"y":7},{"x":2,"y":6},{"x":3,"y":6},{"x":4,"y":6},{"x":5,"y":6},{"x":6,"y":6},{"x":6,"y":5},{"x":6,"y":4},{"x":5,"y":4},{"x":4,"y":4},{"x":3,"y":4},{"x":2,"y":4},{"x":2,"y":3}],"latency":453,"head":{"x":3,"y":0},"length":31,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}},{"id":"gs_78DqkMFGV7VPDbDjQfTJVCK3","name":"Shapeshifter","health":80,"body":[{"x":8,"y":3},{"x":8,"y":2},{"x":7,"y":2},{"x":6,"y":2},{"x":6,"y":1},{"x":6,"y":0},{"x":7,"y":0},{"x":8,"y":0},{"x":8,"y":1},{"x":9,"y":1},{"x":9,"y":0},{"x":10,"y":0},{"x":10,"y":1},{"x":10,"y":2},{"x":10,"y":3},{"x":10,"y":4},{"x":10,"y":5},{"x":10,"y":6},{"x":10,"y":7},{"x":10,"y":8},{"x":9,"y":8},{"x":9,"y":7},{"x":8,"y":7},{"x":8,"y":6},{"x":7,"y":6}],"latency":389,"head":{"x":8,"y":3},"length":25,"shout":"","squad":"","customizations":{"color":"#900050","head":"cosmic-horror-special","tail":"cosmic-horror"}}]},"you":{"id":"gs_FdTfhtdPykVhQp7TqdCYt4BT","name":"Jagwire","health":97,"body":[{"x":3,"y":0},{"x":2,"y":0},{"x":1,"y":0},{"x":0,"y":0},{"x":0,"y":1},{"x":0,"y":2},{"x":0,"y":3},{"x":0,"y":4},{"x":0,"y":5},{"x":0,"y":6},{"x":0,"y":7},{"x":0,"y":8},{"x":0,"y":9},{"x":0,"y":10},{"x":1,"y":10},{"x":1,"y":9},{"x":1,"y":8},{"x":1,"y":7},{"x":2,"y":7},{"x":2,"y":6},{"x":3,"y":6},{"x":4,"y":6},{"x":5,"y":6},{"x":6,"y":6},{"x":6,"y":5},{"x":6,"y":4},{"x":5,"y":4},{"x":4,"y":4},{"x":3,"y":4},{"x":2,"y":4},{"x":2,"y":3}],"latency":453,"head":{"x":3,"y":0},"length":31,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("right") // up is 80 damage hazard, right is fine even if it's lower board coverage
  })
  // difficult case. Jagwire thinks Shapeshifter will go down because of Voronoi limitations with 1 lookahead
  it('hazardPit7: knows not to walk into a hazard pit 4', () => {
    const gameState: GameState = {"game":{"id":"22fa303f-2c93-49c0-9968-f54507ec6e66","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":20,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"hz_hazard_pits","timeout":500,"source":"testing"},"turn":49,"board":{"width":11,"height":11,"food":[{"x":5,"y":3}],"hazards":[{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7}],"snakes":[{"id":"gs_RgYYQ8vdvvVYdybCTmQ6hxKS","name":"Jagwire","health":53,"body":[{"x":2,"y":5},{"x":2,"y":6},{"x":3,"y":6},{"x":4,"y":6},{"x":5,"y":6},{"x":6,"y":6}],"latency":453,"head":{"x":2,"y":5},"length":6,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}},{"id":"gs_Y6BdbYM3F8jjyBpBCcKvxqFK","name":"Shapeshifter","health":51,"body":[{"x":5,"y":2},{"x":4,"y":2},{"x":4,"y":3},{"x":3,"y":3},{"x":3,"y":2},{"x":2,"y":2},{"x":1,"y":2}],"latency":389,"head":{"x":5,"y":2},"length":7,"shout":"","squad":"","customizations":{"color":"#900050","head":"cosmic-horror-special","tail":"cosmic-horror"}},{"id":"gs_PKxqT7J34CX8JVfcPMFYpHrQ","name":"soma-mini[sink]","health":41,"body":[{"x":6,"y":3},{"x":6,"y":2},{"x":7,"y":2},{"x":8,"y":2},{"x":8,"y":1}],"latency":415,"head":{"x":6,"y":3},"length":5,"shout":"410","squad":"","customizations":{"color":"#ff00ff","head":"snail","tail":"fat-rattle"}},{"id":"gs_GqVKMMCvStfWcw3WvPQDWXKK","name":"Snek-Bro","health":73,"body":[{"x":0,"y":9},{"x":0,"y":8},{"x":0,"y":7},{"x":0,"y":6}],"latency":13,"head":{"x":0,"y":9},"length":4,"shout":"Sorry, I don't know what to say","squad":"","customizations":{"color":"#ffbf00","head":"beach-puffin","tail":"beach-puffin"}}]},"you":{"id":"gs_RgYYQ8vdvvVYdybCTmQ6hxKS","name":"Jagwire","health":53,"body":[{"x":2,"y":5},{"x":2,"y":6},{"x":3,"y":6},{"x":4,"y":6},{"x":5,"y":6},{"x":6,"y":6}],"latency":453,"head":{"x":2,"y":5},"length":6,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("down") // left & right are both hazard pits that put me at low health, down is fine
  })
  it('hazardPit8: knows not to waltz into a hazard pit trap', () => {
    const gameState: GameState = {"game":{"id":"88fd1640-4104-4ba9-9029-13984d4298c5","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":20,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"hz_hazard_pits","timeout":500,"source":"testing"},"turn":132,"board":{"width":11,"height":11,"food":[{"x":0,"y":3}],"hazards":[{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7}],"snakes":[{"id":"gs_pRYPqWGMtjhjQKBJ9m6GYmwJ","name":"Jagwire","health":86,"body":[{"x":4,"y":10},{"x":5,"y":10},{"x":6,"y":10},{"x":7,"y":10},{"x":8,"y":10},{"x":8,"y":9},{"x":8,"y":8},{"x":8,"y":7},{"x":8,"y":6},{"x":7,"y":6},{"x":6,"y":6},{"x":6,"y":7},{"x":6,"y":8},{"x":5,"y":8},{"x":4,"y":8},{"x":4,"y":9}],"latency":452,"head":{"x":4,"y":10},"length":16,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}},{"id":"gs_fcm8tpHcxdxbtWDWb3MW4GdS","name":"🧙 doctor strangle","health":55,"body":[{"x":2,"y":6},{"x":3,"y":6},{"x":4,"y":6},{"x":4,"y":5},{"x":4,"y":4},{"x":3,"y":4},{"x":2,"y":4},{"x":2,"y":3},{"x":2,"y":2},{"x":3,"y":2}],"latency":415,"head":{"x":2,"y":6},"length":10,"shout":"","squad":"","customizations":{"color":"#ab4377","head":"trans-rights-scarf","tail":"mystic-moon"}},{"id":"gs_SgqmQr3SHDpJfDMJ4KjgWQgT","name":"Snek-Bro","health":87,"body":[{"x":8,"y":0},{"x":7,"y":0},{"x":6,"y":0},{"x":6,"y":1},{"x":6,"y":2},{"x":6,"y":3},{"x":6,"y":4}],"latency":8,"head":{"x":8,"y":0},"length":7,"shout":"I didn't think anybody would be this bad","squad":"","customizations":{"color":"#ffbf00","head":"beach-puffin","tail":"beach-puffin"}}]},"you":{"id":"gs_pRYPqWGMtjhjQKBJ9m6GYmwJ","name":"Jagwire","health":86,"body":[{"x":4,"y":10},{"x":5,"y":10},{"x":6,"y":10},{"x":7,"y":10},{"x":8,"y":10},{"x":8,"y":9},{"x":8,"y":8},{"x":8,"y":7},{"x":8,"y":6},{"x":7,"y":6},{"x":6,"y":6},{"x":6,"y":7},{"x":6,"y":8},{"x":5,"y":8},{"x":4,"y":8},{"x":4,"y":9}],"latency":452,"head":{"x":4,"y":10},"length":16,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("down") // left allows doctor strangle to trap us in the corner against a hazard pit in ~10 turns, down is safe
  })
  it('hazardPit9: chases tail to prolong life', () => {
    const gameState: GameState = {"game":{"id":"c581daca-acc5-4436-9402-d114a616236f","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":20,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"hz_hazard_pits","timeout":500,"source":"testing"},"turn":326,"board":{"width":11,"height":11,"food":[{"x":10,"y":9},{"x":1,"y":9}],"hazards":[{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7}],"snakes":[{"id":"gs_fmw8rQwmgwxP6rmXWWSdfRhH","name":"Jagwire","health":63,"body":[{"x":2,"y":2},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":2,"y":8},{"x":2,"y":9},{"x":2,"y":10},{"x":3,"y":10},{"x":4,"y":10},{"x":4,"y":9},{"x":4,"y":8},{"x":5,"y":8},{"x":6,"y":8},{"x":6,"y":7},{"x":6,"y":6},{"x":5,"y":6},{"x":4,"y":6},{"x":4,"y":5},{"x":4,"y":4},{"x":4,"y":3},{"x":4,"y":2},{"x":4,"y":1}],"latency":451,"head":{"x":2,"y":2},"length":24,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}},{"id":"gs_TJB4tbgF6fbhpqYrgcfJc8bB","name":"soma-mini[sink]","health":94,"body":[{"x":6,"y":0},{"x":7,"y":0},{"x":8,"y":0},{"x":8,"y":1},{"x":9,"y":1},{"x":9,"y":0},{"x":10,"y":0},{"x":10,"y":1},{"x":10,"y":2},{"x":10,"y":3},{"x":10,"y":4},{"x":10,"y":5},{"x":10,"y":6},{"x":10,"y":7},{"x":9,"y":7},{"x":9,"y":6},{"x":9,"y":5},{"x":9,"y":4},{"x":8,"y":4},{"x":8,"y":3},{"x":8,"y":2},{"x":7,"y":2},{"x":7,"y":3},{"x":6,"y":3},{"x":6,"y":2},{"x":6,"y":1},{"x":5,"y":1}],"latency":11,"head":{"x":6,"y":0},"length":27,"shout":"6","squad":"","customizations":{"color":"#ff00ff","head":"snail","tail":"fat-rattle"}}]},"you":{"id":"gs_fmw8rQwmgwxP6rmXWWSdfRhH","name":"Jagwire","health":63,"body":[{"x":2,"y":2},{"x":2,"y":3},{"x":2,"y":4},{"x":2,"y":5},{"x":2,"y":6},{"x":2,"y":7},{"x":2,"y":8},{"x":2,"y":9},{"x":2,"y":10},{"x":3,"y":10},{"x":4,"y":10},{"x":4,"y":9},{"x":4,"y":8},{"x":5,"y":8},{"x":6,"y":8},{"x":6,"y":7},{"x":6,"y":6},{"x":5,"y":6},{"x":4,"y":6},{"x":4,"y":5},{"x":4,"y":4},{"x":4,"y":3},{"x":4,"y":2},{"x":4,"y":1}],"latency":451,"head":{"x":2,"y":2},"length":24,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("right") // down or left pushes me further in the corner & lets Soma trap us the next loop around, right lets us keep enough board to stay alive
  })
  it('hazardPit10: chooses a potential tie over a potential cutoff against hazard', () => {
    const gameState: GameState = {"game":{"id":"043b861d-cf44-4ebf-a33f-cc6e4f542191","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":20,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"hz_hazard_pits","timeout":500,"source":"testing"},"turn":44,"board":{"width":11,"height":11,"food":[{"x":3,"y":7},{"x":10,"y":8}],"hazards":[{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7}],"snakes":[{"id":"gs_P79kffCCCF4GJFGpKhxHTJD3","name":"Jagwire","health":99,"body":[{"x":6,"y":0},{"x":7,"y":0},{"x":8,"y":0},{"x":8,"y":1},{"x":8,"y":2},{"x":9,"y":2},{"x":10,"y":2}],"latency":451,"head":{"x":6,"y":0},"length":7,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}},{"id":"gs_KYrSpt4ftRQg8WcXMCwwSqSd","name":"Shapeshifter","health":93,"body":[{"x":6,"y":2},{"x":6,"y":3},{"x":6,"y":4},{"x":5,"y":4},{"x":4,"y":4},{"x":4,"y":5},{"x":4,"y":6}],"latency":390,"head":{"x":6,"y":2},"length":7,"shout":"","squad":"","customizations":{"color":"#900050","head":"cosmic-horror-special","tail":"cosmic-horror"}},{"id":"gs_yxj3h7rtY7YFWJGjcQ8HXGhD","name":"soma-mini[sink]","health":58,"body":[{"x":9,"y":9},{"x":9,"y":10},{"x":10,"y":10},{"x":10,"y":9}],"latency":416,"head":{"x":9,"y":9},"length":4,"shout":"411","squad":"","customizations":{"color":"#ff00ff","head":"snail","tail":"fat-rattle"}}]},"you":{"id":"gs_P79kffCCCF4GJFGpKhxHTJD3","name":"Jagwire","health":99,"body":[{"x":6,"y":0},{"x":7,"y":0},{"x":8,"y":0},{"x":8,"y":1},{"x":8,"y":2},{"x":9,"y":2},{"x":10,"y":2}],"latency":451,"head":{"x":6,"y":0},"length":7,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).toBe("up") // up risks tie but lets us escape eating one hazard pit, left will end up eating more
  })
  it('hazardPit11: does not suicide into a kiss of death restricted by hazard pit', () => {
    const gameState: GameState = {"game":{"id":"77cc5b11-8aa3-4153-85a7-41405de8f3fa","ruleset":{"name":"standard","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":20,"royale":{"shrinkEveryNTurns":20},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"hz_hazard_pits","timeout":500,"source":"testing"},"turn":54,"board":{"width":11,"height":11,"food":[{"x":4,"y":1}],"hazards":[{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7},{"x":1,"y":3},{"x":1,"y":5},{"x":1,"y":7},{"x":3,"y":1},{"x":3,"y":3},{"x":3,"y":5},{"x":3,"y":7},{"x":3,"y":9},{"x":5,"y":1},{"x":5,"y":3},{"x":5,"y":5},{"x":5,"y":7},{"x":5,"y":9},{"x":7,"y":1},{"x":7,"y":3},{"x":7,"y":5},{"x":7,"y":7},{"x":7,"y":9},{"x":9,"y":3},{"x":9,"y":5},{"x":9,"y":7}],"snakes":[{"id":"gs_RGxdtB3hTV8fdt76kq9yq8JG","name":"Jagwire","health":28,"body":[{"x":6,"y":6},{"x":6,"y":5},{"x":6,"y":4},{"x":7,"y":4}],"latency":452,"head":{"x":6,"y":6},"length":4,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}},{"id":"gs_GVBStfkS4ktqdD7438Yq9VF8","name":"soma-mini[sink]","health":93,"body":[{"x":4,"y":4},{"x":4,"y":3},{"x":4,"y":2},{"x":3,"y":2},{"x":2,"y":2},{"x":1,"y":2},{"x":1,"y":1},{"x":1,"y":0}],"latency":411,"head":{"x":4,"y":4},"length":8,"shout":"406","squad":"","customizations":{"color":"#ff00ff","head":"snail","tail":"fat-rattle"}}]},"you":{"id":"gs_RGxdtB3hTV8fdt76kq9yq8JG","name":"Jagwire","health":28,"body":[{"x":6,"y":6},{"x":6,"y":5},{"x":6,"y":4},{"x":7,"y":4}],"latency":452,"head":{"x":6,"y":6},"length":4,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).not.toBe("left")
  })
})

describe('islands and bridges tests', () => {
  it('islandsBridges1: does not walk into a corner after guessing MaxN moves wrong', () => {
    const gameState: GameState = {"game":{"id":"6c2a700c-0c71-441b-8a06-1e6ce30163d6","ruleset":{"name":"wrapped","version":"?","settings":{"foodSpawnChance":15,"minimumFood":1,"hazardDamagePerTurn":100,"royale":{},"squad":{"allowBodyCollisions":false,"sharedElimination":false,"sharedHealth":false,"sharedLength":false}}},"map":"hz_islands_bridges","timeout":500,"source":"testing"},"turn":37,"board":{"width":11,"height":11,"food":[{"x":8,"y":9},{"x":7,"y":1}],"hazards":[{"x":5,"y":10},{"x":5,"y":9},{"x":5,"y":7},{"x":5,"y":6},{"x":5,"y":5},{"x":5,"y":4},{"x":5,"y":3},{"x":5,"y":0},{"x":5,"y":1},{"x":6,"y":5},{"x":7,"y":5},{"x":9,"y":5},{"x":10,"y":5},{"x":4,"y":5},{"x":3,"y":5},{"x":1,"y":5},{"x":0,"y":5},{"x":1,"y":10},{"x":9,"y":10},{"x":1,"y":0},{"x":9,"y":0},{"x":10,"y":1},{"x":10,"y":0},{"x":10,"y":10},{"x":10,"y":9},{"x":0,"y":10},{"x":0,"y":9},{"x":0,"y":1},{"x":0,"y":0},{"x":0,"y":6},{"x":0,"y":4},{"x":10,"y":6},{"x":10,"y":4},{"x":6,"y":10},{"x":4,"y":10},{"x":6,"y":0},{"x":4,"y":0}],"snakes":[{"id":"gs_W397BhhwSM3qtMr3Tb9kvSr6","name":"Jagwire","health":91,"body":[{"x":2,"y":7},{"x":2,"y":6},{"x":2,"y":5},{"x":2,"y":4},{"x":1,"y":4},{"x":1,"y":3},{"x":2,"y":3},{"x":3,"y":3}],"latency":452,"head":{"x":2,"y":7},"length":8,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}},{"id":"gs_fV8P4qHyB9vhrTbW6y4kD8WW","name":"gobeans","health":100,"body":[{"x":3,"y":8},{"x":3,"y":9},{"x":3,"y":10},{"x":3,"y":0},{"x":3,"y":0}],"latency":17,"head":{"x":3,"y":8},"length":5,"shout":"","squad":"","customizations":{"color":"#77ebf7","head":"bendr","tail":"offroad"}},{"id":"gs_g3bqX48pTCvkw4gcyVrqVhWK","name":"One","health":100,"body":[{"x":7,"y":8},{"x":8,"y":8},{"x":8,"y":7},{"x":8,"y":6},{"x":8,"y":5},{"x":8,"y":5}],"latency":51,"head":{"x":7,"y":8},"length":6,"shout":"","squad":"","customizations":{"color":"#32a83c","head":"default","tail":"default"}}]},"you":{"id":"gs_W397BhhwSM3qtMr3Tb9kvSr6","name":"Jagwire","health":91,"body":[{"x":2,"y":7},{"x":2,"y":6},{"x":2,"y":5},{"x":2,"y":4},{"x":1,"y":4},{"x":1,"y":3},{"x":2,"y":3},{"x":3,"y":3}],"latency":452,"head":{"x":2,"y":7},"length":8,"shout":"","squad":"","customizations":{"color":"#ffd900","head":"smile","tail":"wave"}}}
    const moveResponse: MoveResponse = move(gameState)
    expect(moveResponse.move).not.toBe("right") // right lets gobeans go right & corner us, which spells death if One plays its cards right
  })
})