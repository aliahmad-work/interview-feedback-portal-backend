import prisma from "../lib/prisma";

const isValidObjectId = (id: string) => /^[a-f\d]{24}$/i.test(id);

export async function createInterview(data: {
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
}) {
    if (!isValidObjectId(data.candidateId)) {
        throw { status: 400, message: "Invalid candidate id" };
    }
    if (!isValidObjectId(data.positionId)) {
        throw { status: 400, message: "Invalid position id" };
    }
    if (!data.interviewerIds.length) {
        throw { status: 400, message: "At least one interviewer is required" };
    }
    for (const id of data.interviewerIds) {
        if (!isValidObjectId(id)) {
            throw { status: 400, message: "Invalid interviewer id" };
        }
    }

    const candidate = await prisma.candidate.findUnique({ where: { id: data.candidateId } });
    if (!candidate) {
        throw { status: 404, message: "Candidate not found" };
    }

    const position = await prisma.jobPositions.findUnique({ where: { id: data.positionId } });
    if (!position) {
        throw { status: 404, message: "Job position not found" };
    }

    if (data.startTime >= data.endTime) {
        throw { status: 400, message: "End time must be after start time" };
    }

    const interviewers = await prisma.user.findMany({
        where: {
            id: { in: data.interviewerIds },
            role: { name: "interviewer" }
        },
        select: { id: true }
    });

    if (interviewers.length !== data.interviewerIds.length) {
        throw { status: 400, message: "One or more assigned users are not valid interviewers" };
    }

    const existingCount = await prisma.interview.count({
        where: { candidateId: data.candidateId }
    });

    for (const interviewerId of data.interviewerIds) {
        const conflict = await prisma.interview.findFirst({
            where: {
                interviewerIds: { has: interviewerId },
                startTime: { lt: data.endTime },
                endTime: { gt: data.startTime }
            },
            select: { id: true, startTime: true, endTime: true }
        });

        if (conflict) {
            throw {
                status: 409,
                message: `Interviewer has a conflicting interview (${conflict.startTime.toISOString()} - ${conflict.endTime.toISOString()})`
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
            interviewerIds: data.interviewerIds
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
            }
        }
    });

    return interview;
}

const feedbackSelect = {
    id: true,
    interviewId: true,
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
            interviewFeedbacks: {
                select: feedbackSelect,
                orderBy: {
                    submittedAt: 'asc'
                }
            }
        },
        orderBy: {
            startTime: 'asc'
        }
    });

    return interviews;
}

export const VALID_DECISIONS = ["pending", "hired", "rejected", "hold", "next_round"];

export async function updateInterviewDecision(interviewId: string, decision: string, adminId: string) {
    if (!isValidObjectId(interviewId)) {
        throw { status: 400, message: "Invalid interview id" };
    }
    if (!VALID_DECISIONS.includes(decision)) {
        throw { status: 400, message: `Decision must be one of: ${VALID_DECISIONS.join(", ")}` };
    }

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
        throw { status: 404, message: "Interview not found" };
    }

    return prisma.interview.update({
        where: { id: interviewId },
        data: {
            decision,
            decisionUpdatedAt: new Date(),
            decisionUpdatedBy: adminId
        },
        select: {
            id: true,
            status: true,
            decision: true,
            decisionUpdatedAt: true,
            decisionUpdatedBy: true
        }
    });
}

export async function getInterviewerInterviews(interviewerId: string) {
    const interviews = await prisma.interview.findMany({
        where: {
            interviewerIds: {
                has: interviewerId
            }
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
            }
        },
        orderBy: {
            startTime: 'asc'
        }
    });

    return interviews;
}

export async function getInterviewById(interviewId: string, interviewerId: string) {
    const interview = await prisma.interview.findFirst({
        where: {
            id: interviewId,
            interviewerIds: {
                has: interviewerId
            }
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

    return interview;
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
