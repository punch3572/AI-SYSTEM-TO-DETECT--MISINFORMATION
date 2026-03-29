const http = require("http");
const fs = require("fs");
const path = require("path");

const port = 8080;
const root = __dirname;

function loadEnvFile() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  });
}

loadEnvFile();

const openAiApiKey = process.env.OPENAI_API_KEY;
const openAiModel = process.env.OPENAI_MODEL || "gpt-5.2";
const openRouterDefaultModel = process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const analysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    content_type: { type: "string" },
    truth_classification: {
      type: "string",
      enum: ["True", "False", "Misleading", "Needs Verification"]
    },
    ai_generated_probability: { type: "string" },
    misinformation_score: { type: "string" },
    suspicious_segments: {
      type: "array",
      items: { type: "string" }
    },
    explanation: { type: "string" },
    corrected_information: { type: "string" },
    deepfake_likelihood: { type: "string" },
    key_reasons: {
      type: "array",
      items: { type: "string" }
    },
    final_verdict: { type: "string" }
  },
  required: [
    "content_type",
    "truth_classification",
    "ai_generated_probability",
    "misinformation_score",
    "suspicious_segments",
    "explanation",
    "corrected_information",
    "deepfake_likelihood",
    "key_reasons",
    "final_verdict"
  ]
};

function resolveFile(urlPath) {
  const safePath = decodeURIComponent(urlPath.split("?")[0]);
  const requested = safePath === "/" ? "/index.html" : safePath;
  const normalized = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  return path.join(root, normalized);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 8 * 1024 * 1024) {
        reject(new Error("Request body too large."));
        request.destroy();
      }
    });

    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("Invalid JSON body."));
      }
    });

    request.on("error", reject);
  });
}

function buildOpenAiInput({ mode, text, imageDataUrl }) {
  const prompt = [
    "You are a fact-checking and AI-content analysis assistant.",
    "Assess whether the content appears AI-generated or human-written when possible.",
    "Fact-check the content carefully. Only mark something True or False when confidence is strong.",
    "Use Needs Verification if the claim cannot be confirmed confidently from model knowledge alone.",
    "For image inputs, inspect whether the image appears manipulated or deepfake-like.",
    "Keep explanations simple and concise.",
    `Analysis mode: ${mode}.`,
    text ? `User-provided text or claim: ${text}` : "No user text was provided."
  ].join("\n");

  const content = [{ type: "input_text", text: prompt }];

  if (imageDataUrl) {
    content.push({
      type: "input_image",
      image_url: imageDataUrl,
      detail: "high"
    });
  }

  return [
    {
      role: "user",
      content
    }
  ];
}

function detectProvider(apiKey) {
  if (apiKey?.startsWith("sk-or-v1")) {
    return "openrouter";
  }

  return "openai";
}

function getProviderModel(provider) {
  if (provider === "openrouter") {
    return openAiModel.includes("/") ? openAiModel : openRouterDefaultModel;
  }

  return openAiModel;
}

function buildChatMessages({ mode, text, imageDataUrl }) {
  const instructions = [
    "You are a fact-checking and AI-content analysis assistant.",
    "Return valid JSON only.",
    "Use these exact keys: content_type, truth_classification, ai_generated_probability, misinformation_score, suspicious_segments, explanation, corrected_information, deepfake_likelihood, key_reasons, final_verdict.",
    "truth_classification must be one of: True, False, Misleading, Needs Verification.",
    "Keep explanations simple and concise.",
    `Analysis mode: ${mode}.`,
    text ? `User-provided text or claim: ${text}` : "No user text was provided."
  ].join("\n");

  const userContent = [{ type: "text", text: instructions }];

  if (imageDataUrl) {
    userContent.push({
      type: "image_url",
      image_url: {
        url: imageDataUrl
      }
    });
  }

  return [
    {
      role: "system",
      content: "You analyze text and images for misinformation, AI-generation likelihood, and deepfake-style manipulation."
    },
    {
      role: "user",
      content: userContent
    }
  ];
}

function extractChatContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => item?.text || "")
      .join("");
  }

  return "";
}

async function analyzeWithOpenAI({ mode, text, imageDataUrl, requestApiKey }) {
  const effectiveApiKey = openAiApiKey || requestApiKey;
  const provider = detectProvider(effectiveApiKey);
  const model = getProviderModel(provider);

  if (!effectiveApiKey) {
    return {
      ok: false,
      error: "OPENAI_API_KEY is not configured on the server."
    };
  }

  if (provider === "openrouter") {
    const apiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${effectiveApiKey}`,
        "HTTP-Referer": "http://localhost:8080",
        "X-Title": "TrustLens Analyzer"
      },
      body: JSON.stringify({
        model,
        messages: buildChatMessages({ mode, text, imageDataUrl }),
        response_format: { type: "json_object" },
        max_tokens: 1200
      })
    });

    const payload = await apiResponse.json();
    if (!apiResponse.ok) {
      const message = payload?.error?.message || "OpenRouter API request failed.";
      return {
        ok: false,
        error: message,
        details: payload
      };
    }

    const parsed = JSON.parse(extractChatContent(payload));
    return {
      ok: true,
      provider,
      model,
      result: parsed
    };
  }

  const apiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${effectiveApiKey}`
    },
    body: JSON.stringify({
      model,
      input: buildOpenAiInput({ mode, text, imageDataUrl }),
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "trustlens_analysis",
          strict: true,
          schema: analysisSchema
        }
      }
    })
  });

  const payload = await apiResponse.json();

  if (!apiResponse.ok) {
    const message = payload?.error?.message || "OpenAI API request failed.";
    return {
      ok: false,
      error: message,
      details: payload
    };
  }

  const parsed = JSON.parse(payload.output_text);
  return {
    ok: true,
    provider,
    model,
    result: parsed
  };
}

const server = http.createServer((request, response) => {
  if (request.method === "OPTIONS" && request.url?.startsWith("/api/")) {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400"
    });
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/api/status") {
    sendJson(response, 200, {
      aiConfigured: Boolean(openAiApiKey),
      model: getProviderModel(detectProvider(openAiApiKey || "")),
      provider: openAiApiKey ? detectProvider(openAiApiKey) : "none",
      acceptsBrowserKey: true
    });
    return;
  }

  if (request.method === "POST" && request.url === "/api/analyze") {
    readJsonBody(request)
      .then(async (body) => {
        const mode = body?.mode || "text";
        const text = typeof body?.text === "string" ? body.text : "";
        const imageDataUrl = typeof body?.imageDataUrl === "string" ? body.imageDataUrl : "";
        const requestApiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
        const result = await analyzeWithOpenAI({ mode, text, imageDataUrl, requestApiKey });

        if (!result.ok) {
          sendJson(response, 503, result);
          return;
        }

        sendJson(response, 200, {
          ok: true,
          provider: result.provider,
          model: result.model,
          result: result.result
        });
      })
      .catch((error) => {
        sendJson(response, 400, {
          ok: false,
          error: error.message
        });
      });
    return;
  }

  const filePath = resolveFile(request.url || "/");

  fs.readFile(filePath, (error, data) => {
    if (error) {
      if (error.code === "ENOENT") {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("404 Not Found");
        return;
      }

      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("500 Internal Server Error");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    response.end(data);
  });
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error("Port 8080 is already in use. Stop the old server process and start this server again.");
    process.exit(1);
  }

  console.error(error);
  process.exit(1);
});

server.listen(port, () => {
  console.log(`TrustLens running at http://localhost:${port}`);
});
