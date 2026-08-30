export async function onRequestGet(context) {
  const cache = caches.default;
  const cacheKey = new Request(
    new URL("/api/wildlife-cache", context.request.url),
  );
  const cachedResponse = await cache.match(cacheKey);

  if (cachedResponse) {
    return cachedResponse;
  }

  const apiKey = context.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing YOUTUBE_API_KEY" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const queries = ["wildlife live cam", "aquarium wildlife live cam"];

  const allItems = [];

  for (const query of queries) {
    const params = new URLSearchParams({
      part: "snippet",
      type: "video",
      eventType: "live",
      videoEmbeddable: "true",
      maxResults: "15",
      q: query,
      key: apiKey,
    });

    const response = await fetch(
      "https://www.googleapis.com/youtube/v3/search?" + params.toString(),
    );

    const data = await response.json();

    if (!response.ok) {
      return new Response(
        JSON.stringify(
          {
            status: response.status,
            query,
            youtube: data,
          },
          null,
          2,
        ),
        {
          status: response.status,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }

    allItems.push(...(data.items || []));
  }

  const seen = new Set();

  const videos = allItems
    .filter((item) => item.id && item.id.videoId)
    .filter((item) => {
      if (seen.has(item.id.videoId)) {
        return false;
      }

      seen.add(item.id.videoId);
      return true;
    })
    .map((item) => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail:
        item.snippet.thumbnails?.medium?.url ||
        item.snippet.thumbnails?.default?.url ||
        "",
    }));

  const result = new Response(
    JSON.stringify({ videos, refreshedAt: new Date().toISOString() }),
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=7200",
      },
    },
  );

  context.waitUntil(cache.put(cacheKey, result.clone()));

  return result;
}
