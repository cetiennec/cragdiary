import { redirect } from "next/navigation";
import { isOwner } from "@/lib/auth";
import EntryForm from "@/components/EntryForm";

export default async function NewEntryPage() {
  if (!(await isOwner())) {
    redirect("/login");
  }

  return (
    <div className="page-container narrow">
      <h1 className="page-title">New entry</h1>
      <EntryForm />
    </div>
  );
}
