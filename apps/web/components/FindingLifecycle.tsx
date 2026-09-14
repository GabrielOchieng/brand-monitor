"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { apiFetch } from "../lib/api";

const STATUSES = ["new", "investigating", "confirmed", "false_positive", "resolved"] as const;

interface Member {
  userId: string;
  email: string;
  role: string;
}

interface Note {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export function FindingLifecycle({
  findingId,
  initialStatus,
  initialAssigneeId,
  initialTags,
}: {
  findingId: string;
  initialStatus: string;
  initialAssigneeId: string | null;
  initialTags: string[];
}) {
  const { getToken } = useAuth();
  const [status, setStatus] = useState(initialStatus);
  const [assigneeId, setAssigneeId] = useState(initialAssigneeId ?? "");
  const [tagsInput, setTagsInput] = useState(initialTags.join(", "));
  const [members, setMembers] = useState<Member[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNotes = useCallback(async () => {
    const token = await getToken();
    const data = await apiFetch<Note[]>(`/api/findings/${findingId}/notes`, token);
    setNotes(data);
  }, [getToken, findingId]);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const data = await apiFetch<Member[]>("/api/organization/members", token);
        setMembers(data);
      } catch {
        // assignee dropdown just stays empty on failure -- non-critical
      }
      loadNotes().catch(() => {});
    })();
  }, [getToken, loadNotes]);

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      await apiFetch(`/api/findings/${findingId}`, token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(next: string) {
    setStatus(next);
    await patch({ status: next });
  }

  async function handleAssigneeChange(next: string) {
    setAssigneeId(next);
    await patch({ assigneeId: next || null });
  }

  async function handleTagsBlur() {
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    await patch({ tags });
  }

  async function handleAddNote(e: React.FormEvent) {
    e.preventDefault();
    if (!newNote.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      await apiFetch(`/api/findings/${findingId}/notes`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: newNote }),
      });
      setNewNote("");
      await loadNotes();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card mt-6 p-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label">Status</label>
          <select
            value={status}
            onChange={(e) => handleStatusChange(e.target.value)}
            disabled={saving}
            className="field mt-1 w-full"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Assignee</label>
          <select
            value={assigneeId}
            onChange={(e) => handleAssigneeChange(e.target.value)}
            disabled={saving}
            className="field mt-1 w-full"
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.email}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Tags</label>
          <input
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            onBlur={handleTagsBlur}
            placeholder="comma, separated, tags"
            disabled={saving}
            className="field mt-1 w-full"
          />
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-6">
        <h3 className="label">Notes</h3>
        <ul className="mt-2 space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink-muted">
              <div>{n.body}</div>
              <div className="mt-1 text-xs text-ink-subtle">{new Date(n.createdAt).toLocaleString()}</div>
            </li>
          ))}
          {notes.length === 0 && <li className="text-sm text-ink-subtle">No notes yet.</li>}
        </ul>
        <form onSubmit={handleAddNote} className="mt-3 flex gap-2">
          <input
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Add a note…"
            className="field flex-1"
          />
          <button type="submit" disabled={saving} className="btn-primary">
            Add
          </button>
        </form>
      </div>
    </section>
  );
}
