module.exports = ({ config }) => {
  const iosId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (!iosId) return config;
  if (!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(iosId)) throw new Error('Use a valid Google iOS OAuth client ID.');
  return { ...config, plugins: [...(config.plugins ?? []), ['react-native-nitro-google-signin', {
    iosUrlScheme: iosId.split('.').reverse().join('.'),
  }]] };
};
