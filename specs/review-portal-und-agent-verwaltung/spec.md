# Feature Specification: Review-Portal & Agent-Verwaltung

**Feature Branch**: `feature/review-portal-und-agent-verwaltung`

**Created**: 2026-07-23

**Status**: Draft

**Input**: User description: "Review-Portal pro Worktree + Agents/Persona-Verwaltung: Neue Top-Level-Review-View über alle integrationsbereiten Features mit Diffs, Git-Historie, Dateibrowser/Editor, Test-/Verify-Dashboard, Agent-Audits, zeilenverankerten Reviewer-Kommentaren und Integrations-Entscheidung (bestehender oder neuer Ziel-Branch). Generalisierung der Review-Personas zu konfigurierbaren Agents mit Trigger-Arten (manual, review_gate, after_phase, before_phase), blocking/advisory-Verhalten, Modellwahl, Per-Feature-Overrides, strukturierter Ergebnis-Ablage und Verwaltungs-UI; drei mitgelieferte Standard-Agents (DoR-Gate, Plan-Qualitätsreview, Kommentar-/Doku-Policy)."

## Clarifications

### Session 2026-07-23 (aus Planungsgespräch, verbindlich entschieden)

- Q: Wie sollen Reviewer-Kommentare strukturiert sein? → A: **Datei-/zeilenverankert, flach** (keine Threads); beim Zurückweisen werden offene Kommentare als strukturierter Prompt an die Feature-Konsole übergeben.
- Q: Woraus speist sich das Test-Dashboard? → A: **Aufbereitung der Verify-Läufe** (Status/Dauer/Exit-Code/Logs + Token/Kosten), keine Test-Report-Parser.
- Q: Wo ist die Branch-Zielwahl verfügbar? → A: **Nur im Review-Portal** (Human-in-the-loop); der automatische Merge-Pfad zielt weiterhin auf den Projekt-Default-Branch.
- Q: Wie kommen die Qualitäts-Gates (DoR, Plan-Qualität, Doku-Policy) ins System? → A: **Als Agents in der neuen Verwaltung** mit generischem Trigger-Mechanismus; vorkonfigurierte Definitionen werden mitgeliefert, nichts wird hart verdrahtet.
- Q: Wie verhalten sich globale und projektspezifische Agents zueinander? → A: **Union** (beide gelten); ein projektspezifischer Agent schaltet globale Agents nicht ab. Abwahl im Einzelfall über Per-Feature-Ausschluss.

## User Scenarios & Testing *(mandatory)*

Zwei Akteure teilen sich dieses Feature:

- **Der Reviewer** (Entwickler:in / Senior Dev, der:die das Toolkit bedient) — prüft fertiggestellte Features, kommentiert, entscheidet über die Integration und verwaltet die Agents.
- **Der Feature-Lebenszyklus** (die orchestrierten SDD-Phasen und der Integrationsprozess) — löst Agents an konfigurierten Punkten automatisch aus und reagiert auf deren Urteile.

### User Story 1 - Integrationsbereite Features prüfen und freigeben (Priority: P1)

Der Reviewer öffnet eine zentrale Review-Ansicht, die pro Projekt alle Features auflistet, die auf menschliche Prüfung warten oder bei der Integration hängen geblieben sind (Prüfung ausstehend, Verifikation fehlgeschlagen, Qualitäts-Gate fehlgeschlagen, Konflikt eskaliert). Von dort öffnet er ein Portal pro Feature, sieht alle Code-Änderungen als Diff mit Zeilennummern sowie die Commit-Historie des Features und entscheidet: freigeben (Integration startet) oder zurückweisen (Feature geht mit Begründung zurück in die Bearbeitung).

**Why this priority**: Kern des Features — der bisherige Review-Dialog zeigt nur ein einzelnes Feature rudimentär; ohne Überblick und belastbare Diff-Ansicht ist keine fundierte Integrations-Entscheidung möglich. Liefert allein bereits Wert.

**Independent Test**: Ein Feature in den Zustand „wartet auf menschliche Prüfung" bringen, die Review-Ansicht öffnen, das Feature dort sehen, das Portal öffnen, Diff und Historie einsehen, einmal zurückweisen und einmal freigeben.

**Acceptance Scenarios**:

1. **Given** ein Projekt mit einem Feature im Zustand „wartet auf menschliche Prüfung", **When** der Reviewer die Review-Ansicht öffnet, **Then** erscheint das Feature dort im Abschnitt „Bereit zum Review" mit Kennzahlen (geänderte Dateien, Audit-Stand).
2. **Given** ein Feature mit fehlgeschlagener Verifikation oder eskaliertem Konflikt, **When** der Reviewer die Review-Ansicht öffnet, **Then** erscheint es im Abschnitt „Braucht Eingriff" mit passender Aktion (z. B. Integration erneut anstoßen).
3. **Given** das geöffnete Portal, **When** der Reviewer eine geänderte Datei auswählt, **Then** sieht er deren Änderungen als zeilennummerierten Diff (alt/neu) und kann zur Commit-Historie des Features wechseln.
4. **Given** das geöffnete Portal, **When** der Reviewer freigibt, **Then** startet die Integration des Features und die Review-Ansicht aktualisiert sich.
5. **Given** das geöffnete Portal, **When** der Reviewer mit Begründung zurückweist, **Then** geht das Feature zurück in Bearbeitung und die Begründung erreicht die Feature-Konsole als Arbeitsauftrag.

---

### User Story 2 - Integrationsziel wählen (Priority: P1)

Bei der Freigabe entscheidet der Reviewer, wohin integriert wird: in den Projekt-Default-Branch (Standard), in einen anderen bestehenden Branch oder in einen neuen Branch, für den das System einen editierbaren Namensvorschlag macht. Der automatische Merge-Pfad (ohne menschliche Prüfung) bleibt unverändert auf den Default-Branch gerichtet.

**Why this priority**: Vom Nutzer explizit gefordertes Kernstück der Integrations-Entscheidung; ohne Zielwahl ist das Portal nur ein besserer Anzeige-Dialog.

**Independent Test**: Ein Feature freigeben mit Ziel „neuer Branch" und prüfen, dass der neue Branch die Feature-Änderungen enthält und der Default-Branch unberührt bleibt.

**Acceptance Scenarios**:

1. **Given** das Portal eines prüfbereiten Features, **When** der Reviewer die Freigabe vorbereitet, **Then** kann er zwischen „bestehender Branch" (Auswahl aus allen Projekt-Branches, Standard: Default-Branch) und „neuer Branch" (editierbarer Namensvorschlag mit Live-Validierung) wählen.
2. **Given** die Wahl „neuer Branch" mit gültigem Namen, **When** der Reviewer freigibt, **Then** wird der Branch angelegt, das Feature dorthin integriert und der Default-Branch nicht verändert.
3. **Given** ein ungültiger oder bereits vergebener neuer Branch-Name, **When** der Reviewer freigeben will, **Then** wird die Eingabe abgelehnt und der Fehler verständlich angezeigt.
4. **Given** ein Feature, das in einen Nicht-Default-Branch integriert wurde, **When** der Reviewer das Board ansieht, **Then** ist am Feature erkennbar, in welchen Ziel-Branch es integriert wurde.
5. **Given** ein Feature ohne menschliche Prüfung (Vollautomatik), **When** die Integration automatisch läuft, **Then** wird unverändert in den Default-Branch integriert.

---

### User Story 3 - Kommentieren und strukturiert zurückweisen (Priority: P2)

Der Reviewer verankert Kommentare an konkreten Dateien und Zeilen des Diffs (flach, ohne Threads). Kommentare bleiben gespeichert, können als erledigt markiert werden und fließen beim Zurückweisen — zusammen mit einem optionalen Freitext — als strukturierter, maschinenlesbarer Arbeitsauftrag in die Feature-Konsole.

**Why this priority**: Macht Zurückweisungen präzise und nachvollziehbar statt eines einzelnen Freitextfelds; baut auf US1 auf.

**Independent Test**: Zwei Zeilen-Kommentare anlegen, Portal schließen und wieder öffnen (Kommentare noch da), zurückweisen und prüfen, dass der erzeugte Auftrag beide Kommentare mit Datei/Zeile enthält.

**Acceptance Scenarios**:

1. **Given** ein Diff im Portal, **When** der Reviewer eine Zeile kommentiert, **Then** wird der Kommentar mit Datei, Zeile und Seite (alt/neu) gespeichert und im Kommentar-Panel gelistet.
2. **Given** gespeicherte Kommentare, **When** das Portal erneut geöffnet wird (auch nach Neustart), **Then** sind alle Kommentare mit ihren Ankern wieder sichtbar und ein Klick springt zur verankerten Stelle.
3. **Given** offene Kommentare, **When** der Reviewer zurückweist, **Then** enthält der an die Feature-Konsole übergebene Auftrag alle offenen Kommentare (mit Datei/Zeile) plus Freitext in strukturierter Form.
4. **Given** ein Kommentar, **When** der Reviewer ihn als erledigt markiert oder löscht, **Then** taucht er in künftigen Zurückweisungs-Aufträgen nicht mehr auf.

---

### User Story 4 - Projektdateien einsehen und korrigieren (Priority: P2)

Der Reviewer durchstöbert im Portal den kompletten Dateibaum des Feature-Arbeitsstands, öffnet beliebige Dateien (Markdown mit Vorschau) und nimmt kleine Korrekturen direkt vor. Gespeicherte Änderungen werden beim Freigeben als Reviewer-Korrektur übernommen und erzwingen eine erneute Verifikation vor dem Merge. Gleichzeitige Änderungen von dritter Seite werden erkannt statt überschrieben.

**Why this priority**: Erspart den Umweg über eine Zurückweisung bei Trivial-Korrekturen (Tippfehler, Kommentare); erhöht aber die Komplexität und ist daher nach dem Kern-Flow eingeordnet.

**Independent Test**: Im Portal eine Datei editieren und speichern, freigeben, prüfen dass die Korrektur im Integrationsergebnis enthalten ist und vor dem Merge erneut verifiziert wurde.

**Acceptance Scenarios**:

1. **Given** das Portal, **When** der Reviewer den Datei-Tab öffnet, **Then** sieht er den Dateibaum des Feature-Arbeitsstands und kann Text-Dateien öffnen; Binär- und übergroße Dateien werden als nicht editierbar ausgewiesen.
2. **Given** eine geöffnete Datei, **When** der Reviewer sie ändert und speichert, **Then** ist die Änderung im Arbeitsstand des Features wirksam.
3. **Given** eine zwischenzeitlich von anderer Seite geänderte Datei, **When** der Reviewer speichert, **Then** wird der Konflikt gemeldet und nichts stillschweigend überschrieben.
4. **Given** gespeicherte Reviewer-Korrekturen, **When** der Reviewer freigibt, **Then** werden die Korrekturen als solche gekennzeichnet übernommen und die Verifikation läuft vor dem Merge erneut.
5. **Given** ein Feature, das nicht (mehr) im Zustand „wartet auf menschliche Prüfung" ist, **When** ein Speicherversuch erfolgt, **Then** wird er abgelehnt.

---

### User Story 5 - Test- und Audit-Ergebnisse im Portal (Priority: P2)

Der Reviewer sieht im Portal, wie es um die Qualität des Features steht: ein Dashboard der Verifikations-Läufe (Status, Dauer, Logs, Token/Kosten) und eine Audit-Übersicht aller Agent-Läufe (Urteil PASS/FAIL, Zusammenfassung, vollständiger Bericht, Kosten), gruppiert nach Auslöser (Phasen-Gates, Review-Gate).

**Why this priority**: Verdichtet die Entscheidungsgrundlage; die Daten existieren bereits (Verify-Läufe, Agent-Berichte) und müssen „nur" zugänglich gemacht werden.

**Independent Test**: Feature mit gelaufener Verifikation und mindestens einem Agent-Lauf öffnen; Dashboard zeigt den Verify-Lauf mit Status und Logs, die Audit-Leiste zeigt den Agent-Lauf mit Urteil und öffenbarem Bericht.

**Acceptance Scenarios**:

1. **Given** ein Feature mit Verifikations-Läufen, **When** der Reviewer den Test-Tab öffnet, **Then** sieht er pro Lauf Status, Dauer und Logs sowie aggregierte Token/Kosten.
2. **Given** ein Feature mit Agent-Läufen, **When** der Reviewer das Portal öffnet, **Then** zeigt die Audit-Leiste pro Agent das letzte Urteil, eine Kurzzusammenfassung und die Kosten; der vollständige Bericht ist öffenbar.
3. **Given** ein Feature, dessen Prüfberichte vor Einführung der strukturierten Ablage entstanden, **When** das Portal geöffnet wird, **Then** werden diese Alt-Berichte weiterhin angezeigt (bestmöglich ausgewertet).

---

### User Story 6 - Agents verwalten (Priority: P1)

Der Reviewer verwaltet in einer eigenen Ansicht alle Agents: mitgelieferte und eigene, global oder projektspezifisch. Pro Agent konfigurierbar: Name, Beschreibung, Prompt, Modell, Auslöser (manuell, Review-Gate, nach Phase X, vor Phase X), blockierend oder beratend, aktiv/inaktiv, Reihenfolge. Globale und projektspezifische Agents gelten gemeinsam (Union).

**Why this priority**: Zweites Kernstück des Features; die bestehenden Review-Personas haben keinerlei Verwaltungsoberfläche und keine Auslöser-Konfiguration. Vorbedingung für US7–US9.

**Independent Test**: Einen neuen projektspezifischen Agent anlegen (Auslöser „nach Phase plan", blockierend), ihn in der Liste sehen, bearbeiten, deaktivieren und löschen; bestehende Review-Personas erscheinen als Review-Gate-Agents unverändert funktionsfähig.

**Acceptance Scenarios**:

1. **Given** die Agent-Verwaltung, **When** der Reviewer sie öffnet, **Then** sieht er globale und projektspezifische Agents getrennt gelistet mit Auslöser, Gate-/Hinweis-Kennzeichnung, Modell, letztem Urteil und Aktiv-Schalter.
2. **Given** der Dialog „Agent anlegen", **When** der Reviewer Name, Prompt, Auslöser, Blockierend-Schalter und Geltungsbereich (global/Projekt) festlegt und speichert, **Then** erscheint der Agent in der Liste und wird beim nächsten passenden Auslöser wirksam.
3. **Given** ein bestehender Agent, **When** der Reviewer ihn deaktiviert, **Then** läuft er bei künftigen Auslösern nicht mehr (außer per Feature explizit eingeschlossen).
4. **Given** die vor der Umstellung vorhandenen Review-Personas, **When** das System aktualisiert wird, **Then** sind sie ohne Datenverlust als blockierende Review-Gate-Agents übernommen und verhalten sich wie zuvor.
5. **Given** ein Agent mit konfiguriertem Modell, **When** er läuft, **Then** wird das konfigurierte Modell verwendet.

---

### User Story 7 - Automatische Qualitäts-Gates im Lebenszyklus (Priority: P2)

Agents laufen automatisch an ihren konfigurierten Punkten: nach Abschluss einer Phase (Ergebnis-Prüfung), vor Start einer Phase (Bereitschafts-Prüfung) oder im Review-Gate der Integration. Ein blockierender FAIL stoppt den automatischen Fortschritt und erzeugt einen Eintrag in der Aufmerksamkeits-Inbox; der Mensch kann übersteuern. Beratende Agents halten nichts an, ihr Ergebnis wird nur verbucht. Meldet ein Bericht explizit menschlichen Freigabebedarf, entsteht dafür ein eigener Inbox-Eintrag.

**Why this priority**: Setzt die Meeting-Beschlüsse (Human-in-the-loop-Gates) um; baut zwingend auf US6 auf.

**Independent Test**: Agent „nach Phase plan, blockierend" konfigurieren, eine Plan-Phase abschließen lassen; bei FAIL stoppt der Auto-Fortschritt und die Inbox zeigt den Gate-Fehlschlag; manuelles Freigeben der Phase bleibt möglich.

**Acceptance Scenarios**:

1. **Given** ein aktiver Agent „nach Phase X, blockierend", **When** Phase X abschließt und der Agent FAIL urteilt, **Then** schreitet das Feature nicht automatisch fort, die Inbox zeigt den Gate-Fehlschlag, und manuelles Freigeben (Human-Override) bleibt möglich.
2. **Given** ein aktiver Agent „vor Phase Y", **When** der Start von Phase Y ansteht, **Then** startet die Phase erst nach PASS; bei FAIL unterbleibt der Start und die Inbox informiert; der laufende Gate-Status ist am Feature sichtbar.
3. **Given** aktive Review-Gate-Agents, **When** die Integration das Review-Gate erreicht, **Then** laufen sie nacheinander; der erste blockierende FAIL beendet das Gate als gescheitert, beratende FAILs werden nur verbucht.
4. **Given** ein Agent-Bericht mit explizit gemeldetem Freigabebedarf, **When** der Lauf abschließt, **Then** entsteht ein eigener Inbox-Eintrag mit Thema und Zugriff auf den Bericht, auch bei PASS.
5. **Given** ein abgeschlossener Agent-Lauf, **When** das Portal oder die Verwaltung ihn anzeigen, **Then** sind Urteil, Zusammenfassung, Bericht und Kosten dauerhaft strukturiert abrufbar.

---

### User Story 8 - Per-Feature-Steuerung und manueller Lauf (Priority: P3)

Der Reviewer passt pro Feature an, welche Agents gelten: einzelne ausschließen (auch globale) oder explizit einschließen (auch deaktivierte), und stößt jeden Agent manuell für ein Feature an, mit direkter Sicht auf das Ergebnis.

**Why this priority**: Feinsteuerung und Escape-Hatch zur Union-Semantik; wertvoll, aber ohne sie funktioniert der Standardpfad bereits.

**Independent Test**: Für ein Feature einen global aktiven Agent ausschließen und prüfen, dass er beim nächsten Auslöser nicht läuft; denselben Agent manuell anstoßen und das Ergebnis einsehen.

**Acceptance Scenarios**:

1. **Given** die Agent-Auswahl eines Features, **When** der Reviewer einen Agent auf „Aus" stellt, **Then** läuft dieser für dieses Feature bei keinem Auslöser mehr.
2. **Given** ein deaktivierter Agent, **When** der Reviewer ihn für ein Feature auf „Ein" stellt, **Then** läuft er für dieses Feature trotz globaler Deaktivierung.
3. **Given** ein Feature mit Arbeitsstand, **When** der Reviewer „Jetzt ausführen" für einen Agent wählt, **Then** startet der Lauf, und Urteil/Zusammenfassung/Kosten erscheinen nach Abschluss; ohne Arbeitsstand wird der Start mit verständlicher Meldung abgelehnt.

---

### User Story 9 - Mitgelieferte Standard-Agents (Priority: P3)

Mit der Umstellung werden drei einsatzbereite Agents ausgeliefert: ein DoR-Gate (prüft vor der Implementierung, ob Spezifikation/Plan/Aufgaben frei von offenen Fragen sind; blockierend), ein Plan-Qualitätsreview (prüft nach der Plan-Phase Evidenz, Pattern-Eignung und Qualitäts-Gates; blockierend, mit explizitem Freigabebedarf für Pattern-Entscheidungen) und eine Kommentar-/Doku-Policy (prüft im Review-Gate auf Meta-Kommentare, redundante DocBlocks und Historie im Code; beratend).

**Why this priority**: Konkretisierung der Meeting-Beschlüsse als Inhalt; technisch nur Daten, setzt US6/US7 voraus.

**Independent Test**: Nach der Umstellung zeigt die Agent-Verwaltung die drei neuen globalen Agents mit korrektem Auslöser und Gate-/Hinweis-Kennzeichnung; ein Probelauf des DoR-Gates auf einem Feature mit offenen Fragen urteilt FAIL mit nummerierter Fragenliste.

**Acceptance Scenarios**:

1. **Given** die aktualisierte Installation, **When** die Agent-Verwaltung geöffnet wird, **Then** existieren die drei Standard-Agents global mit den beschriebenen Auslösern und Verhaltensweisen (DoR: vor Implementierung, blockierend; Plan-Qualität: nach Plan, blockierend; Doku-Policy: Review-Gate, beratend).
2. **Given** das Plan-Qualitätsreview mit Ergebnis „freigegeben mit Änderungen" oder gemeldeten Pattern-Entscheidungen, **When** der Lauf abschließt, **Then** entsteht ein Freigabebedarf-Eintrag in der Inbox trotz bestandenem Gate.

---

### Edge Cases

- Ziel-Branch wird nach der Freigabe, aber vor dem Merge extern gelöscht → Integration schlägt kontrolliert fehl bzw. Aufräumroutinen überspringen mit Warnung; kein Datenverlust am Feature-Branch.
- Neue Commits nach dem Anlegen von Kommentaren → Kommentar-Anker können veralten; sie bleiben erhalten und werden als möglicherweise veraltet gekennzeichnet (v1 akzeptiert Drift).
- Reviewer-Korrektur macht den Build kaputt → erzwungene Re-Verifikation fängt das vor dem Merge ab (setzt konfigurierte Verify-Kommandos voraus).
- Freigabe in neuen Branch, dessen Name während der Eingabe von anderer Seite belegt wird → Validierung beim Ausführen, verständlicher Fehler.
- „Vor Phase"-Gate läuft, während die Phase äußerlich unverändert wirkt → laufender Gate-Status wird am Feature signalisiert; Absturz während des Gates hinterlässt keinen inkonsistenten Zustand (Phase bleibt schlicht ungestartet).
- Manueller Agent-Lauf ohne existierenden Worktree → klare Ablehnung statt fehlerhaftem Lauf.
- Agent-Bericht ohne auswertbares Urteil → wird als fehlgeschlagen/unklar behandelt und angezeigt, nicht stillschweigend als bestanden gewertet.
- Zwei Reviewer bearbeiten dieselbe Datei im Portal → Konfliktschutz meldet die Kollision beim Speichern.
- Migration: bestehende Personas (global und projektspezifisch, inkl. Deaktivierte) erscheinen verlustfrei als Review-Gate-Agents; Reviews aus der Zeit davor bleiben im Portal sichtbar.
- Feature wird zurückgewiesen, nachdem ein Nicht-Default-Ziel gewählt war → die Zielwahl wird zurückgesetzt (nächste Freigabe entscheidet neu).

## Requirements *(mandatory)*

### Functional Requirements

**Review-Übersicht & Portal**

- **FR-001**: Das System MUSS eine projektbezogene Review-Übersicht bereitstellen, die alle Features in den Zuständen „wartet auf menschliche Prüfung", „Verifikation fehlgeschlagen", „Qualitäts-Gate fehlgeschlagen" und „Konflikt eskaliert" auflistet, unterteilt in „Bereit zum Review" und „Braucht Eingriff" (mit Aktion zum erneuten Anstoßen der Integration).
- **FR-002**: Die Review-Übersicht MUSS als eigene Top-Level-Ansicht erreichbar sein und die Anzahl prüfbereiter Features des aktiven Projekts als Badge anzeigen; der bestehende Zugang über die Feature-Karte MUSS dasselbe Portal öffnen.
- **FR-003**: Das Portal MUSS pro geänderter Datei einen zeilennummerierten Diff (alte/neue Zeilennummern) sowie die Commit-Historie des Features anzeigen; bei Features mit automatisch aufgelösten Konflikten MUSS die Konfliktauflösung (vorher/nachher) einsehbar bleiben.
- **FR-004**: Das Portal MUSS Kopf-Kennzahlen zeigen (mindestens: geänderte Dateien/Zeilen, Audit-Stand bestanden/gesamt, Verifikationsstatus).

**Integrations-Entscheidung**

- **FR-005**: Bei der Freigabe MUSS der Reviewer als Integrationsziel einen bestehenden Branch wählen (Vorauswahl: Projekt-Default-Branch) ODER einen neuen Branch mit editierbarem, automatisch vorgeschlagenem Namen anlegen können; Branch-Namen MÜSSEN live validiert werden (Gültigkeit, Kollision, nicht der Feature-Branch selbst).
- **FR-006**: Die Zielwahl MUSS am Feature gespeichert werden und Neustarts überleben; das Anlegen eines neuen Ziel-Branches MUSS idempotent sein („Ziel sicherstellen, dann integrieren"), damit abgebrochene Integrationen gefahrlos wiederaufgenommen werden.
- **FR-007**: Die Integration in ein Nicht-Default-Ziel DARF den Haupt-Arbeitsstand des Projekts NICHT umschalten; der automatische Merge-Pfad ohne menschliche Prüfung MUSS unverändert in den Default-Branch integrieren.
- **FR-008**: Nach Integration in ein Nicht-Default-Ziel MUSS das Ziel am Feature sichtbar sein (z. B. „→ <Ziel>" am Erledigt-Status); Aufräum- und Selbstheilungsroutinen MÜSSEN gegen das tatsächliche Ziel prüfen statt pauschal gegen den Default-Branch.
- **FR-009**: Im PR-Modus MUSS ein neu angelegter Ziel-Branch vor dem Erstellen des Pull Requests veröffentlicht und als PR-Basis verwendet werden.
- **FR-010**: Beim Zurückweisen MUSS eine gewählte Nicht-Default-Zielwahl zurückgesetzt werden.

**Reviewer-Kommentare**

- **FR-011**: Reviewer MÜSSEN Kommentare an Datei + Zeile + Seite (alt/neu) oder an der Datei allgemein verankern können; Kommentare sind flach (keine Threads), dauerhaft gespeichert und als offen/erledigt markierbar; Änderungen MÜSSEN allen offenen Ansichten zeitnah signalisiert werden.
- **FR-012**: Beim Zurückweisen MÜSSEN alle offenen Kommentare plus optionaler Freitext zu einem strukturierten, deutschsprachigen Arbeitsauftrag kompiliert und an die Feature-Konsole übergeben werden.

**Dateibrowser & Editor**

- **FR-013**: Das Portal MUSS den Dateibaum des Feature-Arbeitsstands anzeigen und Text-Dateien zum Lesen öffnen; Binärdateien und Dateien über einer Größengrenze werden als nicht editierbar ausgewiesen; Zugriffe außerhalb des Arbeitsstands MÜSSEN verhindert werden.
- **FR-014**: Text-Dateien MÜSSEN im Portal editier- und speicherbar sein (Markdown mit Vorschau), ausschließlich solange das Feature auf menschliche Prüfung wartet; gleichzeitige Fremdänderungen MÜSSEN beim Speichern als Konflikt gemeldet werden statt zu überschreiben.
- **FR-015**: Bei der Freigabe MÜSSEN ungesicherte Reviewer-Korrekturen als gekennzeichnete Reviewer-Änderung übernommen werden und eine erneute Verifikation vor dem Merge erzwingen.

**Test- & Audit-Anzeige**

- **FR-016**: Das Portal MUSS ein Verifikations-Dashboard zeigen: pro Verify-Lauf Status, Dauer, Logs sowie Token/Kosten (aufbereitet aus den vorhandenen Verify-Läufen, ohne Test-Report-Parser).
- **FR-017**: Das Portal MUSS alle Agent-Läufe des Features gruppiert nach Auslöser anzeigen (Urteil, Entscheidungs-Label, Zusammenfassung, Kosten, Bericht öffenbar); für Features mit Alt-Berichten aus der Zeit vor der strukturierten Ablage MUSS eine bestmögliche Anzeige aus den abgelegten Berichten erfolgen.

**Agent-Verwaltung**

- **FR-018**: Das System MUSS die bisherigen Review-Personas verlustfrei zu Agents überführen (bestehende Einträge werden blockierende Review-Gate-Agents mit unverändertem Verhalten).
- **FR-019**: Agents MÜSSEN folgende konfigurierbare Eigenschaften haben: Name, Beschreibung, Prompt, Modell (leer = Systemstandard), Auslöser (manuell | Review-Gate | nach Phase <P> | vor Phase <P>), blockierend/beratend, aktiv/inaktiv, Reihenfolge, Geltungsbereich (global oder projektspezifisch).
- **FR-020**: Für ein Projekt MÜSSEN globale UND projektspezifische Agents gemeinsam gelten (Union); pro Feature MÜSSEN einzelne Agents aus- oder eingeschlossen werden können (Ausschluss gewinnt; expliziter Einschluss aktiviert auch deaktivierte Agents).
- **FR-021**: Eine Verwaltungs-Ansicht MUSS Anlegen, Bearbeiten, Umordnen, De-/Aktivieren und Löschen von Agents ermöglichen (deutschsprachig, getrennt nach global/Projekt, mit Auslöser-, Gate-/Hinweis- und Modell-Kennzeichnung sowie letztem Urteil).
- **FR-022**: Pro Feature MUSS eine Ansicht die effektiv geltenden Agents mit Aktivierungs-Status (automatisch/ein/aus), letztem Lauf und der Aktion „Jetzt ausführen" bieten; manuelle Läufe ohne Arbeitsstand MÜSSEN abgelehnt werden.

**Agent-Ausführung & Gates**

- **FR-023**: Agents MÜSSEN an ihren Auslösern automatisch laufen: nach Phasenabschluss (vor dem automatischen Fortschritt), vor Phasenstart (Start wird bis PASS zurückgestellt; laufender Gate-Status wird signalisiert) und im Review-Gate der Integration (nacheinander in konfigurierter Reihenfolge).
- **FR-024**: Ein blockierender FAIL MUSS den automatischen Fortschritt bzw. das Gate stoppen und einen Inbox-Eintrag erzeugen; manuelles Übersteuern durch den Menschen MUSS möglich bleiben. Beratende FAILs werden nur verbucht und stoppen nichts.
- **FR-025**: Jeder Agent-Lauf MUSS strukturiert und dauerhaft abgelegt werden: Agent (inkl. Namens-Schnappschuss), Feature, Auslöser, Urteil (PASS/FAIL/unklar), Entscheidungs-Label, Zusammenfassung, Berichts-Ablage, Zeitpunkte, Verknüpfung zu Kosten/Token des Laufs; Berichte ohne auswertbares Urteil DÜRFEN NICHT als bestanden gewertet werden.
- **FR-026**: Meldet ein Bericht expliziten menschlichen Freigabebedarf (auch bei PASS), MUSS ein eigener Inbox-Eintrag mit Thema und Berichts-Zugriff entstehen; Inbox-Einträge zu Gates MÜSSEN sich bei Freigabe/Verwerfen/Neustart der betroffenen Phase selbst auflösen.
- **FR-027**: Der bestehende Automatik-Schalter für Review-Agents MUSS weiterhin ausschließlich das Review-Gate steuern; Phasen-Gates laufen unabhängig davon (Steuerung über aktiv/blockierend/Feature-Override).
- **FR-028**: Ein konfiguriertes Agent-Modell MUSS beim Lauf tatsächlich verwendet werden.

**Standard-Agents**

- **FR-029**: Drei globale Standard-Agents MÜSSEN ausgeliefert werden: DoR-Gate (vor Implementierungs-Phase, blockierend; prüft auf offene Fragen/ungeklärte Annahmen/prüfbare Akzeptanzkriterien, FAIL mit nummerierter Fragenliste), Plan-Qualitätsreview (nach Plan-Phase, blockierend; Evidenz vor Vermutung, Qualitätsprofile, Pattern-Eignung, adversarialer Gegencheck; meldet Pattern-/Änderungs-Entscheidungen als Freigabebedarf) und Kommentar-/Doku-Policy (Review-Gate, beratend; prüft auf Meta-Kommentare, redundante DocBlocks, Ticketnummern/Historie im Code).

### Key Entities

- **Agent**: Konfigurierbare Prüf-/Arbeitseinheit mit Name, Beschreibung, Prompt, Modell, Auslöser, blockierend/beratend, aktiv/inaktiv, Reihenfolge, Geltungsbereich (global/Projekt). Nachfolger der bisherigen Review-Persona.
- **Agent-Lauf**: Strukturiertes, dauerhaftes Ergebnis einer Agent-Ausführung für ein Feature: Urteil, Entscheidungs-Label, Zusammenfassung, Berichts-Ablage, Auslöser, Zeitpunkte, Kosten-Verknüpfung.
- **Reviewer-Kommentar**: Flacher, persistierter Kommentar mit optionalem Anker (Datei, Zeile, Seite alt/neu), Status offen/erledigt, zugehörig zu einem Feature.
- **Integrationsziel**: Am Feature gespeicherte Zielwahl der Integration (leer = Default-Branch; sonst bestehender oder neu anzulegender Branch).
- **Feature-Agent-Auswahl**: Per-Feature-Override (einschließen/ausschließen) gegenüber der automatischen Agent-Geltung.
- **Review-Übersichtseintrag**: Verdichtete Sicht eines integrationsnahen Features (Zustand, Kennzahlen, Audit-Stand) für die Review-Ansicht.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Ein Reviewer erkennt in unter 10 Sekunden nach Öffnen der Review-Ansicht, welche Features prüfbereit sind und welche Eingriff brauchen — ohne einzelne Feature-Karten abzuklappern.
- **SC-002**: Ein vollständiger Review (Diff sichten, 2 Kommentare, Freigabe in neuen Branch) ist ohne Verlassen des Portals und ohne Kommandozeile durchführbar.
- **SC-003**: 100 % der Zurückweisungen enthalten alle offenen Kommentare mit Datei-/Zeilen-Bezug im erzeugten Arbeitsauftrag.
- **SC-004**: Trivial-Korrekturen (z. B. Tippfehler) sind ohne Zurückweisungs-Schleife direkt im Portal erledigbar; jede solche Korrektur durchläuft vor dem Merge nachweisbar eine erneute Verifikation.
- **SC-005**: Nach der Umstellung verhalten sich alle zuvor angelegten Review-Personas unverändert (gleiche Reihenfolge, gleiche Gate-Wirkung), ohne dass ein Nutzer eingreifen muss.
- **SC-006**: Ein neu angelegter Agent mit Phasen-Auslöser wird beim nächsten passenden Phasenübergang ohne weitere Konfiguration wirksam; ein blockierender FAIL verhindert in 100 % der Fälle den automatischen Fortschritt, bis ein Mensch entscheidet.
- **SC-007**: Jeder Agent-Lauf ist im Portal mit Urteil, Zusammenfassung und Kosten auffindbar; kein Lauf ohne auswertbares Urteil wird als bestanden angezeigt.
- **SC-008**: Die Integration in einen Nicht-Default-Branch lässt den Default-Branch und den Haupt-Arbeitsstand in 100 % der Fälle unverändert.

## Assumptions

- Ein detaillierter, mit dem Nutzer abgestimmter technischer Umsetzungsplan liegt aus dem Planungsgespräch vor und ist für die Plan-Phase verbindlich (u. a. Union-Semantik, beratende Doku-Policy, Zielwahl nur im Portal, Re-Verify nach Reviewer-Edits).
- Die vorhandene Merge-/Queue-Infrastruktur (Verifikation, Review-Gate, Merge, Selbstheilung) bleibt Grundlage; das Feature erweitert sie, ersetzt sie nicht.
- Verify-Kommandos sind projektseitig konfiguriert, wo die erzwungene Re-Verifikation greifen soll; ohne konfigurierte Kommandos gilt der bestehende Verhaltens-Standard.
- Urteils-Auswertung der Agent-Berichte bleibt konventionsbasiert (ausgewiesene Urteils-Zeile im Bericht); das Vertrauensmodell gegenüber heute ändert sich nicht.
- Kommentar-Anker dürfen bei nachträglichen Commits veralten (v1); eine Anker-Neuberechnung ist bewusst außerhalb des Umfangs.
- Einzelnutzer-/Kleinteam-Betrieb wie bisher; keine Rechte-/Rollentrennung zwischen Reviewern erforderlich.
- Die Sprache der Oberfläche ist Deutsch (bestehende Konvention).
