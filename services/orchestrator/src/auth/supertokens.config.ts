import { Logger } from '@nestjs/common';
import supertokens from 'supertokens-node';
import ThirdParty from 'supertokens-node/recipe/thirdparty';
import Session from 'supertokens-node/recipe/session';

const logger = new Logger('SuperTokens');

export const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isEmailAllowed(email: string): boolean {
  if (ALLOWED_EMAILS.length === 0) return true;
  return ALLOWED_EMAILS.includes(email.toLowerCase());
}

export function initSuperTokens() {
  const apiDomain = process.env.SUPERTOKENS_API_DOMAIN || 'http://localhost:3002';

  const providers: any[] = [];

  if (process.env.GOOGLE_CLIENT_ID) {
    providers.push({
      config: {
        thirdPartyId: 'google',
        clients: [
          {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
          },
        ],
      },
    });
  }

  supertokens.init({
    framework: 'express',
    supertokens: {
      connectionURI: process.env.SUPERTOKENS_CONNECTION_URI || 'http://localhost:3567',
      apiKey: process.env.SUPERTOKENS_API_KEY || undefined,
    },
    appInfo: {
      appName: 'DTM Monitor',
      apiDomain,
      websiteDomain: process.env.SUPERTOKENS_WEBSITE_DOMAIN || 'http://localhost:5173',
      apiBasePath: '/auth',
      websiteBasePath: '/auth',
    },
    recipeList: [
      ThirdParty.init({
        signInAndUpFeature: { providers },
        override:
          ALLOWED_EMAILS.length > 0
            ? {
                apis: (originalImplementation) => ({
                  ...originalImplementation,
                  signInUpPOST: async function (input) {
                    const response = await originalImplementation.signInUpPOST!(input);
                    if (response.status === 'OK') {
                      const email = response.user.emails[0]?.toLowerCase();
                      if (!ALLOWED_EMAILS.includes(email)) {
                        await Session.revokeAllSessionsForUser(response.user.id);
                        logger.warn(`Access denied for ${email} — not in ALLOWED_EMAILS`);
                        return {
                          status: 'GENERAL_ERROR' as const,
                          message: 'Access denied. Your email is not on the allowlist.',
                        };
                      }
                    }
                    return response;
                  },
                }),
              }
            : undefined,
      }),
      Session.init(),
    ],
  });
}
