import jwt from "jsonwebtoken";

export function generateToken(user: {
  id: number,
  email: string,
  role: string
}) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role
    },
    process.env.JWT_SECRET as string,
    {
      expiresIn: process.env.JWT_EXPIRES_IN as any
    }
  );
}