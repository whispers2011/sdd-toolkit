import { app, BrowserWindow, Menu, dialog, shell, nativeTheme } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * App-Hülle für das SDD-Toolkit. Der Fastify-Server läuft als eigener
 * Kindprozess (Electron-Binary im Node-Modus), das Fenster zeigt dessen
 * ausgeliefertes Web-Bundle. Zwei Betriebsarten:
 *
 *  - **eigener Server** (Normalfall): wir starten ihn, wir beenden ihn.
 *  - **angehängt**: läuft auf 4820 bereits ein SDD-Server (typisch `pnpm dev`),
 *    zeigen wir nur dessen UI. Beim Beenden bleibt er unangetastet — zwei
 *    Prozesse auf derselben SQLite-Datei wären sonst ein Datenrisiko.
 */

const DEFAULT_PORT = Number(process.env.SDD_PORT ?? 4820);
const DATA_DIR = process.env.SDD_DATA_DIR ?? join(homedir(), '.sdd-toolkit');
const WINDOW_STATE = join(DATA_DIR, 'desktop-window.json');

/**
 * Server-, Web- und Modulverzeichnis liegen in der gepackten App bewusst
 * NEBEN dem asar-Archiv (`asarUnpack`): Der Server läuft als eigener Prozess
 * mit nativen Modulen — echte Dateipfade ersparen jede asar-Sonderbehandlung.
 */
const RESOURCE_ROOT = app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked') : __dirname;
const SERVER_ENTRY = join(RESOURCE_ROOT, 'server', 'index.js');
const WEB_DIR = join(RESOURCE_ROOT, 'web');

interface WindowBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

let win: BrowserWindow | null = null;
let serverProc: ChildProcess | null = null;
let serverUrl = '';
let attached = false;
let shuttingDown = false;

// ---------------------------------------------------------------- Port-Wahl

/** Antwortet auf dem Port ein SDD-Server (nicht irgendein Dienst)? */
async function probeSdd(port: number, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/state`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { projects?: unknown };
    return Array.isArray(body.projects);
  } catch {
    return false;
  }
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

async function resolveTarget(): Promise<{ port: number; attach: boolean }> {
  if (await probeSdd(DEFAULT_PORT)) return { port: DEFAULT_PORT, attach: true };
  if (await portFree(DEFAULT_PORT)) return { port: DEFAULT_PORT, attach: false };
  for (let port = DEFAULT_PORT + 1; port <= DEFAULT_PORT + 40; port++) {
    if (await portFree(port)) return { port, attach: false };
  }
  throw new Error(`Kein freier Port im Bereich ${DEFAULT_PORT}–${DEFAULT_PORT + 40}.`);
}

// ------------------------------------------------------------ Serverprozess

function startServer(port: number): ChildProcess {
  mkdirSync(join(DATA_DIR, 'logs'), { recursive: true });
  const log = createWriteStream(join(DATA_DIR, 'logs', 'desktop-server.log'), { flags: 'a' });
  log.write(`\n=== ${new Date().toISOString()} — Start auf Port ${port} ===\n`);

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: dirname(SERVER_ENTRY),
    env: {
      ...process.env,
      // Electron-Binary als reines Node ausführen.
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      SDD_PORT: String(port),
      SDD_HOST: '127.0.0.1',
      SDD_WEB_DIR: WEB_DIR,
      SDD_DATA_DIR: DATA_DIR,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (chunk: Buffer) => {
    log.write(chunk);
    process.stdout.write(`[server] ${chunk}`);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    log.write(chunk);
    process.stderr.write(`[server] ${chunk}`);
  });

  child.on('exit', (code, signal) => {
    log.write(`=== Ende (code=${code}, signal=${signal}) ===\n`);
    if (shuttingDown) return;
    serverProc = null;
    void onServerCrashed(code);
  });

  return child;
}

async function onServerCrashed(code: number | null): Promise<void> {
  const logPath = join(DATA_DIR, 'logs', 'desktop-server.log');
  const { response } = await dialog.showMessageBox({
    type: 'error',
    message: 'Der SDD-Server wurde unerwartet beendet.',
    detail: `Exit-Code ${code ?? '—'}.\n\nProtokoll: ${logPath}`,
    buttons: ['Neu starten', 'Protokoll zeigen', 'Beenden'],
    defaultId: 0,
    cancelId: 2,
  });
  if (response === 1) {
    shell.showItemInFolder(logPath);
    return;
  }
  if (response === 2) {
    app.quit();
    return;
  }
  try {
    await boot();
  } catch (err) {
    dialog.showErrorBox('Neustart fehlgeschlagen', String(err));
    app.quit();
  }
}

async function waitForServer(port: number, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (serverProc && serverProc.exitCode !== null) {
      throw new Error(`Server beendete sich beim Start (Exit-Code ${serverProc.exitCode}).`);
    }
    if (await probeSdd(port, 1000)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server antwortete nicht innerhalb von ${Math.round(timeoutMs / 1000)} s.`);
}

// ------------------------------------------------------------------ Fenster

function loadBounds(): WindowBounds {
  try {
    const saved = JSON.parse(readFileSync(WINDOW_STATE, 'utf8')) as WindowBounds;
    if (typeof saved.width === 'number' && typeof saved.height === 'number') return saved;
  } catch {
    /* erster Start */
  }
  return { width: 1500, height: 950 };
}

function saveBounds(): void {
  if (!win || win.isDestroyed() || win.isFullScreen()) return;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(WINDOW_STATE, JSON.stringify(win.getNormalBounds()));
  } catch {
    /* Fensterposition ist kein kritischer Zustand */
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...loadBounds(),
    minWidth: 1024,
    minHeight: 700,
    title: 'SDD Toolkit',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#09090b' : '#f4f4f5',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });

  window.once('ready-to-show', () => window.show());
  window.on('close', saveBounds);
  window.on('closed', () => {
    win = null;
  });

  // Externe Links (Jira, Doku) gehören in den Browser, nicht in die App.
  const isInternal = (url: string) => !!serverUrl && url.startsWith(serverUrl);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url) && !isInternal(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://') || isInternal(url)) return;
    event.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });

  void window.loadFile(join(__dirname, 'splash.html'));
  return window;
}

// -------------------------------------------------------------------- Menü

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'SDD Toolkit',
      submenu: [
        { role: 'about', label: 'Über SDD Toolkit' },
        { type: 'separator' },
        { role: 'services', label: 'Dienste' },
        { type: 'separator' },
        { role: 'hide', label: 'SDD Toolkit ausblenden' },
        { role: 'hideOthers', label: 'Andere ausblenden' },
        { role: 'unhide', label: 'Alle einblenden' },
        { type: 'separator' },
        { role: 'quit', label: 'SDD Toolkit beenden' },
      ],
    },
    {
      label: 'Bearbeiten',
      submenu: [
        { role: 'undo', label: 'Widerrufen' },
        { role: 'redo', label: 'Wiederholen' },
        { type: 'separator' },
        { role: 'cut', label: 'Ausschneiden' },
        { role: 'copy', label: 'Kopieren' },
        { role: 'paste', label: 'Einsetzen' },
        { role: 'selectAll', label: 'Alles auswählen' },
      ],
    },
    {
      label: 'Ansicht',
      submenu: [
        { role: 'reload', label: 'Neu laden' },
        { role: 'forceReload', label: 'Neu laden (Cache leeren)' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Originalgröße' },
        { role: 'zoomIn', label: 'Größer' },
        { role: 'zoomOut', label: 'Kleiner' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Vollbild' },
        { role: 'toggleDevTools', label: 'Entwicklerwerkzeuge' },
      ],
    },
    {
      label: 'Fenster',
      submenu: [
        { role: 'minimize', label: 'Im Dock ablegen' },
        { role: 'zoom', label: 'Zoomen' },
        { type: 'separator' },
        { role: 'front', label: 'Alle nach vorne bringen' },
      ],
    },
    {
      label: 'Hilfe',
      submenu: [
        {
          label: 'Server-Protokoll zeigen',
          click: () => shell.showItemInFolder(join(DATA_DIR, 'logs', 'desktop-server.log')),
        },
        {
          label: 'Datenverzeichnis öffnen',
          click: () => void shell.openPath(DATA_DIR),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// -------------------------------------------------------------------- Start

async function boot(): Promise<void> {
  const target = await resolveTarget();
  attached = target.attach;
  serverUrl = `http://127.0.0.1:${target.port}`;

  if (!attached) serverProc = startServer(target.port);
  await waitForServer(target.port);

  if (!win) win = createWindow();
  await win.loadURL(serverUrl);

  if (attached) {
    // Sichtbar machen, dass hier ein fremder Serverprozess bedient wird —
    // Beenden der App stoppt ihn NICHT.
    win.on('page-title-updated', (event) => event.preventDefault());
    win.setTitle(`SDD Toolkit — externer Server (Port ${target.port})`);
  }
}

// ---------------------------------------------------------------- Lebenszyklus

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    buildMenu();
    try {
      await boot();
    } catch (err) {
      dialog.showErrorBox('SDD Toolkit konnte nicht starten', String(err));
      app.quit();
    }

    app.on('activate', () => {
      if (win) return;
      win = createWindow();
      void win.loadURL(serverUrl);
    });
  });

  // macOS-Konvention: Fenster zu heißt nicht App zu. Der Server läuft weiter,
  // die laufenden Claude-Sitzungen bleiben unberührt.
  app.on('window-all-closed', () => {
    /* bewusst leer */
  });

  /**
   * Sauberes Beenden: Der Server nimmt SIGTERM entgegen, sichert Snapshots und
   * beendet alle Sitzungen. Erst danach darf Electron gehen — sonst bleiben
   * Claude-Prozesse verwaist zurück.
   */
  app.on('before-quit', (event) => {
    if (shuttingDown || !serverProc || serverProc.exitCode !== null) return;
    event.preventDefault();
    shuttingDown = true;
    saveBounds();

    const proc = serverProc;
    const hardKill = setTimeout(() => proc.kill('SIGKILL'), 15_000);
    proc.once('exit', () => {
      clearTimeout(hardKill);
      app.exit(0);
    });
    proc.kill('SIGTERM');
  });

  // Beendet das System die App (Abmelden, Neustart, `kill`), fährt Electron
  // ohne Umweg über before-quit herunter — der Serverprozess bliebe als Waise
  // samt laufender Claude-Sitzungen zurück. Über app.quit() umleiten.
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(signal, () => app.quit());
  }
}
