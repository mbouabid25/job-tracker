import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listMailAccounts, deleteMailAccount } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const accounts = listMailAccounts(session.user.email);
  return NextResponse.json({ accounts });
}

export async function DELETE(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  deleteMailAccount(session.user.email, id);
  return NextResponse.json({ ok: true });
}
