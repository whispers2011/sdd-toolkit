# Code-Review: Feature `projektspezifisches-wissen`

- **Branch**: `feature/projektspezifisches-wissen`
- **Vergleich**: `git diff` gegen Merge-Base `2d1c2d8` (Default-Branch `main`)
- **Reviewer-Modus**: adversarial (aktiv Fehler suchen)
- **Umfang**: 31 Dateien, +2975 / −4 (Server-API, DB-Migration, KnowledgeRepo/-Service, Shared-Logik, Web-UI, Spec-Artefakte)
- **Hinweis**: `pnpm typecheck` / `pnpm test` konnten in dieser Session nicht ausgeführt werden (Permission-Prompt verweigert). Das Review beruht auf statischer Analyse; ein grüner CI-Lauf ist zusätzlich zu verifizieren.

## Gesamteindruck

Solide, sauber geschnittene Implementierung: klare Trennung von purer Logik (`packages/shared/src/knowledge.ts`), Persistenz (`knowledgeRepo.ts`), IO/Materialisierung (`knowledgeService.ts`) und API. Namensgebung, Migrations-, Event- und Fehler-Konventionen folgen dem Bestand. Pfad-Guards gegen Traversal sind vorhanden, Cross-Projekt-Scoping wird konsequent geprüft, der Index ist als reine Projektion by-construction konsistent (FR-005/FR-006/SC-005). Tests decken Baum, Zyklus, Index, Scoring, Repo-CRUD/Cascade und Materialisierung ab.

Es gibt jedoch **zwei funktionale Mängel im Kern des Features (US4 / selektives Laden)**, die vor dem Merge behoben werden sollten, plus mehrere kleinere Punkte.

---

## Blocker (müssen vor Merge behoben werden)

### B1 — Auto-Relevanz über-inkludiert: keine Stopwort-Filterung, Schwelle 1, Scoring gegen komplette `spec.md`

**Datei**: `packages/shared/src/knowledge.ts:204-232` (`tokenize`, `scoreRelevance`), `:95` (`DEFAULT_RELEVANCE_THRESHOLD = 1`); ausgelöst in `packages/server/src/services/knowledgeService.ts:78-92` (`suggestRelevance`, Signal = Feature-Name + **gesamte** `spec.md`).

`tokenize` behält alle Tokens mit `length >= 3` — deutsche Stopwörter wie `und`, `der`, `die`, `das`, `für`, `mit`, `bei`, `aus`, `den`, `ist` überleben also den Filter. `scoreRelevance` vergibt pro Freitext-Token-Overlap +1, und `resolveSelection` inkludiert automatisch alles mit Score ≥ 1 (Default-Schwelle).

Da das Relevanz-Signal ab der `plan`-Phase die **komplette `spec.md`** enthält (die zwangsläufig Wörter wie „bei", „und", „für" enthält), erhält praktisch **jedes** Bundle/jeder Eintrag mit deutschem Freitext-Anwendbarkeitstext einen Score ≥ 1 und wird automatisch als **[relevant]** markiert. Der Platzhalter im UI schlägt sogar genau so einen Text vor (`z. B. bei Auth-/Login-Themen` → enthält „bei").

**Failure-Szenario**: Projekt mit 10 Bundles, jeweils Anwendbarkeit „bei …-Themen". Feature „export-csv" starten → `materializeForFeature` (vom Orchestrator bei jedem Phasenstart aufgerufen, `orchestrator.ts:177/251/267`) markiert nahezu alle 10 Bundles [relevant] und die Prompt weist die Session an, sie alle zu laden. Das verletzt **SC-003** („höchstens die k passenden Bundles inhaltlich geladen") und **FR-008** direkt und hebt den zentralen Nutzen des Features (Kontext-Entlastung) auf. Der einzige Test, der Scoring gegen ein Feature prüft (`knowledgeService.test.ts:26`), maskiert das, weil dort keine `spec.md` existiert und das Signal nur „jwt login" ist.

**Empfehlung**: Stopwort-Liste ergänzen (oder Mindestlänge/IDF-Gewichtung), das Freitext-Signal beschränken (z. B. Titel + erste Zeilen statt der ganzen Spec) und/oder Default-Schwelle anheben. Ein Test mit realistischem `spec.md`-Signal sollte belegen, dass unbeteiligte Bundles Score 0 behalten.

### B2 — Auswahl/Match eines Bundles liefert keinen Wissensinhalt (kein Cascade auf Einträge)

**Datei**: `packages/server/src/services/knowledgeService.ts:104-135` (`materializeForFeature`).

Die Materialisierung iteriert Einträge und Bundles **unabhängig** und schreibt nur Elemente, deren **eigene ID** in `effective` liegt. Für ein Bundle wird ausschließlich `bundles/<id>.md` mit `# Bundle: <name>` + Anwendbarkeit + Tags geschrieben — **ohne die Bodies der enthaltenen Einträge**. Es gibt keine Weitergabe „Bundle relevant ⇒ Kind-Einträge relevant".

**Failure-Szenario**: Bundle „Auth-Regeln" mit Anwendbarkeit „bei Login" enthält Eintrag „JWT-Rotation" (Body = die eigentliche Regel, Anwendbarkeit leer → laut Spec-Edge-Case „nicht automatisch laden"). Feature „login-hardening": das Bundle matcht und wird [relevant], der Eintrag jedoch nicht (leere Anwendbarkeit) → die Session bekommt nur `Bundle: Auth-Regeln, Anwendbarkeit: bei Login` — **null tatsächliches Wissen**. Dasselbe gilt, wenn der Nutzer im Feature-Dialog ein Bundle manuell auf „Ein" setzt: `FeatureKnowledgeSelect` setzt nur die Bundle-ID, die Kind-Einträge bleiben ungeladen.

Das widerspricht **US4-Akzeptanzszenario 1** („wird **der Inhalt dieses Bundles** der Session bereitgestellt") und **FR-009**. Entweder muss Bundle-Relevanz auf den Teilbaum kaskadieren, oder die Bundle-`.md` muss die (verschachtelten) Einträge einbetten.

---

## Nicht-blockierend (sollte behoben / bewusst akzeptiert werden)

### N1 — Import: falscher HTTP-Status bei fehlender Datei (Contract-Abweichung)

`packages/server/src/api/server.ts:614-641`: Der Import fängt **alle** Fehler aus `importFromFile` ab und wirft pauschal `httpError(400, …)`. Der Contract (`contracts/rest-api.md:56`) verlangt `404`, wenn die Datei fehlt (`Datei nicht gefunden`, `knowledgeService.ts:50`), `400` nur bei Traversal. Aktuell bekommt „Datei fehlt" 400. Kleiner, aber vom eigenen Contract abweichender Fund.

### N2 — Verwaiste `knowledge_feature_selection`-Zeilen nach Löschen

`data-model.md`/Migration: `target_id` hat **keinen** FK (nur `feature_id` kaskadiert). Beim Löschen eines Bundles/Eintrags (`deleteBundle`/`deleteEntry`) bleiben zugehörige Override-Zeilen bestehen. `resolveSelection` (`knowledge.ts:238-251`) übernimmt `userIncluded`/`userExcluded` ungefiltert aus den Selektionen → `resolved.effective`/`userIncluded` können auf gelöschte IDs verweisen. Die Materialisierung ignoriert nicht existierende IDs (kein Absturz), aber der „N aktiv"-Zähler im UI (`FeatureKnowledgeSelect.tsx:83`) kann verfälscht sein, und über die UI sind solche Waisen nicht mehr entfernbar (nur `index.items` werden gerendert). Empfehlung: beim Löschen die Selektionen mitentfernen, oder in `resolveSelection`/UI gegen den aktuellen Index filtern.

### N3 — Materialisierte Dateien werden nie bereinigt

`materializeForFeature` schreibt/überschreibt, löscht aber nie. Nach Ausschluss oder Löschen eines Eintrags bleibt dessen `.sdd/knowledge/entries/<id>.md` im Worktree liegen. `index.md` wird vollständig neu geschrieben und ist maßgeblich (verweist nur auf [relevant]-Elemente), daher überwiegend harmlos — aber `data-model.md:169` beschreibt die Kopie als „bei jedem Phasenstart neu geschrieben", was Aufräumen impliziert. Stale Dateien sind zumindest verwirrend.

### N4 — Latenter Footgun: Materialisierung nach `project.path` bei fehlendem Worktree

`knowledgeService.ts:106` nutzt `feature.worktreePath ?? project.path`. Fällt der Fallback, würde `.sdd/knowledge/` ins Haupt-Repo geschrieben und `.git/info/exclude` dort verändert. Aktuell **nicht erreichbar** (REST-Endpoint prüft `409` bei fehlendem Worktree, `server.ts:663`; der Orchestrator ruft erst nach `ensureSession` auf, das den Worktree garantiert und persistiert). Da der Service aber öffentlich ist, wäre ein defensiver Guard (Fehler statt stiller Fallback) robuster.

### N5 — Kurze Tags/Tokens (< 3 Zeichen) zählen nie

`tokenize` verwirft Tokens mit `length < 3`. Ein exakter Tag wie `ci` oder `qa` erzeugt eine leere Token-Menge und wird durch den Guard `tagTokens.size > 0` (`knowledge.ts:222`) nie gematcht — obwohl Tags laut Spec „Exakttreffer" sein sollen. Für kurze, aber valide Tags geht Relevanz verloren. (Test `knowledge.test.ts:119` nutzt genau `ci` und erwartet Score 0 — die Einschränkung ist also mitgetestet, aber inhaltlich fragwürdig.)

### N6 — Robustheit gegen vorbestehende Zyklen im Baumaufbau

`buildKnowledgeTree` (`knowledge.ts:109-134`) hat keinen Zyklus-Schutz: Ein 2-Zyklus (a↔b) in den Rohdaten führt dazu, dass **keiner** der beiden als Wurzel landet → beide (und ihre Einträge) verschwinden lautlos aus Baum und Index. Über die API nicht erzeugbar (Create kann keinen Zyklus bauen, Update prüft via `detectCycle`), also nur bei DB-Korruption relevant — daher niedrige Priorität, aber ein defensiver Fallback (übrig gebliebene Knoten als Wurzeln anhängen) wäre konsistent mit dem sonst defensiven Stil (`:61` behandelt unbekannte Parents bereits als Wurzel).

---

## Positiv hervorzuheben

- Konsequentes Cross-Projekt-Scoping bei allen Parent-/Bundle-Zuordnungen (`server.ts` PATCH/POST) → FR-002/SC-004.
- Pfad-Guard `safeRepoRelative` (`knowledgeService.ts:161-172`) deckt absolute Pfade, `..`-Segmente und Ausbruch aus dem Projekt sauber ab.
- Index als reine Projektion → automatische Konsistenz ohne separaten Schreibpfad (FR-006/SC-005) — gut getestet (`knowledge.test.ts:92`).
- Best-effort-Materialisierung im Orchestrator mit try/catch: Wissen kann eine Phase nie blockieren (`orchestrator.ts:267-275`).
- `.git/info/exclude` statt Repo-`.gitignore` anzufassen — respektiert das Nutzer-Repo.
- WS-Event `knowledge_updated` sauber in `BUS_EVENT_NAMES` und Store-Reducer integriert; UI refetcht via Versionszähler.

---

## Fazit

Die Architektur ist gut, aber die beiden Kernmängel B1 (Auto-Auswahl inkludiert real fast alles) und B2 (Bundle-Auswahl liefert keinen Inhalt) untergraben den eigentlichen Zweck des Features (US4, selektives Laden, SC-003) und sind im primären Ablauf tatsächlich wirksam. Sie müssen vor dem Merge adressiert werden.

VERDICT: FAIL
