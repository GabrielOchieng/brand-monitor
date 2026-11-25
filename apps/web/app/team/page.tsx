import { TeamMembers } from "../../components/TeamMembers";
import { PageHeader } from "../../components/ui/PageHeader";

export const metadata = { title: "Team" };

export default function TeamPage() {
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Team"
        description="Who can see and act on your threats. Viewers can only look; analysts triage threats and send takedown reports; admins also change settings and invite people; owners manage roles and automatic reporting."
      />
      <TeamMembers />
    </div>
  );
}
