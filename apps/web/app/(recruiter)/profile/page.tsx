import { PageHeader } from "@/components/PageHeader";
import { ProfileContainer } from "@/containers/ProfileContainer";

export default function ProfilePage() {
  return (
    <>
      <PageHeader title="Profile" description="Your account and session." />
      <main className="flex-1 px-8 py-6">
        <ProfileContainer />
      </main>
    </>
  );
}
