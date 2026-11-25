"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { fullDate, statusLabel, timeAgo } from "../lib/format";
import { Panel, PanelBody, PanelHeader, SectionTitle } from "./ui/Panel";
import { Field, Input, Select } from "./ui/Field";
import { Button } from "./ui/Button";

const STATUSES = ["new", "investigating", "confirmed", "false_positive", "resolved"] as const;

interface Member {
  userId: string;
  email: string;
  name?: string | null;
  role: string;
}

interface Note {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
}

type Props = {
  findingId: string;
  status: string;
  // The page owns the status (its header buttons change it too); this asks it to change.
  onStatusChange: (next: string) => void;
  initialAssigneeId: string | null;
  initialTags: string[];
  canEdit: boolean;
};

// Status, assignee, tags and the team's notes on one threat.
export function FindingLifecycle({ findingId, status, onStatusChange, initialAssigneeId, initialTags, canEdit }: Props) {
  const [assigneeId, setAssigneeId] = useState(initialAssigneeId ?? "");
  const [tagsInput, setTagsInput] = useState(initialTags.join(", "));
  const [members, setMembers] = useState<Member[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNotes = useCallback(async () => {
    setNotes(await apiFetch<Note[]>(`/api/findings/${findingId}/notes`));
  }, [findingId]);

  useEffect(() => {
    apiFetch<Member[]>("/api/organization/members")
      .then(setMembers)
      .catch(() => {
        // The assignee list just stays empty: non-critical.
      });
    loadNotes().catch(() => {});
  }, [loadNotes]);

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/findings/${findingId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!newNote.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/findings/${findingId}/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: newNote }) });
      setNewNote("");
      await loadNotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const memberLabel = (id: string): string => {
    const m = members.find((x) => x.userId === id);
    return m ? m.name || m.email : "Someone";
  };

  return (
    <Panel>
      <PanelHeader title="Triage" />
      <PanelBody className="flex flex-col gap-3">
        <Field label="Status" htmlFor="lc-status">
          <Select id="lc-status" value={status} onChange={(e) => onStatusChange(e.target.value)} disabled={!canEdit}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Assignee" htmlFor="lc-assignee">
          <Select
            id="lc-assignee"
            value={assigneeId}
            disabled={saving || !canEdit}
            onChange={(e) => {
              setAssigneeId(e.target.value);
              patch({ assigneeId: e.target.value || null });
            }}
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name || m.email}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tags" htmlFor="lc-tags" hint={canEdit ? "Comma-separated. Saved when you leave the field." : undefined}>
          <Input
            id="lc-tags"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            onBlur={() =>
              patch({
                tags: tagsInput
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean),
              })
            }
            placeholder="campaign-nov, whatsapp"
            disabled={saving || !canEdit}
          />
        </Field>
        {error && <p className="text-[13px] text-sev-critical">{error}</p>}

        <div className="mt-1 border-t border-border pt-3">
          <SectionTitle>Notes</SectionTitle>
          <ul className="flex flex-col gap-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded-md border border-border bg-background px-3 py-2 text-[13px]">
                <div className="whitespace-pre-wrap">{n.body}</div>
                <div className="mt-1 text-xs text-subtle" title={fullDate(n.createdAt)}>
                  {memberLabel(n.authorId)} · {timeAgo(n.createdAt)}
                </div>
              </li>
            ))}
            {notes.length === 0 && <li className="text-xs text-subtle">No notes yet.</li>}
          </ul>
          {canEdit && (
            <form onSubmit={addNote} className="mt-2.5 flex gap-2">
              <Input aria-label="New note" value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Add a note for the team…" />
              <Button type="submit" disabled={saving || !newNote.trim()}>
                Add
              </Button>
            </form>
          )}
        </div>
      </PanelBody>
    </Panel>
  );
}
