import prisma from "../lib/prisma";
import { CreateRoundData, createInterviewRounds, getCurrentRound, updateRoundDecision, VALID_DECISIONS, isRoundVisibleToInterviewers } from "./interview-round.service";

export { VALID_DECISIONS };

const isValidObjectId = (id: string) => /^[a-f\d]{24}$/i.test(id);

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
                startTime: { lt: data.endTime! },
                endTime: { gt: data.startTime! }
            },
            select: { id: true, startTime: true, endTime: true }
        });

        if (conflict) {
            throw {
                status: 409,
                message: `Interviewer has a conflicting interview (${conflict.startTime.toISOString()} - ${conflict.endTime.toISOString()})`
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
            notes: true
        }
    });

    return candidate;
}
