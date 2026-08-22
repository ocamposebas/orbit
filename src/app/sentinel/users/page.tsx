import { redirect } from "next/navigation";
import { UserManagement } from "@/components/sentinel/user-management";
import { currentSession } from "@/sentinel/auth/session";

export default async function Page() { const session = await currentSession(); if (!session || !["OWNER", "ADMIN"].includes(session.role)) redirect("/sentinel"); return <UserManagement currentRole={session.role} />; }
