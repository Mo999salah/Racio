import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth/minimal';
import { nextCookies } from 'better-auth/next-js';
import { createAuthMiddleware } from 'better-auth/api';
import { SignJWT, importPKCS8 } from 'jose';
import { readAppEnv } from '@racio/config';
import { createDatabase, schema } from '@racio/database';
import { logAuthEvent } from './events';

const env = readAppEnv();
const database = createDatabase(env.DATABASE_URL);

async function createAppleClientSecret() {
  if (!env.providers.apple) return undefined;

  const privateKey = await importPKCS8(env.APPLE_PRIVATE_KEY!.replace(/\\n/g, '\n'), 'ES256');
  return new SignJWT({ sub: env.APPLE_CLIENT_ID! })
    .setProtectedHeader({ alg: 'ES256', kid: env.APPLE_KEY_ID! })
    .setIssuer(env.APPLE_TEAM_ID!)
    .setAudience('https://appleid.apple.com')
    .setIssuedAt()
    .setExpirationTime('180d')
    .sign(privateKey);
}

const appleClientSecret = await createAppleClientSecret();

const socialProviders = {
  ...(env.providers.google
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID!,
          clientSecret: env.GOOGLE_CLIENT_SECRET!,
          accessType: 'offline' as const,
        },
      }
    : {}),
  ...(env.providers.apple && appleClientSecret
    ? {
        apple: {
          clientId: env.APPLE_CLIENT_ID!,
          clientSecret: appleClientSecret,
        },
      }
    : {}),
};

export const auth = betterAuth({
  appName: 'Racio',
  baseURL: env.BETTER_AUTH_URL,
  basePath: '/api/auth',
  secret: env.betterAuthSecret,
  database: drizzleAdapter(database.db, {
    provider: 'pg',
    schema: schema.authSchema,
  }),
  socialProviders,
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    freshAge: 60 * 5,
  },
  trustedOrigins: [
    env.BETTER_AUTH_URL,
    ...(env.providers.apple ? ['https://appleid.apple.com'] : []),
  ],
  advanced: {
    useSecureCookies: env.NODE_ENV === 'production',
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
    },
  },
  rateLimit: {
    enabled: env.NODE_ENV === 'production',
    window: 60,
    max: 60,
    customRules: {
      '/sign-in/social': { window: 60, max: 10 },
    },
  },
  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          logAuthEvent('sign_in_succeeded', { userId: session.userId });
        },
      },
      delete: {
        after: async (session) => {
          logAuthEvent('sign_out', { userId: session.userId });
        },
      },
    },
  },
  hooks: {
    after: createAuthMiddleware(async (context) => {
      if (context.path === '/sign-in/social' && !context.context.newSession) {
        logAuthEvent('sign_in_failed');
      }
    }),
  },
  plugins: [nextCookies()],
});

export function getAuthProviderAvailability() {
  return { ...env.providers };
}
