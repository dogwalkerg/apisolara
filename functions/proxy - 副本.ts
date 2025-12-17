// 支持多个音乐源的代理
const MUSIC_APIS = {
  // 原来的 GD Studio API
  gdstudio: "https://music-api.gdstudio.xyz/api.php",
  
  // 新的酷狗音乐 API
  kugo: "https://kugo.520me.cf",
  
  // 可以继续添加其他音乐API
};

const KUWO_HOST_PATTERN = /(^|\.)kuwo\.cn$/i;
const SAFE_RESPONSE_HEADERS = ["content-type", "cache-control", "accept-ranges", "content-length", "content-range", "etag", "last-modified", "expires"];

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

function isAllowedKuwoHost(hostname: string): boolean {
  if (!hostname) return false;
  return KUWO_HOST_PATTERN.test(hostname);
}

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

// 新的：代理到酷狗音乐 API
async function proxyKugoApi(url: URL, request: Request): Promise<Response> {
  // 构建目标 URL
  const baseUrl = MUSIC_APIS.kugo;
  const targetUrl = new URL(baseUrl);
  
  // 获取路径和参数
  const path = url.searchParams.get("path") || "search"; // 默认搜索
  targetUrl.pathname = path;
  
  // 复制其他参数（除了 target, callback, path, api）
  url.searchParams.forEach((value, key) => {
    if (!["target", "callback", "path", "api"].includes(key)) {
      targetUrl.searchParams.set(key, value);
    }
  });
  
  // 如果没有 keywords 参数，尝试从 name 参数转换
  if (!targetUrl.searchParams.has("keywords") && url.searchParams.has("name")) {
    targetUrl.searchParams.set("keywords", url.searchParams.get("name")!);
  }
  
  console.log(`请求酷狗API: ${targetUrl.toString()}`);
  
  const upstream = await fetch(targetUrl.toString(), {
    headers: {
      "User-Agent": request.headers.get("User-Agent") ?? "Mozilla/5.0",
      "Accept": "application/json",
      "Referer": "https://m.kugou.com/",
    },
  });

  const headers = createCorsHeaders(upstream.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

// 原来的：代理到 GD Studio API
async function proxyGdStudioApi(url: URL, request: Request): Promise<Response> {
  const apiUrl = new URL(MUSIC_APIS.gdstudio);
  
  // 复制参数
  url.searchParams.forEach((value, key) => {
    if (!["target", "callback", "api"].includes(key)) {
      apiUrl.searchParams.set(key, value);
    }
  });

  if (!apiUrl.searchParams.has("types")) {
    return new Response("Missing types", { status: 400 });
  }

  const upstream = await fetch(apiUrl.toString(), {
    headers: {
      "User-Agent": request.headers.get("User-Agent") ?? "Mozilla/5.0",
      "Accept": "application/json",
    },
  });

  const headers = createCorsHeaders(upstream.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

// 统一的 API 请求处理
async function proxyApiRequest(url: URL, request: Request): Promise<Response> {
  // 通过 api 参数选择 API 源
  const apiSource = url.searchParams.get("api") || "gdstudio"; // 默认 GD Studio
  
  switch (apiSource.toLowerCase()) {
    case "kugo":
    case "kugou":
      return proxyKugoApi(url, request);
    
    case "gdstudio":
    default:
      return proxyGdStudioApi(url, request);
  }
}

export async function onRequest({ request }: { request: Request }): Promise<Response> {
  if (request.method === "OPTIONS") {
    return handleOptions();
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(request.url);
  const target = url.searchParams.get("target");

  if (target) {
    return proxyKuwoAudio(target, request);
  }

  return proxyApiRequest(url, request);
}