import { TeamMembers } from "../../components/TeamMembers";

export default function TeamPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Team</h1>
      <p className="mt-1 text-sm text-ink-subtle">
        Manage teammates' access. Only an owner can change roles.
      </p>
      <TeamMembers />
    </div>
  );
}
