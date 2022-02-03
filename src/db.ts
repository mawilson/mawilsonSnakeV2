import { Collection, Db, MongoClient } from 'mongodb'
import { version } from './logic'

export async function connectToDatabase(): Promise<MongoClient> {
    // Connection url
    const url = "mongodb://45.79.100.226:27017";

    // Connect using a MongoClient instance
    const mongoClient: MongoClient = new MongoClient(url)
    await mongoClient.connect()

    return mongoClient
}

export async function getCollection(mongoClient: MongoClient, collectionName: string): Promise<Collection> {
    const dbName = "test";
    const db: Db = mongoClient.db(dbName)

    return db.collection(collectionName)
} 

// as gotten from Compass, the aggregator that we can use to get groupings of score averages
// this one groups based on depth, startLookahead, snakeCount, & snakeLength
// it only considers scores whose gameResult was a win & version matches my version
export const snakeScoreAggregations = [
  {
    '$match': {
      'gameResult': 'win', 
      'version': version
    }
  }, {
    '$group': {
      '_id': {
        'hashKey': '$hashKey'
      }, 
      'averageScore': {
        '$avg': '$score'
      }
    }
  }
]

// not used for anything currently, but I wanted it to be in repo
const timingAggregations = [
  {
    '$match': {
      'average': {
        '$lt': 500
      }, 
      'timeout': {
        '$exists': true
      },
      'gameMode': {
        '$exists': true
      }
    }
  }, {
    '$group': {
      '_id': {
        'version': '$version', 
        'amMachineLearning': '$amMachineLearning', 
        'amUsingMachineData': '$amUsingMachineData', 
        'timeout': '$timeout',
        'gameMode': '$gameMode'
      }, 
      'averageAverage': {
        '$avg': '$average'
      }, 
      'averageMax': {
        '$avg': '$max'
      }, 
      'averageStdDev': {
        '$avg': '$populationStandardDeviaton'
      }, 
      'wins': {
        '$sum': {
          '$cond': [
            {
              '$eq': [
                '$gameResult', 'win'
              ]
            }, 1, 0
          ]
        }
      }, 
      'losses': {
        '$sum': {
          '$cond': [
            {
              '$eq': [
                '$gameResult', 'loss'
              ]
            }, 1, 0
          ]
        }
      }, 
      'ties': {
        '$sum': {
          '$cond': [
            {
              '$eq': [
                '$gameResult', 'tie'
              ]
            }, 1, 0
          ]
        }
      }, 
      'total': {
        '$sum': 1
      }
    }
  }, {
    '$project': {
      'version': '$_id.version', 
      'amMachineLearning': '$_id.amMachineLearning', 
      'amUsingMachineData': '$_id.amUsingMachineData', 
      'timeout': '$_id.timeout', 
      'gameMode': '$_id.gameMode',
      'averageAverage': '$averageAverage', 
      'averageMax': '$averageMax', 
      'averageStdDev': '$averageStdDev', 
      'winRate': {
        '$divide': [
          '$wins', '$total'
        ]
      }, 
      'lossRate': {
        '$divide': [
          '$losses', '$total'
        ]
      }, 
      'tieRate': {
        '$divide': [
          '$ties', '$total'
        ]
      }, 
      'total': '$total'
    }
  }
]