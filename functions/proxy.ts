// 酷狗音乐 API 代理
const KUGO_API_BASE_URL = "https://kugo.520me.cf";
const KUWO_HOST_PATTERN = /(^|\.)kuwo\.cn$/i;
const SAFE_RESPONSE_HEADERS = ["content-type", "cache-control", "accept-ranges", "content-length", "content-range", "etag", "last-modified", "expires"];

// 创建 CORS 响应头
function createCorsHeaders(init?: Headers): Headers {
  const headers = new Headers();
  if (init) {
    for (const [key, value] of init.entries()) {
      if (SAFE_RESPONSE_HEADERS.includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    }
  }
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "no-store");
  }
  headers.set("Access-Control-Allow-Origin", "*");
  return headers;
}

// 处理 OPTIONS 预检请求
function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
    },
  });
}

// 检查是否是酷我音频域名
function isAllowedKuwoHost(hostname: string): boolean {
  if (!hostname) return false;
  return KUWO_HOST_PATTERN.test(hostname);
}

// 标准化酷我音频 URL
function normalizeKuwoUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (!isAllowedKuwoHost(parsed.hostname)) {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    parsed.protocol = "http:";
    return parsed;
  } catch {
    return null;
  }
}

// 代理酷我音频
async function proxyKuwoAudio(targetUrl: string, request: Request): Promise<Response> {
  const normalized = normalizeKuwoUrl(targetUrl);
  if (!normalized) {
    return new Response("Invalid target", { status: 400 });
  }

  const init: RequestInit = {
    method: request.method,
    headers: {
      "User-Agent": request.headers.get("User-Agent") ?? "Mozilla/5.0",
      "Referer": "https://www.kuwo.cn/",
    },
  };

  const rangeHeader = request.headers.get("Range");
  if (rangeHeader) {
    (init.headers as Record<string, string>)["Range"] = rangeHeader;
  }

  const upstream = await fetch(normalized.toString(), init);
  const headers = createCorsHeaders(upstream.headers);
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "public, max-age=3600");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

// 代理酷狗音乐 API
async function proxyKugoApi(url: URL, request: Request): Promise<Response> {
  // 构建目标 API URL
  const apiUrl = new URL(KUGO_API_BASE_URL);
  
  // 获取请求类型（默认为 search）
  const type = url.searchParams.get("type") || "search";
  
  // 设置 API 路径
  const apiPaths: Record<string, string> = {
    "search": "/search",
    "song": "/song",
    "url": "/url",
    "lyric": "/lyric",
    "playlist": "/playlist",
    "album": "/album",
    "artist": "/artist",
    "top": "/top",
    "hot": "/hot",
    "suggest": "/suggest",
  };
  
  const path = apiPaths[type] || `/${type}`;
  apiUrl.pathname = path;
  
  // 参数映射：将通用参数映射到酷狗 API 参数
  const paramMapping: Record<string, string> = {
    // 搜索相关
    "keywords": "keywords",
    "name": "keywords",      // 兼容 name 参数
    "id": "keywords",        // 兼容 id 参数
    "type": "type",
    "page": "page",
    "pages": "page",         // 兼容 pages 参数
    "count": "pagesize",     // 兼容 count 参数
    "pagesize": "pagesize",
    "limit": "pagesize",     // 兼容 limit 参数
    
    // 歌曲相关
    "songid": "id",
    "mid": "mid",
    "hash": "hash",
    "br": "br",              // 音质
    "quality": "br",         // 兼容 quality 参数
    
    // 其他
    "playlistid": "id",
    "albumid": "id",
    "artistid": "id",
    "topid": "id",
  };
  
  // 复制并映射参数
  url.searchParams.forEach((value, key) => {
    if (key !== "target" && key !== "callback" && key !== "type") {
      const mappedKey = paramMapping[key] || key;
      apiUrl.searchParams.set(mappedKey, value);
    }
  });
  
  // 设置默认值
  if (type === "search") {
    // 搜索接口默认值
    if (!apiUrl.searchParams.has("pagesize")) {
      apiUrl.searchParams.set("pagesize", "20");
    }
    if (!apiUrl.searchParams.has("page")) {
      apiUrl.searchParams.set("page", "1");
    }
  }
  
  // 如果没有 keywords 但有 name 参数，使用 name 作为 keywords
  if (!apiUrl.searchParams.has("keywords") && url.searchParams.has("name")) {
    apiUrl.searchParams.set("keywords", url.searchParams.get("name")!);
  }
  
  console.log(`请求酷狗API: ${apiUrl.toString()}`);
  
  try {
    // 发送请求到酷狗 API
    const upstream = await fetch(apiUrl.toString(), {
      headers: {
        "User-Agent": request.headers.get("User-Agent") ?? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Referer": "https://m.kugou.com/",
        "Origin": "https://m.kugou.com",
      },
    });

    const headers = createCorsHeaders(upstream.headers);
    
    // 确保响应头有正确的 Content-Type
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json; charset=utf-8");
    }
    
    // 设置缓存
    if (type === "search") {
      headers.set("Cache-Control", "public, max-age=300"); // 搜索缓存5分钟
    } else if (type === "url") {
      headers.set("Cache-Control", "public, max-age=3600"); // 歌曲URL缓存1小时
    } else {
      headers.set("Cache-Control", "public, max-age=1800"); // 其他缓存30分钟
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
    
  } catch (error) {
    // 错误处理
    return new Response(JSON.stringify({
      code: 500,
      message: "酷狗API请求失败",
      error: error instanceof Error ? error.message : String(error),
      url: apiUrl.toString()
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
}

// 主处理函数
export async function onRequest({ request }: { request: Request }): Promise<Response> {
  // 处理 OPTIONS 请求
  if (request.method === "OPTIONS") {
    return handleOptions();
  }

  // 只允许 GET 和 HEAD 方法
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { 
      status: 405,
      headers: {
        "Content-Type": "text/plain",
        "Access-Control-Allow-Origin": "*",
      }
    });
  }

  const url = new URL(request.url);
  const target = url.searchParams.get("target");

  // 如果有 target 参数，代理音频
  if (target) {
    return proxyKuwoAudio(target, request);
  }

  // 否则代理到酷狗 API
  return proxyKugoApi(url, request);
}