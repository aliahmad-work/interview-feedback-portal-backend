import { Request, Response } from "express";
import * as authServices from "../service/auth.service";
import { generateToken } from "../utils/jwt";

export async function login(req: Request, res: Response) {
    const { email, password } = req.body;

    const user = await authServices.login(email, password);

    if (!user) {
        return res.status(401).json({ message: "Invalid email or password"});
    }

    const token = generateToken(user);

    return res.json({
        token,
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role
        },
    });
}
