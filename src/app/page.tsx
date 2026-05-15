"use client";

import { useEffect, useRef, useState } from "react";
import { Toolbar } from "@/components/toolbar";
import { EditorPane } from "@/components/editor-pane";
import { PreviewPane } from "@/components/preview-pane";
import { TasksSidebar } from "@/components/tasks-sidebar";
import { WelcomeModal } from "@/components/welcome-modal";
import { SettingsModal } from "@/components/settings-modal";
import { ConvertChip } from "@/components/convert-chip";
import { useStore, type AgentInfo } from "@/lib/store";
import { W3KITS_DEFAULT_MODEL } from "@/lib/w3kits-runtime";

export default function Home() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const welcomeAck = useStore((s) => s.welcomeAck);
  const selectedAgent = useStore((s) => s.selectedAgent);
  const setAgents = useStore((s) => s.setAgents);
  const locale = useStore((s) => s.locale);
  const layoutMode = useStore((s) => s.layoutMode);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  // Detect agents on mount so the toolbar's agent chip can resolve the
  // persisted `selectedAgent` to a label without waiting for the user to
  // open Settings or Welcome. Without this, after a hard reload the chip
  // briefly (or permanently) shows "Select agent" even though selection
  // is intact in localStorage.
  useEffect(() => {
    if (!hydrated) return;
    const w3kitsAgent: AgentInfo = {
      id: "w3kits-openai",
      label: "W3Kits AI",
      vendor: "W3Kits",
      available: true,
      protocol: "stdin",
      models: [{ id: "default", label: "Default" }, { id: W3KITS_DEFAULT_MODEL, label: W3KITS_DEFAULT_MODEL }],
    };
    setAgents([w3kitsAgent]);
    useStore.getState().setSelectedAgent("w3kits-openai");
    useStore.getState().setAgentModel("w3kits-openai", W3KITS_DEFAULT_MODEL);
    useStore.getState().setWelcomeAck(true);
  }, [hydrated, setAgents]);

  // Keep <html lang="…"> in sync with the user's locale so screen readers
  // and browser features (autotranslate, hyphenation) pick the right language.
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("lang", locale);
    }
  }, [locale]);

  useEffect(() => {
    if (!hydrated) return;
    setWelcomeOpen(false);
  }, [hydrated, welcomeAck, selectedAgent]);

  return (
    <main className="relative flex h-screen flex-col">
      <Toolbar
        iframeRef={iframeRef}
        onOpenAgentPicker={() => setSettingsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div
        className="flex flex-1 min-h-0"
        style={{ borderTop: "1px solid var(--line-faint)" }}
      >
        <TasksSidebar />
        <div className="relative flex flex-1 min-w-0">
          {layoutMode !== "preview" && (
            <section
              className="flex min-w-0 flex-1 basis-0 flex-col"
              style={
                layoutMode === "split"
                  ? { borderRight: "1px solid var(--line-faint)" }
                  : undefined
              }
            >
              <EditorPane />
            </section>
          )}
          {layoutMode !== "editor" && (
            <section className="flex min-w-0 flex-1 basis-0 flex-col">
              <PreviewPane iframeRef={iframeRef} />
            </section>
          )}
          <ConvertChip />
        </div>
      </div>
      {welcomeOpen && <WelcomeModal onClose={() => setWelcomeOpen(false)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </main>
  );
}
