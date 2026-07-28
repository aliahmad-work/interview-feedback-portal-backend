import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { authorize } from "../middleware/role.middleware";
import { getInterviewerInterviews, getInterviewById, getCandidateDetails } from "../controllers/interview.controller";

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

router.get(
    "/interviews/:id",
    authenticate,
    authorize("interviewer"),
    getInterviewById
);

router.get(
    "/candidate/:id",
    authenticate,
    authorize("interviewer"),
    getCandidateDetails
)

export default router;