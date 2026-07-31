/**
 * Branch-Namensvorschlag und -Validierung für die Integrations-Zielwahl im
 * Review-Portal. Pure Funktionen; die Existenzprüfung gegen echte Branches
 * übernimmt der Aufrufer (Server) und reicht die Liste herein.
 */

/** Slug analog zur Feature-Branch-Erzeugung (Kleinbuchstaben, Bindestriche). */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Vorschlag `integration/<slug>`; kollidiert der Name mit einem bestehenden
 * Branch, wird `-2`, `-3`, … angehängt (erster freier Suffix).
 */
export function suggestBranchName(featureName: string, existingBranches: string[]): string {
  const base = `integration/${slugify(featureName) || 'feature'}`;
  const taken = new Set(existingBranches);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Gültigkeit eines Branch-Namens als praxisnahes Subset von
 * `git check-ref-format --branch`: verbietet die Konstrukte, die git ablehnt.
 */
export function isValidBranchName(name: string): boolean {
  if (!name || name.length > 250) return false;
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/')) return false;
  if (name.endsWith('.') || name.endsWith('.lock')) return false;
  if (name === '@' || name.includes('@{')) return false;
  if (name.includes('..') || name.includes('//')) return false;
  // Steuerzeichen, Leerzeichen und git-Sonderzeichen (~ ^ : ? * [ \)
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(name)) return false;
  // Keine Komponente darf leer sein, mit '.' beginnen oder auf '.lock' enden
  if (name.split('/').some((part) => part === '' || part.startsWith('.') || part.endsWith('.lock'))) return false;
  return true;
}
