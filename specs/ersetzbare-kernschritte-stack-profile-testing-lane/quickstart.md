# Quickstart — Validierung

Prüfszenarien, mit denen sich das Feature Ende-zu-Ende nachweisen lässt. Jeder Abschnitt nennt die
Story, die geprüften Anforderungen und das **erwartete** Ergebnis. Implementierungscode steht hier
nicht — er gehört in `tasks.md` und in die Umsetzung.

---

## 0. Voraussetzungen

```sh
pnpm install
pnpm -r typecheck
pnpm -r test
```

Beides muss **grün** sein, bevor manuell geprüft wird.

### Eigene Test-Instanz (Pflicht)

Die laufende Toolkit-Instanz belegt 4820/4830 und **deine Session ist ihr Kindprozess** (siehe
`CLAUDE.md`). Niemals `pkill -f vite` / `pkill -f tsx` / `pkill -f "docker compose"` — das beendet
die eigene Arbeit oder die Stacks der Nachbar-Features. Immer eigene Ports und ein eigenes
Datenverzeichnis:

```sh
export SDD_PORT=4899 SDD_WEB_PORT=4898 SDD_DATA_DIR="$(mktemp -d)/sdd-test"
# Portbereich der Testinstanz von der laufenden Instanz trennen:
export SDD_PORT_RANGE_START=31000 SDD_PORT_RANGE_END=31980 SDD_PORT_BLOCK_SIZE=20
pnpm dev            # → Web auf http://127.0.0.1:4898
```

Abräumen ausschließlich über die eigenen Ports:

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

### Stack ohne Container (empfohlen für die Prüfung)

Die Szenarien brauchen keinen Docker. Ein Profil, das einen Hintergrundprozess startet, genügt und
prüft zusätzlich die Prozessgruppen-Regel:

```sh
# Profil test  (in den Projekt-Einstellungen hinterlegen)
mkdir -p "$SDD_WORKTREE/.stack" && \
  ( nohup python3 -m http.server "$SDD_PORT_BASE" >"$SDD_WORKTREE/.stack/web.log" 2>&1 &
    echo $! > "$SDD_WORKTREE/.stack/web.pid" ) && sleep 1

# Profil full   (zusätzlich ein zweiter Dienst auf Abstand 1)
… analog mit $((SDD_PORT_BASE + 1)) …

# Profil down   (Abbau inkl. „Datenablagen")
[ -f "$SDD_WORKTREE/.stack/web.pid" ] && kill "$(cat "$SDD_WORKTREE/.stack/web.pid")" || true
rm -rf "$SDD_WORKTREE/.stack"
```

Dienstliste: `web` Abstand 0 (Haupteingang), `api` Abstand 1.

---

## 1. US1 — Zwei Features ohne Portkollision (P1, FR-001…FR-010, SC-001)

1. Zwei Features desselben Projekts anlegen.
2. In beiden Worktrees die Env-Datei lesen:

   ```sh
   cat <worktree-a>/.sdd/env; cat <worktree-b>/.sdd/env
   ```

   **Erwartet**: je ein `SDD_PORT_BASE`, beide Blöcke überschneiden sich nicht
   (Differenz ≥ `SDD_PORT_SPAN`); `SDD_PORT_SPAN`, `SDD_WORKTREE`, `SDD_PROJECT`, `SDD_FEATURE`,
   `SDD_BRANCH` gesetzt und korrekt.
3. In beiden Features einen Lebenszyklus-Schritt „nach Worktree-Anlage" mit
   `echo "$SDD_PORT_BASE / $SDD_PROFILE"` anlegen und die Session erneut anstoßen.

   **Erwartet** (Läufe-Ansicht → Log): der Wert stimmt mit der Env-Datei des **eigenen** Worktrees
   überein; `SDD_PROFILE` ist leer (FR-007, US1 Szenario 2).
4. Mehrere Läufe / Serverneustart, dann Env-Datei erneut lesen.

   **Erwartet**: unveränderter Block (FR-004, US1 Szenario 3).
5. **Belegter Bereich**: einen Port des nächsten freien Blocks fremd belegen und ein weiteres
   Feature anlegen:

   ```sh
   python3 -m http.server 31060 &   # z. B. der Anfang des nächsten Blocks
   ```

   **Erwartet**: das neue Feature erhält einen **anderen** Block; der belegte wird übersprungen
   (FR-003, US1 Szenario 4). Danach: `kill %1`.
6. **Freigabe und Wiederverwendung**: Feature A löschen, neues Feature anlegen.

   **Erwartet**: der freigewordene Block darf wieder vergeben werden (FR-005, US1 Szenario 5).
7. **Kein Commit der Env-Datei** (FR-009):

   ```sh
   cd <worktree-a> && git check-ignore -v .sdd/env && git status --porcelain | grep -c '\.sdd/'
   ```

   **Erwartet**: `check-ignore` meldet den Ausschluss aus `info/exclude`, `git status` zählt `0`.
   Nach einer Integration enthält der Merge-Commit keine `.sdd/`-Datei.
8. **Alt-Schritte unverändert** (FR-008, SC-007): ein Schritt, der die neuen Variablen nicht nutzt,
   läuft wie vor dem Feature — mit demselben Exit-Code und ohne zusätzliche Ausgabe.

---

## 2. US2 — Nur den benötigten Stack betreiben (P1, FR-011…FR-023, SC-005/SC-006)

1. Die drei Profile und die Dienstliste im Projekt hinterlegen (siehe oben).
2. Ein Feature bis `implement` führen.

   **Erwartet**: beim **Beginn** von `implement` läuft das `test`-Profil; die Feature-Konsole zeigt
   „Profil: test" und `web` als `● läuft`; die Testsuite findet ihren Dienst vor (FR-014, Szenario 1).
3. Zwei weitere Läufe desselben Features anstoßen.

   **Erwartet**: **kein** weiterer Profillauf in der Läufe-Ansicht; der Dienst bleibt durchgehend
   erreichbar, die PID wechselt nicht (FR-014, SC-006, Szenario 2).
4. Das Hochfahren erneut anstoßen (Aktion „Starten" bei betriebenem Profil).

   **Erwartet**: kein zweiter Dienstsatz, kein Fehler (FR-015, Szenario 3).
5. **Projekt ohne Stack**: zweites Wegwerf-Projekt ohne Profile, Feature durch den ganzen
   Lebenszyklus führen.

   **Erwartet**: keine zusätzlichen Fehlschläge, keine Verzögerung, **kein** Inbox-Item; Lane und
   Feature-Konsole nennen „Kein Stack konfiguriert" (FR-013, SC-010, Szenario 4).
6. **Fehlschlag**: `test`-Kommando auf `exit 3` setzen, Phase `implement` starten.

   **Erwartet**: die Phase startet **nicht** (bleibt „offen"), ein Inbox-Item `stack_failed` mit
   Profil, Kommando, Exit-Code und Ausgabe-Ausschnitt (FR-019, Szenario 5).
7. **Zwei Features, eigene Datenbestände**: in beiden `test` betreiben, in jedem eine Datei in der
   „Datenablage" des Dienstes anlegen.

   **Erwartet**: verschiedene Ports, getrennte Ablagen; nichts vom einen erscheint beim anderen
   (FR-021, Szenario 6).
8. **Geteilter Dienst** (`sharedCommand` + ein Dienst mit `scope: shared`): Feature A starten, dann
   Feature B starten.

   **Erwartet**: der geteilte Dienst läuft **einmal**; im Log des zweiten Starts erscheint kein
   zweiter Start (FR-022, Szenario 7).
9. Feature A abbauen.

   **Erwartet**: der geteilte Dienst läuft weiter (B nutzt ihn). Danach B abbauen ⇒ er ist fort
   (FR-022, Szenario 8).
10. **Server neu starten**, während ein Stack läuft, dann die Lane öffnen.

    **Erwartet**: die Dienststatus stimmen mit der Realität überein (frisch erhoben, FR-023,
    Edge Case).

---

## 3. US3 — Manuelle Abnahme in der Testing-Lane (P1, FR-024…FR-033, SC-002/SC-009)

1. Automation-Dial: „Manuelles Test-Gate" **an** (Stufe-2-Vorgabe prüfen: nach Klick auf
   „Level 2 — Orchestrator" ist der Schalter an, nach „Level 3 — Autonomie" aus — FR-026).
2. Ein Feature integrieren, bis die Verifikation durch ist.

   **Erwartet**: das Feature hält auf „wartet auf manuelle Abnahme" — **vor** dem menschlichen
   Review; Board und Review-Übersicht zeigen die Stufe in amber; Inbox-Item `manual_test_due`
   (FR-024, Szenario 1).
3. Testing-Lane öffnen.

   **Erwartet**: alle fünf Angaben in einer Ansicht — Worktree-Pfad, Branch, klickbare Adresse,
   Anlagedatum, je Dienst Status samt Port (FR-030, SC-009, Szenario 2).
4. „Starten" klicken.

   **Erwartet**: die Dienste des `full`-Profils laufen, die Ansicht zeigt sie einzeln mit Port und
   Status (FR-016, Szenario 4).
5. **Klickprobe** mit zwei Features gleichzeitig in der Lane: Adresse des einen anklicken.

   **Erwartet**: die Anwendung **genau dieses** Features erscheint (in der Prüfung: die
   Verzeichnisauflistung des eigenen Worktrees). Für beide Features wiederholen — 100 % Treffer
   (FR-031, SC-002, Szenario 3).
6. „Stoppen", „Neustarten", „Abbauen" je einmal an Feature A ausführen und dabei Feature B
   beobachten.

   **Erwartet**: B bleibt unberührt — Dienste laufen weiter, Ports unverändert (FR-032, Szenario 5).
7. „Abnahme bestätigen".

   **Erwartet**: das Feature geht auf „wartet auf menschliches Review" (bzw. mit `autoMerge` in die
   Queue); die `manual_test_due`-Meldung verschwindet; die Entscheidung ist festgehalten (FR-028,
   Szenario 6).
8. Bei einem weiteren Feature „Ablehnen …" mit Grund.

   **Erwartet**: das Feature steht wieder in der Umsetzung (letzter Schritt offen), der Grund steht
   als Prompt in der Feature-Konsole und ist als Entscheidung gespeichert (FR-029, Szenario 7).
9. Gate **aus**, Feature integrieren.

   **Erwartet**: die neue Stufe wird nicht betreten, der Ablauf ist unverändert (FR-027, Szenario 8).
10. Projekt **ohne** Stack: Lane öffnen.

    **Erwartet**: „Kein Stack konfiguriert …" statt einer Adresse; Stack-Aktionen gesperrt mit
    Grund (FR-033, Szenario 9).
11. **Nicht erreichbar**: Stack starten, dann den Dienst von außen über seine **eigene** PID
    beenden (`kill "$(cat <worktree>/.stack/web.pid)"`), Lane aktualisieren.

    **Erwartet**: „nicht erreichbar" statt eines Links (FR-033, Edge Case).
12. **Gate einschalten, während ein Feature schon auf Review wartet**.

    **Erwartet**: das Feature wird **nicht** zurückgeschoben; die Regel greift erst beim nächsten
    Durchlauf (Edge Case).

---

## 4. US4 — Nach dem Merge bleibt nichts zurück (P2, FR-034…FR-041, SC-003/SC-004/SC-008)

1. Ein Feature mit laufendem Stack mergen.

   **Erwartet**: `down` läuft vor dem Entfernen; danach sind Verzeichnis, Dienste und
   „Datenablagen" fort — unabhängig nachgemessen (FR-017/FR-038, SC-003):

   ```sh
   ls -d <worktree>            # existiert nicht
   lsof -ti:<portBase>         # leer
   ls -d <worktree>/.stack     # existiert nicht
   ```

2. **Fehlgeschlagenes Entfernen**: ein Feature mergen, während ein Prozess das Verzeichnis hält:

   ```sh
   cd <worktree> && sleep 600 &      # eigene PID merken, kein pkill!
   ```

   **Erwartet**: Inbox-Item `worktree_cleanup_failed` mit Grund; der Worktree-Pfad des Features
   bleibt **gesetzt** (Feature-Detail / Worktree-Übersicht zeigt ihn) — in 0 % der Fälle geleert
   (FR-034/FR-035, SC-004, Szenarien 1/2).
3. Den haltenden Prozess über die gemerkte PID beenden (`kill "$PID"`), dann „Aufräumen erneut
   anstoßen".

   **Erwartet**: das Aufräumen läuft zu Ende, der Pfad wird **erst danach** geleert, die Meldung
   verschwindet (FR-036/FR-037, Szenario 3).
4. **Verwaister Worktree**: ein Verzeichnis unter `<dataDir>/worktrees/<projekt>/` anlegen und als
   Worktree registrieren (oder ein Feature hart löschen, sodass sein Worktree stehenbleibt), dann
   die Worktree-Übersicht öffnen.

   **Erwartet**: Inbox-Item `orphan_worktree` mit Pfad und Größe (FR-039, SC-011, Szenario 5).
5. **Prozessgruppe beim Session-Ende** (FR-040/FR-041, SC-008, Szenario 6): in **zwei** Features je
   eine Session öffnen und in jeder denselben Prozessnamen starten:

   ```sh
   # in Session A und in Session B jeweils:
   python3 -m http.server $SDD_PORT_BASE &
   ```

   Session A beenden.

   **Erwartet**: der Prozess aus A ist fort (sein Port antwortet nicht mehr), der Prozess aus B
   **läuft weiter**. Gegenprobe: `ps -o pid,pgid,command -p <pid>` zeigt getrennte
   Prozessgruppen.
6. **Archivieren/Löschen ohne Merge**: ein Feature mit laufendem Stack archivieren.

   **Erwartet**: `down` läuft, Portblock wird freigegeben (Edge Case).
7. **Worktree von außen gelöscht**: `rm -rf <worktree>` (nur im Wegwerf-Projekt!), dann Übersicht
   aktualisieren.

   **Erwartet**: der Portblock wird freigegeben und steht wieder zur Vergabe (Edge Case).

---

## 5. US5 — Plattenplatz (P3, FR-042…FR-044, SC-012)

1. Worktree-Übersicht öffnen.

   **Erwartet**: je Worktree eine Größe. Gegenprobe:

   ```sh
   du -sh <worktree>
   ```

   Abweichung im Rundungsbereich ist zulässig (Assumption „Schätzung"), Größenordnung muss stimmen
   (FR-042, Szenario 1).
2. Warnschwelle künstlich über die Konfiguration unterschreiten:

   ```sh
   export SDD_DISK_WARN_BYTES=999999999999   # Neustart der Testinstanz
   ```

   **Erwartet**: Warnung mit freiem Platz und den größten Worktrees (FR-043, Szenario 2).
3. Größe unauffindbar machen (Rechte entziehen oder Zeitlimit erzwingen), Übersicht öffnen.

   **Erwartet**: Eintrag vollständig sichtbar, Größe als **„unbekannt"** gekennzeichnet (FR-044,
   Szenario 3).

---

## 6. Edge Cases (Sammelprüfung)

| Fall | Erwartung |
|---|---|
| Portblöcke erschöpft (`SDD_PORT_RANGE_END` klein setzen) | Anlegen scheitert mit klarer Meldung, kein Feature ohne Block, keine Doppelvergabe |
| Env-Datei von Hand verändert | wird bei der nächsten Bereitstellung überschrieben; die Zuweisung des Toolkits gilt |
| Fremdprozess belegt einen Port **nach** der Zuweisung | Hochfahren scheitert sichtbar, die Meldung nennt den Port (aus dem Ausgabe-Ausschnitt) |
| Abbau eines Profils schlägt fehl | Meldung; der Merge räumt **nicht** halb auf und meldet keinen Erfolg |
| Zwei Features starten gleichzeitig denselben geteilten Dienst | er entsteht genau einmal |
| Server startet neu, während Stacks laufen | Dienststatus wird neu erhoben, nichts wird behauptet |
| Anwendung läuft, ist aber unter der Adresse nicht erreichbar | „nicht erreichbar" statt Link |

---

## 7. Abschluss-Checkliste

- [ ] `pnpm -r typecheck` grün
- [ ] `pnpm -r test` grün
- [ ] SC-001: Zwei-Feature-Durchlauf ohne einen einzigen doppelt belegten Port
- [ ] SC-002: Klickprobe der Adresse, 100 % Treffer bei zwei Features
- [ ] SC-003: unabhängige Nachmessung nach dem Merge (Verzeichnis, Dienste, Datenablagen)
- [ ] SC-004: fehlgeschlagenes Entfernen ⇒ Meldung, Pfad bleibt
- [ ] SC-005: drei parallele Features ⇒ nur `test`-Stufen, höchstens ein `full`
- [ ] SC-006: `test` steht ab `implement` und wird über Läufe hinweg nicht neu gestartet
- [ ] SC-007: Alt-Schritte ohne die neuen Variablen unverändert (automatisierter Test)
- [ ] SC-008: zwei gleichnamige Prozesse aus zwei Sessions — nur der eigene stirbt
- [ ] SC-009: fünf Angaben in einer Ansicht, ohne Terminal und ohne Rückfrage
- [ ] SC-010: Projekt ohne Stack-Konfiguration ohne zusätzliche Fehlschläge/Verzögerung
- [ ] SC-011: verwaister Worktree erscheint als Meldung
- [ ] SC-012: Größe oder „unbekannt" je Worktree; Warnung bei Unterschreitung
- [ ] Testinstanz ausschließlich über die eigenen Ports abgeräumt (kein `pkill`/`killall`)
