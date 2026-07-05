/**
 * Publisher Trust module.
 *
 * Maintains a curated blocklist of packages with known reputation incidents
 * (protestware, supply-chain attacks, account hijacks, sabotage). This is
 * intentionally separate from CVE/vulnerability data — the concern here is
 * developer trust, not just security advisories.
 */

export type TrustSeverity = 'critical' | 'high' | 'moderate';

export interface TrustIncident {
  severity: TrustSeverity;
  year: number;
  /** One-line headline shown in the negative signal. */
  summary: string;
  /** Detailed explanation shown in warnings section. */
  detail: string;
  /** Score penalty applied to publisherTrust (0–100). */
  penalty: number;
}

/**
 * Known trust incidents by package name.
 * Only packages with documented, verifiable incidents are listed.
 * Sources: npm security advisories, GitHub post-mortems, public reporting.
 */
const TRUST_BLOCKLIST: Record<string, TrustIncident> = {
  'node-ipc': {
    severity: 'critical',
    year: 2022,
    summary: 'Intentional protestware — maintainer published destructive payload (2022)',
    detail:
      'Versions 9.2.2 and 10.1.1 contained code that silently overwrote files to a peace symbol on systems with Russian or Belarusian IP addresses. Current versions do not contain this code, but this incident fundamentally affected publisher trust.',
    penalty: 45,
  },
  colors: {
    severity: 'high',
    year: 2022,
    summary: 'Intentional sabotage — maintainer broke dependents on purpose (2022)',
    detail:
      'Maintainer Marak Squibb published version 1.4.44-liberty-2 which introduced an infinite loop, breaking thousands of packages that depended on colors. The act was intentional.',
    penalty: 35,
  },
  faker: {
    severity: 'high',
    year: 2022,
    summary: 'Intentional sabotage — same maintainer incident as colors (2022)',
    detail:
      'Faker.js maintainer (same person as colors) published a corrupted release deliberately. While faker has since been community-forked (@faker-js/faker), the original package carries this history.',
    penalty: 35,
  },
  'event-stream': {
    severity: 'critical',
    year: 2018,
    summary: 'Supply chain attack — malicious actor injected credential stealer (2018)',
    detail:
      'The maintainer transferred ownership to a malicious actor who injected code to steal bitcoin wallet credentials from Copay users via a nested dependency (flatmap-stream). One of the most notable npm supply chain attacks to date.',
    penalty: 50,
  },
  'flatmap-stream': {
    severity: 'critical',
    year: 2018,
    summary: 'Malicious package — created specifically for the event-stream attack (2018)',
    detail:
      'This package was created by a malicious actor and added to event-stream as a dependency. It contained obfuscated code to steal cryptocurrency wallet credentials.',
    penalty: 100,
  },
  'ua-parser-js': {
    severity: 'high',
    year: 2021,
    summary: 'Account hijack — malicious versions with cryptominer published (2021)',
    detail:
      'The maintainer account was hijacked and malicious versions were published containing a crypto miner (XMRig) and a credential stealer targeting Linux and Windows environments.',
    penalty: 25,
  },
  coa: {
    severity: 'high',
    year: 2021,
    summary: 'Account hijack — malicious versions published (2021)',
    detail:
      'Maintainer account was compromised; malicious versions were pushed that contained a password-stealing payload targeting Windows machines.',
    penalty: 25,
  },
  rc: {
    severity: 'high',
    year: 2021,
    summary: 'Account hijack — malicious versions published (2021)',
    detail:
      'Same wave of account compromises as coa and ua-parser-js in late 2021. Malicious versions were briefly available on the registry.',
    penalty: 25,
  },
  'eslint-scope': {
    severity: 'high',
    year: 2018,
    summary: 'Supply chain attack — credential-stealing code injected (2018)',
    detail:
      'A malicious version (3.7.2) was published after the maintainer account was compromised. The code harvested npm credentials and sent them to a remote server.',
    penalty: 20,
  },
  crossenv: {
    severity: 'critical',
    year: 2017,
    summary: 'Typosquat — malicious impersonation of cross-env (2017)',
    detail:
      'This package was a deliberate typosquat of the popular cross-env package. It contained malware that stole npm credentials. npm removed it, but it serves as a reference incident.',
    penalty: 100,
  },
};

export interface TrustResult {
  score: number;
  incident: TrustIncident | null;
}

export function checkPublisherTrust(packageName: string): TrustResult {
  const incident = TRUST_BLOCKLIST[packageName] ?? null;
  if (!incident) return { score: 100, incident: null };
  const score = Math.max(0, 100 - incident.penalty);
  return { score, incident };
}
