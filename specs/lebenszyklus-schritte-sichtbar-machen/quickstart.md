# Quickstart / Validierung: Lebenszyklus-Schritte sichtbar machen

Nachweis, dass das Feature end-to-end funktioniert. Verträge:
[lifecycle-catalog.md](./contracts/lifecycle-catalog.md), [ui-contract.md](./contracts/ui-contract.md);
Datenmodell: [data-model.md](./data-model.md); Entscheidungen: [research.md](./research.md).

## Voraussetzungen

- Node ≥ 22, pnpm 10
- Abhängigkeiten installiert: `pnpm install` **im Worktree** — das Toolkit installiert sie
  nicht (genau die Nicht-Zuständigkeit, die dieses Feature dokumentiert)
- Web-UI: entweder die bereits laufende Toolkit-Instanz (<http://localhost:4830>) oder eine
  eigene Instanz auf **freien** Ports
- Mindestens ein Projekt im Toolkit; ein Feature ist **nicht** erforderlich (Stufe 3 prüft
  genau das)

> **Achtung beim Aufräumen einer eigenen Instanz**: Prozesse nur gezielt über den eigenen Port
> oder die gemerkte PID beenden (`lsof -ti:<port> | xargs kill`). Kein `pkill -f vite`/`node`/
> `tsx` — die eigene Session ist Kindprozess der laufenden Toolkit-Instanz und stirbt mit.

---

## Stufe 1: Automatisierte Checks

```bash
pnpm -r typecheck && pnpm -r test
```

**Erwartung**: grün. Neu bzw. relevant:

| Testdatei | Deckt ab |
|---|---|
| `packages/shared/src/lifecycleCatalog.test.ts` | Vollständigkeit aller fünf Stufen (FR-003), ≥ 1 Schritt je Stufe und nicht-leere Pflichtfelder (FR-011), Längengrenzen und eindeutige Schritt-`id`s, Pfadform ohne Zeilennummern (FR-012), Abdeckung von `FEATURE_PHASES` und `IntegrationStage` (FR-010), Reihenfolge der Integrations-Schritte (FR-007), Vorhandensein von `orderNote` am Schritt „Worktree festschreiben" (FR-009) und `notDoneHere` an der Worktree-Anlage (FR-004) |
| `packages/server/src/services/lifecycleCatalogPaths.test.ts` | Jede genannte Datei existiert im Repository, jedes Symbol-Endglied kommt darin vor; Fehlermeldung nennt Stufe + Schritt (SC-004, US2-AS4) |
| bestehende Suites | insbesondere `packages/shared/src/workflowModel.test.ts` unverändert grün (SC-006) |

---

## Stufe 2: Drift-Guard beweisen (US2, SC-003)

Der Guard ist erst belegt, wenn er auch wirklich bricht. Drei Eingriffe, jeder einzeln und
danach **vollständig zurückgenommen**.

### 2a — Neue Feature-Phase (US2-AS1)

```bash
# packages/shared/src/types.ts: FEATURE_PHASES um 'review' erweitern
pnpm -r typecheck
```

**Erwartung**: Fehler **in `packages/shared/src/lifecycleCatalog.ts`** an
`PHASE_LIFECYCLE_STAGES` („Property 'review' is missing"). Zusätzlich bricht wie bisher
`PHASE_META` in `workflowModel.ts` — der neue Fehler am Katalog ist der hier geforderte.

```bash
git checkout -- packages/shared/src/types.ts
```

### 2b — Neue Integrations-Stufe (US2-AS2)

```bash
# packages/shared/src/types.ts: IntegrationStage um | 'canary_check' erweitern
pnpm -r typecheck
```

**Erwartung**: Fehler in `lifecycleCatalog.ts` an `INTEGRATION_STAGE_ORIGIN`.

```bash
git checkout -- packages/shared/src/types.ts
```

### 2c — Leerer Katalogeintrag und toter Code-Ort (US2-AS3, US2-AS4)

```bash
# 1) In lifecycleCatalog.ts die description eines Schritts auf '' setzen
pnpm --filter @sdd/shared test
#    Erwartung: lifecycleCatalog.test.ts schlägt fehl und nennt den Schritt.

# 2) Stattdessen einen location.file auf 'packages/server/src/gibtesnicht.ts' setzen
pnpm --filter @sdd/server test
#    Erwartung: lifecycleCatalogPaths.test.ts schlägt fehl und nennt Stufe + Schritt.

# 3) Stattdessen ein location.symbol auf 'wurdeUmbenannt' setzen
pnpm --filter @sdd/server test
#    Erwartung: derselbe Test schlägt fehl (Symbol nicht in der Datei gefunden).

git checkout -- packages/shared/src/lifecycleCatalog.ts
```

---

## Stufe 3: Anzeige ohne ausgewähltes Feature (US1-AS7, FR-015)

1. Web-UI öffnen → Projekt wählen → **Workflow**.
2. Geltung auf **„Projekt-Standard (global + Projekt)"** stellen.
3. Netzwerk-Panel der DevTools öffnen und **leeren**, dann die Ansicht neu laden.

**Erwartung**:
- Alle fünf Aufklapp-Zeilen sind vorhanden und tragen eine Schrittanzahl.
- Jede Liste lässt sich vollständig lesen, obwohl kein Feature gewählt ist.
- **Keine zusätzliche Anfrage** gegenüber dem Stand vor der Änderung (SC-006): weiterhin nur
  die bestehenden Aufrufe (`/api/agents`, `/api/knowledge`, `/api/state`). Kein Aufruf enthält
  „lifecycle" oder „catalog".

---

## Stufe 4: Inhalte je Stufe (US1-AS1…AS5)

Jeweils aufklappen und prüfen, dass Name, Beschreibung, „Wann:" und der Code-Ort dastehen.

| Stufe | Ort in der Ansicht | Muss enthalten |
|---|---|---|
| **Worktree-Anlage** | Karte „User-Prompt" (Feature-Anlage) | serialisiertes, idempotentes Anlegen (je Repo und Branch), Aufräumen verwaister Registry-Einträge, Wiederholversuch bei Wettlauf, Spiegeln der Agent-Konfiguration (FR-004, US1-AS1) |
| **Phasenstart** | jede Phasen-Karte | Kontext-Reset, Wissens-Präambel, Dokument-Verweise, Bauen des Slash-Kommandos (FR-005, US1-AS2) |
| **Phasenende** | jede Phasen-Karte | Verbrauchsmessung, Festhalten der Transkript-Grenzen, erneutes Zählen der Aufgaben aus `tasks.md` (FR-006, US1-AS3) |
| **Integration** | Kopf des Integrations-Blocks | genau diese Reihenfolge: Worktree festschreiben → Zustand mit Git abgleichen → Verify-Kommandos → Review-Gate-Agents → Review-Berichte committen → Queue bzw. Warten auf menschliches Review (FR-007, US1-AS4) |
| **Merge** | Schritt-Pill „Merge-Queue" | Rebase auf das Ziel, headless Konfliktauflösung (begrenzte Versuche), erneute Verifikation, Merge nach Strategie (fast-forward/squash), Abschluss: Session beenden, Worktree entfernen, Worktree-Pfad leeren (FR-008, US1-AS5) |

Zusätzlich (US3):
- **Integration → „Worktree festschreiben"**: Der abgesetzte Reihenfolge-Hinweis nennt, dass
  dieser Schritt **vor** dem Git-Abgleich stehen MUSS, und die Folge der Umkehrung (der Branch
  gilt ohne eigenen Commit als bereits gemergt ⇒ jede Integration eskaliert) — US3-AS1, SC-005.
- **Worktree-Anlage**: „Nicht Aufgabe des Toolkits" nennt die Installation von Abhängigkeiten
  als Sache des Agents — US3-AS2.

---

## Stufe 5: Aufklapp-Verhalten und Kompaktheit (US1-AS6, FR-014, SC-002, SC-007)

1. Ansicht frisch laden → **alle** Listen sind zugeklappt.
2. Seitenhöhe/Scrollposition mit dem Stand vor der Änderung vergleichen: identisch bis auf die
   fünf Umschaltzeilen (SC-007).
3. Eine Stufe aufklappen → nur diese öffnet sich; die anderen bleiben zu (auch die zweite
   Disclosure derselben Phasen-Karte und die gleichnamigen Stufen anderer Phasen).
4. Dieselbe Stufe erneut anklicken → sie ist wieder zu, die Übersicht so kompakt wie vorher
   (US1-AS6).
5. Ansicht wechseln und zurückkehren → wieder zugeklappt (Aufklappzustand ist flüchtig).
6. Fenster auf ~900 px Breite verkleinern → kein horizontales Scrollen; lange Dateipfade
   brechen um.
7. Zwei Interaktionen genügen für jede Stufe: Übersicht öffnen, Stufe aufklappen (SC-002).

---

## Stufe 6: Keine Verhaltensänderung (FR-016, SC-006)

```bash
git diff --stat main...HEAD
```

**Erwartung**: Geändert werden ausschließlich
`packages/shared/src/lifecycleCatalog.ts` (neu), `packages/shared/src/lifecycleCatalog.test.ts`
(neu), `packages/shared/src/index.ts` (eine Export-Zeile),
`packages/server/src/services/lifecycleCatalogPaths.test.ts` (neu),
`packages/web/src/components/WorkflowOverview.tsx` (additiv) sowie die Spec-Artefakte.

**Nicht** verändert: `orchestrator.ts`, `mergeQueueService.ts`, `worktrees.ts`,
`workflowModel.ts`, Datenbank, API-Routen, WS-Events, `package.json`-Abhängigkeiten.

Funktionaler Gegencheck an einem echten Feature (falls eines vorliegt): eine Phase starten und
abschließen — Ablauf, Kosten und Statusanzeigen verhalten sich wie zuvor.

---

## Abnahme-Matrix

| Kriterium | Stufe |
|---|---|
| SC-001 (alle fünf Stufen lesbar, mit Name/Beschreibung/Zeitpunkt/Ort) | 4 |
| SC-002 (höchstens zwei Interaktionen) | 5 |
| SC-003 (100 % Abdeckung der Domänen-Aufzählungen, Guard bricht) | 1, 2 |
| SC-004 (alle Code-Orte existieren, automatisiert geprüft) | 1, 2c |
| SC-005 (Reihenfolge-Begründung sichtbar und testgesichert) | 1, 4 |
| SC-006 (keine Verhaltensänderung, keine zusätzlichen Anfragen) | 1, 3, 6 |
| SC-007 (Kompaktheit zugeklappt) | 5 |
