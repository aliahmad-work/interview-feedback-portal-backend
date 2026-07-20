import bcrypt from "bcryptjs";

export const users = [
    {
        id: 1,
        name: "System Admin",
        email: "admin@company.com",
        password: bcrypt.hashSync("Admin123!", 10),
        role: "ADMIN"
    },
    {
        id: 2,
        name: "Interviewer",
        email: "interviewer@company.com",
        password: bcrypt.hashSync("Interviewer123!", 10),
        role: "INTERVIEWER"
    }
]