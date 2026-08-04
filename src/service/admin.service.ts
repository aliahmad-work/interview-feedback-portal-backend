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
    createdBy: string;
}) {
    const department = await prisma.department.findUnique({ where: { id: data.departmentId } });
    if (!department) {
        throw { status: 404, message: "Department not found" };
    }

    if (data.maximumExperience !== undefined && data.maximumExperience < data.minimumExperience) {
        throw { status: 400, message: "Maximum experience cannot be less than minimum experience" };
    }

    const position = await prisma.jobPositions.create({
        data: {
            title: data.title,
            departmentId: data.departmentId,
            requiredSkills: data.requiredSkills,
            minimumExperience: data.minimumExperience,
            maximumExperience: data.maximumExperience || null,
            description: data.description,
            status: data.status || "open",
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

async function generateEmployeeId() {
    const lastUser = await prisma.user.findFirst({
        orderBy: { employeeId: 'desc' },
        select: { employeeId: true }
    });

    const lastNumber = lastUser ? parseInt(lastUser.employeeId.replace(/\D/g, ''), 10) || 0 : 0;
    return `EMP${String(lastNumber + 1).padStart(3, '0')}`;
}
