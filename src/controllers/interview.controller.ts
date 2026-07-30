import { Request, Response } from "express";
import * as interviewServices from "../service/interview.service";

export async function getInterviewerInterviews(req: Request, res: Response) {
    const user = (req as any).user;
    
    const interviews = await interviewServices.getInterviewerInterviews(user.id);

    return res.json({
        interviews,
        count: interviews.length
    });
}

export async function getInterviewById(req: Request, res: Response) {
    const user = (req as any).user;
    const { id } = req.params;

    const interview = await interviewServices.getInterviewById(id as string, user.id);

    if (!interview) {
        return res.status(404).json({ message: "Interview not found or you are not assigned to this interview" });
    }

    return res.json({
        interview
    });
}

export async function getCandidateDetails(req: Request, res: Response) {
    const { id } = req.params;

    const candidate = await interviewServices.getCandidateDetails(id as string);

    if (!candidate) {
        return res.status(404).json({ message: "Candidate not found" });
    }

    return res.json({
        candidate
    });
}
