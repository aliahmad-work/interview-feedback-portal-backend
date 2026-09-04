import { Router } from "express";
import { body } from "express-validator";
import { authenticate } from "../middleware/auth.middleware";
import { authorize } from "../middleware/role.middleware";
import { validate } from "../middleware/validate.middleware";
import { uploadResume, uploadMultipleResumes } from "../middleware/upload.middleware";
import {
    createInterview,
    getAllInterviews,
    updateInterview,
    deleteInterview,
    updateDecision,
    resumeInterview,
    getInterviewRounds,
    addInterviewRounds,
    updateRoundSchedule,
    cancelRound,
    updateRoundDecision
} from "../controllers/interview.controller";

import { calendlyController } from "../controllers/calendly.controller";
import { getCandidates, getCandidateById, createCandidate, updateCandidate, deleteCandidate, downloadResume, bulkUploadAndMatchResumes } from "../controllers/candidate.controller";
import { getInterviewers, getPositions, getPositionById, getDepartments, createUser, createPosition, updatePosition } from "../controllers/admin.controller";
import { VALID_DECISIONS } from "../service/interview.service";


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

router.post(
    "/candidates/bulk-match",
    authenticate,
    authorize("admin"),
    uploadMultipleResumes,
    [
        body("positionId").notEmpty().withMessage("Position ID is required")
    ],
    validate,
    bulkUploadAndMatchResumes
);


router.get(
    "/candidates/:id",
    authenticate,
    authorize("admin"),
    getCandidateById
);

router.put(
    "/candidates/:id",
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
    updateCandidate
);

router.delete(
    "/candidates/:id",
    authenticate,
    authorize("admin"),
    deleteCandidate
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

router.patch(
    "/interviews/:id/decision",
    authenticate,
    authorize("admin"),
    [
        body("decision")
            .isIn(VALID_DECISIONS)
            .withMessage(`Decision must be one of: ${VALID_DECISIONS.join(", ")}`)
    ],
    validate,
    updateDecision
);

router.patch(
    "/interviews/:id/resume",
    authenticate,
    authorize("admin"),
    resumeInterview
);

router.post(
    "/interviews",
    authenticate,
    authorize("admin"),
    [
        body("candidateId").notEmpty().withMessage("Candidate is required"),
        body("positionId").notEmpty().withMessage("Position is required")
    ],
    validate,
    createInterview
);

router.put(
    "/interviews/:id",
    authenticate,
    authorize("admin"),
    updateInterview
);

router.delete(
    "/interviews/:id",
    authenticate,
    authorize("admin"),
    deleteInterview
);


router.get(
    "/interviews/:id/rounds",
    authenticate,
    authorize("admin"),
    getInterviewRounds
);

router.post(
    "/interviews/:id/rounds",
    authenticate,
    authorize("admin"),
    [
        body("rounds").isArray({ min: 1 }).withMessage("At least one round is required"),
        body("rounds.*.interviewerIds").isArray({ min: 1 }).withMessage("At least one interviewer is required per round"),
        body("rounds.*.duration").isInt({ min: 15 }).withMessage("Duration must be at least 15 minutes")
    ],
    validate,
    addInterviewRounds
);

router.patch(
    "/interviews/:id/rounds/:roundId/schedule",
    authenticate,
    authorize("admin"),
    [
        body("date").notEmpty().withMessage("Date is required"),
        body("startTime").notEmpty().withMessage("Start time is required"),
        body("endTime").notEmpty().withMessage("End time is required")
    ],
    validate,
    updateRoundSchedule
);

router.patch(
    "/interviews/:id/rounds/:roundId/cancel",
    authenticate,
    authorize("admin"),
    cancelRound
);

router.patch(
    "/interviews/:id/rounds/:roundId/decision",
    authenticate,
    authorize("admin"),
    [
        body("decision")
            .isIn(VALID_DECISIONS)
            .withMessage(`Decision must be one of: ${VALID_DECISIONS.join(", ")}`)
    ],
    validate,
    updateRoundDecision
);

router.get(
    "/interviewers",
    authenticate,
    authorize("admin"),
    getInterviewers
);

router.post(
    "/users",
    authenticate,
    authorize("admin"),
    [
        body("firstname").notEmpty().withMessage("First name is required"),
        body("lastname").notEmpty().withMessage("Last name is required"),
        body("email").isEmail().withMessage("A valid email is required"),
        body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
        body("role").notEmpty().withMessage("Role is required")
    ],
    validate,
    createUser
);

router.get(
    "/departments",
    authenticate,
    authorize("admin"),
    getDepartments
);

router.post(
    "/positions",
    authenticate,
    authorize("admin"),
    [
        body("title").notEmpty().withMessage("Title is required"),
        body("departmentId").notEmpty().withMessage("Department is required"),
        body("requiredSkills").isArray({ min: 1 }).withMessage("At least one required skill is needed"),
        body("minimumExperience").isInt({ min: 0 }).withMessage("Minimum experience must be a number"),
        body("description").notEmpty().withMessage("Description is required")
    ],
    validate,
    createPosition
);

router.get(
    "/positions",
    authenticate,
    authorize("admin"),
    getPositions
);

router.get(
    "/positions/:id",
    authenticate,
    authorize("admin"),
    getPositionById
);

router.put(
    "/positions/:id",
    authenticate,
    authorize("admin"),
    [
        body("status").optional().isIn(["open", "closed"]).withMessage("Status must be open or closed"),
        body("openings").optional().isInt({ min: 1 }).withMessage("Openings must be a number of at least 1"),
        body("closeReason").optional().isString().withMessage("Close reason must be a string")
    ],
    validate,
    updatePosition
);

// Calendly Integration Routes
router.post(
    "/calendly/sync",
    authenticate,
    authorize("admin"),
    calendlyController.syncEvents
);

router.get(
    "/calendly/event-types",
    authenticate,
    authorize("admin"),
    calendlyController.getEventTypes
);

router.get(
    "/calendly/status",
    authenticate,
    authorize("admin"),
    calendlyController.getSyncStatus
);

router.post(
    "/email/test",
    authenticate,
    authorize("admin"),
    [
        body("email").isEmail().withMessage("A valid email is required"),
    ],
    validate,
    calendlyController.testEmail
);

export default router;
