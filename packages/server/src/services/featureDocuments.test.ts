import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { initialPhases, type DocumentManifest } from '@sdd/shared';
import { openMemoryDatabase, type DB } from '../db/database.js';
import { FeatureRepo, ProjectRepo } from '../db/repos.js';
import { FeatureDocumentsService, type IncomingDocument } from './featureDocuments.js';

/**
 * Ablage, Manifest, Commit und Ablehnungsgründe (US1). Arbeitet auf einem echten
 * Git-Repo im Temp-Verzeichnis — die Zusagen betreffen Disk und Git, nicht Logik.
 */

const PHASES = ['specify', 'plan'] as const;

/** Ein multipart-Teil, wie ihn die Route liefert. */
function part(
  filename: string,
  content: string | Buffer,
  opts: { mimeType?: string; truncated?: boolean } = {},
): IncomingDocument {
  const buf = typeof content === 'string' ? Buffer.from(content) : content;
  const stream = Readable.from([buf]) as Readable & { truncated?: boolean };
  stream.truncated = opts.truncated ?? false;
  return { filename, mimeType: opts.mimeType ?? 'text/plain', stream };
}

async function* parts(...items: IncomingDocument[]): AsyncGenerator<IncomingDocument> {
  for (const item of items) yield item;
}

describe('FeatureDocumentsService', () => {
  let db: DB;
  let repo: string;
  let service: FeatureDocumentsService;
  let features: FeatureRepo;
  let projects: ProjectRepo;
  let projectId: string;
  let featureId: string;
  let docsDir: string;

  const feature = () => features.get(featureId)!;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'sdd-docs-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'test@test.local'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
    writeFileSync(join(repo, 'README.md'), '# repo\n');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repo });

    db = openMemoryDatabase();
    projects = new ProjectRepo(db);
    features = new FeatureRepo(db);
    projectId = projects.create({
      name: 'Demo',
      path: repo,
      defaultBranch: 'main',
      color: null,
      enabledPhases: [...PHASES],
      verifyCommands: [],
      automation: {},
      optimization: {},
      mergeMode: 'ff',
      editorCmd: null,
      integrationMode: 'local',
    }).id;
    featureId = features.create({
      projectId,
      name: 'kundenimport',
      branch: 'feature/kundenimport',
      worktreePath: repo,
      phases: initialPhases([...PHASES]),
      integration: 'none',
      integrationTarget: null,
      automation: {},
      optimization: {},
      tasksDone: 0,
      tasksTotal: 0,
    }).id;
    docsDir = join(repo, 'specs', 'kundenimport', 'docs');
    service = new FeatureDocumentsService({ projects, features });
  });

  afterEach(() => {
    try {
      chmodSync(docsDir, 0o700);
    } catch {
      /* Ordner existiert nicht in jedem Test */
    }
    rmSync(repo, { recursive: true, force: true });
    db.close();
  });

  it('schreibt die Datei byte-identisch nach specs/<slug>/docs/ (FR-003)', async () => {
    const inhalt = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x42, 0x0a]); // binär, kein Text
    const res = await service.writeDocuments(feature(), parts(part('roh.bin', inhalt, { mimeType: 'application/octet-stream' })));

    expect(res.rejected).toEqual([]);
    expect(res.documents).toHaveLength(1);
    expect(readFileSync(join(docsDir, 'roh.bin')).equals(inhalt)).toBe(true);
    expect(res.documents[0]).toMatchObject({
      name: 'roh.bin',
      storedName: 'roh.bin',
      relPath: 'specs/kundenimport/docs/roh.bin',
      bytes: 6,
      mimeType: 'application/octet-stream',
    });
    expect(res.documents[0]!.uploadedAt).toBeGreaterThan(0);
  });

  it('legt ein Manifest mit Anzeigename, abgelegtem Namen, Größe und Zeitpunkt an', async () => {
    await service.writeDocuments(feature(), parts(part('Anforderungen 2026.pdf', 'inhalt', { mimeType: 'application/pdf' })));

    const manifest = JSON.parse(readFileSync(join(docsDir, 'documents.json'), 'utf8')) as DocumentManifest;
    expect(manifest.version).toBe(1);
    expect(manifest.documents).toEqual([
      {
        name: 'Anforderungen 2026.pdf',
        storedName: 'Anforderungen 2026.pdf',
        bytes: 6,
        mimeType: 'application/pdf',
        uploadedAt: expect.any(Number),
      },
    ]);
    // relPath steht NICHT im Manifest — er ist aus dem Speicherort ableitbar.
    expect(Object.keys(manifest.documents[0]!)).not.toContain('relPath');
  });

  it('committet Ordner und Manifest sofort (R1)', async () => {
    await service.writeDocuments(feature(), parts(part('a.txt', 'A')));

    const log = execFileSync('git', ['log', '--oneline', '-1'], { cwd: repo, encoding: 'utf8' });
    expect(log).toContain('docs(kundenimport): Ausgangsmaterial hinterlegt');
    const tracked = execFileSync('git', ['ls-files', 'specs/kundenimport/docs'], { cwd: repo, encoding: 'utf8' });
    expect(tracked).toContain('specs/kundenimport/docs/a.txt');
    expect(tracked).toContain('specs/kundenimport/docs/documents.json');
  });

  it('macht gleichnamige Dateien unterscheidbar, statt zu überschreiben (FR-005)', async () => {
    const res = await service.writeDocuments(
      feature(),
      parts(part('bericht.txt', 'Version A'), part('bericht.txt', 'Version B')),
    );

    expect(res.documents.map((d) => d.storedName)).toEqual(['bericht.txt', 'bericht-2.txt']);
    expect(res.documents.map((d) => d.name)).toEqual(['bericht.txt', 'bericht.txt']); // Anzeigename bleibt
    expect(readFileSync(join(docsDir, 'bericht.txt'), 'utf8')).toBe('Version A');
    expect(readFileSync(join(docsDir, 'bericht-2.txt'), 'utf8')).toBe('Version B');
  });

  it('lehnt eine leere Datei mit Dateiname und Grund ab (FR-012)', async () => {
    const res = await service.writeDocuments(feature(), parts(part('gut.txt', 'x'), part('leer.txt', '')));

    expect(res.documents.map((d) => d.name)).toEqual(['gut.txt']); // übrige Auswahl bleibt
    expect(res.rejected).toEqual([{ name: 'leer.txt', reason: 'leer.txt: leere Datei (0 Byte)' }]);
    expect(existsSync(join(docsDir, 'leer.txt'))).toBe(false);
  });

  it('lehnt eine an der Grenze abgeschnittene Datei ab und nennt die Grenze (FR-011)', async () => {
    const res = await service.writeDocuments(
      feature(),
      parts(part('gut.txt', 'x'), part('zu-gross.bin', 'abgeschnitten', { truncated: true })),
    );

    expect(res.documents.map((d) => d.name)).toEqual(['gut.txt']);
    expect(res.rejected).toEqual([{ name: 'zu-gross.bin', reason: 'zu-gross.bin: zu groß (mehr als 25 MB)' }]);
    expect(existsSync(join(docsDir, 'zu-gross.bin'))).toBe(false);
  });

  it('lehnt ab dem 21. Dokument ab, ohne die ersten 20 zu verwerfen (FR-011)', async () => {
    const many = Array.from({ length: 22 }, (_, i) => part(`datei-${i + 1}.txt`, `inhalt ${i + 1}`));
    const res = await service.writeDocuments(feature(), parts(...many));

    expect(res.documents).toHaveLength(20);
    expect(res.rejected).toEqual([
      { name: 'datei-21.txt', reason: 'datei-21.txt: Höchstzahl von 20 Dokumenten je Feature erreicht' },
      { name: 'datei-22.txt', reason: 'datei-22.txt: Höchstzahl von 20 Dokumenten je Feature erreicht' },
    ]);
    expect(existsSync(join(docsDir, 'datei-21.txt'))).toBe(false);
  });

  it('hält einen Traversal-Dateinamen im docs-Ordner fest (FR-005)', async () => {
    const res = await service.writeDocuments(
      feature(),
      parts(part('../../../../tmp/entkommen.txt', 'boese')),
    );

    expect(res.documents).toHaveLength(1);
    const stored = res.documents[0]!.storedName;
    expect(stored).not.toContain('/');
    expect(stored.startsWith('.')).toBe(false);
    expect(res.documents[0]!.relPath.startsWith('specs/kundenimport/docs/')).toBe(true);
    expect(existsSync(join(docsDir, stored))).toBe(true);
    expect(existsSync('/tmp/entkommen.txt')).toBe(false);
  });

  it('meldet einen Schreibfehler als abgelehntes Dokument, statt zu werfen (FR-014)', async () => {
    // Vorlauf legt den Ordner an; danach ist er schreibgeschützt (quickstart Szenario 5).
    await service.writeDocuments(feature(), parts(part('erste.txt', 'da')));
    chmodSync(docsDir, 0o500);

    const res = await service.writeDocuments(feature(), parts(part('zweite.txt', 'geht nicht')));

    expect(res.documents).toEqual([]);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0]!.name).toBe('zweite.txt');
    expect(res.rejected[0]!.reason).toContain('zweite.txt: konnte nicht abgelegt werden (');
    chmodSync(docsDir, 0o700);
    // Das zuvor übernommene Dokument bleibt unangetastet.
    expect(readFileSync(join(docsDir, 'erste.txt'), 'utf8')).toBe('da');
  });

  it('lässt keinen leeren docs-Ordner zurück, wenn nichts übernommen wurde', async () => {
    const res = await service.writeDocuments(feature(), parts(part('leer.txt', '')));

    expect(res.documents).toEqual([]);
    expect(existsSync(docsDir)).toBe(false);
  });

  it('wirft, wenn das Feature keinen Worktree hat (Contract: 500)', async () => {
    features.setWorktree(featureId, null);
    await expect(service.writeDocuments(feature(), parts(part('a.txt', 'x')))).rejects.toThrow(/keinen Worktree/);
  });

  describe('listDocuments', () => {
    it('liest die Liste aus dem Manifest', async () => {
      await service.writeDocuments(feature(), parts(part('a.txt', 'A'), part('b.txt', 'BB')));

      expect(service.listDocuments(featureId)).toEqual([
        expect.objectContaining({ name: 'a.txt', relPath: 'specs/kundenimport/docs/a.txt', bytes: 1 }),
        expect.objectContaining({ name: 'b.txt', relPath: 'specs/kundenimport/docs/b.txt', bytes: 2 }),
      ]);
    });

    it('lässt Einträge ohne vorhandene Datei aus', async () => {
      await service.writeDocuments(feature(), parts(part('a.txt', 'A'), part('b.txt', 'BB')));
      rmSync(join(docsDir, 'a.txt'));

      expect(service.listDocuments(featureId).map((d) => d.name)).toEqual(['b.txt']);
    });

    it('liefert ohne Dokumente eine leere Liste statt eines Fehlers', () => {
      expect(service.listDocuments(featureId)).toEqual([]);
      expect(service.listDocuments('gibt-es-nicht')).toEqual([]);
    });

    it('liefert bei defektem Manifest eine leere Liste', async () => {
      await service.writeDocuments(feature(), parts(part('a.txt', 'A')));
      writeFileSync(join(docsDir, 'documents.json'), '{ kaputt', 'utf8');

      expect(service.listDocuments(featureId)).toEqual([]);
    });

    // SC-007 / US2-AS4: nach dem Merge ist der Worktree entfernt.
    it('liest ohne Worktree aus dem Haupt-Checkout (SC-007)', async () => {
      const mainDocs = join(repo, 'specs', 'kundenimport', 'docs');
      mkdirSync(mainDocs, { recursive: true });
      writeFileSync(join(mainDocs, 'gemergt.txt'), 'inhalt');
      writeFileSync(
        join(mainDocs, 'documents.json'),
        JSON.stringify({
          version: 1,
          documents: [
            { name: 'gemergt.txt', storedName: 'gemergt.txt', bytes: 7, mimeType: 'text/plain', uploadedAt: 1 },
          ],
        }),
      );
      features.setWorktree(featureId, null);

      expect(service.listDocuments(featureId)).toEqual([
        {
          name: 'gemergt.txt',
          storedName: 'gemergt.txt',
          relPath: 'specs/kundenimport/docs/gemergt.txt',
          bytes: 7,
          mimeType: 'text/plain',
          uploadedAt: 1,
        },
      ]);
    });
  });

  describe('documentPath', () => {
    it('liefert den Pfad nur für einen im Manifest gelisteten Namen (FR-005)', async () => {
      await service.writeDocuments(feature(), parts(part('a.txt', 'A')));

      expect(service.documentPath(featureId, 'a.txt')).toBe(join(docsDir, 'a.txt'));
      expect(service.documentPath(featureId, 'documents.json')).toBeNull(); // nicht gelistet
      expect(service.documentPath(featureId, '../../../etc/passwd')).toBeNull();
      expect(service.documentPath('gibt-es-nicht', 'a.txt')).toBeNull();
    });
  });
});
