import prisma from "../lib/prisma";

const isValidObjectId = (id: string) => /^[a-f\d]{24}$/i.test(id);

export const VALID_DECISIONS = ["pending", "hired", "rejected", "hold", "next_round"];

export interface CreateRoundData {
    interviewerIds: string[];
    type?: string;
    duration: number;
    date?: string;
    startTime?: Date;
    endTime?: Date;
}

export async function createInterviewRounds(interviewId: string, rounds: CreateRoundData[]) {
    if (!isValidObjectId(interviewId)) {
        throw { status: 400, message: "Invalid interview id" };
    }

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
        throw { status: 404, message: "Interview not found" };
    }

    const existingRounds = await prisma.interviewRound.findMany({
        where: { interviewId },
        orderBy: { roundNumber: "asc" }
    });

    const startNumber = existingRounds.length + 1;

    for (let i = 0; i < rounds.length; i++) {
        const round = rounds[i];
        if (!round.interviewerIds.length) {
            throw { status: 400, message: `Round ${startNumber + i}: At least one interviewer is required` };
        }
        for (const id of round.interviewerIds) {
            if (!isValidObjectId(id)) {
                throw { status: 400, message: `Round ${startNumber + i}: Invalid interviewer id` };
            }
        }
        if (round.duration < 15) {
            throw { status: 400, message: `Round ${startNumber + i}: Duration must be at least 15 minutes` };
        }
        if (round.date && round.startTime && round.endTime) {
            if (round.startTime >= round.endTime) {
                throw { status: 400, message: `Round ${startNumber + i}: End time must be after start time` };
            }
        }
    }

    const allInterviewerIds = rounds.flatMap(r => r.interviewerIds);
    const uniqueInterviewerIds = [...new Set(allInterviewerIds)];
    const interviewers = await prisma.user.findMany({
        where: {
            id: { in: uniqueInterviewerIds },
            role: { name: "interviewer" }
        },
        select: { id: true }
    });
    if (interviewers.length !== uniqueInterviewerIds.length) {
        throw { status: 400, message: "One or more assigned users are not valid interviewers" };
    }

    for (const round of rounds) {
        if (round.date && round.startTime && round.endTime) {
            for (const interviewerId of round.interviewerIds) {
                const conflict = await prisma.interviewRound.findFirst({
                    where: {
                        interviewerIds: { has: interviewerId },
                        date: round.date,
                        startTime: { lt: round.endTime },
                        endTime: { gt: round.startTime },
                        status: { in: ["scheduled", "in-progress"] }
                    },
                    select: { id: true, startTime: true, endTime: true }
                });
                if (conflict) {
                    throw {
                        status: 409,
                        message: `Interviewer has a conflicting round (${conflict.startTime?.toISOString()} - ${conflict.endTime?.toISOString()})`
                    };
                }
            }
        }
    }

    const isFirstRound = existingRounds.length === 0;

    const createdRounds = await prisma.$transaction(async (tx) => {
        const results = [];
        for (let i = 0; i < rounds.length; i++) {
            const round = rounds[i];
            const roundNumber = startNumber + i;
            const roundStatus =
                isFirstRound && i === 0 && round.date && round.startTime && round.endTime
                    ? "scheduled"
                    : "pending";

            const created = await tx.interviewRound.create({
                data: {
                    interviewId,
                    roundNumber,
                    type: round.type || null,
                    duration: round.duration,
                    date: round.date || null,
                    startTime: round.startTime || null,
                    endTime: round.endTime || null,
                    status: roundStatus,
                    decision: "pending",
                    interviewerIds: round.interviewerIds
                },
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
            });
            results.push(created);
        }
        return results;
    });

    return createdRounds;
}

export async function getRoundsByInterview(interviewId: string) {
    if (!isValidObjectId(interviewId)) {
        throw { status: 400, message: "Invalid interview id" };
    }

    const rounds = await prisma.interviewRound.findMany({
        where: { interviewId },
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
    });

    return rounds;
}

export async function updateRoundSchedule(
    interviewId: string,
    roundId: string,
    date: string,
    startTime: Date,
    endTime: Date
) {
    if (!isValidObjectId(interviewId)) {
        throw { status: 400, message: "Invalid interview id" };
    }
    if (!isValidObjectId(roundId)) {
        throw { status: 400, message: "Invalid round id" };
    }

    const round = await prisma.interviewRound.findFirst({
        where: { id: roundId, interviewId }
    });
    if (!round) {
        throw { status: 404, message: "Round not found" };
    }

    if (startTime >= endTime) {
        throw { status: 400, message: "End time must be after start time" };
    }

    for (const interviewerId of round.interviewerIds) {
        const conflict = await prisma.interviewRound.findFirst({
            where: {
                interviewerIds: { has: interviewerId },
                date: date,
                startTime: { lt: endTime },
                endTime: { gt: startTime },
                status: { in: ["scheduled", "in-progress"] },
                id: { not: roundId }
            },
            select: { id: true, startTime: true, endTime: true }
        });
        if (conflict) {
            throw {
                status: 409,
                message: `Interviewer has a conflicting round (${conflict.startTime?.toISOString()} - ${conflict.endTime?.toISOString()})`
            };
        }
    }

    const eligible = await isEligibleForActivation(interviewId, round.roundNumber);
    const status = round.status === "cancelled" || round.status === "completed" ? round.status : eligible ? "scheduled" : "pending";

    const updated = await prisma.interviewRound.update({
        where: { id: roundId },
        data: {
            date,
            startTime,
            endTime,
            status
        },
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
    });

    return updated;
}

async function isEligibleForActivation(interviewId: string, roundNumber: number) {
    const priorRounds = await prisma.interviewRound.findMany({
        where: {
            interviewId,
            roundNumber: { lt: roundNumber }
        },
        select: { id: true, status: true }
    });

    return priorRounds.every(r => r.status === "completed");
}

export async function cancelRound(interviewId: string, roundId: string) {
    if (!isValidObjectId(interviewId)) {
        throw { status: 400, message: "Invalid interview id" };
    }
    if (!isValidObjectId(roundId)) {
        throw { status: 400, message: "Invalid round id" };
    }

    const round = await prisma.interviewRound.findFirst({
        where: { id: roundId, interviewId }
    });
    if (!round) {
        throw { status: 404, message: "Round not found" };
    }

    const updated = await prisma.interviewRound.update({
        where: { id: roundId },
        data: { status: "cancelled" }
    });

    return updated;
}

export async function cancelSubsequentRounds(interviewId: string, afterRoundNumber: number) {
    const rounds = await prisma.interviewRound.findMany({
        where: {
            interviewId,
            roundNumber: { gt: afterRoundNumber },
            status: { in: ["pending", "scheduled"] }
        }
    });

    if (rounds.length === 0) return [];

    const roundIds = rounds.map(r => r.id);
    await prisma.interviewRound.updateMany({
        where: { id: { in: roundIds } },
        data: { status: "cancelled" }
    });

    return roundIds;
}

export async function getCurrentRound(interviewId: string) {
    const rounds = await prisma.interviewRound.findMany({
        where: {
            interviewId,
            status: { in: ["scheduled", "in-progress", "completed"] },
            decision: { in: ["pending", "hold"] }
        },
        orderBy: { roundNumber: "asc" }
    });

    return rounds[0] || null;
}

export async function updateRoundDecision(
    interviewId: string,
    roundId: string,
    decision: string,
    adminId: string
) {
    if (!isValidObjectId(interviewId)) {
        throw { status: 400, message: "Invalid interview id" };
    }
    if (!isValidObjectId(roundId)) {
        throw { status: 400, message: "Invalid round id" };
    }
    if (!VALID_DECISIONS.includes(decision)) {
        throw { status: 400, message: `Decision must be one of: ${VALID_DECISIONS.join(", ")}` };
    }

    const interview = await prisma.interview.findUnique({
        where: { id: interviewId },
        select: { id: true }
    });
    if (!interview) {
        throw { status: 404, message: "Interview not found" };
    }

    const round = await prisma.interviewRound.findFirst({
        where: { id: roundId, interviewId }
    });
    if (!round) {
        throw { status: 404, message: "Round not found" };
    }

    if (round.status === "cancelled") {
        throw { status: 400, message: "Cannot make a decision on a cancelled round" };
    }

    if (!["scheduled", "in-progress", "completed"].includes(round.status)) {
        throw { status: 400, message: "Cannot make a decision on a round that is not yet active" };
    }

    const nextRound = await prisma.interviewRound.findFirst({
        where: {
            interviewId,
            roundNumber: round.roundNumber + 1,
            status: { not: "cancelled" }
        }
    });

    await prisma.$transaction(async (tx) => {
        await tx.interviewRound.update({
            where: { id: roundId },
            data: {
                decision,
                decisionUpdatedAt: new Date(),
                decisionUpdatedBy: adminId
            }
        });

        if (decision === "next_round") {
            if (round.status !== "completed") {
                await tx.interviewRound.update({
                    where: { id: roundId },
                    data: { status: "completed" }
                });
            }
            if (nextRound) {
                const nextStatus = nextRound.date && nextRound.startTime && nextRound.endTime
                    ? "scheduled"
                    : "pending";
                await tx.interviewRound.update({
                    where: { id: nextRound.id },
                    data: { status: nextStatus }
                });
            }
            await tx.interview.update({
                where: { id: interviewId },
                data: {
                    decision,
                    decisionUpdatedAt: new Date(),
                    decisionUpdatedBy: adminId
                }
            });
        } else if (decision === "rejected" || decision === "hired") {
            if (round.status !== "completed") {
                await tx.interviewRound.update({
                    where: { id: roundId },
                    data: { status: "completed" }
                });
            }
            const subsequent = await tx.interviewRound.findMany({
                where: {
                    interviewId,
                    roundNumber: { gt: round.roundNumber },
                    status: { in: ["pending", "scheduled"] }
                },
                select: { id: true }
            });
            if (subsequent.length > 0) {
                await tx.interviewRound.updateMany({
                    where: { id: { in: subsequent.map(r => r.id) } },
                    data: { status: "cancelled" }
                });
            }
            await tx.interview.update({
                where: { id: interviewId },
                data: {
                    decision,
                    decisionUpdatedAt: new Date(),
                    decisionUpdatedBy: adminId,
                    status: "completed"
                }
            });
        } else if (decision === "hold") {
            await tx.interview.update({
                where: { id: interviewId },
                data: {
                    decision,
                    decisionUpdatedAt: new Date(),
                    decisionUpdatedBy: adminId
                }
            });
        } else {
            await tx.interview.update({
                where: { id: interviewId },
                data: {
                    decision,
                    decisionUpdatedAt: new Date(),
                    decisionUpdatedBy: adminId
                }
            });
        }
    });

    const updated = await prisma.interviewRound.findUnique({
        where: { id: roundId },
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
    });

    return updated;
}

export async function isRoundVisibleToInterviewers(interviewId: string, roundNumber: number): Promise<boolean> {
    // Round 1 is always visible if assigned
    if (roundNumber === 1) {
        return true;
    }

    // For rounds 2+, check if the previous round has a "next_round" decision
    const previousRound = await prisma.interviewRound.findFirst({
        where: {
            interviewId,
            roundNumber: roundNumber - 1
        },
        select: { decision: true, status: true }
    });

    if (!previousRound) {
        return false;
    }

    // Round is visible if previous round has "next_round" decision
    return previousRound.decision === "next_round";
}
