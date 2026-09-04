import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { authorize } from "../middleware/role.middleware";
import { getInterviewerInterviews, getInterviewById, getCandidateDetails, downloadCandidateResume } from "../controllers/interview.controller";
import { submitFeedback, getFeedback } from "../controllers/feedback.controller";

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

router.get(
    "/candidate/:id/resume",
    authenticate,
    authorize("interviewer"),
    downloadCandidateResume
)

router.post(
    "/feedback",
    authenticate,
    authorize("interviewer"),
    submitFeedback
);

router.get(
    "/feedback/:interviewId",
    authenticate,
    authorize("interviewer", "admin"),
    getFeedback
);

export default router;
