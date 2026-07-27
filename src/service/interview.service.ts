import prisma from "../lib/prisma";

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
