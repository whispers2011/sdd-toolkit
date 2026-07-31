# Quickstart: Abnahme von „Ehrlichkeit vor dem Merge"

Wie man nachweist, dass das Feature tut, was die Spezifikation verlangt. Zwei Teile: automatisierte
Prüfungen (schnell, deckt Texte und Lebensdauern ab) und vier Sichtprüfungen in der Oberfläche
(dort ist der Wortlaut die Abnahme).

Details der Verträge: [`contracts/domain.md`](./contracts/domain.md),
[`contracts/http.md`](./contracts/http.md). Zustände und Regeln: [`data-model.md`](./data-model.md).

---

## 0. Voraussetzungen

```sh
pnpm install          # einmalig
pnpm typecheck        # muss grün sein, BEVOR etwas anderes geprüft wird
pnpm test
```

`pnpm typecheck` ist hier keine Formalie, sondern die erste Abnahme von FR-001a: die neue
Integrationsstufe muss den Typecheck in `INTEGRATION_STAGE_META`, `STAGE_CLASS`,
`INTEGRATION_STAGE_ORIGIN` und `KIND_META` brechen, solange dort eine Beschriftung fehlt. Wer die
Stufe einführt und `pnpm typecheck` bleibt grün, hat einen der Kataloge nicht getroffen.

### Eigene Testinstanz (nur für die Sichtprüfungen)

Auf dem Rechner läuft bereits eine Toolkit-Instanz auf 4820/4830 — **die nicht anfassen**
(`CLAUDE.md`). Eigene Ports und eigenes Datenverzeichnis:

```sh
SDD_PORT=4899 SDD_WEB_PORT=4898 SDD_DATA_DIR=/tmp/sdd-abnahme-ehrlichkeit pnpm dev
# Oberfläche: http://127.0.0.1:4898
```

Abräumen ausschließlich über den eigenen Port — niemals `pkill -f vite`/`node`/`pnpm`:

```sh
lsof -ti:4899 | xargs kill
lsof -ti:4898 | xargs kill
```

---

## 1. Automatisierte Prüfungen

```sh
pnpm --filter @sdd/shared test    # Texte, Kosten pro Aufgabe, Stufen-Exhaustiveness
pnpm --filter @sdd/server test    # Lebensdauer des Projekt-Eintrags, Stage-Kopplung
```

Erwartete Abdeckung (Testdatei → geprüfte Anforderung):

| Test | Prüft |
|---|---|
| `shared/integrationMessages.test.ts` | FR-003, FR-012, FR-012a, FR-013 und INV-4 (Wortlaut für konfigurierte Projekte unverändert) — inkl. `0/0` und `tasksDone > tasksTotal` |
| `shared/runSummary.test.ts` | FR-017 (Durchreichung), FR-019/FR-020/FR-021 über `costPerTask()`: 0 erledigt ⇒ `null`, kein Betrag ⇒ `null`, unvollständig ⇒ `incomplete: true` |
| `shared/workflowModel.test.ts`, `shared/actionPolicy.test.ts` | neue Stufe hat Label und Klasse; die Tests iterieren über `Object.keys(INTEGRATION_STAGE_META)` und erfassen sie automatisch |
| `server/services/verificationGap.test.ts` | FR-004, FR-005, FR-006, FR-007 und die Clarification zum Abhaken (siehe Matrix unten) |
| `server/services/mergeQueueService.attention.test.ts` | ein Stufenwechsel eines Features lässt den projektbezogenen Eintrag unberührt (FR-006) |
| `server/services/attentionReconciler.test.ts` | die neue Art ist nicht stage-gekoppelt und übersteht einen Neustart |

Matrix, die `verificationGap.test.ts` abdecken muss:

| Ausgangslage | Vorgang | Erwartung |
|---|---|---|
| `verifyCommands: []`, kein Eintrag | erster Integrationsversuch erreicht die Verifikation | genau **ein** offener Eintrag, `featureId === null` |
| Eintrag offen | zweites und drittes Feature integrieren | **kein** weiterer Eintrag |
| Eintrag offen | Feature wandert `verification_unconfigured → queued → merged` | Eintrag bleibt offen |
| Eintrag offen | `verifyCommands` erhält ein Kommando, Reconcile läuft | Eintrag ist weg, ohne dass jemand abgehakt hat |
| Eintrag abgehakt, `verifyCommands: []` | weiteres Feature integrieren | **kein** neuer Eintrag (Erinnerung wurde verzichtet) |
| Eintrag abgehakt, `verifyCommands: []` | Stufe und Meldung des Features prüfen | weiterhin `verification_unconfigured`, Meldung nennt die fehlende Verifikation |
| `verifyCommands` gefüllt, dann wieder geleert | nächster Integrationsversuch | Eintrag entsteht erneut |

---

## 2. Sichtprüfung A — Projekt ohne Verifikation (Story 1, SC-001/SC-002/SC-005)

**Aufbau**: Projekt hinzufügen, in den Projekt-Einstellungen `verifyCommands` **leer** lassen,
Auto-Merge **aus**. Ein Feature bis `implement` freigeben (mindestens eine Aufgabe in `tasks.md`
abgehakt, sonst greift die bestehende Mindesthürde) und „Integrieren" auslösen.

Zu prüfen:

1. **Board** (`KanbanBoard`): die Stufe der Kachel liest „keine Verifikation konfiguriert" in Amber.
   Nirgends „Verifikation läuft".
2. **Braucht dich** (`AttentionInbox`): genau ein Eintrag „Verifikation fehlt — Projekt hat keine
   Verifikation konfiguriert …". Ein zweites Feature desselben Projekts integrieren ⇒ es bleibt bei
   einem Eintrag.
3. **Review & Änderungen** (`ReviewOverview`): die Zeile zeigt `Verify nicht konfiguriert` —
   sichtbar anders als bei einem Projekt mit Kommandos, das noch nicht gelaufen ist
   (`Verify – (kein Lauf)`).
4. **Review-Portal**, Reiter *Tests*: „Für dieses Projekt ist keine Verifikation konfiguriert — es
   wurde nichts geprüft." (nicht die alte, leere Ansicht). Kopfzeile: `Verify nicht konfiguriert`.
5. **Meldung zum Review**: der Eintrag „Review fällig" enthält nicht das Wort „verifiziert",
   sondern benennt die fehlende Verifikation.
6. **Durchlauf ungehindert**: „Freigeben & Integrieren" führt bis „gemergt" — nichts wurde
   gesperrt, verzögert oder eskaliert (SC-005).
7. **Auflösung**: in den Projekt-Einstellungen ein Verify-Kommando hinterlegen, Ansicht neu laden ⇒
   der Eintrag ist ohne Zutun verschwunden (SC-002).
8. **Rückblick** (FR-001a): das gemergte Feature in der Läufe-Ansicht zeigt weiterhin die Stufe
   „keine Verifikation konfiguriert" bzw. „gemergt" — nie „verifiziert", auch nachdem Kommandos
   konfiguriert wurden.

**Gegenprobe (FR-011)**: dasselbe mit einem Projekt **mit** Verify-Kommandos. Stufenanzeigen,
Meldungswortlaut zur Verifikation und Aufmerksamkeits-Liste sind identisch zu vorher — die einzige
Änderung ist der angehängte Aufgabenstand.

---

## 3. Sichtprüfung B — Aufgabenstand an der Entscheidungsstelle (Story 2, SC-003/SC-004)

**Aufbau**: Feature mit teilweise abgehakter `tasks.md` (z. B. 68 von 76), Auto-Merge **aus**,
integrieren.

1. Meldung „Review fällig" nennt `68/76 erledigt, 8 offen`.
2. Review-Portal beim Öffnen (kein Reiterwechsel, kein Klick): Kopf-Kennzahl `Aufgaben 68/76`,
   offene Aufgaben amber hervorgehoben (FR-014/FR-015).
3. Freigabe funktioniert unverändert — die Anzeige informiert, sie sperrt nicht (FR-016).
4. Feature mit vollständiger Liste (76/76): „keine offen", keine Hervorhebung.
5. Feature ohne `tasks.md` (0/0): „keine Aufgabenliste vorhanden" — nicht „0/0".
6. Feature mit vorhandener Liste, aber keiner erledigten Aufgabe: Integration startet **nicht**
   (bestehende Mindesthürde, unverändert).
7. **Auto-Merge-Pfad**: Auto-Merge **an**, Feature mit 68/76 integrieren. Es entsteht keine
   Review-Meldung; die Meldung „Feature gemergt" trägt `… → main · 68/76 erledigt, 8 offen`
   (FR-012a).

---

## 4. Sichtprüfung C — Läufe mit Bezugsgrösse (Story 3, SC-006/SC-007)

**Aufbau**: zwei Läufe desselben Projekts mit deutlich unterschiedlicher Aufgabenzahl und
gemeldeten Beträgen; Ansicht *Läufe* öffnen.

1. Jede Zeile zeigt ohne Aufklappen den Aufgabenstand (z. B. `68/76`) als eigene Angabe.
2. Jede Zeile zeigt die Kosten pro erledigter Aufgabe; zwei Läufe mit ähnlichem Gesamtbetrag und
   sehr unterschiedlicher Aufgabenzahl unterscheiden sich hier sichtbar (SC-007).
3. Lauf aufklappen: das Dashboard nennt denselben Wert (FR-019).
4. Lauf ohne erledigte Aufgabe: bei Kosten pro Aufgabe steht ein **Strich** — kein Wert, keine
   Schätzung, keine Fehlermeldung.
5. Lauf mit Ausführungen ohne gemeldeten Betrag: der Wert ist als unvollständig gekennzeichnet.
6. Lauf ohne `tasks.md`: „keine Aufgabenliste" statt „0 von 0 erledigt".
7. Archiviertes Feature: dieselben Angaben (Edge Case).
8. **Feature-Dashboard** (`FeatureDashboard`): dieselbe Karte, dieselben Werte — sie kommen aus
   derselben Komponente.

---

## 5. Abschlussprüfung: keine neue Erhebung (SC-008)

```sh
# Es darf keine neue Zähl-/Messstelle entstanden sein:
git diff main --stat -- packages/server/src/telemetry packages/shared/src/costMeter.ts \
  packages/shared/src/transcriptUsage.ts packages/shared/src/telemetryAttribution.ts
# erwartet: keine Ausgabe

# Und keine neue Route/kein neues Ereignis:
git diff main -- packages/server/src/api/server.ts | grep -E '^\+\s*app\.(get|post|patch|delete)'
# erwartet: keine Ausgabe
```

Ebenso darf `git diff main -- packages/server/src/db/database.ts` leer sein — dieses Feature braucht
keine Migration (`research.md` D10).
