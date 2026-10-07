/** Pure configuration summary and read-only aggregate queries. Never return account or credential values. */
export function runtimeReadiness(env = {}) {
  const smtp = prefix => {
    const modeKey = prefix === 'TAXI_AI_CONTACT' ? 'TAXI_AI_CONTACT_EMAIL_MODE' : 'TAXI_AI_EMAIL_MODE';
    const keys = ['HOST', 'PORT', 'USER', 'PASSWORD', 'FROM'].map(key => `${prefix}_SMTP_${key}`);
    return { mode: ['off', 'smtp'].includes(env[modeKey] || 'off') ? (env[modeKey] || 'off') : 'invalid',
      missingKeys: keys.filter(key => !env[key]), authenticationVerified: false, inboxDeliveryVerified: false };
  };
  return {
    staffMfa: { required: env.TAXI_AI_STAFF_MFA_REQUIRED === 'true',
      policyValid: ['true', 'false'].includes(env.TAXI_AI_STAFF_MFA_REQUIRED ?? 'false'),
      keyPresent: Boolean(env.TAXI_AI_STAFF_MFA_KEY), keyFormatValid: /^[a-fA-F0-9]{64}$/.test(env.TAXI_AI_STAFF_MFA_KEY ?? '') },
    accountEmail: smtp('TAXI_AI'), contactEmail: smtp('TAXI_AI_CONTACT'),
    maps: { mode: ['off', 'community', 'dedicated'].includes(env.TAXI_AI_MAPS_MODE) ? env.TAXI_AI_MAPS_MODE : 'unspecified',
      explicitSearchEndpoint: Boolean(env.TAXI_AI_SEARCH_URL), explicitRoutingEndpoint: Boolean(env.TAXI_AI_ROUTING_URL),
      explicitTileEndpoint: Boolean(env.TAXI_AI_TILE_URL), capacityVerified: false },
    notice: 'Presence and syntax checks do not prove login, MFA operation, delivery, map availability or capacity.'
  };
}

export async function adminReadiness(query, storage) {
  if (!['postgres', 'sqlite'].includes(storage)) throw new Error('Unsupported storage inventory');
  const rows = await query(storage === 'postgres'
    ? "SELECT table_name AS name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name IN ('staff_memberships','staff_mfa')"
    : "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('staff_memberships','staff_mfa')");
  const tables = new Set(rows.map(row => row.name));
  const count = async sql => {
    const value = Number((await query(sql))[0]?.n);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid aggregate count');
    return value;
  };
  const result = { administratorAccounts: await count("SELECT count(*) AS n FROM users WHERE role='admin'"),
    membershipTablePresent: tables.has('staff_memberships'), mfaTablePresent: tables.has('staff_mfa'),
    activeOwners: null, activeOwnersWithMfa: null, successfulLoginVerified: false };
  if (result.membershipTablePresent) result.activeOwners = await count("SELECT count(*) AS n FROM staff_memberships m JOIN users u ON u.id=m.user_id WHERE m.role='owner' AND m.status='active' AND u.role='admin'");
  if (result.membershipTablePresent && result.mfaTablePresent) result.activeOwnersWithMfa = await count("SELECT count(*) AS n FROM staff_memberships m JOIN users u ON u.id=m.user_id JOIN staff_mfa f ON f.user_id=m.user_id WHERE m.role='owner' AND m.status='active' AND u.role='admin'");
  return result;
}
