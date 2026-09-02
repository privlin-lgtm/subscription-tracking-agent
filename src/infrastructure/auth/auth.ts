import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { appConfig } from "@/shared/config";
import { PrismaUserRepository } from "@/infrastructure/db/repositories";
import { authConfig } from "@/infrastructure/auth/auth.config";

const users = new PrismaUserRepository();

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  secret: appConfig.authSecret,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) {
          return null;
        }
        const user = await users.findByEmail(email);
        if (!user) {
          return null;
        }
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
          return null;
        }
        return { id: user.id, email: user.email };
      },
    }),
  ],
});
