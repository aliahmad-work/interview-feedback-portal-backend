import bcrypt from "bcryptjs";
import { users } from "../data/users";

export async function login(email: string, password: string) {
    const user = users.find(u => u.email === email);

    if (!user) {
        return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
        return null;
    }

    return user;
}
