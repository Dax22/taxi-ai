const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

// The native app installs independently; only pure shared contracts live outside it.
const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../../packages/shared')];
module.exports = config;
