import { Request, Response } from "express";
import * as interviewServices from "../service/interview.service";

export async function createInterview(req: Request, res: Response) {
    try {
        const user = (req as any).user;
        const { candidateId, positionId, interviewerIds, date, startTime, endTime, round, type, status } = req.body;

        const interview = await interviewServices.createInterview({
            candidateId,
            positionId,
            interviewerIds,
            date,
            startTime: new Date(startTime),
            endTime: new Date(endTime),
            round: round ? Number(round) : undefined,
            type,
            status,
            createdBy: user.id
        });

        return res.status(201).json({ interview });
    } catch (error: any) {
        const status = error.status || 500;
        const message = error.message || "Internal server error";
        return res.status(status).json({ message });
    }
}

export async function getAllInterviews(req: Request, res: Response) {
    const interviews = await interviewServices.getAllInterviews();

    return res.json({
        interviews,
        count: interviews.length
    });
}

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

export async function updateDecision(req: Request, res: Response) {
    try {
        const user = (req as any).user;
        const { id } = req.params;
        const { decision } = req.body;

        const updated = await interviewServices.updateInterviewDecision(id as string, decision, user.id);

        return res.json({ interview: updated });
    } catch (error: any) {
        const status = error.status || 500;
        const message = error.message || "Internal server error";
        return res.status(status).json({ message });
    }
}
