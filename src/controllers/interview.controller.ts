import { Request, Response } from "express";
import * as interviewServices from "../service/interview.service";
import * as interviewRoundServices from "../service/interview-round.service";

export async function createInterview(req: Request, res: Response) {
    try {
        const user = (req as any).user;
        const { candidateId, positionId, interviewerIds, date, startTime, endTime, round, type, status, rounds } = req.body;

        const interviewData: any = {
            candidateId,
            positionId,
            createdBy: user.id
        };

        if (rounds && rounds.length > 0) {
            interviewData.rounds = rounds.map((r: any) => ({
                interviewerIds: r.interviewerIds,
                type: r.type,
                duration: Number(r.duration),
                date: r.date || undefined,
                startTime: r.startTime ? new Date(r.startTime) : undefined,
                endTime: r.endTime ? new Date(r.endTime) : undefined
            }));
        } else {
            interviewData.interviewerIds = interviewerIds;
            interviewData.date = date;
            interviewData.startTime = startTime ? new Date(startTime) : undefined;
            interviewData.endTime = endTime ? new Date(endTime) : undefined;
            interviewData.round = round ? Number(round) : undefined;
            interviewData.type = type;
            interviewData.status = status;
        }

        const interview = await interviewServices.createInterview(interviewData);

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

export async function getInterviewRounds(req: Request, res: Response) {
    try {
        const { id } = req.params;

        const rounds = await interviewRoundServices.getRoundsByInterview(id as string);

        return res.json({ rounds });
    } catch (error: any) {
        const status = error.status || 500;
        const message = error.message || "Internal server error";
        return res.status(status).json({ message });
    }
}

export async function addInterviewRounds(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const { rounds } = req.body;

        if (!rounds || !Array.isArray(rounds) || rounds.length === 0) {
            return res.status(400).json({ message: "At least one round is required" });
        }

        const createdRounds = await interviewRoundServices.createInterviewRounds(id as string, rounds);

        return res.status(201).json({ rounds: createdRounds });
    } catch (error: any) {
        const status = error.status || 500;
        const message = error.message || "Internal server error";
        return res.status(status).json({ message });
    }
}

export async function updateRoundSchedule(req: Request, res: Response) {
    try {
        const { id, roundId } = req.params;
        const { date, startTime, endTime } = req.body;

        if (!date || !startTime || !endTime) {
            return res.status(400).json({ message: "date, startTime, and endTime are required" });
        }

        const updated = await interviewRoundServices.updateRoundSchedule(
            id as string,
            roundId as string,
            date,
            new Date(startTime),
            new Date(endTime)
        );

        return res.json({ round: updated });
    } catch (error: any) {
        const status = error.status || 500;
        const message = error.message || "Internal server error";
        return res.status(status).json({ message });
    }
}

export async function cancelRound(req: Request, res: Response) {
    try {
        const { id, roundId } = req.params;

        const updated = await interviewRoundServices.cancelRound(id as string, roundId as string);

        return res.json({ round: updated });
    } catch (error: any) {
        const status = error.status || 500;
        const message = error.message || "Internal server error";
        return res.status(status).json({ message });
    }
}

export async function updateRoundDecision(req: Request, res: Response) {
    try {
        const user = (req as any).user;
        const { id, roundId } = req.params;
        const { decision } = req.body;

        const updated = await interviewRoundServices.updateRoundDecision(
            id as string,
            roundId as string,
            decision,
            user.id
        );

        return res.json({ round: updated });
    } catch (error: any) {
        const status = error.status || 500;
        const message = error.message || "Internal server error";
        return res.status(status).json({ message });
    }
}
