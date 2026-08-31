// gcc-youtube-feed — Vegas campus YouTube RSS, no API key.
// Returns the latest service streams (skips sermon shorts) for the Watch
// section on ooak21.github.io/gateway-city-church/.
//
// Channel: @gatewaycitychurchlasvegas  UC -> UCzBSLVhkfYqJWyA1KG4qa8A
// Deploy: supabase functions deploy gcc-youtube-feed --no-verify-jwt

const CHANNEL_ID = 'UCzBSLVhkfYqJWyA1KG4qa8A';
const HANDLE = 'https://www.youtube.com/@gatewaycitychurchlasvegas';
const FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
const MAX_VIDEOS = 5;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function decodeXmlText(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function pickTag(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : null;
}

function isService(title: string): boolean {
  const t = title.toLowerCase();
  if (t.includes('#sermonshort') || t.includes('#short')) return false;
  return /sunday|service|midweek|espa[nñ]ol|devo|worship|fuel/.test(t);
}

function parseFeed(xml: string) {
  const videos: Array<{
    videoId: string;
    title: string;
    videoUrl: string;
    thumbnailUrl: string;
    published: string | null;
  }> = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(xml)) && videos.length < MAX_VIDEOS) {
    const block = m[1];
    const videoId = pickTag(block, 'yt:videoId');
    if (!videoId) continue;
    const title = decodeXmlText(pickTag(block, 'title') || '').trim();
    if (!isService(title)) continue;
    const published = pickTag(block, 'published');
    videos.push({
      videoId,
      title,
      videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      published: published ? published.trim() : null,
    });
  }
  return videos;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'GET') {
    return Response.json({ error: 'method not allowed' }, { status: 405, headers: CORS });
  }

  async function fetchFeed(): Promise<string> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(FEED_URL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
        },
      });
      if (res.ok) return await res.text();
      if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
      else throw new Error(`youtube feed ${res.status}`);
    }
    throw new Error('youtube feed failed');
  }

  try {
    const videos = parseFeed(await fetchFeed());
    return Response.json(
      { videos, channel: CHANNEL_ID, handle: HANDLE },
      {
        headers: {
          ...CORS,
          'Cache-Control': 'public, max-age=300, s-maxage=600',
        },
      },
    );
  } catch (err) {
    console.error('[gcc-youtube-feed]', err);
    return Response.json(
      { error: (err as Error).message, videos: [] },
      { status: 502, headers: { ...CORS, 'Cache-Control': 'no-store' } },
    );
  }
});
