import { Request, Response } from "express";
import * as adminServices from "../service/admin.service";

export async function getInterviewers(req: Request, res: Response) {
    const interviewers = await adminServices.getInterviewers();

    return res.json({
        interviewers
    });
}

export async function getPositions(req: Request, res: Response) {
    const positions = await adminServices.getPositions();

    return res.json({
        positions
    });
}

export async function getDepartments(req: Request, res: Response) {
    const departments = await adminServices.getDepartments();

    return res.json({
        departments
    });
}

export async function createUser(req: Request, res: Response) {
    try {
        const { firstname, lastname, email, password, role, designation, phone } = req.body;

        const user = await adminServices.createUser({
            firstname,
            lastname,
            email,
            password,
            role,
            designation,
            phone
        });

        return res.status(201).json({ user });
    } catch (error: any) {
        const status = error.status || 500;
        const message = error.message || "Internal server error";
        return res.status(status).json({ message });
    }
}

export async function createPosition(req: Request, res: Response) {
    try {
        const user = (req as any).user;
        const { title, departmentId, requiredSkills, minimumExperience, maximumExperience, description, status } = req.body;

        const position = await adminServices.createPosition({
            title,
            departmentId,
            requiredSkills,
            minimumExperience: Number(minimumExperience),
            maximumExperience: maximumExperience !== undefined && maximumExperience !== '' ? Number(maximumExperience) : undefined,
            description,
            status,
            createdBy: user.id
        });

        return res.status(201).json({ position });
    } catch (error: any) {
        const status = error.status || 500;
        const message = error.message || "Internal server error";
        return res.status(status).json({ message });
    }
}
