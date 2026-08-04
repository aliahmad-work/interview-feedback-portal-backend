import prisma from "../lib/prisma";

export async function getInterviewers() {
    const interviewers = await prisma.user.findMany({
        where: {
            role: { name: "interviewer" }
        },
        select: {
            id: true,
            employeeId: true,
            firstname: true,
            lastname: true,
            email: true,
            designation: true
        },
        orderBy: {
            firstname: 'asc'
        }
    });

    return interviewers;
}

export async function getPositions() {
    const positions = await prisma.jobPositions.findMany({
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
                    name: true
                }
            }
        },
        orderBy: {
            title: 'asc'
        }
    });

    return positions;
}
