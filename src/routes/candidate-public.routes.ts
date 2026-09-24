import { Router } from "express";
import { getQuestionnaireByToken, submitQuestionnaire } from "../controllers/questionnaire.controller";
import { body } from "express-validator";
import { validate } from "../middleware/validate.middleware";

const router = Router();

router.get("/questionnaire/:token", getQuestionnaireByToken);

router.post(
  "/questionnaire/:token/submit",
  [
    body("isInterested").isBoolean().withMessage("isInterested must be a boolean"),
    // answers can be optional if not interested, so we don't strictly validate here unless we add custom validation
  ],
  validate,
  submitQuestionnaire
);

export default router;
