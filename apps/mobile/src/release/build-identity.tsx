import Constants from 'expo-constants';
import { Platform, Share, View } from 'react-native';
import { Text } from '../ui/typography';
import { Button, Card, Pill, styles } from '../ui/components';

type ReleaseExtra = { buildId?: string | null; projectId?: string | null; profile?: string | null; platform?: string | null; gitCommit?: string | null; apiOrigin?: string | null };

export function buildIdentity() {
  const release = (Constants.expoConfig?.extra?.release ?? {}) as ReleaseExtra;
  const platform = release.platform ?? Platform.OS;
  const version = Constants.nativeApplicationVersion ?? Constants.expoConfig?.version ?? 'unknown';
  const nativeBuild = Constants.nativeBuildVersion ?? 'unknown';
  const commit = release.gitCommit?.slice(0, 12) ?? 'local';
  const buildId = release.buildId ?? null;
  const evidenceRef = buildId ? `mobile:${platform}:${buildId}` : `mobile:${platform}:${version}:${nativeBuild}:${commit}`;
  return { platform, version, nativeBuild, commit, buildId, projectId: release.projectId ?? null,
    profile: release.profile ?? 'local', apiOrigin: release.apiOrigin ?? process.env.EXPO_PUBLIC_API_ORIGIN ?? 'not configured', evidenceRef };
}

export function BuildIdentityCard() {
  const info = buildIdentity();
  const summary = ['Taxi Ai production acceptance build', `Evidence: ${info.evidenceRef}`, `Platform: ${info.platform}`,
    `Version: ${info.version} (${info.nativeBuild})`, `Profile: ${info.profile}`, `Commit: ${info.commit}`,
    `EAS build: ${info.buildId ?? 'local / unavailable'}`, `API: ${info.apiOrigin}`].join('\n');
  return <Card><Pill>BUILD IDENTITY</Pill><Text style={styles.h2}>Acceptance evidence</Text>
    <Text style={styles.body} selectable>{info.evidenceRef}</Text>
    <View style={styles.stack}><Text style={styles.small}>Platform · {info.platform}</Text><Text style={styles.small}>App · {info.version} · native build {info.nativeBuild}</Text>
      <Text style={styles.small}>Profile · {info.profile}</Text><Text style={styles.small}>Commit · {info.commit}</Text><Text style={styles.small}>API · {info.apiOrigin}</Text></View>
    <Button title="Share build identity" secondary onPress={() => void Share.share({ message: summary, title: 'Taxi Ai build identity' })}/>
    <Text style={styles.small}>Use the evidence reference when recording a real-device result in Admin → Production acceptance. This card contains no signing credentials or provider secrets.</Text>
  </Card>;
}
