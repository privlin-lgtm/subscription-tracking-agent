import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { appConfig } from "@/shared/config";
import { PrismaUserRepository } from "@/infrastructure/db/repositories";
import { authConfig, googleProvider } from "@/infrastructure/auth/auth.config";

const users = new PrismaUserRepository();

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  secret: appConfig.authSecret,
  providers: [
    googleProvider,
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
        if (!user?.passwordHash) {
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
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }) {
      if (account?.provider !== "google") {
        return true;
      }
      const email = user.email?.trim().toLowerCase();
      if (!email) {
        return false;
      }
      await users.findOrCreateByEmail(email);
      return true;
    },
    async jwt({ token, user, account, profile, trigger, session }) {
      if (user?.email) {
        const record = await users.findByEmail(user.email.trim().toLowerCase());
        if (record) {
          token.sub = record.id;
          token.email = record.email;
          return token;
        }
      }
      return authConfig.callbacks.jwt({ token, user, account, profile, trigger, session });
    },
  },
});
