import { ENV } from "./env";

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4" ;
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

const ensureArray = (
  value: MessageContent | MessageContent[]
): MessageContent[] => (Array.isArray(value) ? value : [value]);

const normalizeContentPart = (
  part: MessageContent
): TextContent | ImageContent | FileContent => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }

  if (part.type === "text") {
    return part;
  }

  if (part.type === "image_url") {
    return part;
  }

  if (part.type === "file_url") {
    return part;
  }

  throw new Error("Unsupported message content part");
};

const normalizeMessage = (message: Message) => {
  const { role, name, tool_call_id } = message;

  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content)
      .map(part => (typeof part === "string" ? part : JSON.stringify(part)))
      .join("\n");

    return {
      role,
      name,
      tool_call_id,
      content,
    };
  }

  const contentParts = ensureArray(message.content).map(normalizeContentPart);

  // If there's only text content, collapse to a single string for compatibility
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return {
      role,
      name,
      content: contentParts[0].text,
    };
  }

  return {
    role,
    name,
    content: contentParts,
  };
};

const normalizeToolChoice = (
  toolChoice: ToolChoice | undefined,
  tools: Tool[] | undefined
): "none" | "auto" | ToolChoiceExplicit | undefined => {
  if (!toolChoice) return undefined;

  if (toolChoice === "none" || toolChoice === "auto") {
    return toolChoice;
  }

  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error(
        "tool_choice 'required' was provided but no tools were configured"
      );
    }

    if (tools.length > 1) {
      throw new Error(
        "tool_choice 'required' needs a single tool or specify the tool name explicitly"
      );
    }

    return {
      type: "function",
      function: { name: tools[0].function.name },
    };
  }

  if ("name" in toolChoice) {
    return {
      type: "function",
      function: { name: toolChoice.name },
    };
  }

  return toolChoice;
};

// ─── Provider registry ───────────────────────────────────────────────────────

type OAIProvider = { type: "oai"; url: string; key: string; name: string };
type OllamaProvider = { type: "ollama"; host: string; key: string; name: string };
type Provider = OAIProvider | OllamaProvider;

/** Returns ordered list of providers to try. Never throws; may return empty list. */
function buildProviderChain(model?: string): Provider[] {
  const chain: Provider[] = [];

  // 1. Ollama Cloud — primary if OLLAMA_API_KEY is set
  if (ENV.ollamaApiKey) {
    chain.push({
      type: "ollama",
      host: ENV.ollamaHost,
      key: ENV.ollamaApiKey,
      name: `ollama-cloud/${model ?? ENV.llmPrimaryModel}`,
    });
  }

  // 2. Fallbacks from LLM_FALLBACK_PROVIDERS (comma-separated: openrouter,grok)
  for (const fb of ENV.llmFallbackProviders.split(",").map(s => s.trim())) {
    if (fb === "openrouter" && ENV.openrouterApiKey) {
      chain.push({
        type: "oai",
        url: "https://openrouter.ai/api/v1/chat/completions",
        key: ENV.openrouterApiKey,
        name: "openrouter",
      });
    } else if (fb === "grok" && ENV.grokApiKey) {
      chain.push({
        type: "oai",
        url: "https://api.x.ai/v1/chat/completions",
        key: ENV.grokApiKey,
        name: `grok/${ENV.grokModel}`,
      });
    } else if (fb === "forge" && ENV.forgeApiKey) {
      const url =
        ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0
          ? `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`
          : "https://forge.manus.im/v1/chat/completions";
      chain.push({ type: "oai", url, key: ENV.forgeApiKey, name: "forge" });
    }
  }

  // 3. Legacy fallback: forge if nothing else is configured
  if (
    chain.length === 0 &&
    !ENV.ollamaApiKey &&
    !ENV.openrouterApiKey &&
    !ENV.grokApiKey &&
    ENV.forgeApiKey
  ) {
    const url =
      ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0
        ? `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`
        : "https://forge.manus.im/v1/chat/completions";
    chain.push({ type: "oai", url, key: ENV.forgeApiKey, name: "forge" });
  }

  return chain;
}

/** Tracks the last provider used — read by the dashboard status badge. */
export let activeProvider = "unconfigured";
export let activeProviderLatencyMs = 0;

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Normalize an Ollama /api/chat response into InvokeResult shape. */
function ollamaToInvokeResult(
  body: { model?: string; message?: { role?: string; content?: string }; done?: boolean }
): InvokeResult {
  return {
    id: `ollama-${Date.now()}`,
    created: Math.floor(Date.now() / 1000),
    model: body.model ?? "unknown",
    choices: [
      {
        index: 0,
        message: {
          role: (body.message?.role as Role) ?? "assistant",
          content: body.message?.content ?? "",
        },
        finish_reason: body.done ? "stop" : null,
      },
    ],
  };
}

/** Call Ollama /api/chat endpoint with optional JSON schema enforcement. */
async function callOllama(
  provider: OllamaProvider,
  params: InvokeParams,
  model: string
): Promise<InvokeResult> {
  const schema = params.outputSchema || params.output_schema;
  const body: Record<string, unknown> = {
    model,
    stream: false,
    messages: params.messages.map(m => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    })),
  };

  if (schema?.schema) {
    body.format = schema.schema;
  } else {
    const rf = params.responseFormat || params.response_format;
    if (rf?.type === "json_object") body.format = "json";
    else if (rf?.type === "json_schema" && rf.json_schema?.schema) {
      body.format = rf.json_schema.schema;
    }
  }

  const response = await fetch(
    `${provider.host.replace(/\/$/, "")}/api/chat`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${provider.key}`,
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(
      `Ollama ${response.status} ${response.statusText} – ${raw.slice(0, 300)}`
    );
  }

  const resp = (await response.json()) as {
    model?: string;
    message?: { role?: string; content?: string };
    done?: boolean;
  };
  return ollamaToInvokeResult(resp);
}

/** Call OpenAI-compatible endpoint. */
async function callOAI(
  provider: OAIProvider,
  params: InvokeParams,
  model: string
): Promise<InvokeResult> {
  const {
    messages,
    tools,
    toolChoice,
    tool_choice,
    outputSchema,
    output_schema,
    responseFormat,
    response_format,
  } = params;

  const payload: Record<string, unknown> = {
    model,
    messages: messages.map(normalizeMessage),
    max_tokens: 32768,
  };

  if (tools && tools.length > 0) payload.tools = tools;
  const normalizedToolChoice = normalizeToolChoice(toolChoice || tool_choice, tools);
  if (normalizedToolChoice) payload.tool_choice = normalizedToolChoice;

  // thinking budget only for forge/gemini
  if (provider.name === "forge") payload.thinking = { budget_tokens: 128 };

  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat, response_format, outputSchema, output_schema,
  });
  if (normalizedResponseFormat) payload.response_format = normalizedResponseFormat;

  const response = await fetch(provider.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${provider.key}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    const err = new Error(
      `LLM ${provider.name} ${response.status} ${response.statusText} – ${raw.slice(0, 500)}`
    ) as Error & { status: number };
    err.status = response.status;
    throw err;
  }

  return (await response.json()) as InvokeResult;
}

const assertApiKey = () => {
  if (buildProviderChain().length === 0) {
    throw new Error(
      "No LLM provider configured — set OLLAMA_API_KEY, OPENROUTER_API_KEY, GROK_API_KEY, or BUILT_IN_FORGE_API_KEY"
    );
  }
};

const normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema,
}: {
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
}):
  | { type: "json_schema"; json_schema: JsonSchema }
  | { type: "text" }
  | { type: "json_object" }
  | undefined => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (
      explicitFormat.type === "json_schema" &&
      !explicitFormat.json_schema?.schema
    ) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }

  const schema = outputSchema || output_schema;
  if (!schema) return undefined;

  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }

  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...(typeof schema.strict === "boolean" ? { strict: schema.strict } : {}),
    },
  };
};

/**
 * Invoke the LLM with automatic fallback.
 *
 * @param params  Standard invoke params
 * @param model   Override model (e.g. LLM_EXTRACTOR_MODEL or LLM_PRIMARY_MODEL).
 *                Defaults to ENV.llmPrimaryModel for Ollama; provider default for others.
 */
export async function invokeLLM(
  params: InvokeParams,
  model?: string
): Promise<InvokeResult> {
  assertApiKey();

  const chain = buildProviderChain(model);
  const resolvedModel = model ?? ENV.llmPrimaryModel;

  let lastError: Error | undefined;
  const t0 = Date.now();

  for (const provider of chain) {
    try {
      const result =
        provider.type === "ollama"
          ? await callOllama(provider, params, resolvedModel)
          : await callOAI(provider, params, resolvedModel);

      activeProvider = provider.name;
      activeProviderLatencyMs = Date.now() - t0;

      if (provider !== chain[0]) {
        console.warn(`[LLM] Using fallback provider: ${provider.name}`);
      }

      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const status = (err as { status?: number }).status ?? 0;
      if (!isRetryable(status) && status !== 0) {
        // Non-transient error (e.g. 400 bad request) — skip remaining chain
        throw lastError;
      }
      console.warn(
        `[LLM] Provider ${provider.name} failed (${status || "network"}), trying next: ${lastError.message.slice(0, 120)}`
      );
    }
  }

  activeProvider = "failed";
  throw lastError ?? new Error("All LLM providers failed");
}
