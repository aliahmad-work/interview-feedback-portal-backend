import prisma from "../lib/prisma";
import bcrypt from "bcryptjs";

const VALID_ROLES = ["admin", "interviewer"];

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
            openings: true,
            closedAt: true,
            closeReason: true,
            createdAt: true,
            department: {
                select: {
                    id: true,
                    name: true
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
        },
        orderBy: {
            createdAt: 'desc'
        }
    });

    // Merge real application/hiring analytics per vacancy
    const interviews = await prisma.interview.findMany({
        select: {
            positionId: true,
            candidateId: true,
            status: true,
            decision: true,
            date: true
        }
    });

    return positions.map((p) => {
        const posInterviews = interviews.filter((i) => i.positionId === p.id);
        const appliedCandidates = new Set(posInterviews.map((i) => i.candidateId)).size;
        const interviewing = posInterviews.filter((i) =>
            ["scheduled", "in-progress", "pending"].includes(i.status)
        ).length;
        const hired = posInterviews.filter((i) => i.decision === "hired").length;
        const rejected = posInterviews.filter((i) => i.decision === "rejected").length;
        const onHold = posInterviews.filter((i) => i.decision === "hold").length;

        return {
            ...p,
            stats: {
                applied: appliedCandidates,
                interviewing,
                hired,
                rejected,
                onHold,
                filled: hired
            }
        };
    });
}

export async function getDepartments() {
    const departments = await prisma.department.findMany({
        select: {
            id: true,
            name: true,
            description: true
        },
        orderBy: {
            name: 'asc'
        }
    });

    return departments;
}

export async function createUser(data: {
    firstname: string;
    lastname: string;
    email: string;
    password: string;
    role: string;
    designation?: string;
    phone?: string;
}) {
    const roleName = data.role.toLowerCase();

    if (!VALID_ROLES.includes(roleName)) {
        throw { status: 400, message: "Role must be either 'admin' or 'interviewer'" };
    }

    const normalizedEmail = data.email.trim().toLowerCase();

    const emailExists = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (emailExists) {
        throw { status: 409, message: "A user with this email already exists" };
    }

    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) {
        throw { status: 400, message: `Role '${roleName}' does not exist` };
    }

    const employeeId = await generateEmployeeId();
    const password = await bcrypt.hash(data.password, 10);

    const user = await prisma.user.create({
        data: {
            employeeId,
            firstname: data.firstname,
            lastname: data.lastname,
            email: normalizedEmail,
            password,
            roleId: role.id,
            designation: data.designation || null,
            phone: data.phone || null
        },
        select: {
            id: true,
            employeeId: true,
            firstname: true,
            lastname: true,
            email: true,
            designation: true,
            phone: true,
            role: {
                select: {
                    id: true,
                    name: true
                }
            }
        }
    });

    return user;
}

export async function createPosition(data: {
    title: string;
    departmentId: string;
    requiredSkills: string[];
    minimumExperience: number;
    maximumExperience?: number;
    description: string;
    status?: string;
    openings?: number;
    createdBy: string;
}) {
    const department = await prisma.department.findUnique({ where: { id: data.departmentId } });
    if (!department) {
        throw { status: 404, message: "Department not found" };
    }

    if (data.maximumExperience !== undefined && data.maximumExperience < data.minimumExperience) {
        throw { status: 400, message: "Maximum experience cannot be less than minimum experience" };
    }

    const openings = data.openings && data.openings > 0 ? data.openings : 1;
    const status = data.status || "open";

    const position = await prisma.jobPositions.create({
        data: {
            title: data.title,
            departmentId: data.departmentId,
            requiredSkills: data.requiredSkills,
            minimumExperience: data.minimumExperience,
            maximumExperience: data.maximumExperience || null,
            description: data.description,
            status,
            openings,
            closedAt: status === "closed" ? new Date() : null,
            createdBy: data.createdBy
        },
        include: {
            department: {
                select: {
                    id: true,
                    name: true
                }
            }
        }
    });

    return position;
}

export async function updatePosition(data: {
    id: string;
    status?: string;
    openings?: number;
    closeReason?: string;
    title?: string;
    departmentId?: string;
    requiredSkills?: string[];
    minimumExperience?: number;
    maximumExperience?: number;
    description?: string;
}) {
    const existing = await prisma.jobPositions.findUnique({ where: { id: data.id } });
    if (!existing) {
        throw { status: 404, message: "Position not found" };
    }

    if (data.departmentId) {
        const department = await prisma.department.findUnique({ where: { id: data.departmentId } });
        if (!department) {
            throw { status: 404, message: "Department not found" };
        }
    }

    if (data.maximumExperience !== undefined && data.minimumExperience !== undefined && data.maximumExperience < data.minimumExperience) {
        throw { status: 400, message: "Maximum experience cannot be less than minimum experience" };
    }

    const nextStatus = data.status || existing.status;
    const closing = nextStatus === "closed" && existing.status !== "closed";
    const reopening = nextStatus === "open" && existing.status === "closed";

    const position = await prisma.jobPositions.update({
        where: { id: data.id },
        data: {
            title: data.title ?? existing.title,
            departmentId: data.departmentId ?? existing.departmentId,
            requiredSkills: data.requiredSkills ?? existing.requiredSkills,
            minimumExperience: data.minimumExperience ?? existing.minimumExperience,
            maximumExperience: data.maximumExperience !== undefined ? data.maximumExperience : existing.maximumExperience,
            description: data.description ?? existing.description,
            status: nextStatus,
            openings: data.openings && data.openings > 0 ? data.openings : existing.openings,
            closeReason: closing ? (data.closeReason || null) : reopening ? null : (data.closeReason !== undefined ? data.closeReason : existing.closeReason),
            closedAt: closing ? new Date() : reopening ? null : existing.closedAt
        },
        include: {
            department: {
                select: {
                    id: true,
                    name: true
                }
            }
        }
    });

    return position;
}

export async function getPositionById(id: string) {
    const position = await prisma.jobPositions.findUnique({
        where: { id },
        select: {
            id: true,
            title: true,
            requiredSkills: true,
            minimumExperience: true,
            maximumExperience: true,
            description: true,
            status: true,
            openings: true,
            closedAt: true,
            closeReason: true,
            createdAt: true,
            department: {
                select: {
                    id: true,
                    name: true
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

    if (!position) {
        throw { status: 404, message: "Position not found" };
    }

    return position;
}

async function generateEmployeeId() {
    const lastUser = await prisma.user.findFirst({
        orderBy: { employeeId: 'desc' },
        select: { employeeId: true }
    });

    const lastNumber = lastUser ? parseInt(lastUser.employeeId.replace(/\D/g, ''), 10) || 0 : 0;
    return `EMP${String(lastNumber + 1).padStart(3, '0')}`;
}
