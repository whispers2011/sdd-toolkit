# Sicherheit

> **English summary:** This tool is a local developer workstation utility. It has **no
> authentication whatsoever** and can spawn shell sessions, run editor commands and read
> and write arbitrary files in your projects. Bind it to `127.0.0.1` only. Never expose it
> to a network, and never put it behind a reverse proxy. Treat access to the port as
> equivalent to a shell on the machine.

## Bedrohungsmodell in einem Satz

Wer den Server-Port erreicht, kann auf der Maschine tun, was der Benutzer tun kann, unter
dem der Server läuft. Es gibt keine Zwischenstufe.

## Warum das so ist

Das Toolkit ist bewusst ein **lokales Werkzeug für den eigenen Rechner**. Diese
Eigenschaften sind Absicht, nicht Versehen — aber sie machen jede Netzwerk-Exposition
gefährlich:

- **Keine Authentifizierung.** Die HTTP-API und die WebSocket-Verbindung prüfen weder
  Token noch Session noch Herkunft. Jeder Request wird ausgeführt.
- **Shell-Sessions über die API.** Die API kann PTY-Sessions vom Typ `shell` starten
  (`packages/server/src/api/server.ts`). Das ist eine interaktive Shell auf der Maschine.
- **Editor-Kommandos.** Pro Projekt konfigurierbar (`editorCmd`, Default `code -g {file}:{line}`)
  und über die API auslösbar.
- **Datei-Zugriff.** Projektdateien und Spec-Artefakte lassen sich über die API lesen und
  schreiben.
- **Auto-Modus startet Agenten mit `bypassPermissions`.** Ist der Automation-Dial auf
  Level 3, laufen Claude-Sessions mit `permissionMode: 'bypassPermissions'`
  (`packages/server/src/services/orchestrator.ts` und `.../chatWorkService.ts`) — der Agent führt
  Kommandos ohne Rückfrage aus.
- **Hinterlegte Fremd-Zugangsdaten.** Im Datenverzeichnis (`~/.sdd-toolkit`) liegen je nach
  Nutzung die Atlassian-OAuth-Tokens (`atlassian-mcp.json`) und optional ein API-Key für die
  Sprach-Eingabe (OpenAI/Groq).
- **Inhalte der Datenbank.** `sdd-toolkit.sqlite` hält im Klartext: Projektpfade,
  Jira-Ticketbezüge und importierte Ticketinhalte, Chat-Nachrichten, Wissenseinträge,
  Review-Kommentare sowie Pfade zu Transkripten und Logs.

## Was der Server aktiv abwehrt

Zwei Dinge sind bewusst *keine* Restrisiken, sondern implementiert
(`packages/server/src/api/originGuard.ts`, Tests in `originGuard.test.ts`):

- **Zugriffe fremder Webseiten (CSRF/Drive-by).** HTTP-API und beide WebSocket-Routen
  akzeptieren nur Anfragen mit erlaubtem `Origin` — standardmässig `localhost`, `127.0.0.1`
  und `[::1]` auf API- und Web-Port. Ohne diese Prüfung genügte eine beliebige offene
  Browser-Seite, um über `POST /api/projects/:id/terminal` eine Shell zu starten und ihr
  per WebSocket Kommandos zu schicken; WebSockets unterliegen keiner Same-Origin-Policy.
- **DNS-Rebinding.** Der `Host`-Header muss ebenfalls auf eine erlaubte lokale Adresse
  zeigen. Ein Angreifer-DNS-Name, der auf 127.0.0.1 auflöst, wird damit abgewiesen.

`SDD_ALLOWED_ORIGINS` (kommagetrennt) erweitert die Liste für abweichende Betriebsarten.
Das ist eine bewusste Öffnung — sie hebt den Schutz für die genannten Origins auf.

**Diese Prüfungen ersetzen keine Authentifizierung.** Wer den Port direkt erreicht (nicht
über einen Browser), ist von ihnen nicht betroffen. Die localhost-Regel unten gilt unverändert.

## Sicherer Betrieb

**Die einzige unterstützte Betriebsart ist localhost.**

- Der Server bindet per Default auf `127.0.0.1` (`packages/server/src/config.ts`). **Lass das so.**
- `SDD_HOST` kann diese Bindung auf jede Adresse öffnen — auch `0.0.0.0`. Setze die Variable
  nicht, außer du weißt genau, warum. Es gibt keinen Anwendungsfall, in dem das sicher ist.
- **Stelle das Tool nicht hinter einen Reverse-Proxy.** Ein Proxy fügt keine
  Authentifizierung hinzu; er macht die ungeschützte API nur von weiter weg erreichbar.
- Brauchst du Zugriff von einem anderen Gerät, nutze einen SSH-Tunnel
  (`ssh -L 4820:127.0.0.1:4820 …`) statt die Bindung zu ändern.
- Betreibe das Toolkit nicht auf einer geteilten Maschine, auf der andere Nutzer lokale
  Ports erreichen können.
- Das Datenverzeichnis `~/.sdd-toolkit` enthält Tokens und Logs — behandle es wie `~/.ssh`.

## Schwachstelle melden

Melde Schwachstellen bitte **nicht** über ein öffentliches Issue.

Nutze stattdessen **GitHub Security Advisories**: im Repository unter
*Security → Report a vulnerability*
([whispers2011/sdd-toolkit](https://github.com/whispers2011/sdd-toolkit/security/advisories/new)).

Bitte beschreibe: betroffene Version oder Commit, Reproduktionsschritte und die
tatsächliche Auswirkung. Da es sich um ein privat betriebenes Nebenprojekt handelt, gibt es
keine zugesicherte Reaktionszeit und kein Bug-Bounty.

## Was keine Schwachstelle ist

Die oben genannten Eigenschaften sind dokumentiertes, beabsichtigtes Verhalten eines
lokalen Werkzeugs. Meldungen der Form „die API ist nicht authentifiziert" oder
„`SDD_HOST=0.0.0.0` legt Code-Ausführung offen" beschreiben genau das, wovor dieses
Dokument warnt. Ebenso wenig zählt ein selbst gesetztes `SDD_ALLOWED_ORIGINS`.

Interessant sind dagegen: Wege, die Origin- oder Host-Prüfung zu umgehen, Wege, die
localhost-Bindung ungewollt zu unterlaufen, Pfad-Traversal über die Projektgrenze hinaus
und das Leaken von Tokens oder Datenbankinhalten aus dem Datenverzeichnis.
