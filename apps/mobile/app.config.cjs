module.exports = ({ config }) => {
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
