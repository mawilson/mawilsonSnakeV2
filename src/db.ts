import { Collection, Db, MongoClient } from 'mongodb'
import { version } from './logic'

export async function connectToDatabase(): Promise<MongoClient> {
    // Connection url
    let url: string = "mongodb://45.79.100.226:27017"
    // if (isLinodeDedi) {
    //   url = "mongodb://45.79.102.27:27017"
    // } else {
    //   url = "mongodb://45.79.100.226:27017";
    // }


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

// not used for anything currently, but I wanted it to be in repo
const timingAggregations = [
  {
    '$match': {
      'timeout': {
        '$exists': true
      }, 
      'gameMode': {
        '$exists': true
      }, 
      'isDevelopment': {
        '$exists': true
      }, 
      'source': {
        '$exists': true
      }, 
      'hazardDamage': {
        '$exists': true
      }, 
      'map': {
        '$exists': true
      }, 
      'snakeLength': {
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
        'gameMode': '$gameMode', 
        'isDevelopment': '$isDevelopment', 
        'source': '$source', 
        'hazardDamage': '$hazardDamage', 
        'map': '$map'
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
      'averageLength': {
        '$avg': '$snakeLength'
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
      }, 
      'numTimeouts': {
        '$sum': '$numTimeouts'
      }
    }
  }, {
    '$project': {
      'version': '$_id.version', 
      'amMachineLearning': '$_id.amMachineLearning', 
      'amUsingMachineData': '$_id.amUsingMachineData', 
      'timeout': '$_id.timeout', 
      'gameMode': '$_id.gameMode', 
      'source': '$_id.source', 
      'hazardDamage': '$_id.hazardDamage', 
      'map': '$_id.map', 
      'isDevelopment': '$_id.isDevelopment', 
      'averageAverage': '$averageAverage', 
      'averageMax': '$averageMax', 
      'averageStdDev': '$averageStdDev', 
      'averageLength': '$averageLength', 
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
      'total': '$total', 
      'numTimeouts': '$numTimeouts'
    }
  }, {
    '$match': {
      'isDevelopment': false, 
      'source': 'ladder', 
      'map': 'healing_pools', 
      'timeout': 500
    }
  }
]