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
        const file = req.file as Express.Multer.File | undefined;

        const candidate = await candidateServices.createCandidate({
            firstname: req.body.firstname,
            lastname: req.body.lastname,
            email: req.body.email,
            phone: req.body.phone,
            experience: req.body.experience,
            currentCompany: req.body.currentCompany,
            currentPosition: req.body.currentPosition,
            skills: req.body.skills ? req.body.skills.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
            notes: req.body.notes,
            createdBy: user.id,
            resumeData: file?.buffer || null,
            resumeMimeType: file?.mimetype || null
        });

        return res.status(201).json({ candidate });
    } catch (error: any) {
        const status = error.status || 500;
        const message = error.message || "Internal server error";
        return res.status(status).json({ message });
    }
}

export async function downloadResume(req: Request, res: Response) {
    try {
        const id = req.params.id as string;

        const candidate = await candidateServices.getCandidateResume(id);

        if (!candidate) {
            return res.status(404).json({ message: "Candidate or resume not found" });
        }

        const ext = candidate.resumeMimeType === "application/pdf" ? "pdf"
            : candidate.resumeMimeType === "application/msword" ? "doc"
            : "docx";

        res.set({
            "Content-Type": candidate.resumeMimeType,
            "Content-Disposition": `attachment; filename="${candidate.firstname}_${candidate.lastname}_resume.${ext}"`
        });

        return res.send(candidate.resumeData);
    } catch (error: any) {
        const status = error.status || 500;
        const message = error.message || "Internal server error";
        return res.status(status).json({ message });
    }
}
