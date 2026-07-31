# Phase 0 — Research: Dokument-Upload bei manueller Feature-Erfassung

**Datum**: 2026-07-27 | **Spec**: [spec.md](./spec.md)

Die Spezifikation enthält keine `[NEEDS CLARIFICATION]`-Marker; alle offenen Punkte
sind dort als Annahmen festgehalten. Diese Datei prüft jede Annahme gegen den
tatsächlichen Code und entscheidet die technischen Fragen, die daraus folgen.

---

## R1 — Ablageort der Dokumente

**Decision**: `specs/<feature-slug>/docs/` im Feature-Worktree; unmittelbar nach dem
Schreiben committet (`git add specs/<slug>/docs && git commit`).

**Rationale**:
- Direktes Vorbild im Code: `JiraImportService.writeTicketMaterial()`
  (`packages/server/src/services/jiraImportService.ts:165`) legt das Ticket-Dossier unter
  `specs/<slug>/jira/` ab — versioniert, neben den übrigen Artefakten (FR-004).
- Der Fundort ist ein kurzer, stabiler Relativpfad — genau das, was der Prompt-Verweis
  braucht (FR-009: nur Name + Fundort, kein Inhalt).
- `featureSpecsDir()` (`packages/server/src/services/featureArtifacts.ts:16`) fällt auf
  `project.path` zurück, sobald der Worktree nach dem Merge entfernt ist. Committete
  Dokumente sind dadurch nach Abschluss weiterhin auffindbar (SC-007, FR-016).
- Der sofortige Commit deckt drei Fälle ab, die ohne ihn brechen:
  US2-AS3 (Worktree neu aufgesetzt → `git worktree add` checkt den Branch neu aus,
  uncommittete Dateien wären weg), US2-AS4/SC-007 (Nachvollziehbarkeit nach der
  Integration) und den in `mergeQueueService.reconcile()` dokumentierten Fallstrick
  „Branch ohne eigene Commits gilt trivial als gemergt"
  (`packages/server/src/services/mergeQueueService.ts:653`) — ein Dokument-Commit gibt
  dem Branch von Anfang an einen eigenen Commit.
- Commit-Muster existiert bereits: `commitWorktree()`
  (`packages/server/src/services/mergeQueueService.ts:629`).

**Alternatives considered**:
- **`.sdd/documents/` (git-excluded, wie das materialisierte Projektwissen,
  `knowledgeService.ts:36`)** — verworfen: widerspricht der Spec-Annahme
  „Ablage bei den Feature-Artefakten", überlebt den Merge nicht und macht SC-007
  unerfüllbar. Bleibt die richtige Wahl, falls das Projekt später vertrauliches
  Material ausdrücklich aus der Versionierung halten will (dann per `/speckit-clarify`).
- **`<dataDir>/features/<id>/docs/` als Quelle + Materialisierung in den Worktree** —
  verworfen: zweite Wahrheit, zusätzliche Synchronisation, kein Gewinn gegenüber
  „einmal schreiben + committen".
- **Ohne Commit, nur auf Disk** — verworfen: `WorktreeManager.remove()` verweigert zwar
  das Entfernen bei uncommitteten Änderungen (`git/worktrees.ts:220`), aber ein
  `--force`-Pfad und der Neuaufbau eines fehlenden Worktrees umgehen diesen Schutz.

**Konsequenz, die bewusst in Kauf genommen wird**: Direkt nach dem Anlegen meldet
`integrationHasChanges()` (`api/server.ts:860`) `true` — die Integrations-Aktion ist also
schon vor der ersten Phase freigeschaltet. Der Docs-Commit *ist* eine echte Änderung am
Branch; das ist korrekt, nur ungewohnt früh.

**Kein Konflikt mit dem Specify-Lauf**: Die `speckit-specify`-Skill legt das
Feature-Verzeichnis mit `mkdir -p` an (`.claude/skills/speckit-specify/SKILL.md:97`) und
kopiert `spec.md` nur, falls sie fehlt. Ein bereits existierendes `specs/<slug>/docs/`
stört nicht. (Der Guard „Feature directory already exists" in
`.specify/scripts/bash/create-new-feature.sh:285` betrifft nur den Skript-Pfad, den die
Skill nicht benutzt.)

---

## R2 — Metadaten: Manifest auf Disk statt DB-Tabelle

**Decision**: Kein DB-Schema. Ein Manifest `specs/<slug>/docs/documents.json` hält je
Dokument Anzeigename (Originalname), abgelegten Dateinamen, Größe, MIME-Typ und
Übernahmezeitpunkt. Die API leitet ihre Antworten daraus ab.

**Rationale**:
- Die Key Entity im Spec verlangt Anzeigename **und** abgelegten Namen — bei einer
  Namenskollision (FR-005) unterscheiden die sich, und nur das Manifest kann den
  Originalnamen dann noch nennen.
- Dokumente und Manifest wandern gemeinsam mit den Artefakten durch Review, Merge und
  Archiv. Eine DB-Zeile täte das nicht — sie wäre nach dem Merge eine Referenz auf einen
  Pfad in einem gelöschten Worktree.
- Keine Migration (aktuell 28 Einträge im `MIGRATIONS`-Array,
  `packages/server/src/db/database.ts`), kein Drift zwischen DB und Disk.
- Das Manifest ist zugleich der maschinenlesbare Teil des in SC-007 geforderten
  Nachweises.

**Alternatives considered**:
- **Tabelle `feature_documents`** — verworfen: Migration + Repo + Mapping für Daten, die
  vollständig aus dem Verzeichnis ableitbar sind, plus das Merge-Problem oben.
- **Ganz ohne Manifest, alles aus `readdirSync` + `statSync`** — verworfen: verliert den
  Originalnamen bei Umbenennung und den Übernahmezeitpunkt bei jedem `git checkout`
  (mtime).
- **Markdown-Index statt JSON** — verworfen für die API (Parsing), aber der Prompt-Verweis
  liefert dem Agenten ohnehin die Liste; ein zweites Markdown-Dokument wäre Redundanz.

---

## R3 — Transport: multipart, Felder vor Dateien, ohne Zwischenlager

**Decision**: Neue Route `POST /api/projects/:id/features/with-documents`, Content-Type
`multipart/form-data`. Reihenfolge im Formular verbindlich: erst `name`, dann
`description`, dann die Dateien (`files`). Der Server iteriert `req.parts()` und schreibt
jede Datei direkt in den Ziel-Ordner — kein Staging-Verzeichnis, keine Pufferung des
gesamten Uploads im Speicher.

**Rationale**:
- `@fastify/multipart@10.1.0` ist bereits registriert (`api/server.ts:110`) mit
  `limits.fileSize = 25 MB` — exakt die in der Spec angenommene Grenze.
  `req.parts()` akzeptiert routenlokale Optionen (`FastifyMultipartBaseOptions`:
  `limits`, `throwFileSizeLimit`).
- Bis zu 20 Dateien à 25 MB = 500 MB. Sie vorab vollständig zu puffern
  (`file.toBuffer()`, wie im `paste-image`-Pfad, `api/server.ts:874`) ist bei einem
  einzelnen Screenshot vertretbar, hier nicht.
- Felder vor Dateien erlaubt es, das Feature **vor** dem ersten Byte auf Disk anzulegen
  (siehe R4) — das ist die ganze Mechanik hinter FR-015.

**Alternatives considered**:
- **Zwei Schritte über bestehende Routen** (`POST …/features` → neue Upload-Route →
  `POST …/phases/specify/start`) — verworfen: der Client müsste die Orchestrierung
  übernehmen; bricht er zwischendrin ab, steht ein Feature ohne gestarteten Specify-Lauf
  da. Der Jira-Import löst dasselbe Problem bewusst serverseitig
  (`jiraImportService.ts:98–115`).
- **Staging in `<dataDir>/tmp/` und erst danach Feature anlegen** — verworfen: mehr
  bewegliche Teile (Aufräumen des Staging-Ordners bei jedem Fehlerpfad) für denselben
  Effekt, den die Reihenfolge in R4 umsonst liefert.
- **Bestehende JSON-Route auf multipart erweitern** — verworfen: FR-017/SC-006 verlangen,
  dass der dokumentlose Weg *unverändert* bleibt. Zwei Routen halten das trivial prüfbar.

---

## R4 — Reihenfolge: Feature zuerst, Dateien danach (FR-014/FR-015)

**Decision**:
1. `orchestrator.createFeature(projectId, name)` — **ohne** `description`, damit noch kein
   Specify-Lauf startet.
2. Dokumente schreiben, Manifest schreiben, committen. Fehler einzelner Dateien werden
   gesammelt, nicht geworfen.
3. `orchestrator.startPhaseRun(featureId, 'specify', description)` — auch wenn
   `description` leer ist (FR-010).

**Rationale**:
- Scheitert Schritt 1 (z. B. „Feature 'x' existiert bereits",
  `orchestrator.ts:163`), ist noch keine Datei geschrieben — FR-015 ist ohne
  Aufräum-Logik erfüllt. Der restliche Request-Body wird verworfen, der Client bekommt
  die Fehlermeldung.
- Schritt 2 sammelt statt zu werfen: das Feature bleibt nutzbar, der Client bekommt die
  Liste der nicht übernommenen Dokumente (FR-014, SC-005).
- Schritt 3 nach dem Schreiben garantiert, dass die Dokumente vor dem Agenten im Worktree
  liegen — dasselbe Argument wie im Jira-Import (`jiraImportService.ts:96`).
- `startPhaseRun` mit leerem `extraPrompt` sendet nur den Slash-Command; der
  Dokument-Verweis kommt zentral aus `launchPhase` (R5). Damit steht der Specify-Lauf auch
  ohne Beschreibung auf den Dokumenten (FR-010).

---

## R5 — Verweis-Injektion: zentral in `launchPhase`, unbedingt

**Decision**: Der Dokument-Block wird in
`Orchestrator.launchPhase()` (`packages/server/src/services/orchestrator.ts:419`) an den
Prompt gehängt — bei **jedem** Phasenstart, ohne Dedupe, direkt aus dem Manifest gelesen.
Reihenfolge: `base + docsBlock + [Wissens-Präambel] + templateHint(phase)`.

**Rationale**:
- `launchPhase` ist der einzige Punkt, durch den alle Startwege laufen: regulärer
  `startPhaseRun` (`orchestrator.ts:317`), Gate-Fortsetzung (`:349`) und die
  Auto-Progress-Kette (`startAgentForApprovedChain`, `:561`). Eine Injektion hier deckt
  FR-007 und SC-003 vollständig ab.
- **Bewusst ohne die Dedupe-Logik der Wissens-Präambel**: dort wird die Präambel nur bei
  Reset oder Änderung erneut gesendet (`orchestrator.ts:461`). Für Dokumente verlangen
  FR-007 („alle nachfolgenden Arbeitsschritte") und SC-003 („in 100 % der gestarteten
  Arbeitsschritte") den Verweis in *jedem* Auftrag. Der Block kostet wenige Dutzend
  Tokens — die Dedupe-Ersparnis rechtfertigt das Risiko nicht, dass ein Schritt nach
  `/compact` ohne Verweis läuft (FR-008).
- Frisch aus dem Manifest gelesen statt aus dem Prozessspeicher: überlebt Neustart,
  Kontext-Reset und Session-Wechsel und bleibt wahr, wenn jemand eine Datei entfernt.
- Ohne Dokumente liefert die Funktion `''` — der Prompt ist dann zeichengleich mit dem
  heutigen (FR-017, SC-006). Das ist als Test festgehalten.

**Bewusste Abgrenzung**: Nicht injiziert wird in headless laufende Gate-Agents
(`agentGateService.ts`), Verify- und Konfliktauflösungs-Läufe. Die Spec spricht von
„Arbeitsschritten des Features"; SC-003 misst „alle für das Projekt aktivierten Schritte"
— das sind die Phasen aus `FEATURE_PHASES`.

**Alternatives considered**:
- **Injektion in `startPhaseRun` neben `extraPrompt`** — verworfen: umgeht
  `startAgentForApprovedChain` (`:561`) und damit einen Teil der Auto-Progress-Kette.
- **Verweis in die Wissens-Präambel einweben** (`knowledgePreambleFor`) — verworfen:
  koppelt zwei unabhängige Mechanismen; die Präambel unterliegt zusätzlich der
  Verdichtung durch `compress()` (`contextOptimizer.ts:70`), die Dateipfade beschädigen
  könnte.

---

## R6 — Grenzen durchsetzen, ohne die Auswahl zu verwerfen

**Decision**:
- Je Datei 25 MB (`MAX_DOCUMENT_BYTES`), je Feature 20 Dokumente
  (`MAX_DOCUMENTS_PER_FEATURE`), 0 Byte wird abgelehnt — Konstanten in
  `packages/shared/src/featureDocuments.ts`, damit Client und Server dieselbe Zahl
  nennen (FR-011, FR-018).
- Server: `req.parts({ limits: { fileSize: MAX_DOCUMENT_BYTES }, throwFileSizeLimit: false })`.
  Eine überschrittene Datei erscheint als `part.file.truncated === true` → sie wird
  verworfen und als `rejected` gemeldet, der Strom läuft weiter.
- Die Dokumentzahl wird **gezählt**, nicht über `limits.files` erzwungen: das Limit würde
  den ganzen Request mit `RequestFileCountLimitError` abbrechen, statt die überzähligen
  Dateien einzeln zu melden.
- Client: dieselben Prüfungen schon bei der Auswahl, damit gar nichts erst hochlädt
  (SC-001) — die serverseitige Prüfung bleibt die verbindliche.

**Rationale**: FR-011 verlangt ausdrücklich „ohne die übrige Auswahl zu verwerfen", und
SC-005 verlangt für jeden Fehlerfall eine Meldung mit Dateiname und Ursache. Ein
werfendes Limit kann beides nicht liefern.

---

## R7 — Dateinamen härten (FR-005)

**Decision**: `sanitizeFilename()` und `uniqueFilename()` wandern aus
`jiraImportService.ts:310–323` in ein eigenes Modul
`packages/server/src/services/safeFilename.ts`; beide Aufrufer nutzen es. Die Härtung wird
dabei erweitert:

| Eingabe | Ergebnis |
|---|---|
| `../../etc/passwd` | `.._.._etc_passwd` (Separatoren ersetzt, führende Punkte entwertet) |
| `.ssh` | `_ssh` |
| `bericht.pdf` (zweimal) | `bericht.pdf`, `bericht-2.pdf` |
| Steuerzeichen/NUL | entfernt |
| > 200 Zeichen | vor der Endung gekürzt |
| leer nach Bereinigung | `dokument` |

Zusätzlich prüft der Schreibpfad, dass der aufgelöste Zielpfad unterhalb des
Dokument-Ordners liegt (`resolve(dir, name).startsWith(resolve(dir) + sep)`) — dieselbe
Gürtel-plus-Hosenträger-Prüfung wie in `knowledgeService.safeRepoRelative()`
(`knowledgeService.ts:161`).

**Rationale**: Die Vorlage im Jira-Import ist erprobt, deckt aber `..` und Steuerzeichen
nicht ab. Ein zweiter, leicht abweichender Sanitizer wäre die schlechtere Antwort als ein
gemeinsamer, getesteter — und der Jira-Import gewinnt die Härtung mit.

---

## R8 — Ansehen und Öffnen (FR-016)

**Decision**: `GET /api/features/:id/documents` liefert die Liste aus dem Manifest;
`POST /api/features/:id/documents/open` öffnet ein Dokument mit der
Systemanwendung (`open <pfad>` auf macOS, wie im Zweig `target === 'finder'` von
`/api/features/:id/open`, `api/server.ts:854`). Der Dateiname aus dem Request wird gegen
die Manifest-Einträge geprüft, nie direkt als Pfad verwendet.

**Rationale**: `POST /api/open-in-editor` (`api/server.ts:838`) existiert bereits, öffnet
aber über `editorCmd` (Default `code -g {file}:{line}`) — für PDF, Bilder oder Tabellen die
falsche Anwendung, und es akzeptiert absolute Pfade ungeprüft. Für beliebige Dateiarten
(FR-013) ist der Systemöffner richtig, und die Auswahl aus dem Manifest schließt
Pfadmanipulation aus.

---

## R9 — Zwei Client-Pfade, damit der dokumentlose Ablauf identisch bleibt

**Decision**: `NewFeatureDialog` ruft ohne ausgewählte Dateien unverändert
`api.createFeature()` (JSON), mit Dateien `api.createFeatureWithDocuments()` (multipart).

**Rationale**: FR-017 und SC-006 fordern für den dokumentlosen Fall „gleiche Schritte,
gleicher Auftragstext, keine zusätzlichen Tokens". Zwei getrennte Pfade machen das zu
einer Aussage, die man lesen und testen kann, statt zu einer, die man aus einer
Verzweigung im Server herleiten muss.

---

## R10 — Teilfehler sichtbar machen (FR-014, SC-005)

**Decision**: Die Upload-Antwort enthält `rejected: { name, reason }[]`. Der Dialog zeigt
diese Liste über den bestehenden Fehlerkanal des Stores
(`dispatch({ type: 'error', message })`, `packages/web/src/store.tsx:83`) und navigiert
trotzdem zur Feature-Konsole — das Feature ist ja angelegt.

**Rationale**: Kein stiller Verlust (FR-014); die Meldung nennt Dateiname und Ursache
(SC-005). Ein eigener Meldungskanal (Attention-Inbox) wäre schwerer als nötig: der Nutzer
steht in dem Moment vor dem Dialog.

---

## Zusammenfassung der Entscheidungen

| # | Frage | Entscheidung |
|---|---|---|
| R1 | Ablageort | `specs/<slug>/docs/` im Worktree, sofort committet |
| R2 | Metadaten | Manifest `documents.json`, keine DB-Migration |
| R3 | Transport | multipart, Felder vor Dateien, direkt auf Disk gestreamt |
| R4 | Reihenfolge | Feature → Dokumente → Specify-Start |
| R5 | Verweis | unbedingt in `launchPhase`, aus dem Manifest gelesen |
| R6 | Grenzen | 25 MB/Datei, 20/Feature, 0 Byte abgelehnt; weich pro Datei |
| R7 | Dateinamen | gemeinsames `safeFilename.ts` + Zielpfad-Prüfung |
| R8 | Ansehen | `GET …/documents` + `POST …/documents/open` (Systemöffner) |
| R9 | Client | zwei Pfade — JSON ohne, multipart mit Dokumenten |
| R10 | Teilfehler | `rejected[]` in der Antwort, Meldung im Dialog |
