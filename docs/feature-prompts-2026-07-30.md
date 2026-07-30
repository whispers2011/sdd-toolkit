# Kopierfertige Feature-Anforderungen (Stand 30.07.2026)

Jeder Block ist **eigenständig** — ein Agent im Worktree kennt dieses Gespräch nicht, deshalb steht
in jedem Prompt die Begründung samt Belegstelle. Reihenfolge nach Wirkung; F1a und F2 zuerst.

Details und Messwerte: `docs/verbesserungen-2026-07-30.md`.
Die reine Von-Hand-Liste steht am Ende — die sind kein Feature wert.

---

## F1a · Lebenszyklus-Schritte sichtbar machen

```
Das Toolkit führt an mehreren Stellen fest verdrahtete Schritte aus, die in der Oberfläche
nirgends einsehbar sind. Es ist nicht erkennbar, wann ein Worktree angelegt wird und was dabei
passiert, wann ein Kontext-Reset erfolgt oder in welcher Reihenfolge die Integration abläuft.
Ziel dieses Features: Sichtbarkeit — noch keine Editierbarkeit.

Aufgabe:
1. Einen deklarativen Katalog der Kernschritte anlegen (Name, kurze Beschreibung, Zeitpunkt,
   Ort im Code). Er gehört in shared/, getypt über die bestehenden Domänen-Unions, damit
   `pnpm typecheck` bricht, wenn eine Stufe unbeschrieben bleibt — dasselbe Drift-Guard-Muster,
   das workflowModel.ts schon benutzt.
2. Diese Schritte in der bestehenden Workflow-Übersicht ausklappbar anzeigen: je Stufe die Liste
   der Schritte mit Beschreibung.

Zu erfassende Schritte (vollständig, aus dem Code erhoben):
- Worktree-Anlage (git/worktrees.ts:162-237): `git worktree add` serialisiert je (Repo,Branch),
  idempotent mit prune/retry; `mirrorAgentConfig` spiegelt die Agent-Konfiguration ins Worktree
  (5 Aufrufstellen); Abhängigkeiten installieren ist heute Sache des Agents, nicht des Toolkits.
- Phasenstart (orchestrator.ts:362, 509-524, commandBuilder.ts): Kontext-Reset (/clear bzw.
  /compact), Wissens-Präambel, Dokument-Verweise, Slash-Kommando bauen.
- Phasenende (orchestrator.handleTurnCompleted): Verbrauch messen, Transkript-Grenzen festhalten,
  tasks.md neu zählen.
- Integration (mergeQueueService.ts:239-300): commitWorktree -> reconcile -> verifyCommands ->
  Review-Gate-Agents -> Commit der Berichte -> Queue bzw. awaiting_human_review.
- Merge (mergeQueueService.ts:144-156): Rebase, Headless-Konfliktauflösung, ff/squash,
  finalizeMerged (Session beenden, Worktree entfernen, worktree_path nullen).

Wichtig: Die Reihenfolge commitWorktree VOR reconcile ist kein Zufall, sondern ein Fix (sonst
eskaliert jede Integration). Das gehört in die Beschreibung des Schritts, damit es niemand
"aufräumt".

Ausdrücklich NICHT in diesem Feature: Kommandos editierbar machen, neue Trigger, Stack-Verwaltung.
Nur beschreiben und anzeigen.

Abnahme: Für jede der fünf Stellen ist in der Workflow-Übersicht lesbar, was dort passiert. Ein
neuer IntegrationStage oder eine neue Phase bricht den Typecheck, solange sie keinen Katalogeintrag
hat. Tests für die Vollständigkeit des Katalogs.
```

---

## F1b · Eigene Schritte an den Lebenszyklus hängen

```
Setzt F1a voraus (sichtbarer Schrittkatalog).

Das Toolkit soll erlauben, an definierten Punkten eigene Shell-Kommandos auszuführen — analog zu
den bestehenden Agents mit before_phase/after_phase, aber mit Kommando statt Prompt. Vorbild in
Bedienung und Fehlerverhalten: die Agent-Gates (blockierend/beratend).

Aufgabe:
1. Trigger-Punkte einführen: before_worktree_create, after_worktree_create, before_phase,
   after_phase, before_stage, after_stage. Getypt, damit workflowModel.ts den Drift-Guard behält.
2. Schritt-Definition analog zu VerifyCommand { name, command } (shared/types.ts:91-94), erweitert
   um: Auslöser, Fehlerverhalten (blockierend | beratend), Zeitlimit. Ebenen wie bei den Agents:
   global -> Projekt -> Feature.
3. Ausführung im Worktree mit definiertem Kontext — ohne den hängt jede Konfiguration an
   absoluten Pfaden:
     $SDD_WORKTREE (= cwd)  $SDD_PROJECT  $SDD_FEATURE  $SDD_BRANCH
     $SDD_PHASE  $SDD_STAGE  $SDD_PORT_BASE  $SDD_PROFILE
   $SDD_PORT_BASE muss aus EINER Quelle kommen (siehe F1c/Portvergabe), sonst kollidieren
   parallele Features weiter.
4. Jeder Schritt-Lauf erzeugt einen Eintrag in `executions` (eigene kind-Art), damit er in der
   Läufe-Ansicht sichtbar und gemessen ist. Grund: am 30.07.2026 lief Arbeit ausserhalb jeder
   Execution und war dadurch unbepreist und unsichtbar — das darf mit eigenen Schritten nicht
   wieder passieren.
5. Ein blockierend fehlgeschlagener Schritt hält die Stufe an und erzeugt ein Attention-Item mit
   dem Kommando, dem Exit-Code und den letzten Ausgabezeilen.

Abnahme: Ein Projekt kann ein Kommando nach der Worktree-Anlage ausführen (z. B. Abhängigkeiten
installieren), es erscheint als Lauf in der Läufe-Ansicht, ein Fehlschlag blockiert die Stufe und
landet in der Inbox. Tests für Auslöser-Auflösung über die drei Ebenen und für beide
Fehlerverhalten.
```

---

## F1c · Ersetzbare Kernschritte + Stack-Profile + Testing-Lane

```
Setzt F1a und F1b voraus.

Drei Dinge, die zusammengehören: konfigurierbare Stacks, Portvergabe und eine Testing-Lane, in
der ein Feature vor dem Merge manuell ausprobiert wird.

AUSGANGSLAGE (gemessen am 30.07.2026):
- Das Toolkit weiss nicht, auf welchem Port ein Feature läuft. Es gibt im Code keinen Docker-,
  Compose- oder Stack-Begriff.
- Zwei parallel laufende Features fuhren auf denselben Standardports (localhost:8080 55x/23x,
  localhost:4000 23x/22x), kein einziger --port-Schalter. Ein Agent setzte `pkill -f "dx serve"`
  ohne Port ab und traf damit jeden dx-Server der Maschine.
- Nach dem Merge blieben Worktrees liegen (10 GB in einem Fall), weil ein laufender Dev-Server
  sein Arbeitsverzeichnis hielt; `git worktree remove --force` schlug fehl, `worktree_path` wurde
  trotzdem genullt — damit war der Rest für das Toolkit unauffindbar.

AUFGABE:
1. Portvergabe pro Worktree aus einer einzigen Quelle ($SDD_PORT_BASE, z. B. 8080+n/4000+n),
   geschrieben in eine Env-Datei im Worktree, die eigene Schritte und Agents lesen.
2. Stack-Profile als ersetzbare Kernschritte, projektweise konfiguriert:
     test  — nur das Minimum für die Testsuite. MUSS ab implement stehen, sonst ist TDD nicht
             möglich; lebt über alle Läufe eines Features (nicht pro Lauf hoch/runter).
     full  — der ganze Stack, erst in der Testing-Lane zur Regressionsabnahme.
     down  — Abbau bei Session-Ende, Merge und Worktree-Entfernung, inklusive Volumes.
   Begründung für die Stufen: ein voller Stack pro Feature ist bei Business-Anwendungen nicht
   bezahlbar (ein Beispielprojekt hat 7 Dienste; 3 parallele Features wären 21 Container auf
   einer Maschine, die schon an Platte und Swap anstand).
3. Teilbarkeit: zustandslose Nebendienste dürfen projektweit einmal laufen. Die Datenbank NICHT —
   zwei Features haben unterschiedliche Migrationen, ein gemeinsames Schema bricht beim ersten
   Konflikt. Also DB pro Feature, Nebendienste geteilt.
4. Neue Integrationsstufe `awaiting_manual_test` VOR awaiting_human_review, plus Schalter
   `manualTestGate` in AutomationSettings (types.ts:46-57 — der Dial hat schon die Ebenen global ->
   Projekt -> Feature und resolveAutomation()). Vorgabe: in LEVEL2_DEFAULTS an, in LEVEL3_DEFAULTS
   aus.
5. Testing-Lane-Ansicht: Worktree-Pfad, Branch, Stack-URL (klickbar), Anlagedatum, Stack-Status je
   Dienst mit Ports, und Start/Stop/Restart/Abbau.
6. Aufräumen: finalizeMerged muss PRÜFEN, ob das Entfernen geklappt hat, und sonst eskalieren statt
   worktree_path zu nullen. Verwaiste Worktrees aktiv als Attention melden. Beim Entfernen gehört
   das Build-Verzeichnis (target/, node_modules) und `down -v` dazu — sonst leaken Volumes
   unsichtbar weiter, diesmal ausserhalb des Worktrees.
7. Prozesse beim Session-Ende über die PROZESSGRUPPE beenden, nie über Namensmuster. Muster sind
   genau das Problem: ein `pkill -f "dx serve"` trifft die Nachbarn.
8. Grösse je Worktree in der Worktree-Übersicht anzeigen (WorktreeEntry hat kein Grössenfeld) und
   bei knappem Plattenplatz warnen. Am 30.07. lief die Platte auf 813 MB und der Server starb
   wahrscheinlich daran.
9. URL zweistufig: zuerst http://localhost:<port>; ein sprechender Hostname (<feature>.test) ist
   ein späterer Schritt und braucht Wildcard-DNS plus Reverse-Proxy.

Abnahme: Zwei Features laufen gleichzeitig ohne Portkollision. Ein Klick in der Testing-Lane
öffnet die laufende Anwendung des richtigen Features. Nach dem Merge bleibt kein Verzeichnis, kein
Container und kein Volume zurück; scheitert das Entfernen, gibt es ein Inbox-Item statt eines
stillen Nullens.
```

---

## F2 · Ehrlichkeit vor dem Merge

```
Drei Anzeigen fehlen an genau der Stelle, an der entschieden wird. Alle Daten liegen vor, es ist
ein Durchreichen, keine neue Erhebung.

1. „Verifiziert" ohne Verifikation.
   verify_commands ist bei zwei von drei Projekten leer ([]). Am 30.07.2026 sind FÜNF Features
   nach main gelaufen, jedes mit 0 verify-Läufen und 0 review-Läufen — über die Meldung
   „verifiziert — bereit für dein Review & Merge" (mergeQueueService.ts:291). Mit autoMerge=true
   wird zusätzlich awaiting_human_review übersprungen (:287); dann gibt es zwischen Agent-Ausgabe
   und main keine einzige Prüfung.
   Aufgabe: Leere verifyCommands als Zustand behandeln, nicht als Erfolg. Stage und Meldung dürfen
   nicht „verifiziert" heissen. Beim ersten Integrationsversuch ein Attention-Item „Projekt hat
   keine Verifikation konfiguriert". Im Review-Portal die Lücke benennen statt eine leere Kachel
   zu zeigen.

2. Offene Tasks werden nicht genannt.
   Ein Feature ist mit 68 von 76 Tasks ins Review und nach merged gelaufen. Der Guard ist
   absichtlich nur eine Mindesthürde (mergeQueueService.ts:230, hasAnyTaskDone) — er fängt den
   Totalausfall, nicht die Unvollständigkeit. Das ist als Sperre richtig.
   Aufgabe: tasksDone/tasksTotal in die review_due-Meldung und ins Review-Portal aufnehmen
   („68/76 erledigt, 8 offen"). NICHT sperren, nur benennen.

3. Läufe-Ansicht ohne Bezugsgrösse.
   RunSummary (shared/runSummary.ts:44-62) führt total, byStep, byCategory, sourceMix — keine
   Task-Zahlen. Die Werte liegen am Feature (types.ts:133-134), buildRunSummaries arbeitet ohnehin
   je Feature.
   Aufgabe: tasksDone/tasksTotal in RunSummary aufnehmen, in der Läufe-Liste als Spalte und im
   Lauf-Dashboard zeigen. Zusätzlich „Kosten pro Task" als Bezugsgrösse — sie macht Features
   unterschiedlicher Grösse erst vergleichbar.

Abnahme: Ein Projekt ohne verifyCommands kann kein Feature als „verifiziert" ausweisen. Die
review_due-Meldung nennt den Task-Stand. Die Läufe-Ansicht zeigt Tasks und Kosten pro Task.
```

---

## F3 · Plausibilitätsprüfung

```
Das Toolkit schreibt viele Kennzahlen und beurteilt keine davon. Vier kaputte Zustände stehen als
auffällige Zahlen in der Datenbank, jeder mit einer SQL-Zeile auffindbar, keiner wird geprüft:

  171  Läufe mit Tokens, aber cost_micros IS NULL   (Widerspruch, wächst weiter)
   43  Phasenläufe „failed" nach 2,1–2,7 s          (Signatur: die Phase lief nie an)
   31  orphaned
   22  Features in einem Projekt ohne einen einzigen Phasenlauf

Aufgabe: Beim Abschluss eines Laufs auf Widersprüche prüfen und als Attention melden —
  - Tokens gesetzt, aber keine Kosten
  - Phasenlauf kürzer als ~6 s mit exit != 0 (Fehlstart, nicht Fehlschlag)
  - Projekt mit Features, aber ohne Läufe
  - nachträgliche Korrektur eines fertigen Laufs um Faktor >= 2 (heute nur console.warn in
    orchestrator.ts, siehe updateTelemetry in db/repos.ts — die Ablehnung soll sichtbar werden)

Das ist kein Feature im Sinne neuer Funktion, sondern ein Alarm auf Daten, die es bereits gibt.
Bereits erledigt und NICHT erneut zu bauen: „Arbeit läuft, aber kein Lauf offen"
(orchestrator.checkWorkWithoutRun).

Abnahme: Jeder der vier Zustände erzeugt genau ein Attention-Item, mit Tests für Erkennung und
für die Fälle, die NICHT melden dürfen. Keine Dauermeldungen für denselben Zustand.
```

---

## F4 · Server-Ausfälle sichtbar machen

```
Am 30.07.2026 endete der Server um 12:59:10 mitten in zwei laufenden Features. Im Log steht die
letzte normale Anfrage, dann „Node.js v22.19.0" und ELIFECYCLE — kein Fehlertext, keine
Stack-Trace, null Fehlermarker, kein Crash-Report. Umstände: 813 MB freier Plattenplatz, Swap
4,1 von 5,1 GB belegt, zwei Rust-Builds parallel.

Der eigentliche Mangel ist nicht der Absturz, sondern die Stille danach: in der Datenbank steht
KEIN Hinweis darauf. Kein Attention-Item, kein Ereignis. Der Ausfall ist nachträglich nicht
rekonstruierbar; von aussen sieht ein toter Server aus wie „nichts passiert".

Aufgabe:
1. Herzschlag: Der Server schreibt periodisch einen Zeitstempel. Beim Start prüft die
   Boot-Recovery, ob der letzte Herzschlag lange her ist, und legt ein Attention-Item an:
   „Server war zwischen X und Y unerwartet weg, N Läufe betroffen".
2. Absturzursache festhalten: process.on('exit') plus Signal-Handler protokollieren mit
   Zeitstempel in eine Datei neben der Datenbank, damit ein stiller Abgang einen Eintrag hat.
3. Ressourcendruck anzeigen: freier Plattenplatz und Swap-Nutzung, mit Warnung bei knappem Platz
   und einem Hinweis, wenn mehrere Features parallel laufen.

Abnahme: Nach einem `kill -9` des Servers erzeugt der nächste Start ein Attention-Item mit dem
Zeitfenster und den betroffenen Läufen. Tests für die Lückenerkennung.
```

---

## F5 · „Braucht Dich" verschwindet nach dem Review nicht

```
Ein aufgelöstes Attention-Item bleibt in der Oberfläche stehen. In der Datenbank ist es
aufgelöst (beobachtet: erstellt 10:38:48, gelöst 10:40:43, Feature merged) — es hängt nur in der
Anzeige. Ein Reload räumt es weg, weil /api/state attention.listOpen() mitliefert
(server.ts:170); daher wirkt es „manchmal".

Zwei unabhängige Fehler in derselben Kette:
1. resolveFor() (db/repos.ts:720) ist ein reines DB-Update. Die Review-Pfade
   mergeQueueService.ts:354 und server.ts:813 feuern KEIN attention_resolved. Nur der Einzelpfad
   (server.ts:958, mergeQueueService.ts:732) emittiert — deshalb funktioniert manuelles Wegklicken,
   automatisches Auflösen nicht.
2. orchestrator.ts:394 sendet attention_resolved mit einer featureId, :633 mit einer session.id.
   Der Reducer filtert `a.id !== action.id && a.sessionId !== action.id` (web/store.tsx:162) —
   eine featureId passt auf keines von beiden, das Ereignis entfernt also nichts.

Aufgabe: resolveFor() gibt die betroffenen Item-IDs zurück und emittiert pro ID.
attention_resolved trägt ausschliesslich Item-IDs, nie featureId oder sessionId.

Abnahme: Nach Freigabe und Merge verschwindet das Item ohne Reload. Reducer-Tests für beide
bisherigen Fehlerfälle.
```

---

## F6 · Review-Portal und Läufe-Ansicht: Sicht-Pass

```
Vier Beobachtungen aus der Benutzung am 30.07.2026:

1. Rechte Sidebar im Review-Portal ist leer. ReviewPortal.tsx:303-316 rendert AuditSidebar in
   einer w-80-Spalte. Vermutlich Folge fehlender Verifikationsläufe (siehe F2) — dann gehört dort
   eine Aussage hin, keine leere Spalte.
2. Die Mitte zeigt ohne Dateiauswahl nur „Datei links auswählen." (ReviewPortal.tsx:262).
   Gewünscht: standardmässig eine Zusammenfassung der Änderungen als Überblick über das Feature.
   Die Daten liegen im selben summary-Objekt, das den Commits-Tab speist (:270).
3. Der DiffViewer ist schlecht lesbar (Kontrast, Markierungen).
4. Läufe-Ansicht (ExecutionsView.tsx): SOURCE_LABELS:45-50 enthält
   telemetry: 'von der CLI gemeldet' — ein Halbsatz zwischen drei Einzelwörtern („gemessen",
   „geparst", „geschätzt"), darum wirkt er fremd. Kürzen, z. B. „gemeldet".
   WICHTIG: Die Unterscheidung gemeldet <-> vom Toolkit erschlossen ist bewusst gebaut
   (FR-017/SC-009) und muss erhalten bleiben — sie hat einen Messfehler um Faktor 10 sichtbar
   gemacht. Nur das Wort kürzen, nicht die Aussage einziehen.
   Grössen: die Datei benutzt durchgehend text-xs und für Balken w-1/w-1.5/h-1.5, während das
   Haus-Iconset (icons.tsx) auf h-6 ausgelegt ist. Icons und Zahlen wirken dadurch zu klein.

Randbedingungen: Hell- UND Dunkelmodus prüfen. Der Hell-Modus invertiert nur die Skalen
zinc/emerald/amber/red/sky — kein indigo verwenden. Prüfung im Browser gehört dazu (Chrome-MCP);
sie steht noch aus, weil bei der Erhebung mehrere Agents denselben MCP benutzten.

Abnahme: Review-Portal ohne Dateiauswahl zeigt eine Änderungsübersicht; die rechte Spalte sagt
etwas, auch wenn es keine Verifikationsläufe gibt; Diff und Läufe-Ansicht sind in beiden Themes
lesbar.
```

---

## F7 · Persönliche Einstellungen

```
Ein neuer Einstellungsbereich „Individuelle Einstellungen" mit drei Themen.

1. Signaltöne — frei definierbar.
   Heute: ein fest verdrahteter Zwei-Ton-Beep (web/store.tsx:378-398, WebAudio 880+1174 Hz), eine
   Boolean-Einstellung im localStorage (sdd-sound), und die Auslöser sind hart auf
   turn_completed und merged verdrahtet (:531).
   Gewünscht: eine Matrix Auslöser x Ton. Das Vokabular existiert bereits als AttentionKind
   (shared/types.ts:222-232): awaiting_input, review_due, approval_required, permission_request,
   verify_failed, gate_failed, merge_conflict_escalated, phase_gate_failed, agent_errored,
   run_interrupted; dazu Phasenwechsel und „bestimmte Phase erreicht" aus FeaturePhase.
   Mindestens 20 unterscheidbare Töne — ohne Asset-Dateien: der bestehende Beep beweist, dass
   WebAudio genügt (Frequenzfolgen, Wellenformen, Rhythmen). Stimm-Ansagen über speechSynthesis
   (Web Speech ist für die Spracheingabe schon im Einsatz), damit auch frei eingetippte Texte
   möglich sind. Vorhör-Knopf je Ton.
   AUSDRÜCKLICH: „Ton bei Rückfrage" kehrt eine bewusste Entscheidung um — im Code steht
   „Rückfragen bewusst lautlos (WhisperM8-Regel)". Erlauben, aber standardmässig AUS, damit die
   alte Begründung nicht verloren geht. Standardwerte so wählen, dass es nicht lauter wird als
   heute.
   Einstellung serverseitig ablegen, nicht im localStorage — sonst gilt sie pro Browser.

2. Themes — mehrere Farbdesigns.
   web/theme.ts ist laut eigenem Vertrag („Contract C1") die einzige Quelle der Wahrheit, kennt
   aber nur 'light' | 'dark'. Günstig ist es, weil der Hell-Modus in index.css die
   Tailwind-Farbskalen SELBST überschreibt (--color-zinc-50: #09090b …) statt Klassen: ein neues
   Theme ist ein weiterer :root[data-theme='X']-Block ohne Komponentenänderung.
   Drei Fallen: (a) Der Hell-Block definiert 57 Variablen über 5 Skalen (zinc 13, amber/emerald/
   red/sky je 11) — wer eine vergisst, erbt still den Dunkel-Wert; deshalb ein Test, der prüft,
   dass jeder Theme-Block denselben Schlüsselsatz definiert. (b) terminalTheme.ts hängt über
   onThemeChange am Theme, weil xterm echte Farbwerte braucht — jedes Theme braucht dort einen
   Eintrag, sonst bleibt die Konsole im alten Schema. (c) Die Skalennamen sind nicht semantisch:
   für ein warmes Theme müsste man nicht-grüne Werte in „emerald" schreiben. Entscheiden:
   günstig weiterbauen oder einmal auf semantische Tokens (--surface, --accent, --danger)
   umstellen.

3. Vorauswahl der Ticket-Quelle.
   Bei aktiver Jira-Verbindung soll einstellbar sein, ob JIRA oder manuelles Erfassen
   vorausgewählt ist; „Neues Feature" öffnet dann den gewählten Weg zuerst.
   Heute hart verdrahtet (web/components/Sidebar.tsx:304-316): setMode(c ? 'jira' : 'manual') —
   Jira gewinnt immer, sobald verbunden. Es ist eine Zeile: die Vorauswahl kommt aus der
   Einstellung statt aus dem Verbindungszustand; ohne Verbindung weiter zwingend manual. Der
   Umschalter FeatureSourceToggle bleibt — die Einstellung bestimmt nur, was vorausgewählt ist,
   nicht was möglich ist.
   NICHT in jira.lastSelection ablegen (server.ts:923) — das ist die letzte Auswahl INNERHALB des
   Import-Dialogs, ein anderer Zweck.

Abnahme: Töne pro Auslöser wählbar und vorhörbar, Standard nicht lauter als heute; mindestens ein
zusätzliches Theme vollständig (inklusive Terminal) mit Vollständigkeitstest; Vorauswahl der
Ticket-Quelle wirkt beim Öffnen des Dialogs.
```

---

## F8 · Kontext-Hygiene im Wissens-Chat

```
Ein fortgesetzter Wissens-Chat wird pro Turn teurer, und niemand sieht es. Gemessen an einem
Verlauf vom 28.07.2026 (16,8 MB, 191 Anfragen, 32'608'759 Tokens): die letzten sechs Turns lesen
je ~265'000 Tokens Kontext, um 100–400 Tokens zu erzeugen — ein Verhältnis von etwa 1000 : 1, und
der Cache-Read steigt monoton (262'577 -> 265'673 in sechs Turns). Ein „danke, passt"-Turn kostet
dort so viel wie eine echte Aufgabe.

Das Werkzeug existiert schon: restart() und die Karte [Chat fortsetzen] / [Neuen Chat starten],
die beim Leerlauf-Reap gezeigt wird. Sie wird nur nie angeboten, weil der Auslöser
„5 Minuten Leerlauf" heisst und nicht „der Verlauf ist teuer geworden".

Aufgabe:
1. Denselben Auslöser zusätzlich an die Grösse hängen: übersteigt der Verlauf eine Schwelle oder
   der Cache-Read je Turn einen Wert, dieselbe Karte anbieten — „Verlauf ist X MB, jeder weitere
   Turn zahlt ihn mit. Neu starten?" Verlustfrei, der Verlauf bleibt lesbar.
2. Die Zahl im Chat sichtbar machen: Kontextgrösse und Kosten des letzten Turns.
3. Als Kennzahl das Verhältnis Cache-Read : Output ausweisen — bei ~1000 : 1 ist ein Schnitt fällig.

Abnahme: Ein Chat mit grossem Verlauf bietet den Neustart an, ohne dass eine Leerlaufzeit
abläuft; die Kosten des letzten Turns sind im Chat sichtbar.
```

---

## F9 · Chat-Pfad und Phasen-Pfad in einen gemeinsamen Kern

```
ChatWorkService und Orchestrator lösen dieselben Aufgaben doppelt: Session sicherstellen, Turn
messen, Worktree anlegen. Gepflegt wurde über Monate nur der Phasen-Pfad. Jeder am 28.07.2026
gefundene Chat-Fehler war eine Lösung, die im Repo schon existierte, nur nicht im Chat
(Doppel-Sessions bei parallelem Start; Turn ohne Kosten abgerechnet).

Am 30.07.2026 sind vier weitere Verbesserungen ausschliesslich in den Phasen-Pfad geflossen:
telemetryStore.hold/release (Puffer eines laufenden Laufs schützen), der monotone
Telemetrie-Akkumulator, die Sperre gegen Integration bei schreibendem Agenten, und der
Zuordnungswächter checkWorkWithoutRun. Der Chat hat von keiner davon etwas.

Aufgabe: Die geteilten Aufgaben in einen gemeinsamen Kern ziehen, statt sie zweimal zu pflegen.
Vor jeder Änderung an orchestrator.ts sollte die Entsprechung in chatWorkService.ts nicht mehr
gesucht werden müssen.

Kein Eilfall — aber der einzige Punkt, der mit jedem weiteren Fix teurer wird statt billiger.

Abnahme: Session sicherstellen, Turn messen und Worktree anlegen existieren je einmal; Chat- und
Phasen-Pfad benutzen dieselbe Implementierung. Bestehende Tests beider Pfade bleiben grün.
```

---

## Von Hand, kein Feature

| # | Punkt | Ort |
|---|---|---|
| 1 | Laufgrenzen beim Laufende festschreiben — der End-Offset wird beim Nachtrag fotografiert und saugt Fremdarbeit ein | `orchestrator.persistTranscriptRange` |
| 2 | Entscheidung + Umsetzung: `transcript`/`estimated` bepreisen **oder** als „ungemessen" ausweisen (derzeit rechnet keine Stelle Tokens in Geld um) | `costMeter.ts`, `runSummary.ts` |
| 3 | `refs/backup/<name>` vor `git branch -D` — zwei Zeilen, überlebt `gc` | `git.ts` |
| 4 | `queue.head()` sortiert nur nach `position`, ignoriert die Stage | `repos.ts:620` |
| 5 | CI-Lint läuft ins Leere: `pnpm lint` fehlt, ESLint nicht installiert, `eslint.config.js` liegt da → installieren **oder** Konfig löschen | `package.json`, CI |
| 6 | `target/` mit dem Worktree entfernen (bis F1c da ist) | `finalizeMerged` |
| 7 | Projektregeln: Dateiänderungen über `Edit` statt `python3`-Heredocs; Warteschleifen müssen die Fehlersignatur mitprüfen | `CLAUDE.md` |
| 8 | Squash-Merges gelten nicht als „merged" — latent, alle Projekte laufen auf `ff`; erst nötig, wenn du umstellst | `isBranchMergedInto` |
