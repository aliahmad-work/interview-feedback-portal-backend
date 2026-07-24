import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { authorize } from "../middleware/role.middleware";

const router = Router();

router.get(
    "admin/dashboard",
    authenticate,
    authorize("admin"),
    (req, res) => {
        res.json({ message: "Admin Dashboard" });
    }
);

export default router;