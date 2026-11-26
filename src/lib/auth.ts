import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { bearer } from "better-auth/plugins/bearer";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { magicLink } from "better-auth/plugins/magic-link";
import { db, schema } from "@/db";
import { ensurePersonalWorkspace } from "@/server/workspaces";
import { actionEmail, sendEmail } from "./email";
import { env, isDesktop } from "./env";

function createAuth() {
  const e = env();

  const orcidConfig =
    e.ORCID_CLIENT_ID && e.ORCID_CLIENT_SECRET
      ? [
          {
            providerId: "orcid",
            name: "ORCID",
            clientId: e.ORCID_CLIENT_ID,
            clientSecret: e.ORCID_CLIENT_SECRET,
            discoveryUrl: `${e.ORCID_BASE_URL}/.well-known/openid-configuration`,
            scopes: ["openid"],
            pkce: true,
            // ORCID rarely shares email addresses, so we key accounts on the ORCID iD
            // and use a non-routable placeholder email the user can change later.
            getUserInfo: async (tokens: { accessToken?: string }) => {
              const res = await fetch(`${e.ORCID_BASE_URL}/oauth/userinfo`, {
                headers: { Authorization: `Bearer ${tokens.accessToken}` },
              });
              if (!res.ok) return null;
              const p = (await res.json()) as {
                sub: string;
                name?: string;
                given_name?: string;
                family_name?: string;
              };
              const name = p.name || [p.given_name, p.family_name].filter(Boolean).join(" ") || p.sub;
              return { id: p.sub, name, email: `${p.sub}@orcid.invalid`, emailVerified: false };
            },
          },
        ]
      : [];

  return betterAuth({
    baseURL: e.BETTER_AUTH_URL,
    secret: e.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      sendResetPassword: async ({ user, url }) => {
        const m = actionEmail("Reset your password", "Use the link below to choose a new password.", url, "Reset password");
        await sendEmail({ to: user.email, subject: "Reset your Jobiza password", ...m });
      },
    },
    emailVerification: {
      // The desktop app's local account has no mailbox.
      sendOnSignUp: !isDesktop(),
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        const m = actionEmail("Verify your email", "Confirm your address to secure your account.", url, "Verify email");
        await sendEmail({ to: user.email, subject: "Verify your Jobiza email", ...m });
      },
    },
    socialProviders:
      e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
        ? { google: { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET } }
        : {},
    account: {
      accountLinking: { enabled: true, trustedProviders: ["google", "orcid"] },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await ensurePersonalWorkspace(user.id, user.name);
          },
        },
      },
    },
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          const m = actionEmail("Sign in to Jobiza", "Click below to sign in. The link expires in 5 minutes.", url, "Sign in");
          await sendEmail({ to: email, subject: "Your Jobiza sign-in link", ...m });
        },
      }),
      genericOAuth({ config: orcidConfig }),
      // Lets future desktop/mobile clients authenticate with `Authorization: Bearer <session token>`.
      bearer(),
      nextCookies(), // must stay last
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;
const g = globalThis as unknown as { __jobizaAuth?: Auth };

/** Lazily constructed so `next build` doesn't need runtime secrets. */
export function auth(): Auth {
  if (!g.__jobizaAuth) g.__jobizaAuth = createAuth();
  return g.__jobizaAuth;
}

export type Session = Auth["$Infer"]["Session"];
