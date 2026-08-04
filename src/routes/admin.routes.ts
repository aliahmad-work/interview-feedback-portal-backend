import { Router } from "express";
import { body } from "express-validator";
import { authenticate } from "../middleware/auth.middleware";
import { authorize } from "../middleware/role.middleware";
import { validate } from "../middleware/validate.middleware";
import { getCandidates, createCandidate } from "../controllers/candidate.controller";
import { createInterview, getAllInterviews } from "../controllers/interview.controller";
import { getInterviewers, getPositions, getDepartments, createUser, createPosition } from "../controllers/admin.controller";

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

export default router;
