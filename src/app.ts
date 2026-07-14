import express from "express";
import morgan from "morgan";
import cors from "cors";
import helmet from "helmet";

const app = express();

app.use(cors());
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());

app.get("/", (req, res) => {
    res.send("Interview Feedback Portal!");
});

export default app;