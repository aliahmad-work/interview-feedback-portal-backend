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
