import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import EntryForm from "@/components/EntryForm";

export default async function NewEntryPage() {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }

  return <EntryForm />;
}
