import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { authorize } from "../middleware/role.middleware";

const router = Router();

router.get(
    "interviewer/dashboard",
    authenticate,
    authorize("INTERVIEWER"),
    (req, res) => {
        res.json({ message: "Interviewer Dashboard" });
    }
);

export default router;