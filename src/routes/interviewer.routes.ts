import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { authorize } from "../middleware/role.middleware";
import { getInterviewerInterviews } from "../controllers/interview.controller";

const router = Router();

router.get(
    "/dashboard",
    authenticate,
    authorize("interviewer"),
    (req, res) => {
        res.json({ message: "Interviewer Dashboard" });
    }
);

router.get(
    "/interviews",
    authenticate,
    authorize("interviewer"),
    getInterviewerInterviews
);

export default router;