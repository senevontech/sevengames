/* Things done while offline that the server must hear about later: finished rounds (scores),
   XP, and boosters used. They're kept on the device (per account) and sent in order when the
   connection is back. The server's usual limits still apply (e.g. one score every 3 seconds),
   so jobs are sent with small gaps; XP for the same game is merged into one award. */
import { supabase } from "../supabase";
import { isNetworkError, isOnline, onOnlineChange } from "./online";

type Job = { uid: string; rpc: string; args: Record<string, unknown>; at: number; merge?: string };

const KEY = "senevon:offline-queue";
const GAP_MS: Record<string, number> = { submit_score: 3200 };

function read(): Job[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function write(jobs: Job[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(jobs.slice(-300)));
  } catch {
    /* storage unavailable */
  }
}

/** Queue a server call. `merge`: jobs with the same key add up their `p_amount` instead. */
export function enqueue(uid: string, rpc: string, args: Record<string, unknown>, merge?: string) {
  const jobs = read();
  if (merge) {
    const same = jobs.find((j) => j.uid === uid && j.merge === merge);
    if (same) {
      same.args = { ...same.args, p_amount: Number(same.args.p_amount ?? 0) + Number(args.p_amount ?? 0) };
      write(jobs);
      return;
    }
  }
  jobs.push({ uid, rpc, args, at: Date.now(), merge });
  write(jobs);
}

export const pendingCount = (uid: string) => read().filter((j) => j.uid === uid).length;

let flushing = false;
let currentUid: string | null = null;

/** Send queued jobs for the signed-in player. Stops (and keeps the rest) if the connection drops. */
export async function flushQueue(uid: string | null = currentUid) {
  if (!uid || !supabase || flushing || !isOnline()) return;
  flushing = true;
  try {
    for (;;) {
      const jobs = read();
      const job = jobs.find((j) => j.uid === uid);
      if (!job) break;
      const { error } = await supabase.rpc(job.rpc, job.args);
      if (error && isNetworkError(error)) break; // still offline: try again later
      // sent (or refused for good, e.g. a rate limit): either way it's done
      write(read().filter((j) => !(j.uid === job.uid && j.at === job.at && j.rpc === job.rpc)));
      await new Promise((r) => window.setTimeout(r, GAP_MS[job.rpc] ?? 400));
    }
  } finally {
    flushing = false;
  }
}

/** Start sending for this account now and whenever the connection comes back. */
export function startOfflineSync(uid: string | null) {
  currentUid = uid;
  if (uid) void flushQueue(uid);
}

onOnlineChange(() => {
  if (isOnline()) void flushQueue();
});
