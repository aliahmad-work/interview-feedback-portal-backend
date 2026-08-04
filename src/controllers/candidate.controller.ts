import { Request, Response } from "express";
import * as candidateServices from "../service/candidate.service";

export async function getCandidates(req: Request, res: Response) {
    const search = (req.query.search as string) || undefined;

    const candidates = await candidateServices.getCandidates(search);

    return res.json({
        candidates,
        count: candidates.length
    });
}

export async function createCandidate(req: Request, res: Response) {
    try {
        const user = (req as any).user;

        const candidate = await candidateServices.createCandidate({
            firstname: req.body.firstname,
            lastname: req.body.lastname,
            email: req.body.email,
            phone: req.body.phone,
            experience: req.body.experience,
            currentCompany: req.body.currentCompany,
            currentPosition: req.body.currentPosition,
            skills: req.body.skills,
            notes: req.body.notes,
            createdBy: user.id
        });

        return res.status(201).json({ candidate });
    } catch (error: any) {
        const status = error.status || 500;
        const message = error.message || "Internal server error";
        return res.status(status).json({ message });
    }
}
