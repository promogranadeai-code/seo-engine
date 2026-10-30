import { jaccard, stems } from "../util/text.js";

export interface Clusterable {
  keyword: string;
  volume: number | null;
  /** Top-10 organic URLs, when SERP data was fetched. */
  serpUrls?: string[];
}

export interface Cluster<T extends Clusterable> {
  head: T;
  members: T[];
  totalVolume: number;
  method: "serp-overlap" | "lexical";
}

/**
 * Group keywords that one page can rank for together.
 * - With SERP data: Semrush/Keyword-Strategy-Builder style — same cluster when the
 *   top-10 results share ≥ `minSharedUrls` URLs (industry default 3–4 of 10).
 * - Without: lexical similarity of stemmed tokens (≥ 0.5 Jaccard with the head term).
 */
export function clusterKeywords<T extends Clusterable>(items: T[], minSharedUrls = 4): Cluster<T>[] {
  const sorted = [...items].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  const clusters: Cluster<T>[] = [];
  const assigned = new Set<T>();
  for (const head of sorted) {
    if (assigned.has(head)) continue;
    const cluster: Cluster<T> = { head, members: [head], totalVolume: head.volume ?? 0, method: "lexical" };
    assigned.add(head);
    const headStems = stems(head.keyword);
    for (const other of sorted) {
      if (assigned.has(other)) continue;
      let same = false;
      if (head.serpUrls?.length && other.serpUrls?.length) {
        const shared = head.serpUrls.filter((u) => other.serpUrls!.includes(u)).length;
        same = shared >= minSharedUrls;
        if (same) cluster.method = "serp-overlap";
      } else {
        same = jaccard(headStems, stems(other.keyword)) >= 0.5;
      }
      if (same) {
        cluster.members.push(other);
        cluster.totalVolume += other.volume ?? 0;
        assigned.add(other);
      }
    }
    clusters.push(cluster);
  }
  return clusters.sort((a, b) => b.totalVolume - a.totalVolume);
}
