import { fetchWithTimeout } from "../http";
import { toLoose, toLooseList, type Loose } from "../loose";

export function stripHtml(raw: string) {
  return String(raw || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractPageBrief(html: string) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim();
  const ogTitle = html.match(/property=["']og:title["']\s+content=["']([^"']+)/i)?.[1]
    || html.match(/content=["']([^"']+)["']\s+property=["']og:title["']/i)?.[1]
    || "";
  const desc = html.match(/property=["']og:description["']\s+content=["']([^"']+)/i)?.[1]
    || html.match(/name=["']description["']\s+content=["']([^"']+)/i)?.[1]
    || "";
  return {
    title: stripHtml(ogTitle || title).slice(0, 120),
    snippet: stripHtml(desc || stripHtml(html).slice(0, 400)).slice(0, 280)
  };
}

export async function searchWikipedia(query: string) {
  const url = `https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=3&utf8=1&format=json`;
  try {
    const res = await fetchWithTimeout(url, 7000);
    if (!res.ok) return [];
    const data: unknown = await res.json();
    const queryObj = toLoose(toLoose(data).query);
    const hits = Array.isArray(queryObj.search) ? toLooseList(queryObj.search) : [];
    return hits.map((hit: Loose) => ({
      title: String(hit.title || ""),
      snippet: stripHtml(String(hit.snippet || "")),
      url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(String(hit.title || ""))}`
    })).filter((item) => item.title);
  } catch {
    return [];
  }
}

export async function searchDuckDuckGo(query: string) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const res = await fetchWithTimeout(url, 7000);
    if (!res.ok) return [];
    const html = await res.text();
    const findings: { title: string; snippet: string; url: string }[] = [];
    const blockRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|div)>)/gi;
    let match: RegExpExecArray | null;
    while ((match = blockRe.exec(html)) && findings.length < 4) {
      const href = String(match[1] || "");
      const uddg = href.match(/uddg=([^&]+)/);
      const resolved = uddg ? decodeURIComponent(uddg[1]) : href;
      if (!/^https?:/i.test(resolved)) continue;
      findings.push({
        title: stripHtml(match[2] || "").slice(0, 80),
        snippet: stripHtml(match[3] || "").slice(0, 180),
        url: resolved
      });
    }
    return findings;
  } catch {
    return [];
  }
}

export async function searchWeb(query: string) {
  const [wiki, ddg] = await Promise.all([searchWikipedia(query), searchDuckDuckGo(query)]);
  const seen = new Set<string>();
  const merged: { title: string; snippet: string; url: string }[] = [];
  [...wiki, ...ddg].forEach((item) => {
    const key = item.url || item.title;
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(item);
  });
  return merged.slice(0, 4);
}

export async function fetchPageFinding(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (!/^https?:$/i.test(url.protocol)) return null;
    if (/(youtube\.com|youtu\.be)/i.test(url.hostname)) {
      const oembed = await fetchWithTimeout(`https://www.youtube.com/oembed?url=${encodeURIComponent(url.toString())}&format=json`, 7000);
      if (oembed.ok) {
        const data: unknown = await oembed.json();
        const rec = toLoose(data);
        return {
          title: String(rec.title || url.toString()),
          snippet: `对标视频 · ${String(rec.author_name || "")}`.trim(),
          url: url.toString()
        };
      }
    }
    const res = await fetchWithTimeout(url.toString(), 8000);
    if (!res.ok) return null;
    const html = await res.text();
    const brief = extractPageBrief(html);
    return {
      title: brief.title || url.hostname,
      snippet: brief.snippet || "已抓到页面标题，正文摘要有限。",
      url: url.toString()
    };
  } catch {
    return null;
  }
}
