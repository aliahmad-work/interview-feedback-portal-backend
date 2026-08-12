import { Request, Response } from "express";
import * as feedbackService from "../service/feedback.service";

export async function submitFeedback(req: Request, res: Response) {
    try {
        const user = (req as any).user;
        const { interviewId, roundId, rating, recommendation, positiveComments, negativeComments, additionalComments } = req.body;

        if (!interviewId || !rating || !recommendation || !positiveComments || !negativeComments) {
            return res.status(400).json({ message: "Missing required fields: interviewId, rating, recommendation, positiveComments, negativeComments" });
        }

        const feedback = await feedbackService.submitFeedback({
            interviewId,
            roundId: roundId || undefined,
            interviewerId: user.id,
            rating: Number(rating),
            recommendation,
            positiveComments,
            negativeComments,
            additionalComments: additionalComments || ""
        });

        return res.status(201).json({ feedback });
    } catch (error: any) {
        const status = error.status || 500;
        const message = error.message || "Internal server error";
        return res.status(status).json({ message });
    }
}

export async function getFeedback(req: Request, res: Response) {
    try {
        const user = (req as any).user;
        const interviewId = req.params.interviewId as string;

        const feedback = await feedbackService.getFeedbackByInterview(interviewId, user.id, user.role);

        return res.json({ feedback });
    } catch (error: any) {
        const status = error.status || 500;
        const message = error.message || "Internal server error";
        return res.status(status).json({ message });
    }
}
