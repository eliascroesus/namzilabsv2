"use server";

import { put, del } from "@vercel/blob";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { getDb } from "@/db/client";
import { userProfiles } from "@/db/schema";

/**
 * YOUR OWN PROFILE — the only writes in the product that are not tenant-scoped.
 *
 * Every other action here starts with `requireOrg()` and walls its query by
 * `org_id`, because everything else belongs to a workspace. A person does not:
 * the same name and picture follow you into every workspace you are a member of,
 * so these are keyed on the WorkOS user id and take no org at all.
 *
 * THAT MAKES THE GATE SIMPLER AND MORE IMPORTANT, not less. There is no rank to
 * check and no membership to verify — the only question is "is this session who
 * it says it is", and the answer is `withAuth({ ensureSignedIn: true })`. The id
 * is taken from the SESSION and never from the form, so a crafted post cannot
 * rename somebody else.
 */

export type Result = { ok: true } | { ok: false; error: string };

const nameSchema = z
  .string()
  .trim()
  .max(60, "That name is too long — 60 characters at most.");

/**
 * WHAT TO CALL YOU. Empty means "go back to my email", which is a real choice
 * rather than a failed save, so it stores NULL instead of refusing.
 */
export async function updateDisplayNameAction(fd: FormData): Promise<Result> {
  const auth = await withAuth({ ensureSignedIn: true });
  const parsed = nameSchema.safeParse(String(fd.get("displayName") ?? ""));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That name won't do." };
  const displayName = parsed.data.length > 0 ? parsed.data : null;

  try {
    await getDb()
      .insert(userProfiles)
      .values({ userId: auth.user.id, displayName, updatedAt: new Date() })
      // UPSERT, because no row is the default — see the table's own note. A
      // profile appears the first time somebody changes something, which keeps
      // the sign-in path free of a write.
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: { displayName, updatedAt: new Date() },
      });
    // The shell draws this name on every route, so every route is stale.
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    console.error("[profile] name write failed", e);
    return { ok: false, error: "That didn't save. Try again." };
  }
}

/**
 * THE LIMITS ON AN UPLOAD, stated here rather than trusted from the browser.
 *
 * A file input's `accept` is a filter for the picker, not a rule — anything can
 * POST to this action — so the type and the size are checked again on the
 * server. 4MB is generous for an avatar that renders at 96px and small enough
 * that a mis-drop of a RAW file fails immediately rather than after a minute.
 */
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export async function uploadAvatarAction(fd: FormData): Promise<Result> {
  const auth = await withAuth({ ensureSignedIn: true });
  const file = fd.get("avatar");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an image first." };
  if (!ALLOWED.has(file.type)) return { ok: false, error: "That has to be a PNG, JPEG, WebP or GIF." };
  if (file.size > MAX_BYTES) return { ok: false, error: "That image is larger than 4MB." };

  /**
   * NO TOKEN, NO SILENT FAILURE. `put` throws a generic error when
   * BLOB_READ_WRITE_TOKEN is missing, which on a first deploy reads to the
   * customer as "uploads are broken" rather than "this environment is not
   * finished". The name change still works without it, so the honest answer is
   * to say which half is unavailable.
   */
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return { ok: false, error: "Image uploads aren't configured on this environment yet." };
  }

  try {
    /**
     * A RANDOM SUFFIX, NOT A STABLE PATH. Overwriting one key per user would be
     * tidier and is wrong: the old image stays in every CDN cache and every
     * browser that has seen it, so a new picture would keep showing as the old
     * one for hours. A fresh URL each time is what makes the change visible
     * immediately, and the previous blob is deleted below.
     */
    const blob = await put(`avatars/${auth.user.id}`, file, {
      access: "public",
      addRandomSuffix: true,
      contentType: file.type,
    });

    const db = getDb();
    const [prev] = await db
      .select({ avatarUrl: userProfiles.avatarUrl })
      .from(userProfiles)
      .where(eq(userProfiles.userId, auth.user.id));

    await db
      .insert(userProfiles)
      .values({ userId: auth.user.id, avatarUrl: blob.url, updatedAt: new Date() })
      .onConflictDoUpdate({ target: userProfiles.userId, set: { avatarUrl: blob.url, updatedAt: new Date() } });

    /**
     * THE OLD PICTURE GOES, AFTER the new one is stored. Deleting first would
     * leave somebody with no avatar if the upload then failed; deleting after
     * means the worst case is one orphaned blob, which costs a fraction of a
     * cent and nothing else. Best-effort for the same reason.
     */
    if (prev?.avatarUrl) await del(prev.avatarUrl).catch(() => {});

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    console.error("[profile] avatar upload failed", e);
    return { ok: false, error: "That didn't upload. Try again." };
  }
}

/** Back to the initials chip — the default, not an absence of one. */
export async function removeAvatarAction(): Promise<Result> {
  const auth = await withAuth({ ensureSignedIn: true });
  try {
    const db = getDb();
    const [prev] = await db
      .select({ avatarUrl: userProfiles.avatarUrl })
      .from(userProfiles)
      .where(eq(userProfiles.userId, auth.user.id));
    await db
      .insert(userProfiles)
      .values({ userId: auth.user.id, avatarUrl: null, updatedAt: new Date() })
      .onConflictDoUpdate({ target: userProfiles.userId, set: { avatarUrl: null, updatedAt: new Date() } });
    if (prev?.avatarUrl) await del(prev.avatarUrl).catch(() => {});
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    console.error("[profile] avatar removal failed", e);
    return { ok: false, error: "That didn't save. Try again." };
  }
}
