module.exports = ({ config }) => {
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
