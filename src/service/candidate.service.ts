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

async function generateCandidateCode() {
    const lastCandidate = await prisma.candidate.findFirst({
        orderBy: { candidateCode: 'desc' },
        select: { candidateCode: true }
    });

    const lastNumber = lastCandidate ? parseInt(lastCandidate.candidateCode.replace(/\D/g, ''), 10) || 0 : 0;
    return `CAND${String(lastNumber + 1).padStart(4, '0')}`;
}
