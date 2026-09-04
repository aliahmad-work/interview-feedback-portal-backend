import prisma from "../lib/prisma";
import { CreateRoundData, createInterviewRounds, getCurrentRound, updateRoundDecision, resumeInterview, VALID_DECISIONS, isRoundVisibleToInterviewers } from "./interview-round.service";
import { calendlyService } from "./calendly.service";
import { emailService } from "./email.service";

export { VALID_DECISIONS };

const isValidObjectId = (id: string) => /^[a-f\d]{24}$/i.test(id);

async function sendSchedulingEmailToInterviewer(interviewId: string) {
    try {
        const interview = await prisma.interview.findUnique({
            where: { id: interviewId },
            include: {
                candidate: true,
                position: true,
                interviewers: true,
                rounds: { orderBy: { roundNumber: "asc" } },
            },
        });
        if (!interview) return;

        const pendingRound = interview.rounds.find(
            (r) => r.status === "pending" || r.status === "pending_schedule" || (!r.date && !r.startTime)
        );
        if (!pendingRound) return;

        const schedulingUrl = await calendlyService.getSchedulingUrl();

        await emailService.sendScheduleToCandidate({
            candidateEmail: interview.candidate.email,
            candidateName: `${interview.candidate.firstname} ${interview.candidate.lastname}`,
            positionName: interview.position.title,
            roundNumber: pendingRound.roundNumber,
            schedulingUrl,
        });
    } catch (error) {
        console.error("[Email] Failed to send scheduling email:", error);
    }
}

export async function createInterview(data: {
    candidateId: string;
    positionId: string;
    createdBy: string;
    interviewerIds?: string[];
    date?: string;
    startTime?: Date;
    endTime?: Date;
    round?: number;
    type?: string;
    status?: string;
    rounds?: CreateRoundData[];
    schedulingMode?: boolean;
    duration?: number;
}) {
    if (!isValidObjectId(data.candidateId)) {
        throw { status: 400, message: "Invalid candidate id" };
    }
    if (!isValidObjectId(data.positionId)) {
        throw { status: 400, message: "Invalid position id" };
    }

    const candidate = await prisma.candidate.findUnique({ where: { id: data.candidateId } });
    if (!candidate) {
        throw { status: 404, message: "Candidate not found" };
    }

    const position = await prisma.jobPositions.findUnique({ where: { id: data.positionId } });
    if (!position) {
        throw { status: 404, message: "Job position not found" };
    }

    // Scheduling mode: no date/time required, candidate will pick via Calendly
    if (data.schedulingMode) {
        const rounds = data.rounds && data.rounds.length > 0
            ? data.rounds
            : [{ interviewerIds: data.interviewerIds || [], type: data.type, duration: data.duration || 60 }];

        // Validate all rounds have interviewers
        for (let i = 0; i < rounds.length; i++) {
            const r = rounds[i];
            if (!r.interviewerIds || r.interviewerIds.length === 0) {
                throw { status: 400, message: `Round ${i + 1}: At least one interviewer is required` };
            }
            for (const id of r.interviewerIds) {
                if (!isValidObjectId(id)) {
                    throw { status: 400, message: `Round ${i + 1}: Invalid interviewer id` };
                }
            }
        }

        // Validate all interviewer ids are valid users
        const allInterviewerIds = [...new Set(rounds.flatMap(r => r.interviewerIds))];
        const interviewers = await prisma.user.findMany({
            where: {
                id: { in: allInterviewerIds },
                role: { name: "interviewer" }
            },
            select: { id: true }
        });
        if (interviewers.length !== allInterviewerIds.length) {
            throw { status: 400, message: "One or more assigned users are not valid interviewers" };
        }

        const existingCount = await prisma.interview.count({
            where: { candidateId: data.candidateId }
        });

        const schedulingUrl = await calendlyService.getSchedulingUrl();

        const interview = await prisma.interview.create({
            data: {
                round: existingCount + 1,
                type: data.type || rounds[0]?.type || null,
                date: null,
                startTime: null,
                endTime: null,
                status: "pending_schedule",
                candidateId: data.candidateId,
                positionId: data.positionId,
                createdBy: data.createdBy,
                interviewerIds: allInterviewerIds,
                calendlySchedulingUrl: schedulingUrl,
            },
            include: {
                candidate: true,
                position: true,
                creator: true,
                interviewers: true,
                rounds: true,
            },
        });

        // Create all rounds in pending_schedule status
        const createdRounds = await prisma.$transaction(async (tx) => {
            const results = [];
            for (let i = 0; i < rounds.length; i++) {
                const r = rounds[i];
                const duration = r.duration || 60;
                const created = await tx.interviewRound.create({
                    data: {
                        interviewId: interview.id,
                        roundNumber: i + 1,
                        type: r.type || data.type || null,
                        duration,
                        date: null,
                        startTime: null,
                        endTime: null,
                        status: "pending_schedule",
                        decision: "pending",
                        interviewerIds: r.interviewerIds,
                    },
                    include: {
                        interviewers: {
                            select: {
                                id: true,
                                firstname: true,
                                lastname: true,
                                email: true,
                                designation: true,
                            },
                        },
                    },
                });
                results.push(created);
            }
            return results;
        });

        // Send scheduling email to candidate with CV attached
        try {
            await emailService.sendScheduleToCandidate({
                candidateEmail: candidate.email,
                candidateName: `${candidate.firstname} ${candidate.lastname}`,
                positionName: position.title,
                roundNumber: 1,
                schedulingUrl,
                resume: {
                    candidateFirstname: candidate.firstname,
                    candidateLastname: candidate.lastname,
                    resumeData: candidate.resumeData,
                    resumeMimeType: candidate.resumeMimeType,
                },
            });
        } catch (emailError: any) {
            console.error("[Email] FAILED to send scheduling email to candidate:", candidate.email);
            console.error("[Email] Error:", emailError.message || emailError);
        }

        return {
            ...interview,
            rounds: createdRounds,
        };
    }

    const hasRounds = data.rounds && data.rounds.length > 0;
    const hasDirectInterview = data.interviewerIds && data.interviewerIds.length > 0 && data.date && data.startTime && data.endTime;

    if (!hasRounds && !hasDirectInterview) {
        throw { status: 400, message: "Either 'rounds' array or 'interviewerIds' with 'date', 'startTime', 'endTime' is required" };
    }

    if (hasRounds && hasDirectInterview) {
        throw { status: 400, message: "Cannot provide both 'rounds' and direct interview fields. Use one or the other." };
    }

    const existingCount = await prisma.interview.count({
        where: { candidateId: data.candidateId }
    });

    if (hasDirectInterview) {
        return createDirectInterview({
            candidateId: data.candidateId,
            positionId: data.positionId,
            interviewerIds: data.interviewerIds!,
            date: data.date!,
            startTime: data.startTime!,
            endTime: data.endTime!,
            round: data.round,
            type: data.type,
            status: data.status,
            createdBy: data.createdBy
        }, existingCount);
    }

    return createInterviewWithRounds({
        candidateId: data.candidateId,
        positionId: data.positionId,
        rounds: data.rounds!,
        type: data.type,
        createdBy: data.createdBy
    }, existingCount);
}

async function createDirectInterview(data: {
    candidateId: string;
    positionId: string;
    interviewerIds: string[];
    date: string;
    startTime: Date;
    endTime: Date;
    round?: number;
    type?: string;
    status?: string;
    createdBy: string;
}, existingCount: number) {
    if (!data.interviewerIds!.length) {
        throw { status: 400, message: "At least one interviewer is required" };
    }
    for (const id of data.interviewerIds!) {
        if (!isValidObjectId(id)) {
            throw { status: 400, message: "Invalid interviewer id" };
        }
    }

    if (data.startTime >= data.endTime) {
        throw { status: 400, message: "End time must be after start time" };
    }

    const interviewers = await prisma.user.findMany({
        where: {
            id: { in: data.interviewerIds! },
            role: { name: "interviewer" }
        },
        select: { id: true }
    });

    if (interviewers.length !== data.interviewerIds!.length) {
        throw { status: 400, message: "One or more assigned users are not valid interviewers" };
    }

    for (const interviewerId of data.interviewerIds!) {
        const conflict = await prisma.interview.findFirst({
            where: {
                interviewerIds: { has: interviewerId },
                status: { not: "pending_schedule" },
                startTime: { not: null, lt: data.endTime! },
                endTime: { not: null, gt: data.startTime! }
            },
            select: { id: true, startTime: true, endTime: true }
        });

        if (conflict) {
            throw {
                status: 409,
                message: `Interviewer has a conflicting interview (${conflict.startTime!.toISOString()} - ${conflict.endTime!.toISOString()})`
            };
        }

        const roundConflict = await prisma.interviewRound.findFirst({
            where: {
                interviewerIds: { has: interviewerId },
                date: data.date,
                startTime: { lt: data.endTime! },
                endTime: { gt: data.startTime! },
                status: { in: ["scheduled", "in-progress"] }
            },
            select: { id: true, startTime: true, endTime: true }
        });

        if (roundConflict) {
            throw {
                status: 409,
                message: `Interviewer has a conflicting round (${roundConflict.startTime?.toISOString()} - ${roundConflict.endTime?.toISOString()})`
            };
        }
    }

    const interview = await prisma.interview.create({
        data: {
            round: data.round || existingCount + 1,
            type: data.type || null,
            date: data.date,
            startTime: data.startTime,
            endTime: data.endTime,
            status: data.status || "scheduled",
            candidateId: data.candidateId,
            positionId: data.positionId,
            createdBy: data.createdBy,
            interviewerIds: data.interviewerIds!
        },
        include: {
            candidate: {
                select: {
                    id: true,
                    candidateCode: true,
                    firstname: true,
                    lastname: true,
                    email: true,
                    phone: true,
                    experience: true,
                    currentCompany: true,
                    currentPosition: true,
                    skills: true
                }
            },
            position: {
                select: {
                    id: true,
                    title: true,
                    requiredSkills: true,
                    minimumExperience: true,
                    maximumExperience: true,
                    description: true,
                    status: true
                }
            },
            creator: {
                select: {
                    id: true,
                    firstname: true,
                    lastname: true,
                    email: true
                }
            },
            interviewers: {
                select: {
                    id: true,
                    firstname: true,
                    lastname: true,
                    email: true,
                    designation: true
                }
            },
            rounds: {
                include: {
                    interviewers: {
                        select: {
                            id: true,
                            firstname: true,
                            lastname: true,
                            email: true,
                            designation: true
                        }
                    }
                }
            }
        }
    });

    return interview;
}

async function createInterviewWithRounds(data: {
    candidateId: string;
    positionId: string;
    rounds: CreateRoundData[];
    type?: string;
    createdBy: string;
}, existingCount: number) {
    const interview = await prisma.interview.create({
        data: {
            round: existingCount + 1,
            type: data.rounds[0]?.type || data.type || null,
            date: data.rounds[0]?.date || "",
            startTime: data.rounds[0]?.startTime || new Date(),
            endTime: data.rounds[0]?.endTime || new Date(),
            status: "scheduled",
            candidateId: data.candidateId,
            positionId: data.positionId,
            createdBy: data.createdBy,
            interviewerIds: data.rounds[0]?.interviewerIds || []
        },
        include: {
            candidate: {
                select: {
                    id: true,
                    candidateCode: true,
                    firstname: true,
                    lastname: true,
                    email: true,
                    phone: true,
                    experience: true,
                    currentCompany: true,
                    currentPosition: true,
                    skills: true
                }
            },
            position: {
                select: {
                    id: true,
                    title: true,
                    requiredSkills: true,
                    minimumExperience: true,
                    maximumExperience: true,
                    description: true,
                    status: true
                }
            },
            creator: {
                select: {
                    id: true,
                    firstname: true,
                    lastname: true,
                    email: true
                }
            }
        }
    });

    const createdRounds = await createInterviewRounds(interview.id, data.rounds);

    const allInterviewerIds = [...new Set(data.rounds.flatMap(r => r.interviewerIds))];
    if (allInterviewerIds.length > 0) {
        await prisma.interview.update({
            where: { id: interview.id },
            data: { interviewerIds: allInterviewerIds }
        });
    }

    return {
        ...interview,
        interviewerIds: allInterviewerIds,
        rounds: createdRounds
    };
}

const feedbackSelect = {
    id: true,
    interviewId: true,
    roundId: true,
    candidateId: true,
    interviewerId: true,
    interviewer: {
        select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
            designation: true
        }
    },
    rating: true,
    recommendation: true,
    positiveComments: true,
    negativeComments: true,
    additionalComments: true,
    submittedAt: true
} as const;

export async function getAllInterviews() {
    const interviews = await prisma.interview.findMany({
        include: {
            candidate: {
                select: {
                    id: true,
                    candidateCode: true,
                    firstname: true,
                    lastname: true,
                    email: true,
                    phone: true,
                    experience: true,
                    currentCompany: true,
                    currentPosition: true,
                    skills: true
                }
            },
            position: {
                select: {
                    id: true,
                    title: true,
                    requiredSkills: true,
                    minimumExperience: true,
                    maximumExperience: true,
                    description: true,
                    status: true
                }
            },
            creator: {
                select: {
                    id: true,
                    firstname: true,
                    lastname: true,
                    email: true
                }
            },
            interviewers: {
                select: {
                    id: true,
                    firstname: true,
                    lastname: true,
                    email: true,
                    designation: true
                }
            },
            rounds: {
                include: {
                    interviewers: {
                        select: {
                            id: true,
                            firstname: true,
                            lastname: true,
                            email: true,
                            designation: true
                        }
                    }
                },
                orderBy: { roundNumber: "asc" as const }
            },
            interviewFeedbacks: {
                select: feedbackSelect,
                orderBy: {
                    submittedAt: 'asc' as const
                }
            }
        },
        orderBy: {
            createdAt: 'desc' as const
        }
    });

    return interviews;
}

export async function updateInterviewDecision(interviewId: string, decision: string, adminId: string) {
    if (!isValidObjectId(interviewId)) {
        throw { status: 400, message: "Invalid interview id" };
    }
    if (!VALID_DECISIONS.includes(decision)) {
        throw { status: 400, message: `Decision must be one of: ${VALID_DECISIONS.join(", ")}` };
    }

    const interview = await prisma.interview.findUnique({
        where: { id: interviewId },
        include: {
            candidate: true,
            position: true,
            interviewers: true,
            rounds: {
                orderBy: { roundNumber: "asc" }
            }
        }
    });
    if (!interview) {
        throw { status: 404, message: "Interview not found" };
    }

    const hasRounds = interview.rounds.length > 0;

    if (hasRounds) {
        const currentRound = await getCurrentRound(interviewId);
        if (!currentRound) {
            throw { status: 400, message: "No active round found for this interview" };
        }

        await updateRoundDecision(interviewId, currentRound.id, decision, adminId);

        // Handle next_round: create next round and trigger Calendly scheduling
        if (decision === "next_round") {
            const nextRoundNumber = currentRound.roundNumber + 1;
            const existingNextRound = interview.rounds.find(
                (r) => r.roundNumber === nextRoundNumber
            );

            if (!existingNextRound) {
                // Create the next round reusing current round's config
                const schedulingUrl = await calendlyService.getSchedulingUrl();

                const newRound = await prisma.interviewRound.create({
                    data: {
                        interviewId,
                        roundNumber: nextRoundNumber,
                        type: currentRound.type,
                        duration: currentRound.duration,
                        date: null,
                        startTime: null,
                        endTime: null,
                        status: "pending_schedule",
                        decision: "pending",
                        interviewerIds: currentRound.interviewerIds,
                    },
                });

                // Update interview status
                await prisma.interview.update({
                    where: { id: interviewId },
                    data: {
                        status: "pending_schedule",
                        calendlySchedulingUrl: schedulingUrl,
                    },
                });

                // Send scheduling email to candidate
                try {
                    await emailService.sendScheduleToCandidate({
                        candidateEmail: interview.candidate.email,
                        candidateName: `${interview.candidate.firstname} ${interview.candidate.lastname}`,
                        positionName: interview.position.title,
                        roundNumber: nextRoundNumber,
                        schedulingUrl,
                        resume: {
                            candidateFirstname: interview.candidate.firstname,
                            candidateLastname: interview.candidate.lastname,
                            resumeData: interview.candidate.resumeData,
                            resumeMimeType: interview.candidate.resumeMimeType,
                        },
                    });
                } catch (emailError: any) {
                    console.error("[Email] FAILED to send scheduling email for next round:", emailError.message || emailError);
                }
            } else {
                // Next round exists but has no date/time - trigger scheduling
                if (!existingNextRound.date || !existingNextRound.startTime) {
                    const schedulingUrl = await calendlyService.getSchedulingUrl();

                    await prisma.interviewRound.update({
                        where: { id: existingNextRound.id },
                        data: { status: "pending_schedule" },
                    });

                    await prisma.interview.update({
                        where: { id: interviewId },
                        data: {
                            status: "pending_schedule",
                            calendlySchedulingUrl: schedulingUrl,
                        },
                    });

                    try {
                        await emailService.sendScheduleToCandidate({
                            candidateEmail: interview.candidate.email,
                            candidateName: `${interview.candidate.firstname} ${interview.candidate.lastname}`,
                            positionName: interview.position.title,
                            roundNumber: existingNextRound.roundNumber,
                            schedulingUrl,
                            resume: {
                                candidateFirstname: interview.candidate.firstname,
                                candidateLastname: interview.candidate.lastname,
                                resumeData: interview.candidate.resumeData,
                                resumeMimeType: interview.candidate.resumeMimeType,
                            },
                        });
                    } catch (emailError: any) {
                        console.error("[Email] FAILED to send scheduling email:", emailError.message || emailError);
                    }
                }
            }
        }

        return prisma.interview.findUnique({
            where: { id: interviewId },
            include: {
                candidate: {
                    select: {
                        id: true,
                        candidateCode: true,
                        firstname: true,
                        lastname: true,
                        email: true,
                        phone: true,
                        experience: true,
                        currentCompany: true,
                        currentPosition: true,
                        skills: true
                    }
                },
                position: {
                    select: {
                        id: true,
                        title: true,
                        requiredSkills: true,
                        minimumExperience: true,
                        maximumExperience: true,
                        description: true,
                        status: true
                    }
                },
                creator: {
                    select: {
                        id: true,
                        firstname: true,
                        lastname: true,
                        email: true
                    }
                },
                interviewers: {
                    select: {
                        id: true,
                        firstname: true,
                        lastname: true,
                        email: true,
                        designation: true
                    }
                },
                rounds: {
                    include: {
                        interviewers: {
                            select: {
                                id: true,
                                firstname: true,
                                lastname: true,
                                email: true,
                                designation: true
                            }
                        }
                    },
                    orderBy: { roundNumber: "asc" }
                },
                interviewFeedbacks: {
                    select: feedbackSelect,
                    orderBy: {
                        submittedAt: 'asc' as const
                    }
                }
            }
        });
    }

    return prisma.interview.update({
        where: { id: interviewId },
        data: {
            decision,
            decisionUpdatedAt: new Date(),
            decisionUpdatedBy: adminId
        },
        include: {
            candidate: {
                select: {
                    id: true,
                    candidateCode: true,
                    firstname: true,
                    lastname: true,
                    email: true,
                    phone: true,
                    experience: true,
                    currentCompany: true,
                    currentPosition: true,
                    skills: true
                }
            },
            position: {
                select: {
                    id: true,
                    title: true,
                    requiredSkills: true,
                    minimumExperience: true,
                    maximumExperience: true,
                    description: true,
                    status: true
                }
            },
            creator: {
                select: {
                    id: true,
                    firstname: true,
                    lastname: true,
                    email: true
                }
            },
            interviewers: {
                select: {
                    id: true,
                    firstname: true,
                    lastname: true,
                    email: true,
                    designation: true
                }
            },
            rounds: {
                include: {
                    interviewers: {
                        select: {
                            id: true,
                            firstname: true,
                            lastname: true,
                            email: true,
                            designation: true
                        }
                    }
                },
                orderBy: { roundNumber: "asc" }
            },
            interviewFeedbacks: {
                select: feedbackSelect,
                orderBy: {
                    submittedAt: 'asc' as const
                }
            }
        }
    });
}

export async function getInterviewerInterviews(interviewerId: string) {
    const interviews = await prisma.interview.findMany({
        where: {
            OR: [
                { interviewerIds: { has: interviewerId } },
                {
                    rounds: {
                        some: {
                            interviewerIds: { has: interviewerId },
                            status: { in: ["pending", "pending_schedule", "scheduled", "in-progress", "completed"] }
                        }
                    }
                }
            ]
        },
        include: {
            candidate: {
                select: {
                    id: true,
                    candidateCode: true,
                    firstname: true,
                    lastname: true,
                    email: true,
                    phone: true,
                    experience: true,
                    currentCompany: true,
                    currentPosition: true,
                    skills: true
                }
            },
            position: {
                select: {
                    id: true,
                    title: true,
                    requiredSkills: true,
                    minimumExperience: true,
                    maximumExperience: true,
                    description: true,
                    status: true
                }
            },
            creator: {
                select: {
                    id: true,
                    firstname: true,
                    lastname: true,
                    email: true
                }
            },
            interviewers: {
                select: {
                    id: true,
                    firstname: true,
                    lastname: true,
                    email: true
                }
            },
            rounds: {
                include: {
                    interviewers: {
                        select: {
                            id: true,
                            firstname: true,
                            lastname: true,
                            email: true,
                            designation: true
                        }
                    }
                },
                orderBy: { roundNumber: "asc" }
            },
            interviewFeedbacks: {
                select: feedbackSelect,
                orderBy: {
                    submittedAt: 'asc' as const
                }
            }
        },
        orderBy: {
            createdAt: 'desc'
        }
    });

    // Filter rounds based on visibility rules
    const filteredInterviews: any[] = [];
    for (const interview of interviews) {
        const totalRoundsCount = await prisma.interviewRound.count({
            where: { interviewId: interview.id }
        });
        const hasRoundsInDb = totalRoundsCount > 0;

        const interviewerRounds = interview.rounds.filter(r => r.interviewerIds.includes(interviewerId));
        const visibleInterviewerRounds = await Promise.all(
            interviewerRounds.map(async (round) => {
                const isVisible = await isRoundVisibleToInterviewers(interview.id, round.roundNumber);
                return isVisible ? round : null;
            })
        );
        const activeRounds = visibleInterviewerRounds.filter((r): r is typeof r => r !== null);

        if (hasRoundsInDb && activeRounds.length === 0) {
            continue;
        }

        const processedRounds = await Promise.all(
            interview.rounds.map(async (round) => {
                const isVisible = await isRoundVisibleToInterviewers(interview.id, round.roundNumber);
                if (isVisible) {
                    return round;
                } else {
                    return {
                        ...round,
                        date: null,
                        startTime: null,
                        endTime: null
                    };
                }
            })
        );

        filteredInterviews.push({
            ...interview,
            rounds: processedRounds
        });
    }

    return filteredInterviews;
}

export async function getInterviewById(interviewId: string, interviewerId: string) {
    const interview = await prisma.interview.findFirst({
        where: {
            id: interviewId,
            OR: [
                { interviewerIds: { has: interviewerId } },
                {
                    rounds: {
                        some: {
                            interviewerIds: { has: interviewerId },
                            status: { in: ["pending", "scheduled", "in-progress", "completed"] }
                        }
                    }
                }
            ]
        },
        include: {
            candidate: {
                select: {
                    id: true,
                    candidateCode: true,
                    firstname: true,
                    lastname: true,
                    email: true,
                    phone: true,
                    experience: true,
                    currentCompany: true,
                    currentPosition: true,
                    skills: true,
                    notes: true
                }
            },
            position: {
                select: {
                    id: true,
                    title: true,
                    requiredSkills: true,
                    minimumExperience: true,
                    maximumExperience: true,
                    description: true,
                    status: true,
                    department: {
                        select: {
                            id: true,
                            name: true,
                            description: true
                        }
                    }
                }
            },
            creator: {
                select: {
                    id: true,
                    firstname: true,
                    lastname: true,
                    email: true,
                    designation: true
                }
            },
            interviewers: {
                select: {
                    id: true,
                    firstname: true,
                    lastname: true,
                    email: true,
                    designation: true
                }
            },
            rounds: {
                include: {
                    interviewers: {
                        select: {
                            id: true,
                            firstname: true,
                            lastname: true,
                            email: true,
                            designation: true
                        }
                    },
                    interviewFeedbacks: {
                        select: {
                            id: true,
                            interviewerId: true,
                            interviewer: {
                                select: {
                                    id: true,
                                    firstname: true,
                                    lastname: true,
                                    email: true
                                }
                            },
                            rating: true,
                            recommendation: true,
                            positiveComments: true,
                            negativeComments: true,
                            additionalComments: true,
                            submittedAt: true
                        }
                    }
                },
                orderBy: { roundNumber: "asc" }
            },
            interviewFeedbacks: {
                select: {
                    id: true,
                    interviewerId: true,
                    interviewer: {
                        select: {
                            id: true,
                            firstname: true,
                            lastname: true,
                            email: true
                        }
                    },
                    rating: true,
                    recommendation: true,
                    positiveComments: true,
                    negativeComments: true,
                    additionalComments: true,
                    submittedAt: true
                }
            }
        }
    });

    if (!interview) {
        return null;
    }

    const totalRoundsCount = await prisma.interviewRound.count({
        where: { interviewId: interview.id }
    });
    const hasRoundsInDb = totalRoundsCount > 0;

    const interviewerRounds = interview.rounds.filter(r => r.interviewerIds.includes(interviewerId));
    const visibleInterviewerRounds = await Promise.all(
        interviewerRounds.map(async (round) => {
            const isVisible = await isRoundVisibleToInterviewers(interview.id, round.roundNumber);
            return isVisible ? round : null;
        })
    );
    const activeRounds = visibleInterviewerRounds.filter((r): r is typeof r => r !== null);

    if (hasRoundsInDb && activeRounds.length === 0) {
        return null;
    }

    const processedRounds = await Promise.all(
        interview.rounds.map(async (round) => {
            const isVisible = await isRoundVisibleToInterviewers(interview.id, round.roundNumber);
            if (isVisible) {
                return round;
            } else {
                return {
                    ...round,
                    date: null,
                    startTime: null,
                    endTime: null
                };
            }
        })
    );

    return {
        ...interview,
        rounds: processedRounds
    };
}

export async function getCandidateDetails(candidateId: string) {
    const candidate = await prisma.candidate.findUnique({
        where: {
            id: candidateId
        },
        select: {
            id: true,
            candidateCode: true,
            firstname: true,
            lastname: true,
            email: true,
            phone: true,
            experience: true,
            currentCompany: true,
            currentPosition: true,
            skills: true,
            notes: true,
            resumeMimeType: true
        }
    });

    if (!candidate) {
        return null;
    }

    return {
        ...candidate,
        resumeUrl: candidate.resumeMimeType
            ? `/api/interviewer/candidate/${candidateId}/resume`
            : undefined
    };
}

export async function getInterviewByIdForAdmin(id: string) {
    if (!isValidObjectId(id)) {
        throw { status: 400, message: "Invalid interview id" };
    }
    const interview = await prisma.interview.findUnique({
        where: { id },
        include: {
            candidate: {
                select: {
                    id: true,
                    candidateCode: true,
                    firstname: true,
                    lastname: true,
                    email: true,
                    phone: true,
                    experience: true,
                    currentCompany: true,
                    currentPosition: true,
                    skills: true
                }
            },
            position: {
                select: {
                    id: true,
                    title: true,
                    requiredSkills: true,
                    minimumExperience: true,
                    maximumExperience: true,
                    description: true,
                    status: true
                }
            },
            creator: {
                select: {
                    id: true,
                    firstname: true,
                    lastname: true,
                    email: true
                }
            },
            interviewers: {
                select: {
                    id: true,
                    firstname: true,
                    lastname: true,
                    email: true,
                    designation: true
                }
            },
            rounds: {
                include: {
                    interviewers: {
                        select: {
                            id: true,
                            firstname: true,
                            lastname: true,
                            email: true,
                            designation: true
                        }
                    }
                },
                orderBy: { roundNumber: "asc" as const }
            },
            interviewFeedbacks: {
                select: feedbackSelect,
                orderBy: {
                    submittedAt: 'asc' as const
                }
            }
        }
    });

    return interview;
}

export async function updateInterview(id: string, data: {
    candidateId?: string;
    positionId?: string;
    interviewerIds?: string[];
    date?: string;
    startTime?: Date;
    endTime?: Date;
    round?: number;
    type?: string;
    status?: string;
    rounds?: CreateRoundData[];
}) {
    if (!isValidObjectId(id)) {
        throw { status: 400, message: "Invalid interview id" };
    }

    const existingInterview = await prisma.interview.findUnique({
        where: { id },
        include: { rounds: true }
    });

    if (!existingInterview) {
        throw { status: 404, message: "Interview not found" };
    }

    if (data.candidateId) {
        if (!isValidObjectId(data.candidateId)) {
            throw { status: 400, message: "Invalid candidate id" };
        }
        const candidate = await prisma.candidate.findUnique({ where: { id: data.candidateId } });
        if (!candidate) {
            throw { status: 404, message: "Candidate not found" };
        }
    }

    if (data.positionId) {
        if (!isValidObjectId(data.positionId)) {
            throw { status: 400, message: "Invalid position id" };
        }
        const position = await prisma.jobPositions.findUnique({ where: { id: data.positionId } });
        if (!position) {
            throw { status: 404, message: "Job position not found" };
        }
    }

    if (data.rounds && data.rounds.length > 0) {
        await prisma.interviewRound.deleteMany({ where: { interviewId: id } });
        await createInterviewRounds(id, data.rounds);

        const allInterviewerIds = [...new Set(data.rounds.flatMap(r => r.interviewerIds))];
        const round1 = data.rounds[0];

        await prisma.interview.update({
            where: { id },
            data: {
                ...(data.candidateId && { candidateId: data.candidateId }),
                ...(data.positionId && { positionId: data.positionId }),
                ...(data.type && { type: data.type }),
                ...(data.status && { status: data.status }),
                ...(round1.date && { date: round1.date }),
                ...(round1.startTime && { startTime: round1.startTime }),
                ...(round1.endTime && { endTime: round1.endTime }),
                interviewerIds: allInterviewerIds
            }
        });
    } else {
        const updateData: any = {};
        if (data.candidateId) updateData.candidateId = data.candidateId;
        if (data.positionId) updateData.positionId = data.positionId;
        if (data.interviewerIds) {
            for (const invId of data.interviewerIds) {
                if (!isValidObjectId(invId)) {
                    throw { status: 400, message: "Invalid interviewer id" };
                }
            }
            updateData.interviewerIds = data.interviewerIds;
        }
        if (data.date) updateData.date = data.date;
        if (data.startTime) updateData.startTime = data.startTime;
        if (data.endTime) updateData.endTime = data.endTime;
        if (data.round !== undefined) updateData.round = data.round;
        if (data.type !== undefined) updateData.type = data.type;
        if (data.status) updateData.status = data.status;

        if (updateData.startTime && updateData.endTime && updateData.startTime >= updateData.endTime) {
            throw { status: 400, message: "End time must be after start time" };
        }

        await prisma.interview.update({
            where: { id },
            data: updateData
        });

        if (existingInterview.rounds.length > 0) {
            const firstRound = existingInterview.rounds[0];
            await prisma.interviewRound.update({
                where: { id: firstRound.id },
                data: {
                    ...(data.interviewerIds && { interviewerIds: data.interviewerIds }),
                    ...(data.type && { type: data.type }),
                    ...(data.date && { date: data.date }),
                    ...(data.startTime && { startTime: data.startTime }),
                    ...(data.endTime && { endTime: data.endTime })
                }
            });
        }
    }

    return getInterviewByIdForAdmin(id);
}

export async function deleteInterview(id: string) {
    if (!isValidObjectId(id)) {
        throw { status: 400, message: "Invalid interview id" };
    }

    const existing = await prisma.interview.findUnique({
        where: { id }
    });

    if (!existing) {
        throw { status: 404, message: "Interview not found" };
    }

    await prisma.$transaction([
        prisma.interviewFeedback.deleteMany({ where: { interviewId: id } }),
        prisma.interviewRound.deleteMany({ where: { interviewId: id } }),
        prisma.interview.delete({ where: { id } })
    ]);

    return { message: "Interview deleted successfully" };
}

