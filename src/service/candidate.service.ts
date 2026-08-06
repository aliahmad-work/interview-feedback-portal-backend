import prisma from "../lib/prisma";
import { Prisma } from "@prisma/client";

export async function getCandidates(search?: string) {
    const where: Prisma.CandidateWhereInput | undefined = search
        ? {
              OR: [
                  { firstname: { contains: search, mode: Prisma.QueryMode.insensitive } },
                  { lastname: { contains: search, mode: Prisma.QueryMode.insensitive } },
                  { email: { contains: search, mode: Prisma.QueryMode.insensitive } }
              ]
          }
        : undefined;

    const candidates = await prisma.candidate.findMany({
        where,
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
            createdAt: true
        },
        orderBy: {
            createdAt: 'desc'
        }
    });

    return candidates;
}

export async function getCandidateResume(id: string) {
    const candidate = await prisma.candidate.findUnique({
        where: { id },
        select: {
            firstname: true,
            lastname: true,
            resumeData: true,
            resumeMimeType: true
        }
    });

    if (!candidate || !candidate.resumeData) {
        return null;
    }

    return {
        firstname: candidate.firstname,
        lastname: candidate.lastname,
        resumeData: new Uint8Array(candidate.resumeData),
        resumeMimeType: candidate.resumeMimeType
    };
}

export async function createCandidate(data: {
    firstname: string;
    lastname: string;
    email: string;
    phone: string;
    experience?: string;
    currentCompany?: string;
    currentPosition?: string;
    skills?: string[];
    notes?: string;
    createdBy: string;
    resumeData?: Buffer | null;
    resumeMimeType?: string | null;
}) {
    const normalizedEmail = data.email.trim().toLowerCase();

    const emailExists = await prisma.candidate.findUnique({ where: { email: normalizedEmail } });
    if (emailExists) {
        throw { status: 409, message: "A candidate with this email already exists" };
    }

    const phoneExists = await prisma.candidate.findUnique({ where: { phone: data.phone } });
    if (phoneExists) {
        throw { status: 409, message: "A candidate with this phone number already exists" };
    }

    const candidateCode = await generateCandidateCode();

    const candidate = await prisma.candidate.create({
        data: {
            candidateCode,
            firstname: data.firstname,
            lastname: data.lastname,
            email: normalizedEmail,
            phone: data.phone,
            experience: data.experience || null,
            currentCompany: data.currentCompany || null,
            currentPosition: data.currentPosition || null,
            skills: data.skills || [],
            notes: data.notes || null,
            resumeData: data.resumeData ? new Uint8Array(data.resumeData) : null,
            resumeMimeType: data.resumeMimeType || null,
            createdBy: data.createdBy
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

export async function getCandidateById(id: string) {
    const candidate = await prisma.candidate.findUnique({
        where: { id },
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
            resumeMimeType: true,
            createdAt: true,
            updatedAt: true,
            interviews: {
                select: {
                    id: true,
                    round: true,
                    type: true,
                    date: true,
                    startTime: true,
                    endTime: true,
                    status: true,
                    candidateId: true,
                    positionId: true,
                    createdBy: true,
                    interviewerIds: true,
                    createdAt: true,
                    updatedAt: true,
                    interviewers: {
                        select: {
                            id: true,
                            firstname: true,
                            lastname: true,
                            email: true,
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
                        }
                    },
                    creator: {
                        select: {
                            id: true,
                            firstname: true,
                            lastname: true,
                            email: true,
                        }
                    }
                },
                orderBy: { createdAt: 'desc' }
            }
        }
    });

    if (!candidate) {
        throw { status: 404, message: "Candidate not found" };
    }

    return {
        ...candidate,
        resumeUrl: candidate.resumeMimeType
            ? `/api/admin/candidates/${id}/resume`
            : undefined
    };
}

export async function updateCandidate(id: string, data: {
    firstname?: string;
    lastname?: string;
    email?: string;
    phone?: string;
    experience?: string;
    currentCompany?: string;
    currentPosition?: string;
    skills?: string[];
    notes?: string;
    resumeData?: Buffer | null;
    resumeMimeType?: string | null;
}) {
    const existing = await prisma.candidate.findUnique({ where: { id } });

    if (!existing) {
        throw { status: 404, message: "Candidate not found" };
    }

    if (data.email && data.email !== existing.email) {
        const emailExists = await prisma.candidate.findUnique({ where: { email: data.email.trim().toLowerCase() } });
        if (emailExists) {
            throw { status: 409, message: "A candidate with this email already exists" };
        }
    }

    if (data.phone && data.phone !== existing.phone) {
        const phoneExists = await prisma.candidate.findUnique({ where: { phone: data.phone } });
        if (phoneExists) {
            throw { status: 409, message: "A candidate with this phone number already exists" };
        }
    }

    const updateData: any = {};

    if (data.firstname !== undefined) updateData.firstname = data.firstname;
    if (data.lastname !== undefined) updateData.lastname = data.lastname;
    if (data.email !== undefined) updateData.email = data.email.trim().toLowerCase();
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.experience !== undefined) updateData.experience = data.experience || null;
    if (data.currentCompany !== undefined) updateData.currentCompany = data.currentCompany || null;
    if (data.currentPosition !== undefined) updateData.currentPosition = data.currentPosition || null;
    if (data.skills !== undefined) updateData.skills = data.skills;
    if (data.notes !== undefined) updateData.notes = data.notes || null;
    if (data.resumeData !== undefined) updateData.resumeData = data.resumeData ? new Uint8Array(data.resumeData) : null;
    if (data.resumeMimeType !== undefined) updateData.resumeMimeType = data.resumeMimeType || null;

    const candidate = await prisma.candidate.update({
        where: { id },
        data: updateData,
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
            resumeMimeType: true,
            createdAt: true,
            updatedAt: true
        }
    });

    return {
        ...candidate,
        resumeUrl: candidate.resumeMimeType
            ? `/api/admin/candidates/${id}/resume`
            : undefined
    };
}

export async function deleteCandidate(id: string) {
    const existing = await prisma.candidate.findUnique({
        where: { id },
        select: { id: true }
    });

    if (!existing) {
        throw { status: 404, message: "Candidate not found" };
    }

    const interviewCount = await prisma.interview.count({ where: { candidateId: id } });
    if (interviewCount > 0) {
        throw { status: 409, message: "Cannot delete candidate with associated interviews" };
    }

    const feedbackCount = await prisma.interviewFeedback.count({ where: { candidateId: id } });
    if (feedbackCount > 0) {
        throw { status: 409, message: "Cannot delete candidate with associated feedback" };
    }

    await prisma.candidate.delete({ where: { id } });

    return { message: "Candidate deleted successfully" };
}

async function generateCandidateCode() {
    const lastCandidate = await prisma.candidate.findFirst({
        orderBy: { candidateCode: 'desc' },
        select: { candidateCode: true }
    });

    const lastNumber = lastCandidate ? parseInt(lastCandidate.candidateCode.replace(/\D/g, ''), 10) || 0 : 0;
    return `CAND${String(lastNumber + 1).padStart(4, '0')}`;
}
