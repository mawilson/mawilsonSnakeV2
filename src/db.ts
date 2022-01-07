import { Collection, Db, MongoClient } from 'mongodb'
import { version } from './logic'

export async function connectToDatabase(): Promise<MongoClient> {
    // Connection url
    const url = "mongodb://localhost:27017";

    // Connect using a MongoClient instance
    const mongoClient: MongoClient = new MongoClient(url)
    await mongoClient.connect()

    return mongoClient
}

export async function getSnakeScoresCollection(mongoClient: MongoClient): Promise<Collection> {
    const dbName = "test";
    const collectionName = "snakeScores"
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
          'depth': '$depth', 
          'startLookahead': '$startLookahead', 
          'snakeCount': '$snakeCount', 
          'snakeLength': '$snakeLength'
        }, 
        'averageScore': {
          '$avg': '$score'
        }
      }
    }
  ]