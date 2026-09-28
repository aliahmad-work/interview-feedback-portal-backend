import prisma from "../lib/prisma";
import {
    evaluateResumeWithGemini,
    evaluateResumeAcrossAllPositions,
    ParsedResumeEvaluation,
    MultiPositionMatchResult,
    determineTier
} from "./gemini.service";
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
    matchedPosition?: {
        id: string;
        title: string;
        department?: string;
    };
    otherMatches?: Array<{
        positionId: string;
        positionTitle: string;
        matchScore: number;
        tier: "TIER_1_TOP" | "TIER_2_STRONG" | "TIER_3_GOOD" | "NEGLECTED";
        shortlisted: boolean;
    }>;
    status: "CREATED" | "EXISTING" | "NEGLECTED" | "ERROR";
    errorMessage?: string;
}

export interface BatchMatchingResponse {
    mode?: "single" | "all_positions";
    position?: {
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
    positionId?: string | null;
    files: Express.Multer.File[];
    createdBy: string;
}): Promise<BatchMatchingResponse> {
    const { positionId, files, createdBy } = params;

    // Case 1: Matching against a specific single position
    if (positionId && positionId !== 'ALL') {
        const position = await prisma.jobPositions.findUnique({
            where: { id: positionId },
            include: { department: true }
        });

        if (!position) {
            throw { status: 404, message: "Job position not found" };
        }

        const jobContext = {
            id: position.id,
            title: position.title,
            description: position.description,
            requiredSkills: position.requiredSkills,
            minimumExperience: position.minimumExperience,
            maximumExperience: position.maximumExperience,
            department: position.department?.name
        };

        const results: ProcessedResumeResult[] = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            console.log(`[Resume Matcher - Single] Processing resume ${i + 1}/${files.length}: ${file.originalname}`);

            try {
                const aiEvaluation: ParsedResumeEvaluation = await evaluateResumeWithGemini(
                    file.buffer,
                    file.mimetype,
                    file.originalname,
                    jobContext
                );

                const { candidateInfo, evaluation } = aiEvaluation;
                const normalizedEmail = candidateInfo.email ? candidateInfo.email.trim().toLowerCase() : "";
                const candidateStatus = evaluation.shortlisted ? "shortlisted" : "neglected";

                const existingCandidate = normalizedEmail
                    ? await prisma.candidate.findUnique({ where: { email: normalizedEmail } })
                    : null;

                if (existingCandidate) {
                    await prisma.candidate.update({
                        where: { id: existingCandidate.id },
                        data: {
                            status: candidateStatus,
                            aiMatchScore: evaluation.matchScore,
                            aiTier: evaluation.tier,
                            aiSummary: evaluation.summary,
                            aiStrengths: evaluation.strengths,
                            aiGaps: evaluation.gaps,
                            aiTargetPositionId: positionId,
                            notes: `[AI Match Score: ${evaluation.matchScore}% - Tier: ${evaluation.tier} - Status: ${candidateStatus.toUpperCase()}]\n${evaluation.summary}\n${candidateInfo.notes || ""}`.trim()
                        }
                    });

                    results.push({
                        filename: file.originalname,
                        mimetype: file.mimetype,
                        candidateInfo,
                        evaluation,
                        candidateId: existingCandidate.id,
                        candidateCode: existingCandidate.candidateCode,
                        matchedPosition: {
                            id: position.id,
                            title: position.title,
                            department: position.department?.name
                        },
                        status: "EXISTING"
                    });
                    continue;
                }

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
                        status: candidateStatus,
                        aiMatchScore: evaluation.matchScore,
                        aiTier: evaluation.tier,
                        aiSummary: evaluation.summary,
                        aiStrengths: evaluation.strengths,
                        aiGaps: evaluation.gaps,
                        aiTargetPositionId: positionId,
                        notes: `[AI Match Score: ${evaluation.matchScore}% - Tier: ${evaluation.tier} - Status: ${candidateStatus.toUpperCase()}]\n${evaluation.summary}\n${candidateInfo.notes || ""}`.trim(),
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
                        matchedPosition: {
                            id: position.id,
                            title: position.title,
                            department: position.department?.name
                        },
                        status: "CREATED"
                    });
                } catch (dbErr: any) {
                    console.error("Error creating candidate profile in DB:", dbErr);
                    results.push({
                        filename: file.originalname,
                        mimetype: file.mimetype,
                        candidateInfo,
                        evaluation,
                        matchedPosition: {
                            id: position.id,
                            title: position.title,
                            department: position.department?.name
                        },
                        status: "ERROR",
                        errorMessage: dbErr.message || "Failed to persist candidate to database"
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

        results.sort((a, b) => b.evaluation.matchScore - a.evaluation.matchScore);

        const totalUploaded = results.length;
        const totalShortlisted = results.filter(r => r.evaluation.shortlisted).length;
        const totalNeglected = totalUploaded - totalShortlisted;
        const tier1Count = results.filter(r => r.evaluation.tier === "TIER_1_TOP").length;
        const tier2Count = results.filter(r => r.evaluation.tier === "TIER_2_STRONG").length;
        const tier3Count = results.filter(r => r.evaluation.tier === "TIER_3_GOOD").length;

        return {
            mode: "single",
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

    // Case 2: Matching against ALL open positions
    // Fetch all open job positions
    const openPositions = await prisma.jobPositions.findMany({
        where: { status: "open" },
        include: { department: true },
        orderBy: { createdAt: "desc" }
    });

    if (openPositions.length === 0) {
        throw { status: 400, message: "No open job positions available. Please create an open job position first." };
    }

    const positionsContextList = openPositions.map(pos => ({
        id: pos.id,
        title: pos.title,
        description: pos.description,
        requiredSkills: pos.requiredSkills,
        minimumExperience: pos.minimumExperience,
        maximumExperience: pos.maximumExperience,
        department: pos.department?.name
    }));

    const results: ProcessedResumeResult[] = [];

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        console.log(`[Resume Matcher - All Positions] Processing resume ${i + 1}/${files.length}: ${file.originalname}`);

        try {
            const multiMatch: MultiPositionMatchResult = await evaluateResumeAcrossAllPositions(
                file.buffer,
                file.mimetype,
                file.originalname,
                positionsContextList
            );

            const { candidateInfo, bestMatch, allMatches } = multiMatch;
            const targetPos = bestMatch
                ? openPositions.find(p => p.id === bestMatch.positionId) || openPositions[0]
                : openPositions[0];

            const evaluation = bestMatch?.evaluation || {
                matchScore: 0,
                summary: "No suitable open position found.",
                strengths: [],
                gaps: ["No matching positions"],
                tier: "NEGLECTED" as const,
                shortlisted: false
            };

            const normalizedEmail = candidateInfo.email ? candidateInfo.email.trim().toLowerCase() : "";
            const candidateStatus = evaluation.shortlisted ? "shortlisted" : "neglected";

            const existingCandidate = normalizedEmail
                ? await prisma.candidate.findUnique({ where: { email: normalizedEmail } })
                : null;

            const otherMatches = allMatches
                .filter(m => m.positionId !== targetPos.id)
                .map(m => ({
                    positionId: m.positionId,
                    positionTitle: m.positionTitle,
                    matchScore: m.matchScore,
                    tier: m.tier,
                    shortlisted: m.shortlisted
                }));

            if (existingCandidate) {
                await prisma.candidate.update({
                    where: { id: existingCandidate.id },
                    data: {
                        status: candidateStatus,
                        aiMatchScore: evaluation.matchScore,
                        aiTier: evaluation.tier,
                        aiSummary: evaluation.summary,
                        aiStrengths: evaluation.strengths,
                        aiGaps: evaluation.gaps,
                        aiTargetPositionId: targetPos.id,
                        notes: `[AI Best Match: ${targetPos.title} (${evaluation.matchScore}%) - Tier: ${evaluation.tier} - Status: ${candidateStatus.toUpperCase()}]\n${evaluation.summary}\n${candidateInfo.notes || ""}`.trim()
                    }
                });

                results.push({
                    filename: file.originalname,
                    mimetype: file.mimetype,
                    candidateInfo,
                    evaluation,
                    candidateId: existingCandidate.id,
                    candidateCode: existingCandidate.candidateCode,
                    matchedPosition: {
                        id: targetPos.id,
                        title: targetPos.title,
                        department: targetPos.department?.name
                    },
                    otherMatches,
                    status: "EXISTING"
                });
                continue;
            }

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
                    status: candidateStatus,
                    aiMatchScore: evaluation.matchScore,
                    aiTier: evaluation.tier,
                    aiSummary: evaluation.summary,
                    aiStrengths: evaluation.strengths,
                    aiGaps: evaluation.gaps,
                    aiTargetPositionId: targetPos.id,
                    notes: `[AI Best Match: ${targetPos.title} (${evaluation.matchScore}%) - Tier: ${evaluation.tier} - Status: ${candidateStatus.toUpperCase()}]\n${evaluation.summary}\n${candidateInfo.notes || ""}`.trim(),
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
                    matchedPosition: {
                        id: targetPos.id,
                        title: targetPos.title,
                        department: targetPos.department?.name
                    },
                    otherMatches,
                    status: "CREATED"
                });
            } catch (dbErr: any) {
                console.error("Error creating candidate profile in DB:", dbErr);
                results.push({
                    filename: file.originalname,
                    mimetype: file.mimetype,
                    candidateInfo,
                    evaluation,
                    matchedPosition: {
                        id: targetPos.id,
                        title: targetPos.title,
                        department: targetPos.department?.name
                    },
                    otherMatches,
                    status: "ERROR",
                    errorMessage: dbErr.message || "Failed to persist candidate to database"
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

    // Sort results by matchScore descending
    results.sort((a, b) => b.evaluation.matchScore - a.evaluation.matchScore);

    const totalUploaded = results.length;
    const totalShortlisted = results.filter(r => r.evaluation.shortlisted).length;
    const totalNeglected = totalUploaded - totalShortlisted;
    const tier1Count = results.filter(r => r.evaluation.tier === "TIER_1_TOP").length;
    const tier2Count = results.filter(r => r.evaluation.tier === "TIER_2_STRONG").length;
    const tier3Count = results.filter(r => r.evaluation.tier === "TIER_3_GOOD").length;

    return {
        mode: "all_positions",
        position: {
            id: "all",
            title: `All Open Positions (${openPositions.length})`,
            department: "Company-wide"
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
