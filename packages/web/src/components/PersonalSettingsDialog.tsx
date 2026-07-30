import { Dialog } from './Sidebar.js';

/**
 * Einstellungsbereich „Individuelle Einstellungen" (Contract U6): nutzerweit,
 * projektübergreifend. Drei Abschnitte in fester Reihenfolge — Signaltöne,
 * Darstellung, Vorauswahl Ticket-Quelle (U6.1).
 */
export function PersonalSettingsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Individuelle Einstellungen" onClose={onClose} wide>
      <div className="max-h-[75vh] space-y-5 overflow-y-auto pr-1">
        <Section title="Signaltöne" />
        <Section title="Darstellung" />
        <Section title="Vorauswahl Ticket-Quelle" />
      </div>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 border-b border-zinc-800 pb-1 text-xs font-semibold tracking-wide text-zinc-400 uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}
