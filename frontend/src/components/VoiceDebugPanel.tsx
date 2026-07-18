"use client";

import { useEffect, useMemo, useState } from "react";
import {
  clearVoiceDebugEntries,
  formatVoiceDebugLogsForCopy,
  getVoiceDebugEntries,
  isVoiceDebugPanelEnabled,
  subscribeVoiceDebugEntries,
  type VoiceDebugLogEntry,
} from "@/lib/natalie/voiceRecordingDebug";

function formatCell(value: string | number | undefined): string {
  if (value === undefined || value === "") return "—";
  return String(value);
}

function VoiceDebugRow({ entry }: { entry: VoiceDebugLogEntry }) {
  return (
    <div className="border-b border-[#dbeafe] px-2 py-1.5 text-[10px] leading-4 text-[#0f172a]">
      <div className="font-bold text-[#1d4ed8]">{entry.event}</div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[#334155]">
        <span>time: {entry.at.slice(11, 23)}</span>
        <span>rms: {formatCell(entry.rms)}</span>
        <span>threshold: {formatCell(entry.threshold)}</span>
        <span>recorder: {formatCell(entry.recorderState)}</span>
        <span>ctx: {formatCell(entry.audioContextState)}</span>
        <span>chunk: {formatCell(entry.chunkSize)}</span>
        <span className="col-span-2">trigger: {formatCell(entry.trigger)}</span>
      </div>
    </div>
  );
}

export function VoiceDebugPanel() {
  const [enabled, setEnabled] = useState(false);
  /** Collapsed by default so even with ?voiceDebug=1 it does not cover bottom nav/CTAs. */
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<VoiceDebugLogEntry[]>([]);
  const [copyStatus, setCopyStatus] = useState<string>("");

  useEffect(() => {
    setEnabled(isVoiceDebugPanelEnabled());
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setEntries(getVoiceDebugEntries());
    return subscribeVoiceDebugEntries(() => {
      setEntries(getVoiceDebugEntries());
    });
  }, [enabled]);

  const copyText = useMemo(() => formatVoiceDebugLogsForCopy(entries), [entries]);

  if (!enabled) return null;

  async function handleCopy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(copyText);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = copyText;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Copy failed");
    }
    window.setTimeout(() => setCopyStatus(""), 2000);
  }

  return (
    <div
      className="fixed bottom-2 left-2 z-[120] w-[min(92vw,360px)] overflow-hidden rounded-xl border border-[#93c5fd] bg-white/95 shadow-[0_12px_40px_rgba(15,23,42,0.18)] backdrop-blur"
      dir="ltr"
    >
      <div className="flex items-center justify-between border-b border-[#dbeafe] bg-[#eff6ff] px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="text-left text-[11px] font-extrabold text-[#1d4ed8]"
        >
          Voice Debug ({entries.length}) {open ? "▾" : "▸"}
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              clearVoiceDebugEntries();
              setCopyStatus("");
            }}
            className="rounded px-1.5 py-0.5 text-[10px] font-bold text-[#475569] hover:bg-[#dbeafe]"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="rounded bg-[#1d5bff] px-2 py-0.5 text-[10px] font-bold text-white"
          >
            Copy logs
          </button>
        </div>
      </div>
      {copyStatus && (
        <div className="border-b border-[#dbeafe] px-2 py-1 text-[10px] font-bold text-[#15803d]">{copyStatus}</div>
      )}
      {open && (
        <div className="max-h-52 overflow-y-auto bg-white">
          {entries.length === 0 ? (
            <div className="px-2 py-3 text-[10px] text-[#64748b]">No voice-debug events yet.</div>
          ) : (
            entries.map((entry) => <VoiceDebugRow key={entry.id} entry={entry} />)
          )}
        </div>
      )}
    </div>
  );
}
