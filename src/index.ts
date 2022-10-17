import express, { Request, Response } from "express"

import { info, start, move, end } from "./logic";
import { Server } from "http";

import tokei from 'node-tokei'
import { TokeiResult } from "node-tokei"

const app = express()
app.use(express.json())

const port = process.env.PORT || 8080

const locStats: Promise<{[language: string]: TokeiResult }> = tokei('./')

app.get("/", (req: Request, res: Response) => {
    res.send(info())
});

app.get("/stats", (req: Request, res: Response) => {
    locStats.then(value => {
        return res.send(value)
    })
});

app.post("/start", (req: Request, res: Response) => {
    res.send(start(req.body))
});

app.post("/move", (req: Request, res: Response) => {
    res.send(move(req.body))
});

app.post("/end", (req: Request, res: Response) => {
    res.send(end(req.body))
});

app.listen(port, () => { // Start the Express server
    console.log(`Starting Battlesnake Server at http://0.0.0.0:${port}...`)
});
