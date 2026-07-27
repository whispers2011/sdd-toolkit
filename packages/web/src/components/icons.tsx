import type { ReactNode } from 'react';

/**
 * Hausinternes SVG-Icon-Set für Wissensdatenbank & Wissens-Chat.
 * Outline-Stil (24er-Grid, stroke-width 2), erbt Farbe via `currentColor`
 * und Größe via `1em`/`className`. Dekorativ per Default (aria-hidden);
 * mit `title` wird das Icon als role="img" + aria-label zugänglich gemacht.
 */
export type IconProps = {
  className?: string;
  title?: string;
};

function Base({ className, title, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable={false}
    >
      {children}
    </svg>
  );
}

/** Wissensdatenbank öffnen (ersetzt 📚). */
export function KnowledgeIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </Base>
  );
}

/** Bundle / verschachtelte Gruppe (ersetzt 📦). */
export function BundleIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </Base>
  );
}

/** Eintrag / Dokument (ersetzt 📄). */
export function EntryIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <line x1="10" y1="9" x2="8" y2="9" />
    </Base>
  );
}

/** Unter-Bundle hinzufügen (ersetzt +📦). */
export function BundlePlusIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </Base>
  );
}

/** Eintrag hinzufügen (ersetzt +📄). */
export function EntryPlusIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="18" x2="12" y2="12" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </Base>
  );
}

/** Bearbeiten (ersetzt ✎). */
export function EditIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
    </Base>
  );
}

/** Löschen (ersetzt 🗑). */
export function DeleteIcon(props: IconProps) {
  return (
    <Base {...props}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </Base>
  );
}

/** Aus Datei neu laden (ersetzt ⟳). */
export function RefreshIcon(props: IconProps) {
  return (
    <Base {...props}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </Base>
  );
}

/** Schließen / Verwerfen (ersetzt ✕). */
export function CloseIcon(props: IconProps) {
  return (
    <Base {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </Base>
  );
}

/** Projekt-/Wissens-Chat öffnen (ersetzt 💬). */
export function ChatIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
    </Base>
  );
}

/** Feature-Vorschlag (ersetzt 💡). */
export function IdeaIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
      <path d="M9 18h6" />
      <path d="M10 22h4" />
    </Base>
  );
}

/** Angenommen / Erfolg (ersetzt ✓). */
export function CheckIcon(props: IconProps) {
  return (
    <Base {...props}>
      <polyline points="20 6 9 17 4 12" />
    </Base>
  );
}

/** Fehler / Warnung (ersetzt ⚠). */
export function WarningIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </Base>
  );
}

/** Neue Unterhaltung (ersetzt ↺). */
export function RestartIcon(props: IconProps) {
  return (
    <Base {...props}>
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </Base>
  );
}

/** Antwort unterbrochen (ersetzt ⏸). */
export function PauseIcon(props: IconProps) {
  return (
    <Base {...props}>
      <line x1="8" y1="4" x2="8" y2="20" />
      <line x1="16" y1="4" x2="16" y2="20" />
    </Base>
  );
}

/** Light-Mode aktiv (Sonne). */
export function SunIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </Base>
  );
}

/** Specify-Ergebnis (spec.md) — Dokument mit Textzeilen. */
export function SpecifyResultIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </Base>
  );
}

/** Dark-Mode aktiv (Mond). */
export function MoonIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </Base>
  );
}

/** Plan-Ergebnis (plan.md + Begleitartefakte) — Blueprint/Karte. */
export function PlanResultIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M9 3 3 5v16l6-2 6 2 6-2V3l-6 2z" />
      <line x1="9" y1="3" x2="9" y2="19" />
      <line x1="15" y1="5" x2="15" y2="21" />
    </Base>
  );
}

/** Tasks-Ergebnis (tasks.md) — Liste mit Häkchen. */
export function TasksResultIcon(props: IconProps) {
  return (
    <Base {...props}>
      <polyline points="3 6 4 7 6 5" />
      <polyline points="3 12 4 13 6 11" />
      <polyline points="3 18 4 19 6 17" />
      <line x1="10" y1="6" x2="21" y2="6" />
      <line x1="10" y1="12" x2="21" y2="12" />
      <line x1="10" y1="18" x2="21" y2="18" />
    </Base>
  );
}

/** Checklist-Ergebnis (checklists/*) — Klemmbrett mit Häkchen. */
export function ChecklistResultIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1z" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <polyline points="9 13 11 15 15 11" />
    </Base>
  );
}

/** Ordner öffnen (Im Finder öffnen) — ersetzt 📂. */
export function FolderOpenIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 14l1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6A2 2 0 0 1 18.45 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2" />
    </Base>
  );
}

/** Code/Editor (Im Editor öffnen) — ersetzt ⌨. */
export function CodeIcon(props: IconProps) {
  return (
    <Base {...props}>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </Base>
  );
}

/** Kopieren (in die Zwischenablage) — ersetzt 📋. */
export function CopyIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Base>
  );
}

/** Info / Erläuterung (Tooltip-Anker) — Kreis mit „i". */
export function InfoIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </Base>
  );
}

/** Aufklapp-Indikator (Chevron nach unten). */
export function ChevronDownIcon(props: IconProps) {
  return (
    <Base {...props}>
      <polyline points="6 9 12 15 18 9" />
    </Base>
  );
}

/** Person / Mensch (User-Prompt, Human-in-the-Loop) — ersetzt 🧑. */
export function UserIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </Base>
  );
}

/** Automatisch (Blitz) — ersetzt ⚡. */
export function BoltIcon(props: IconProps) {
  return (
    <Base {...props}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </Base>
  );
}

/** Agent-Gate / Prüfung (Schild) — ersetzt ⚖. */
export function ShieldIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </Base>
  );
}

/** Verifikation (Klemmbrett mit Häkchen). */
export function VerifyIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1z" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <polyline points="9 14 11 16 15 12" />
    </Base>
  );
}

/** Merge / Integration (Git-Merge) — ersetzt 🔀. */
export function GitMergeIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M6 21V9a9 9 0 0 0 9 9" />
    </Base>
  );
}

/** Fluss-Pfeil nach rechts — ersetzt → / ▶. */
export function ArrowRightIcon(props: IconProps) {
  return (
    <Base {...props}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </Base>
  );
}

/** Hinzufügen (Plus) — ersetzt +. */
export function PlusIcon(props: IconProps) {
  return (
    <Base {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </Base>
  );
}

/** Worktree / abgezweigte Arbeitskopie (Git-Branch-Form). */
export function WorktreeIcon(props: IconProps) {
  return (
    <Base {...props}>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </Base>
  );
}

/** Tool-Einstellungen (Zahnrad). */
export function SettingsIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Base>
  );
}

/**
 * Produktmarke (Kachel + Merge-Graph) — identisch zum Favicon (public/favicon.svg).
 * Nicht Teil des Outline-Sets: eigene Geometrie (32er-Grid) und eigene Flächen,
 * Farben über Tailwind-Utilities, damit der Light-Mode (Skalen-Inversion) greift.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 32 32"
      className={className}
      aria-hidden={true}
      focusable={false}
    >
      <rect width="32" height="32" rx="7.5" className="fill-zinc-900" />
      <rect
        x="0.75"
        y="0.75"
        width="30.5"
        height="30.5"
        rx="6.75"
        fill="none"
        strokeWidth={1.5}
        className="stroke-zinc-700"
      />
      <g fill="none" strokeWidth={2.6} strokeLinecap="round" className="stroke-emerald-400">
        <path d="M10 9v14" />
        <path d="M22 9v2.5a5.5 5.5 0 0 1-5.5 5.5H10" />
      </g>
      <g className="fill-emerald-400">
        <circle cx="10" cy="9" r="2.5" />
        <circle cx="22" cy="9" r="2.5" />
        <circle cx="10" cy="23" r="2.5" />
      </g>
    </svg>
  );
}
