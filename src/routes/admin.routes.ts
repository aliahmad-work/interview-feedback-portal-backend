import { Router } from "express";
import { body } from "express-validator";
import { authenticate } from "../middleware/auth.middleware";
import { authorize } from "../middleware/role.middleware";
import { validate } from "../middleware/validate.middleware";
import { uploadResume } from "../middleware/upload.middleware";
import { getCandidates, createCandidate, downloadResume } from "../controllers/candidate.controller";
import { createInterview, getAllInterviews } from "../controllers/interview.controller";
import { getInterviewers, getPositions } from "../controllers/admin.controller";

const router = Router();

router.get(
    "/dashboard",
    authenticate,
    authorize("admin"),
    (req, res) => {
        res.json({ message: "Admin Dashboard" });
    }
);

router.get(
    "/candidates",
    authenticate,
    authorize("admin"),
    getCandidates
);

router.post(
    "/candidates",
    authenticate,
    authorize("admin"),
    uploadResume,
    [
        body("firstname").notEmpty().withMessage("First name is required"),
        body("lastname").notEmpty().withMessage("Last name is required"),
        body("email").isEmail().withMessage("A valid email is required"),
        body("phone").notEmpty().withMessage("Phone is required")
    ],
    validate,
    createCandidate
);

router.get(
    "/candidates/:id/resume",
    authenticate,
    authorize("admin"),
    downloadResume
);

router.get(
    "/interviews",
    authenticate,
    authorize("admin"),
    getAllInterviews
);

router.post(
    "/interviews",
    authenticate,
    authorize("admin"),
    [
        body("candidateId").notEmpty().withMessage("Candidate is required"),
        body("positionId").notEmpty().withMessage("Position is required"),
        body("interviewerIds").isArray({ min: 1 }).withMessage("At least one interviewer is required"),
        body("date").notEmpty().withMessage("Date is required"),
        body("startTime").notEmpty().withMessage("Start time is required"),
        body("endTime").notEmpty().withMessage("End time is required")
    ],
    validate,
    createInterview
);

router.get(
    "/interviewers",
    authenticate,
    authorize("admin"),
    getInterviewers
);

router.get(
    "/positions",
    authenticate,
    authorize("admin"),
    getPositions
);

export default router;
