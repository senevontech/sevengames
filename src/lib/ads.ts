import { useEffect, useState } from "react";
import { supabase } from "../supabase";

export type Ad = {
  id: string;
  title: string;
  link_url: string;
  cover_url: string | null;
  thumb_url: string | null;
  body: string | null;
  cta_label: string;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  daily_start: string | null; // "HH:MM:SS"
  daily_end: string | null;
  max_impressions: number | null;
  impressions: number;
  clicks: number;
  sort_order: number;
  /** 'all' = banners + home-page promo disks; missing (column not added yet) counts as 'all'. */
  placement?: AdPlacement;
  created_at: string;
};

export type AdPlacement = "all" | "banner" | "disk";

export const placementLabel: Record<AdPlacement, string> = {
  all: "Everywhere",
  banner: "Banners only",
  disk: "Home disks only",
};

/** Can this ad show in a slot of kind `where`? */
export function fitsPlacement(ad: Pick<Ad, "placement">, where: "banner" | "disk") {
  const p = ad.placement ?? "all";
  return p === "all" || p === where;
}

function minutesOf(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Daily window in the viewer's local time. Supports overnight ranges (22:00–02:00). */
export function inDailyWindow(ad: Pick<Ad, "daily_start" | "daily_end">, now = new Date()) {
  if (!ad.daily_start || !ad.daily_end) return true;
  const cur = now.getHours() * 60 + now.getMinutes();
  const start = minutesOf(ad.daily_start);
  const end = minutesOf(ad.daily_end);
  if (start === end) return true;
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

export type AdState = "live" | "scheduled" | "expired" | "capped" | "outside-hours" | "paused";

export function adState(ad: Ad, now = new Date()): AdState {
  if (!ad.active) return "paused";
  if (ad.starts_at && new Date(ad.starts_at) > now) return "scheduled";
  if (ad.ends_at && new Date(ad.ends_at) <= now) return "expired";
  if (ad.max_impressions && ad.impressions >= ad.max_impressions) return "capped";
  if (!inDailyWindow(ad, now)) return "outside-hours";
  return "live";
}

/** Live ads for one kind of slot: "banner" (sponsored boxes, reward ads) or "disk" (home promos). */
export function useLiveAds(where: "banner" | "disk") {
  const [ads, setAds] = useState<Ad[]>([]);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    void Promise.resolve(
      supabase.from("ads").select("*").eq("active", true).order("sort_order", { ascending: true }),
    ).then(({ data }) => {
      if (!alive || !data) return;
      setAds((data as Ad[]).filter((ad) => adState(ad) === "live" && fitsPlacement(ad, where)));
    });
    return () => {
      alive = false;
    };
  }, [where]);
  return ads;
}
