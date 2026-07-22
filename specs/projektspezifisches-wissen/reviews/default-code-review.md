# Code-Review: Feature `projektspezifisches-wissen`

- **Branch**: `feature/projektspezifisches-wissen`
- **Vergleich**: `git diff` gegen Merge-Base `2d1c2d8` (Default-Branch `main`)
- **Reviewer-Modus**: adversarial (aktiv Fehler suchen)
- **Umfang**: 31 Dateien, +2975 / −4 (Server-API, DB-Migration, KnowledgeRepo/-Service, Shared-Logik, Web-UI, Spec-Artefakte)
- **Hinweis**: `pnpm -r typecheck` / `pnpm -r test` konnten in dieser Session nicht ausgeführt werden (nicht-interaktive Sandbox verweigert Ausführung). Das Review beruht auf statischer Analyse; ein grüner CI-Lauf ist zusätzlich zu verifizieren.

## Gesamteindruck

Sauber geschnittene Implementierung: klare Trennung von purer Logik (`packages/shared/src/knowledge.ts`), Persistenz (`knowledgeRepo.ts`), IO/Materialisierung (`knowledgeService.ts`) und API. Namensgebung, Migrations-, Event- und Fehler-Konventionen folgen dem Bestand. Pfad-Guards gegen Traversal sind vorhanden, Cross-Projekt-Scoping wird konsequent geprüft, der Index ist als reine Projektion by-construction konsistent (FR-005/FR-006/SC-005). Tests decken Baum, Zyklus, Index, Scoring, Repo-CRUD/Cascade und Materialisierung ab.

Es gibt jedoch **drei Kernmängel** — einer davon verletzt die zentrale, ausdrücklich formulierte Rahmenbedingung des Features und tritt im Normalablauf garantiert auf. Zusammen mit mehreren kleineren Punkten ist das Urteil **FAIL**.

---

## Blocker (müssen vor Merge behoben werden)

### B1 — Materialisiertes `.sdd/knowledge/` wird committet und in den Default-Branch gemergt (Verstoß gegen die Kern-Rahmenbedingung)

**Dateien**: `packages/server/src/services/knowledgeService.ts:140,175-183`; `packages/server/src/services/orchestrator.ts:177,249,267-277`; `packages/server/src/services/mergeQueueService.ts:51,313-323`; `packages/server/src/git/git.ts:50-53`.

Die git-Ausschluss-Logik ist in echten Worktrees ein **No-Op**, und der Integrationsfluss committet die materialisierten Dateien anschließend automatisch. Damit landet abgeleitetes Wissen im Feature-Diff und im Default-Branch — genau das, was plan.md („Kein Eingriff in Feature-Diffs; materialisiertes Wissen strikt git-excluded"), tasks.md:185 („Feature-Diffs dürfen `.sdd/` nie enthalten") und `contracts/materialized-layout.md` ausschließen wollen.

Belegte Fehlerkette:

1. `Orchestrator.knowledgePreambleFor` ruft bei **jedem** Phasenstart (`startPhaseRun` Z.177, `startAgentForApprovedChain` Z.249) `materializeForFeature` auf → `.sdd/knowledge/index.md` (+ selektierte Bundle-/Entry-Dateien) liegt im Worktree. `.sdd/` ist beim Merge damit praktisch immer vorhanden.
2. `ensureGitExcluded` (`knowledgeService.ts:175-183`) schreibt nach `join(worktreeRoot, '.git', 'info', 'exclude')`. In einem per `git worktree add` erzeugten Worktree (`git/worktrees.ts:32`) ist `.git` **eine Datei** (gitdir-Redirect), kein Verzeichnis. `appendFileSync` auf einen Pfad unterhalb dieser Datei wirft `ENOTDIR`; der `catch` verschluckt es → **`.sdd/` wird nie ausgeschlossen**. Der Code-Kommentar („Worktree-.git ist eine Datei … best effort") bestätigt, dass das bekannt ist — die zentrale Garantie hängt aber genau daran.
3. `MergeQueueService.beginIntegration` (Z.51) ruft `commitWorktree` (Z.313-323). `isCleanWorkingTree` (`git.ts:50-53`) nutzt `git status --porcelain`, das **untracked** Dateien meldet → `.sdd/` macht den Baum „dirty" → `git add -A` + `git commit`. Die materialisierten Inhalte (bei `source='file'`-Importen sogar duplizierter Repo-Datei-Inhalt) werden in den Feature-Branch committet und in den Default-Branch gemergt.

**Failure-Szenario**: Projekt mit Wissen, Feature durchläuft `specify` → `.sdd/knowledge/` wird geschrieben. Beim Abschluss/Merge (`beginIntegration` → `commitWorktree`) ist der Baum wegen der untracked `.sdd/`-Dateien nicht sauber → `git add -A` + Commit → `.sdd/knowledge/index.md` und alle Inhaltsdateien erscheinen im Merge-Commit auf `main`.

**Warum die Tests das nicht fangen**: `knowledgeService.test.ts:29` legt `.git/info` als **echtes Verzeichnis** an (`mkdirSync(join(worktree, '.git', 'info'))`). Damit gelingt `ensureGitExcluded` im Test — die reale Worktree-Bedingung (`.git` = Datei) wird nicht nachgebildet. Der Test erzeugt falsche Sicherheit.

**Fix (günstig, Idiom bereits im Bestand)**: Den realen Exclude-Pfad über `git rev-parse --git-path info/exclude` im Worktree auflösen und dort schreiben — exakt dieses Muster wird schon in `mergeEngine.ts:46` (`rev-parse --git-path rebase-merge`) verwendet. Ergänzend den Service-Test auf einen echten Linked-Worktree (bzw. `.git`-Datei) umstellen, damit der Ausschluss tatsächlich verifiziert wird.

### B2 — Auto-Relevanz über-inkludiert: keine Stopwort-Filterung, Schwelle 1, Scoring gegen komplette `spec.md`

**Datei**: `packages/shared/src/knowledge.ts:204-232` (`tokenize`, `scoreRelevance`), `:95` (`DEFAULT_RELEVANCE_THRESHOLD = 1`); ausgelöst in `packages/server/src/services/knowledgeService.ts:78-92` (`suggestRelevance`, Signal = Feature-Name + **gesamte** `spec.md`).

`tokenize` behält alle Tokens mit `length >= 3` — deutsche Stopwörter wie `und`, `der`, `die`, `das`, `für`, `mit`, `bei`, `aus`, `den`, `ist` überleben also. `scoreRelevance` vergibt pro Freitext-Token-Overlap +1, und `resolveSelection` inkludiert automatisch alles mit Score ≥ 1 (Default-Schwelle).

Da das Signal ab der `plan`-Phase die **komplette `spec.md`** enthält (die zwangsläufig „bei", „und", „für" … enthält), erhält praktisch **jedes** Bundle/jeder Eintrag mit deutschem Anwendbarkeitstext Score ≥ 1 und wird als **[relevant]** markiert. Der UI-Platzhalter schlägt sogar genau so einen Text vor (`z. B. bei Auth-/Login-Themen` → enthält „bei").

**Failure-Szenario (manuell nachvollzogen)**: Ein völlig fremdes Feature-Signal, das „… bei jeder Änderung … und die Daten …" enthält, ergibt für ein unbeteiligtes Deployment-Bundle mit Text „bei Release und CI/CD" bereits Score 2 (Overlap „bei", „und") → auto-inkludiert. Bei 10 Bundles „bei …-Themen" werden nahezu alle 10 [relevant] markiert; die Phasen-Präambel weist die Session an, sie zu laden. Das verletzt **SC-003** („höchstens die k passenden Bundles inhaltlich geladen") und **FR-008** direkt und hebt den Kernnutzen (Kontext-Entlastung) auf. Der einzige Scoring-Test gegen ein Feature (`knowledgeService.test.ts:26`) maskiert das, weil dort keine `spec.md` existiert und das Signal nur „jwt login" ist.

**Empfehlung**: Stopwort-Liste (DE/EN) filtern (oder IDF-Gewichtung), das Freitext-Signal beschränken (z. B. Titel + erste Zeilen statt ganzer Spec) und/oder Default-Schwelle anheben; Tag-Treffer als Hauptsignal belassen. Ein Test mit realistischem `spec.md`-Signal sollte belegen, dass unbeteiligte Bundles Score 0 behalten.

### B3 — Auswahl/Match eines Bundles liefert keinen Wissensinhalt (kein Cascade auf Einträge)

**Datei**: `packages/server/src/services/knowledgeService.ts:104-135` (`materializeForFeature`).

Die Materialisierung iteriert Einträge und Bundles **unabhängig** und schreibt nur Elemente, deren **eigene ID** in `effective` liegt. Für ein Bundle wird ausschließlich `bundles/<id>.md` mit `# Bundle: <name>` + Anwendbarkeit + Tags geschrieben — **ohne die Bodies der enthaltenen Einträge**. Es gibt keine Weitergabe „Bundle relevant ⇒ Kind-Einträge relevant".

**Failure-Szenario**: Bundle „Auth-Regeln" (Anwendbarkeit „bei Login") enthält Eintrag „JWT-Rotation" (Body = die eigentliche Regel, Anwendbarkeit leer → laut Spec-Edge-Case „nicht automatisch laden"). Feature „login-hardening": Das Bundle matcht und wird [relevant], der Eintrag jedoch nicht → die Session bekommt nur `Bundle: Auth-Regeln, Anwendbarkeit: bei Login` — **null tatsächliches Wissen**. Ebenso, wenn der Nutzer im Feature-Dialog ein Bundle manuell auf „Ein" setzt: `FeatureKnowledgeSelect` setzt nur die Bundle-ID, die Kind-Einträge bleiben ungeladen.

Das widerspricht **US4-Akzeptanzszenario 1** („wird **der Inhalt dieses Bundles** der Session bereitgestellt") und **FR-009**. Entweder muss Bundle-Relevanz auf den Teilbaum kaskadieren, oder die Bundle-`.md` muss die (verschachtelten) Einträge einbetten.

---

## Nicht-blockierend (sollte behoben / bewusst akzeptiert werden)

### N1 — US2-Akzeptanzszenario 4 (Verschieben) über die UI nicht durchführbar

**Dateien**: `packages/web/src/components/KnowledgePanel.tsx:245,289`; `packages/web/src/api.ts` (kein `moveNode`).

Das Backend (PATCH mit `parentId`/`bundleId` + Zyklus-Guard) unterstützt Umhängen, die UI verdrahtet es aber nicht: `BundleEditor.submit` sendet beim Bearbeiten nur `{ name, applicability }` (Z.245, nie `parentId`), `EntryEditor.submit` nur `{ title, body, applicability }` (Z.289, nie `bundleId`). Die in tasks.md T023 genannte `moveNode`-Methode existiert nicht; T024 („Verschieben") ist im Frontend nicht umgesetzt. US2-Szenario 4 („einen Eintrag in ein anderes Bundle verschieben") ist damit nicht erfüllbar, obwohl die Story als erledigt markiert ist.

### N2 — Import: falscher HTTP-Status bei fehlender Datei (Contract-Abweichung)

Die Import-Route (`packages/server/src/api/server.ts`, `POST /api/projects/:id/knowledge/entries/import`) fängt **alle** Fehler aus `importFromFile` ab und wirft pauschal `httpError(400, …)`. Der Contract (`contracts/rest-api.md:56`) verlangt `404`, wenn die Datei fehlt (`Datei nicht gefunden`, `knowledgeService.ts:50`), `400` nur bei Traversal. Aktuell bekommt „Datei fehlt" 400.

### N3 — Verwaiste `knowledge_feature_selection`-Zeilen nach Löschen

Migration/`data-model.md`: `target_id` hat **keinen** FK (nur `feature_id` kaskadiert). Beim Löschen eines Bundles/Eintrags (`deleteBundle`/`deleteEntry`) bleiben zugehörige Override-Zeilen bestehen. `resolveSelection` (`knowledge.ts:238-251`) übernimmt `userIncluded`/`userExcluded` ungefiltert → `resolved.effective` kann auf gelöschte IDs verweisen. Die Materialisierung ignoriert nicht existierende IDs (kein Absturz), aber der „N aktiv"-Zähler (`FeatureKnowledgeSelect.tsx:83`) kann verfälscht sein und Waisen sind über die UI nicht mehr entfernbar (es werden nur `index.items` gerendert). Empfehlung: beim Löschen Selektionen mitentfernen oder in `resolveSelection`/UI gegen den aktuellen Index filtern.

### N4 — Materialisierte Dateien werden nie bereinigt

`materializeForFeature` schreibt/überschreibt, löscht aber nie. Nach Ausschluss/Löschen eines Eintrags bleibt `.sdd/knowledge/entries/<id>.md` im Worktree liegen. `index.md` wird vollständig neu geschrieben und ist maßgeblich (verweist nur auf [relevant]-Elemente), daher überwiegend harmlos — aber `data-model.md:169` beschreibt die Kopie als „bei jedem Phasenstart neu geschrieben", was Aufräumen impliziert. (Verschärft indirekt B1, da mehr Altlasten committet werden können.)

### N5 — `PUT /selection` emittiert kein `knowledge_updated` (Contract-Abweichung)

Die Selektions-Route schreibt in `knowledge_feature_selection`, ruft aber `knowledgeChanged` nicht auf. `contracts/rest-api.md:3` fordert: „Alle schreibenden Routen emittieren `knowledge_updated`". Für den aktuellen Single-Client-Fluss funktional folgenlos (`FeatureKnowledgeSelect` aktualisiert lokal und abonniert `knowledgeVersion` nicht), aber Contract angleichen oder Event ergänzen.

### N6 — Kurze Tags/Tokens (< 3 Zeichen) zählen nie

`tokenize` verwirft Tokens mit `length < 3`. Ein exakter Tag wie `ci` oder `qa` erzeugt eine leere Token-Menge und wird durch den Guard `tagTokens.size > 0` (`knowledge.ts:222`) nie gematcht — obwohl Tags laut Spec „Exakttreffer" sein sollen. Für kurze, valide Tags geht Relevanz verloren. (Test `knowledge.test.ts:119` nutzt `ci` und erwartet Score 0 — die Einschränkung ist mitgetestet, inhaltlich aber fragwürdig.)

### N7 — `buildKnowledgeTree` ohne Schutz gegen vorbestehende Zyklen

`buildKnowledgeTree` (`knowledge.ts:109-134`) hat keinen Zyklus-Schutz: Ein 2-Zyklus (a↔b) in den Rohdaten führt dazu, dass **keiner** der beiden als Wurzel landet → beide (samt Einträgen) verschwinden lautlos aus Baum und Index. Über die API nicht erzeugbar (Create baut keinen Zyklus, Update prüft via `detectCycle`), also nur bei DB-Korruption relevant — niedrige Priorität, aber ein Fallback (übrig gebliebene Knoten als Wurzeln anhängen) wäre konsistent mit dem sonst defensiven Stil (`:61` behandelt unbekannte Parents bereits als Wurzel).

### N8 — `refreshEntry` schluckt Fehler stillschweigend

`KnowledgePanel.tsx:172`: `onClick={() => void api.refreshEntry(entry.id)}` — anders als alle übrigen Aufrufe (mit `.catch(e => dispatch({ type: 'error', … }))`) wird ein Fehler (z. B. gelöschte Quelldatei) nicht angezeigt. UX-/Konsistenz-Kleinigkeit.

### N9 — Latenter Footgun: Materialisierung nach `project.path` bei fehlendem Worktree

`knowledgeService.ts:106` nutzt `feature.worktreePath ?? project.path`. Fällt der Fallback, würde `.sdd/knowledge/` ins Haupt-Repo geschrieben und dort `.git/info/exclude` angefasst. Aktuell **nicht erreichbar** (REST-Endpoint prüft `409` bei fehlendem Worktree; der Orchestrator ruft erst nach `ensureSession` auf, das den Worktree garantiert und persistiert). Da der Service öffentlich ist, wäre ein defensiver Guard (Fehler statt stiller Fallback) robuster.

---

## Positiv hervorzuheben

- Konsequentes Cross-Projekt-Scoping bei allen Parent-/Bundle-Zuordnungen (`server.ts` PATCH/POST) → FR-002/SC-004.
- Pfad-Guard `safeRepoRelative` (`knowledgeService.ts:161-172`) deckt absolute Pfade, `..`-Segmente und Ausbruch aus dem Projekt sauber ab.
- Index als reine Projektion → automatische Konsistenz ohne separaten Schreibpfad (FR-006/SC-005), gut getestet (`knowledge.test.ts:92`).
- `detectCycle` mit `seen`-Set gegen Hängenbleiben bei vorbestehenden Zyklen; robuste Row-Mapper (`parseTags` try/catch, Enum-Normalisierung).
- Best-effort-Materialisierung im Orchestrator mit try/catch: Wissen kann eine Phase nie blockieren (`orchestrator.ts:267-277`).
- WS-Event `knowledge_updated` sauber in `BUS_EVENT_NAMES` und Store-Reducer integriert; UI refetcht via Versionszähler.

> Anmerkung/Korrektur: Der Ansatz „`.git/info/exclude` statt Repo-`.gitignore`" ist konzeptionell richtig (Nutzer-Repo unangetastet), in der aktuellen Umsetzung aber in echten Worktrees wirkungslos — siehe B1.

---

## Fazit

Die Architektur ist gut, aber B1 (materialisiertes `.sdd/` wird committet und gemergt — Verstoß gegen die Kern-Rahmenbedingung, im Normalablauf reproduzierbar), B2 (Auto-Auswahl inkludiert real fast alles) und B3 (Bundle-Auswahl liefert keinen Inhalt) untergraben zentrale Zusagen und den eigentlichen Zweck des Features (US4, selektives Laden, SC-003) und müssen vor dem Merge adressiert werden. Die Punkte N1 (US2-Verschieben fehlt) und N2/N3/N5 (Contract-/Konsistenz-Abweichungen) sollten ebenfalls behoben werden.

VERDICT: FAIL
