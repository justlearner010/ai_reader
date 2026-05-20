import { cleanText } from "@/utils/textCleaner";

const MAX_AI_CONTEXT_CHARS = 12_000;
const AI_CACHE_PREFIX = "ai_reader_ai_cache:";
const AI_CACHE_VERSION = "v1";
const AI_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const BOOK_CONTEXT_BLOCK_VERSION = "BOOK_CONTEXT_V1";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  parsed?: { term: string; definition: string; essence: string; context: string };
}

export interface ApiConfig {
  engineMode: string;
  temperature: number;
  cloud: {
    currentProvider: string;
    keys: Record<string, string>;
    customUrl: string;
    customModel: string;
  };
  local: {
    url: string;
    model: string;
  };
}

export type AiCacheScope = "chat" | "selection" | "vocabulary" | "translation";

export interface AiCacheEntry {
  content: string;
  createdAt: number;
  scope: AiCacheScope;
  model: string;
  parsed?: Message["parsed"];
}

interface ResolvedAiEndpoint {
  isCloud: boolean;
  provider: string;
  url: string;
  model: string;
  apiKey?: string;
}

export const PROVIDER_PRESETS: Record<string, { name: string; url: string; model: string }> = {
  deepseek: { name: "DeepSeek 官方", url: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  siliconflow: { name: "硅基流动 (SiliconFlow)", url: "https://api.siliconflow.cn/v1", model: "deepseek-ai/DeepSeek-V3" },
  openai: { name: "OpenAI", url: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  openrouter: { name: "OpenRouter", url: "https://openrouter.ai/api/v1", model: "google/gemini-2.5-flash" },
  custom: { name: "Custom (自定义中转)", url: "", model: "" },
};

export const AI_IDENTITIES: Record<string, { name: string; prompt: string }> = {
  default: {
    name: "综合技术专家",
    prompt: "你是一个一针见血的技术与文学专家，请用最简练、直击本质的话语为用户解释划词内容。",
  },
  coder: {
    name: "源码推演家",
    prompt: "你是一个精通 C++、Linux 内核和 AI Infra 的硬核架构师。请直接剖析用户划词背后的底层系统机制、内存堆栈变化或算法时空复杂度，多用代码块示例，拒绝废话。",
  },
  translator: {
    name: "极简翻译官",
    prompt: "你是一个同声传译专家。请直接给出用户划词最地道的中文翻译，并在下方列出 2-3 个最核心的专业词汇延伸解析，格式要极其紧凑。",
  },
  detective: {
    name: "悬疑伏笔拆解手",
    prompt: "你是一个深谙新本格派的悬疑小说家。请帮我严密分析用户划出这段话背后的文学隐喻、心理博弈或潜在的剧情伏笔。",
  },
};

export const DEFAULT_API_CONFIG: ApiConfig = {
  engineMode: "cloud",
  temperature: 1.0,
  cloud: {
    currentProvider: "deepseek",
    keys: {
      deepseek: "",
      siliconflow: "",
      openai: "",
      openrouter: "",
      custom: "",
    },
    customUrl: "",
    customModel: "",
  },
  local: {
    url: "http://localhost:11434/v1",
    model: "qwen2.5",
  },
};

export function normalizeCacheText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function stableHash(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function makeAiCacheKey(scope: AiCacheScope, payload: Record<string, unknown>): string {
  return `${scope}:${stableHash(stableStringify({ version: AI_CACHE_VERSION, scope, ...payload }))}`;
}

export function readAiCache(key: string): AiCacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${AI_CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as AiCacheEntry;
    if (!entry.content || Date.now() - entry.createdAt > AI_CACHE_MAX_AGE_MS) {
      window.localStorage.removeItem(`${AI_CACHE_PREFIX}${key}`);
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

export function writeAiCache(key: string, entry: AiCacheEntry): void {
  if (typeof window === "undefined" || !entry.content.trim()) return;
  try {
    window.localStorage.setItem(`${AI_CACHE_PREFIX}${key}`, JSON.stringify(entry));
  } catch {
    // localStorage may be full or unavailable; caching is an optimization only.
  }
}

export function parseAssistantPayload(content: string): Message["parsed"] | undefined {
  try {
    const parsed = JSON.parse(content) as Partial<NonNullable<Message["parsed"]>>;
    if (!parsed.term && !parsed.definition) return undefined;
    return {
      term: parsed.term || "",
      definition: parsed.definition || "",
      essence: parsed.essence || "",
      context: parsed.context || "",
    };
  } catch {
    return undefined;
  }
}

export function limitAiContext(raw: string): string {
  const text = cleanText(raw);
  if (text.length <= MAX_AI_CONTEXT_CHARS) return text;
  const half = Math.floor(MAX_AI_CONTEXT_CHARS / 2);
  return `${text.slice(0, half)}\n\n...[已截断中间内容，避免上下文过长]...\n\n${text.slice(-half)}`;
}

export function resolveAiEndpoint(apiConfig: ApiConfig): ResolvedAiEndpoint {
  const isCloud = apiConfig.engineMode === "cloud";
  if (isCloud) {
    const provider = apiConfig.cloud.currentProvider;
    return {
      isCloud,
      provider,
      apiKey: apiConfig.cloud.keys[provider],
      url: apiConfig.cloud.customUrl || PROVIDER_PRESETS[provider]?.url || "",
      model: apiConfig.cloud.customModel || PROVIDER_PRESETS[provider]?.model || "",
    };
  }
  return {
    isCloud,
    provider: "local",
    url: apiConfig.local.url,
    model: apiConfig.local.model,
  };
}

export function buildAiSystemContent(userPrompt: string, context: string): string {
  const prompt = userPrompt.trim();
  const normalizedContext = context.trim() || "（当前页面暂无可用文本）";
  return `${prompt}

[${BOOK_CONTEXT_BLOCK_VERSION}]
${normalizedContext}
[/${BOOK_CONTEXT_BLOCK_VERSION}]

回答规则：
- 优先基于 ${BOOK_CONTEXT_BLOCK_VERSION} 中的当前阅读上下文回答。
- 如果问题与上下文无关，可以基于你的通用知识回答。
- 保持回答直接、紧凑，避免无关寒暄。`;
}

export async function translateWithProvider(
  text: string,
  apiConfig: ApiConfig,
): Promise<string> {
  const endpoint = resolveAiEndpoint(apiConfig);
  const translationPrompt = "You are a translator. Translate the following text to Chinese. Return only the translation, no explanations.";
  const cacheKey = makeAiCacheKey("translation", {
    provider: endpoint.provider,
    model: endpoint.model,
    endpointHash: stableHash(endpoint.url),
    temperature: apiConfig.temperature,
    promptHash: stableHash(translationPrompt),
    textHash: stableHash(normalizeCacheText(text)),
  });
  const cached = readAiCache(cacheKey);
  if (cached) return cached.content;

  if (!endpoint.url || !endpoint.model) return "请先配置 AI 提供商";
  if (endpoint.isCloud && !endpoint.apiKey) return "请先配置 API Key";

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (endpoint.apiKey) headers.Authorization = `Bearer ${endpoint.apiKey}`;

    const res = await fetch(`${endpoint.url}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: endpoint.model,
        messages: [
          { role: "system", content: translationPrompt },
          { role: "user", content: text },
        ],
        stream: false,
        temperature: apiConfig.temperature,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      return `请求失败 (${res.status}): ${errBody}`;
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return "翻译失败: 返回内容为空";
    writeAiCache(cacheKey, {
      content,
      createdAt: Date.now(),
      scope: "translation",
      model: endpoint.model,
    });
    return content;
  } catch (error) {
    return `网络错误: ${error instanceof Error ? error.message : String(error)}`;
  }
}
