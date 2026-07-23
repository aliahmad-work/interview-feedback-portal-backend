import bcrypt from "bcryptjs";
import prisma from "../lib/prisma";

export async function login(email: string, password: string) {
    const user = await prisma.user.findUnique({
        where: { email },
        include: { role: true }
    });

    if (!user) {
        return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
        return null;
    }

    return user;
}
