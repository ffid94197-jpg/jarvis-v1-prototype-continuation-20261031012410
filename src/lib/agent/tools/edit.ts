/**
 * Native source edit primitive used by JARVIS coding tasks.
 * One bounded replacement ONLY after Guardian has authorized the path and
 * the caller supplies the SHA-256 of the observed complete UTF-8 file.
 *
 * Preserves the existing Core/Guardian ownership model. It is NOT a shell,
 * a second coding agent, or a security-certified cross-process atomic CAS.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { assertWithinRoot, MAX_READ_BYTES, MAX_WRITE_BYTES } from "../guardian/policy";

export const sha256Text = (text: string): string =>
  createHash("sha256").update(text,"utf8").digest("hex");

export interface EditPrepared {
  path: string;
  relPath: string;
  expectedSha256: string;
  oldText: string;
  newText: string;
}

export interface EditOutcome {
  ok: boolean;
  evidence: string;
  detail?: Record<string, unknown>;
  error?: string;
}

/**
 * Fail-closed targeted edit. Refuses symlinks, file growth beyond workspace
 * limits, ambiguous replacements, stale read SHA, and changed file pre-commit.
 *
 * A cooperating editor should not mutate files concurrently with this tool;
 * there is no cross-process transactional filesystem API for a true CAS.
 */
export async function editWorkspaceTextFile(
  prepared: EditPrepared,
  isCancelled: () => boolean = () => false,
): Promise<EditOutcome> {
  const { path: abs, relPath, expectedSha256, oldText, newText } = prepared;
  const currentHash = (buffer: Buffer) =>
    createHash("sha256").update(buffer).digest("hex");
  let temporary: string | undefined;
  try {
    if (isCancelled()) return {ok:false,evidence:"",error:"edit cancelled before admission"};
    const st = await fs.lstat(abs);
    if (!st.isFile() || st.isSymbolicLink())
      return {ok:false,evidence:"",error:"edit target must be an existing regular file"};
    const containment = await assertWithinRoot(abs);
    if (!containment.ok)
      return {ok:false,evidence:"",error:"edit path no longer inside authorized workspace"};
    const original = await fs.readFile(abs);
    if (original.byteLength > MAX_READ_BYTES)
      return {ok:false,evidence:"",error:"file exceeds bounded full-content edit limit"};
    const originalText = original.toString("utf8");
    if (!Buffer.from(originalText,"utf8").equals(original))
      return {ok:false,evidence:"",error:"non-UTF-8/binary edit target refused"};
    const beforeHash = currentHash(original);
    if (beforeHash !== expectedSha256)
      return {ok:false,evidence:"",error:"stale file digest; re-read before editing"};
    const first = originalText.indexOf(oldText);
    if (first < 0 || originalText.indexOf(oldText,first+oldText.length) >= 0)
      return {ok:false,evidence:"",error:"replacement target missing or occurs more than once"};
    if (isCancelled()) return {ok:false,evidence:"",error:"edit cancelled"};
    const updated = originalText.slice(0,first)+newText+
      originalText.slice(first+oldText.length);
    if (updated === originalText || Buffer.byteLength(updated,"utf8")>MAX_WRITE_BYTES)
      return {ok:false,evidence:"",error:"no-op or oversized edit refused"};
    temporary = path.join(path.dirname(abs),
      ".jarvis-edit-"+randomBytes(12).toString("hex")+".tmp");
    await fs.writeFile(temporary,updated,{encoding:"utf8",flag:"wx",mode:st.mode & 0o777});
    // Verify the staging bytes and detect changes between initial read and
    // commit. No partial write is exposed on a failed staging operation.
    const staged = await fs.readFile(temporary);
    if (currentHash(staged)!==sha256Text(updated))
      return {ok:false,evidence:"",error:"staged edit content could not be verified"};
    const latest = await fs.readFile(abs);
    if (currentHash(latest)!==beforeHash || !(await assertWithinRoot(abs)).ok)
      return {ok:false,evidence:"",error:"file changed during edit; no replacement applied"};
    if (isCancelled()) return {ok:false,evidence:"",error:"edit cancelled before commit"};
    await fs.rename(temporary,abs);
    temporary=undefined;
    const final = await fs.readFile(abs);
    const resultingHash = currentHash(final);
    const verified = resultingHash === sha256Text(updated);
    return {ok:verified,
      evidence:verified ? `edited and read back ${relPath} (SHA-256 ${resultingHash})`
        : "edited file readback mismatch",
      detail:{path:relPath,previousSha256:beforeHash,sha256:resultingHash,verified},
      error:verified?undefined:"post-commit readback mismatch"};
  } catch (error) {
    return {ok:false,evidence:"",
      error:error instanceof Error? `scoped edit failed: ${error.name}` : "scoped edit failed"};
  } finally {
    if (temporary) await fs.rm(temporary,{force:true}).catch(()=>{});
  }
}
