import express from "express";
import morgan from "morgan";
import cors from "cors";
import helmet from "helmet";
import authRoutes from "./routes/auth.routes";
import adminRoutes from "./routes/admin.routes";
import interviewerRoutes from "./routes/interviewer.routes";
import candidatePublicRoutes from "./routes/candidate-public.routes";

const app = express();

app.use(cors());
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/interviewer", interviewerRoutes);
app.use("/api/candidate", candidatePublicRoutes);

app.get("/", (_req, res) => {
    res.send("Interview Feedback Portal!");
});

export default app;