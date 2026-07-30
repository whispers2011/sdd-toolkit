# Quickstart — Validierung

**Feature**: Eigene Schritte an den Lebenszyklus hängen · **Datum**: 2026-07-30

Nachweisführung für die Akzeptanzszenarien und Erfolgskriterien der
[Spezifikation](./spec.md). Verträge nicht hier duplizieren — siehe
[contracts/lifecycle-triggers.md](./contracts/lifecycle-triggers.md),
[contracts/http-api.md](./contracts/http-api.md), [data-model.md](./data-model.md).

---

## 0. Voraussetzungen

```sh
pnpm install
pnpm -r typecheck
pnpm -r test
```

Beides muss **grün** sein, bevor manuell geprüft wird.

### Eigene Test-Instanz (Pflicht)

Die laufende Toolkit-Instanz belegt 4820/4830 und **deine Session ist ihr Kindprozess**
(siehe `CLAUDE.md`). Niemals `pkill -f vite`/`pkill -f tsx` — das beendet die eigene Arbeit.
Immer eigene Ports und ein eigenes Datenverzeichnis:

```sh
export SDD_PORT=4899 SDD_WEB_PORT=4898 SDD_DATA_DIR="$(mktemp -d)/sdd-test"
pnpm dev            # → Web auf http://127.0.0.1:4898
```

Abräumen ausschließlich über den eigenen Port:

```sh
lsof -ti:4899 | xargs -r kill
lsof -ti:4898 | xargs -r kill
```

Ein Wegwerf-Projekt für die Läufe:

```sh
mkdir -p /tmp/sdd-demo && cd /tmp/sdd-demo && git init -b main \
  && git commit --allow-empty -m init
```

Im Web-UI dieses Verzeichnis als Projekt hinzufügen.

---

## 1. US1 — Kommando nach der Worktree-Anlage (P1, Abnahmebedingung)

**Einrichten** (Ziel SC-001: unter 2 Minuten, keine Datei im Repository bearbeiten):

Sidebar → Projektzeile → Icon **Lebenszyklus-Schritte** → Abschnitt „Projekt: …" →
`+ Schritt anlegen`:

| Feld | Wert |
|---|---|
| Name | `Marker schreiben` |
| Kommando | `echo "vorbereitet für $SDD_FEATURE" > .sdd-prepared` |
| Auslöser | Nach Worktree-Anlage |
| Blockierend | an |

Speichern. Dann ein Feature anlegen (Name `demo-eins`, beliebige Beschreibung).

**Erwartet**

| # | Prüfung | Erwartung |
|---|---|---|
| 1.1 | `cat "$SDD_DATA_DIR"/worktrees/*/demo-eins/.sdd-prepared` | `vorbereitet für demo-eins` — das Kommando lief **im neuen Worktree** |
| 1.2 | Läufe-Ansicht → Lauf `demo-eins` aufklappen | Zeile `Schritt · Marker schreiben` mit Startzeit, Dauer, `erfolgreich`, `exit 0` |
| 1.3 | Log dieser Zeile öffnen | erste Zeile `=== Marker schreiben: echo … ===` |
| 1.4 | Reihenfolge | Der Schritt-Lauf beginnt **vor** dem `specify`-Lauf (Startzeiten vergleichen) |
| 1.5 | Tokens/Betrag der Zeile | **leer** — nicht `0` (FR-020) |

**Szenario 3 (FR-027/SC-008)**: Schritt deaktivieren (`Aktiv` aus) bzw. löschen, zweites Feature
`demo-zwei` anlegen → kein zusätzlicher Lauf in der Läufe-Ansicht, kein `.sdd-prepared`, keine
wahrnehmbare Verzögerung bis zum Start von `specify`.

**Szenario 4 (Reihenfolge, FR-004)**: zweiten Schritt am selben Auslöser anlegen
(`Zweiter Marker`, `echo 2 >> .sdd-prepared`, Position 10). Neues Feature → Datei enthält beide
Zeilen in der Reihenfolge Position 0, dann 10; die zwei Läufe überlappen zeitlich **nicht**.

---

## 2. US2 — Fehlerverhalten (P1)

Zwei Schritte am Auslöser **Nach Worktree-Anlage** anlegen:

| Name | Kommando | Blockierend | Position |
|---|---|---|---|
| `Beratender Fehlschlag` | `exit 4` | **aus** | 0 |
| `Blockierender Fehlschlag` | `echo "zeile a"; echo "zeile b"; exit 3` | **an** | 10 |
| `Darf nicht laufen` | `touch .sdd-should-not-exist` | an | 20 |

Feature `demo-fehler` anlegen.

**Erwartet**

| # | Prüfung | Erwartung |
|---|---|---|
| 2.1 | Läufe-Ansicht | `Beratender Fehlschlag` = `fehlgeschlagen (exit 4)`; `Blockierender Fehlschlag` = `fehlgeschlagen (exit 3)` |
| 2.2 | Kette (FR-022, Szenario 2) | **kein** Lauf `Darf nicht laufen`; `.sdd-should-not-exist` existiert nicht |
| 2.3 | Inbox (FR-023, Szenario 1, SC-003) | **genau ein** Eintrag, innerhalb von 5 s: Schrittname, Kommando, `exit 3`, letzte Ausgabezeilen (`zeile a`/`zeile b`) |
| 2.4 | Beratender Fehlschlag (FR-024, Szenario 3, SC-004) | **kein** Inbox-Eintrag dafür; der Ablauf lief ohne Eingriff weiter bis zum blockierenden Schritt |
| 2.5 | Halt | Feature hat **keine** laufende Phase; `specify` steht auf `idle` |
| 2.6 | Vollständige Ausgabe (FR-019) | Log des blockierenden Laufs enthält beide Zeilen |

**Szenario 5 (Wiederanlauf, FR-025)**: Kommando des blockierenden Schritts auf `exit 0` ändern,
im Web-UI die Feature-Konsole öffnen (`POST /api/features/:id/session`) → der Auslöser läuft
erneut, alle Schritte werden grün, **der Inbox-Eintrag verschwindet**, `.sdd-should-not-exist`
entsteht jetzt.

**Szenario 4 (Zeitlimit, FR-015/SC-006)**: Schritt `Hänger` mit `sleep 600`, Zeitlimit `1` Minute,
blockierend. Neues Feature → nach ~60 s ist der Lauf `fehlgeschlagen (exit 137)` (innerhalb von
10 s nach Ablauf verbucht) und das Fehlerverhalten greift wie in 2.3/2.5.

---

## 3. US3 — Kontext (P2)

Ein Schritt je Auslöserart mit demselben Kommando:

```sh
{ echo "W=$SDD_WORKTREE"; echo "P=$SDD_PROJECT"; echo "F=$SDD_FEATURE";
  echo "B=$SDD_BRANCH"; echo "PH=$SDD_PHASE"; echo "ST=$SDD_STAGE"; echo "PWD=$PWD"; } \
  >> /tmp/sdd-context.log
```

**Erwartet** (Logdatei bzw. Lauf-Log prüfen)

| # | Auslöser | Erwartung |
|---|---|---|
| 3.1 | Nach Worktree-Anlage | `W` = Worktree, `PWD` == `W`, `P`/`F`/`B` gesetzt, `PH` und `ST` **leer** |
| 3.2 | Nach Phase `specify` | zusätzlich `PH=specify`, `ST` leer |
| 3.3 | Vor Stufe `verify` | `ST=verify`, `PH` leer |
| 3.4 | Vor Worktree-Anlage (US3 §5) | `W` = **künftiger** Worktree-Pfad, `PWD` = **Haupt-Checkout** des Projekts |
| 3.5 | FR-012 | Keine Zeile trägt einen Platzhalter oder einen Wert aus einem anderen Vorgang |

**US3 Szenario 4 (Erweiterungspunkt, FR-013)** wird im Test geführt, nicht manuell:
`packages/shared/src/lifecycleSteps.test.ts` enthält einen Test, der die Schlüsselmenge von
`buildLifecycleEnv` festnagelt — er ist der Beweis, dass es **eine** Stelle gibt, und schlägt an,
sobald jemand Variablen anderswo setzt.

**SC-005 (drei gleichzeitige Features)**: drei Features desselben Projekts anlegen, ohne auf den
Abschluss zu warten. Erwartet: drei Schritt-Läufe mit je eigenem Log, jede Zeile in
`/tmp/sdd-context.log` trägt konsistent zusammengehörige `F`/`B`/`W`-Werte; kein Lauf schreibt in
den Worktree eines anderen Features. *Portkollisionen sind ausdrücklich nicht Gegenstand — F1c.*

---

## 4. US4 — Drei Ebenen (P2)

| # | Aufbau | Erwartung |
|---|---|---|
| 4.1 | Globaler Schritt `Global A`, Auslöser Nach Worktree-Anlage | läuft in **jedem** Projekt (Szenario 1) |
| 4.2 | zusätzlich Projekt-Schritt `Projekt B` am selben Auslöser | beide laufen, **global vor Projekt** (Szenario 2, stabil über mehrere Feature-Anlagen) |
| 4.3 | Feature-Konsole → Schritte → `Global A` auf **Aus** | `Global A` läuft für dieses Feature nicht, für ein weiteres Feature desselben Projekts unverändert schon (Szenario 3) |
| 4.4 | Schritt deaktivieren, für ein Feature auf **Ein** | läuft für dieses Feature (Szenario 4) |
| 4.5 | `Projekt B` löschen (Bestätigung lesen) | bisherige Läufe bleiben in der Läufe-Ansicht **mit Namen** sichtbar (Szenario 5, FR-028) |

**SC-007** wird zusätzlich durch automatisierte Tests über alle drei Ebenen belegt
(`packages/shared/src/lifecycleSteps.test.ts`): jede Kombination aus
`{global, projekt} × {enabled, disabled} × {auto, include, exclude}`.

---

## 5. US5 — Phasen- und Stufen-Auslöser (P3)

| # | Aufbau | Erwartung |
|---|---|---|
| 5.1 | `Vor Phase plan`, blockierend, `exit 1` | `plan` startet **nicht**, bleibt `idle`, Inbox-Eintrag (Szenario 1) |
| 5.2 | derselbe Schritt mit `exit 0`, Auto-Progress an | `plan` startet danach; Schritt-Lauf beginnt vor dem Phasen-Lauf |
| 5.3 | `Nach Phase implement`, `touch .sdd-after-implement` | Datei existiert, **bevor** die Folgestufe/Integration beginnt (Szenario 2, FR-009) |
| 5.4 | `Vor Stufe verify`, blockierend, `exit 1`; Integration starten | Verifikation läuft **nicht**, Feature bleibt in `verifying`, Inbox-Eintrag (Szenario 3) |
| 5.5 | `Nach Stufe merged`, `exit 1`, blockierend; Feature durchmergen | Merge fand statt, aber der **Abschluss ist nicht vermerkt**; Inbox-Eintrag (Edge Case) |
| 5.6 | Workflow-Übersicht öffnen | Schritt-Zonen an allen sechs Punkten; die angelegten Schritte erscheinen als Chip an der richtigen Stelle (Szenario 4) |
| 5.7 | Reihenfolge Schritt/Agent | Bei einem Schritt **und** einem Agenten am selben Punkt beginnt der Schritt-Lauf zuerst (research.md E8) |

**Szenario 4, zweite Hälfte** (Übersicht kann nicht still veralten) wird im Test geführt:
in `packages/shared/src/workflowModel.test.ts` eine Auslöser-Art aus dem Meta-Record entfernen ⇒
`pnpm -r typecheck` bricht; eine Stufen-ID entfernen ⇒ der Test
„INTEGRATION_STEPS-IDs == INTEGRATION_STAGE_IDS" schlägt an.

---

## 6. Edge Cases

| Fall | Prüfung | Erwartung |
|---|---|---|
| Kommando existiert nicht | Schritt `gibtsnicht --version` | Lauf `fehlgeschlagen (exit 127)`, Fehlerverhalten greift, **kein** stiller Erfolg |
| Sehr viel Ausgabe | `seq 1 200000` | Lauf grün, vollständige Ausgabe über den Lauf abrufbar; Inbox-Eintrag (bei blockierendem Fehlschlag) zeigt nur die letzten Zeilen |
| Toolkit endet während eines Laufs | Schritt `sleep 300` starten, dann `lsof -ti:4899 \| xargs -r kill`, neu starten | Lauf ist als `orphaned`/„unterbrochen" erkennbar, **nicht** dauerhaft „läuft" (FR-021) |
| Worktree fehlt unerwartet | Worktree-Verzeichnis von Hand löschen, Phasen-Auslöser feuern lassen | Meldung „erneut anstoßen" (behebbarer Infrastrukturfehler), **kein** Schritt-Lauf mit FAIL (FR-026) |
| Schritt während des Laufs umbenannt | `sleep 30`-Schritt starten, Namen ändern | Lauf endet und bleibt mit dem **alten** Namen verbucht (FR-028) |
| Kommando ohne Wirkung | `true` | Lauf grün — Erfolgsvermerk ist ausdrücklich keine inhaltliche Aussage |

---

## 7. Abschluss-Checkliste

- [ ] `pnpm -r typecheck` grün
- [ ] `pnpm -r test` grün (inkl. der neuen Test-Dateien aus [plan.md](./plan.md))
- [ ] Abschnitte 1–6 dieses Dokuments manuell durchlaufen
- [ ] Bestehende Datenbank geöffnet (nicht nur eine frische): Migration läuft durch, keine
      zusätzlichen Läufe, keine Verhaltensänderung ohne konfigurierte Schritte (FR-027)
- [ ] Test-Instanz ausschließlich über die eigenen Ports abgeräumt (`lsof -ti:4899 | xargs -r kill`)
