// Long-running broadcasts can fall out of a channel's recent uploads, so each
// channel also has known stream IDs that are revalidated before they are used.
const FALLBACK_CHANNELS = [
  {
    name: "Explore Live Nature Cams",
    channelId: "UC-2KSeUU5SMCX6XLRD-AEvw",
    knownLivestreamIds: ["EwTH5yY7Mks", "J7ZrIDvqlic"],
  },
  {
    name: "Monterey Bay Aquarium",
    channelId: "UCnM5iMGiKsZg-iOlIO2ZkdQ",
    knownLivestreamIds: ["XUfvWYSNO-8", "fuCeRkeDxtQ"],
  },
  {
    name: "Africam",
    channelId: "UCuoNAKa3P0QR1Lw9QdpmoVg",
    knownLivestreamIds: ["PsJplltf9n8", "QJe1tGI1EZc"],
  },
];

function youtubeUrl(resource, params, apiKey) {
  return (
    `https://www.googleapis.com/youtube/v3/${resource}?` +
    new URLSearchParams({ ...params, key: apiKey }).toString()
  );
}

async function responseJson(response) {
  try {
    return await response.json();
  } catch {
    return { error: { message: "YouTube returned an invalid response." } };
  }
}

function requestError(error) {
  return {
    error: {
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

async function fallbackLivestreams(apiKey) {
  const recentVideoIds = await Promise.all(
    FALLBACK_CHANNELS.map(async (channel) => {
      try {
        const response = await fetch(
          youtubeUrl(
            "playlistItems",
            {
              part: "contentDetails",
              playlistId: `UU${channel.channelId.slice(2)}`,
              maxResults: "15",
            },
            apiKey,
          ),
        );

        if (!response.ok) {
          return [];
        }

        const data = await responseJson(response);
        return (data.items || [])
          .map((item) => item.contentDetails?.videoId)
          .filter(Boolean);
      } catch {
        return [];
      }
    }),
  );

  const videoIds = [
    ...new Set([
      ...FALLBACK_CHANNELS.flatMap((channel) => channel.knownLivestreamIds),
      ...recentVideoIds.flat(),
    ]),
  ];
  const items = [];

  for (let index = 0; index < videoIds.length; index += 50) {
    try {
      const response = await fetch(
        youtubeUrl(
          "videos",
          {
            part: "snippet,status",
            id: videoIds.slice(index, index + 50).join(","),
          },
          apiKey,
        ),
      );
      const data = await responseJson(response);

      if (!response.ok) {
        return { ok: false, status: response.status, youtube: data };
      }

      items.push(...(data.items || []));
    } catch (error) {
      return { ok: false, status: 502, youtube: requestError(error) };
    }
  }

  const fallbackChannelIds = new Set(
    FALLBACK_CHANNELS.map((channel) => channel.channelId),
  );

  return {
    ok: true,
    items: items
      .filter(
        (item) =>
          item.snippet?.liveBroadcastContent === "live" &&
          item.status?.embeddable === true &&
          fallbackChannelIds.has(item.snippet.channelId),
      )
      .map((item) => ({
        id: { videoId: item.id },
        snippet: item.snippet,
      })),
  };
}

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

  let allItems = [];
  let searchFailure;

  for (const query of queries) {
    try {
      const response = await fetch(
        youtubeUrl(
          "search",
          {
            part: "snippet",
            type: "video",
            eventType: "live",
            videoEmbeddable: "true",
            maxResults: "15",
            q: query,
          },
          apiKey,
        ),
      );
      const data = await responseJson(response);

      if (!response.ok) {
        searchFailure = {
          status: response.status,
          query,
          youtube: data,
        };
        break;
      }

      allItems.push(...(data.items || []));
    } catch (error) {
      searchFailure = {
        status: 502,
        query,
        youtube: requestError(error),
      };
      break;
    }
  }

  let source = "search";

  if (searchFailure) {
    const fallback = await fallbackLivestreams(apiKey);

    if (!fallback.ok) {
      return new Response(
        JSON.stringify(
          {
            ...searchFailure,
            fallback: {
              status: fallback.status,
              youtube: fallback.youtube,
            },
          },
          null,
          2,
        ),
        {
          status: searchFailure.status,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }

    allItems = fallback.items;
    source = "fallback-channels";
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
    JSON.stringify({
      videos,
      source,
      refreshedAt: new Date().toISOString(),
    }),
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
