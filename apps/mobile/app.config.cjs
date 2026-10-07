module.exports = ({ config }) => {
  const uuid = (value) => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value) ? value : null;
  const profile = typeof process.env.EAS_BUILD_PROFILE === 'string' && /^[a-z0-9_-]{1,40}$/i.test(process.env.EAS_BUILD_PROFILE)
    ? process.env.EAS_BUILD_PROFILE : process.env.TAXI_AI_ACCEPTANCE_BUILD === 'true' ? 'acceptance' : 'local';
  const platform = ['ios','android'].includes(process.env.EAS_BUILD_PLATFORM ?? '') ? process.env.EAS_BUILD_PLATFORM : null;
  const commit = typeof process.env.EAS_BUILD_GIT_COMMIT_HASH === 'string' && /^[a-f0-9]{40}$/i.test(process.env.EAS_BUILD_GIT_COMMIT_HASH)
    ? process.env.EAS_BUILD_GIT_COMMIT_HASH : null;
  let apiOrigin = null;
  try { const url = new URL(process.env.EXPO_PUBLIC_API_ORIGIN ?? ''); if (url.protocol === 'https:' && !url.username && !url.password && !url.port && url.pathname === '/' && !url.search && !url.hash) apiOrigin = url.origin; } catch { /* Local development may not use HTTPS. */ }
  const strictRelease = process.env.TAXI_AI_ACCEPTANCE_BUILD === 'true' || process.env.TAXI_AI_PRODUCTION_BUILD === 'true';
  if (strictRelease) {
    const clientId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value);
    if (apiOrigin !== 'https://taxiai.app') throw new Error('Signed Taxi Ai acceptance/production builds must target https://taxiai.app.');
    if (!uuid(process.env.EXPO_PUBLIC_EXPO_PROJECT_ID)) throw new Error('Signed Taxi Ai builds require the EAS project UUID.');
    if (!clientId(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) || !clientId(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID))
      throw new Error('Signed Taxi Ai builds require configured public Google OAuth client IDs.');
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? ''))
      throw new Error('Signed Taxi Ai builds require the restricted Android Maps SDK key.');
    if (typeof process.env.GOOGLE_SERVICES_JSON !== 'string' || !process.env.GOOGLE_SERVICES_JSON)
      throw new Error('Signed Taxi Ai builds require the Firebase Android client configuration file.');
  }
  config = { ...config, extra: { ...config.extra, release: {
    buildId: uuid(process.env.EAS_BUILD_ID), projectId: uuid(process.env.EAS_BUILD_PROJECT_ID ?? process.env.EXPO_PUBLIC_EXPO_PROJECT_ID),
    profile, platform, gitCommit: commit, apiOrigin,
  } } };
  // Android embeds this restricted SDK key in the native manifest. iOS uses MapKit.
  const androidMapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY;
  if (androidMapsKey && !/^[A-Za-z0-9_-]{20,200}$/.test(androidMapsKey)) throw new Error('Configure a valid Android Maps SDK key.');
  config = { ...config,
    plugins: [...(config.plugins ?? []), ['react-native-maps', {
      ...(androidMapsKey ? { androidGoogleMapsApiKey: androidMapsKey } : {}),
    }]],
    extra: { ...config.extra, nativeMaps: { androidConfigured: Boolean(androidMapsKey) } },
  };
  // EAS file environment variable, or a local ignored client configuration file.
  // This is google-services.json, never a Firebase service-account private key.
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
  if (googleServicesFile) config = { ...config, android: { ...config.android, googleServicesFile } };
  const projectId = process.env.EXPO_PUBLIC_EXPO_PROJECT_ID;
  if (projectId) {
    if (!/^[a-f0-9-]{36}$/.test(projectId)) throw new Error('Use a valid Expo project ID.');
    config = { ...config, extra: { ...config.extra, eas: { projectId } } };
  }
  const iosId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (!iosId) return config;
  if (!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(iosId)) throw new Error('Use a valid Google iOS OAuth client ID.');
  return { ...config, plugins: [...(config.plugins ?? []), ['react-native-nitro-google-signin', {
    iosUrlScheme: iosId.split('.').reverse().join('.'),
  }]] };
};
