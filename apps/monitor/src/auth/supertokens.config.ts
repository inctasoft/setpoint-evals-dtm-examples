import SuperTokens from 'supertokens-auth-react';
import ThirdParty, {
  Google,
} from 'supertokens-auth-react/recipe/thirdparty';
import Session from 'supertokens-auth-react/recipe/session';

export function initSuperTokens() {
  SuperTokens.init({
    appInfo: {
      appName: 'DTM Monitor',
      apiDomain: window.location.origin,
      websiteDomain: window.location.origin,
      apiBasePath: '/api/auth',
      websiteBasePath: '/auth',
    },
    recipeList: [
      ThirdParty.init({
        signInAndUpFeature: {
          providers: [Google.init()],
        },
      }),
      Session.init(),
    ],
  });
}
