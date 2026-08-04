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
