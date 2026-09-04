import prisma from "../lib/prisma";
import { evaluateResumeWithGemini, ParsedResumeEvaluation, determineTier } from "./gemini.service";
import * as candidateServices from "./candidate.service";

export interface ProcessedResumeResult {
    filename: string;
    mimetype: string;
    candidateInfo: {
        firstname: string;
        lastname: string;
        email: string;
        phone: string;
        experience?: string;
        currentCompany?: string;
        currentPosition?: string;
        skills: string[];
        notes?: string;
    };
    evaluation: {
        matchScore: number;
        summary: string;
        strengths: string[];
        gaps: string[];
        tier: "TIER_1_TOP" | "TIER_2_STRONG" | "TIER_3_GOOD" | "NEGLECTED";
        shortlisted: boolean;
    };
    candidateId?: string;
    candidateCode?: string;
    status: "CREATED" | "EXISTING" | "NEGLECTED" | "ERROR";
    errorMessage?: string;
}

export interface BatchMatchingResponse {
    position: {
        id: string;
        title: string;
        department?: string;
    };
    summary: {
        totalUploaded: number;
        totalShortlisted: number;
        totalNeglected: number;
        tier1Count: number; // >= 95%
        tier2Count: number; // 85% - 94%
        tier3Count: number; // 75% - 84%
    };
    results: ProcessedResumeResult[];
}

export async function processBatchResumes(params: {
    positionId: string;
    files: Express.Multer.File[];
    createdBy: string;
}): Promise<BatchMatchingResponse> {
    const { positionId, files, createdBy } = params;

    // 1. Fetch Job Position
    const position = await prisma.jobPositions.findUnique({
        where: { id: positionId },
        include: { department: true }
    });

    if (!position) {
        throw { status: 404, message: "Job position not found" };
    }

    const jobContext = {
        title: position.title,
        description: position.description,
        requiredSkills: position.requiredSkills,
        minimumExperience: position.minimumExperience,
        maximumExperience: position.maximumExperience
    };

    // 2. Process each resume sequentially (one at a time)
    const results: ProcessedResumeResult[] = [];

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        console.log(`[Resume Matcher] Processing resume ${i + 1}/${files.length}: ${file.originalname}`);

        try {
            const aiEvaluation: ParsedResumeEvaluation = await evaluateResumeWithGemini(
                file.buffer,
                file.mimetype,
                file.originalname,
                jobContext
            );

            const { candidateInfo, evaluation } = aiEvaluation;

            // If matchScore >= 75 (Shortlisted), create or link Candidate profile in DB
            if (evaluation.shortlisted) {
                const normalizedEmail = candidateInfo.email.trim().toLowerCase();

                // Check if candidate exists by email
                const existingCandidate = normalizedEmail
                    ? await prisma.candidate.findUnique({ where: { email: normalizedEmail } })
                    : null;

                if (existingCandidate) {
                    // Candidate already exists, return existing profile reference
                    results.push({
                        filename: file.originalname,
                        mimetype: file.mimetype,
                        candidateInfo,
                        evaluation,
                        candidateId: existingCandidate.id,
                        candidateCode: existingCandidate.candidateCode,
                        status: "EXISTING"
                    });
                    continue;
                }

                // Create new candidate
                try {
                    const createdCandidate = await candidateServices.createCandidate({
                        firstname: candidateInfo.firstname,
                        lastname: candidateInfo.lastname,
                        email: normalizedEmail || `candidate_${Date.now()}_${i}@placeholder.com`,
                        phone: candidateInfo.phone || "N/A",
                        experience: candidateInfo.experience,
                        currentCompany: candidateInfo.currentCompany,
                        currentPosition: candidateInfo.currentPosition,
                        skills: candidateInfo.skills,
                        notes: `[AI Match Score: ${evaluation.matchScore}% - Tier: ${evaluation.tier}]\n${evaluation.summary}\n${candidateInfo.notes || ""}`.trim(),
                        createdBy,
                        resumeData: file.buffer,
                        resumeMimeType: file.mimetype
                    });

                    results.push({
                        filename: file.originalname,
                        mimetype: file.mimetype,
                        candidateInfo,
                        evaluation,
                        candidateId: createdCandidate.id,
                        candidateCode: createdCandidate.candidateCode,
                        status: "CREATED"
                    });
                } catch (dbErr: any) {
                    console.error("Error creating candidate profile in DB:", dbErr);
                    results.push({
                        filename: file.originalname,
                        mimetype: file.mimetype,
                        candidateInfo,
                        evaluation,
                        status: "ERROR",
                        errorMessage: dbErr.message || "Failed to persist shortlisted candidate to database"
                    });
                }
            } else {
                // Neglected (matchScore < 75), do not save profile
                results.push({
                    filename: file.originalname,
                    mimetype: file.mimetype,
                    candidateInfo,
                    evaluation,
                    status: "NEGLECTED"
                });
            }
        } catch (error: any) {
            console.error(`Error processing resume ${file.originalname}:`, error);
            results.push({
                filename: file.originalname,
                mimetype: file.mimetype,
                candidateInfo: {
                    firstname: "Unknown",
                    lastname: "Unknown",
                    email: "",
                    phone: "",
                    skills: []
                },
                evaluation: {
                    matchScore: 0,
                    summary: "Failed to evaluate resume with AI.",
                    strengths: [],
                    gaps: ["Evaluation Error"],
                    tier: "NEGLECTED",
                    shortlisted: false
                },
                status: "ERROR",
                errorMessage: error.message || "AI Evaluation failed"
            });
        }
    }


    // 3. Sort results strictly by matchScore descending (highest ranked first)
    results.sort((a, b) => b.evaluation.matchScore - a.evaluation.matchScore);

    // 4. Calculate summary statistics
    const totalUploaded = results.length;
    const totalShortlisted = results.filter(r => r.evaluation.shortlisted).length;
    const totalNeglected = totalUploaded - totalShortlisted;
    const tier1Count = results.filter(r => r.evaluation.tier === "TIER_1_TOP").length;
    const tier2Count = results.filter(r => r.evaluation.tier === "TIER_2_STRONG").length;
    const tier3Count = results.filter(r => r.evaluation.tier === "TIER_3_GOOD").length;

    return {
        position: {
            id: position.id,
            title: position.title,
            department: position.department?.name
        },
        summary: {
            totalUploaded,
            totalShortlisted,
            totalNeglected,
            tier1Count,
            tier2Count,
            tier3Count
        },
        results
    };
}
