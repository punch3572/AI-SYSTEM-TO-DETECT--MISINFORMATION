const modeButtons = document.querySelectorAll(".mode-button");
const input = document.getElementById("userInput");
const analyzeButton = document.getElementById("analyzeButton");
const sampleButton = document.getElementById("sampleButton");
const copyButton = document.getElementById("copyButton");
const output = document.getElementById("jsonOutput");
const imageTools = document.getElementById("imageTools");
const imageInput = document.getElementById("imageInput");
const imagePreview = document.getElementById("imagePreview");
const imageMeta = document.getElementById("imageMeta");
const backendUrlInput = document.getElementById("backendUrl");
const apiKeyInput = document.getElementById("apiKeyInput");
const statusNote = document.getElementById("statusNote");

let currentMode = "claim";
let uploadedImageState = null;
let apiStatus = {
  aiConfigured: false,
  model: "",
  provider: "none",
  acceptsBrowserKey: false
};

const samples = {
  claim: "Drinking bleach cures viral infections instantly and doctors hide it from the public.",
  text: "In conclusion, it is important to note that technology has changed the world in many ways. Furthermore, we must consider both advantages and disadvantages in a comprehensive manner.",
  image: "A portrait shows a person with one eye looking left and the other slightly upward, smooth plastic-like skin, earrings merging into hair, and background lights reflecting in impossible directions."
};

const knownFalsePatterns = [
  {
    pattern: /drinking bleach cures|bleach cures/i,
    correction: "Bleach is poisonous and does not cure infections. It can cause severe internal injury or death."
  },
  {
    pattern: /vaccines cause autism/i,
    correction: "Vaccines do not cause autism. Large studies have found no causal link."
  },
  {
    pattern: /earth is flat/i,
    correction: "The Earth is an oblate sphere, confirmed by satellite imagery, physics, and navigation."
  },
  {
    pattern: /climate change is a hoax/i,
    correction: "Climate change is real and supported by extensive scientific evidence, including rising temperatures and greenhouse gas measurements."
  },
  {
    pattern: /5g (causes|spreads) (covid|coronavirus)/i,
    correction: "Viruses are not transmitted by radio waves. 5G does not cause or spread COVID-19."
  }
];

const misinformationSignals = [
  { regex: /\b(always|never|instantly|guaranteed|everyone knows|they hide|secret cure)\b/gi, weight: 9 },
  { regex: /\b(shocking|miracle|100% proof|undeniable|exposed)\b/gi, weight: 7 },
  { regex: /\b(conspiracy|mainstream media|they don't want you to know)\b/gi, weight: 8 },
  { regex: /!{2,}/g, weight: 4 }
];

const aiStyleSignals = [
  { regex: /\bin conclusion\b/gi, weight: 10 },
  { regex: /\bit is important to note\b/gi, weight: 10 },
  { regex: /\bfurthermore\b/gi, weight: 8 },
  { regex: /\bmoreover\b/gi, weight: 8 },
  { regex: /\bcomprehensive\b/gi, weight: 7 },
  { regex: /\bdelve\b/gi, weight: 9 },
  { regex: /\bcrucial to understand\b/gi, weight: 9 },
  { regex: /\bin today's (world|digital landscape|fast-paced world|rapidly evolving world)\b/gi, weight: 10 },
  { regex: /\bplays a crucial role\b/gi, weight: 10 },
  { regex: /\bit is worth noting\b/gi, weight: 9 },
  { regex: /\bthere are several (reasons|factors|ways)\b/gi, weight: 9 },
  { regex: /\boverall\b/gi, weight: 6 },
  { regex: /\bseamless\b/gi, weight: 8 },
  { regex: /\bleverage\b/gi, weight: 7 },
  { regex: /\bfoster\b/gi, weight: 7 },
  { regex: /\bkey takeaway\b/gi, weight: 10 }
];

const deepfakeSignals = [
  { regex: /\b(unrealistic lighting|impossible shadows|shadow mismatch|wrong shadow direction)\b/gi, weight: 16, reason: "Lighting or shadow directions sound physically inconsistent." },
  { regex: /\b(inconsistent facial features|uneven eyes|asymmetrical eyes|different eye direction)\b/gi, weight: 18, reason: "Facial alignment problems are a common synthetic-image artifact." },
  { regex: /\b(blurred background|distorted background|warped background|melting background)\b/gi, weight: 14, reason: "Background warping often appears in generated or heavily edited visuals." },
  { regex: /\b(unnatural texture|plastic skin|wax skin|overly smooth skin)\b/gi, weight: 17, reason: "Over-smoothed skin and texture loss can indicate AI rendering or aggressive retouching." },
  { regex: /\b(extra fingers|merged fingers|broken hands|missing fingers)\b/gi, weight: 22, reason: "Hands and finger structure remain a strong manipulation clue." },
  { regex: /\b(earrings merging|jewelry melting|hair merging|teeth distortion)\b/gi, weight: 16, reason: "Object boundaries blending into nearby features suggests generation artifacts." }
];

function setMode(mode) {
  currentMode = mode;
  modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  imageTools.classList.toggle("hidden", mode !== "image");
  input.placeholder = {
    claim: "Paste a claim to verify. Example: 'Vaccines cause autism.'",
    text: "Paste a paragraph to estimate whether it looks AI-generated or human-written.",
    image: "Describe the image or video frame, including lighting, facial details, background, and textures."
  }[mode];
}

function setStatusNote(message) {
  statusNote.textContent = message;
}

function getEnteredApiKey() {
  return apiKeyInput.value.trim();
}

function getBackendBaseUrl() {
  const manualValue = backendUrlInput.value.trim().replace(/\/$/, "");
  if (manualValue) {
    return manualValue;
  }

  if (window.location.protocol.startsWith("http")) {
    return window.location.origin;
  }

  return "http://localhost:8080";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function collectMatches(text, signalList) {
  const matches = [];
  let total = 0;

  signalList.forEach((signal) => {
    const found = text.match(signal.regex);
    if (found) {
      total += signal.weight * found.length;
      matches.push(...found);
    }
  });

  return { total, matches };
}

function findSuspiciousSegments(text, phrases) {
  const lowered = text.toLowerCase();
  return [...new Set(
    phrases
      .filter(Boolean)
      .map((phrase) => phrase.toLowerCase())
      .filter((phrase) => lowered.includes(phrase))
  )];
}

function sentenceList(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function standardDeviation(values) {
  if (!values.length) {
    return 0;
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function countRepeatedStarters(sentences) {
  const starterCounts = new Map();

  sentences.forEach((sentence) => {
    const words = sentence.toLowerCase().match(/\b[\w'-]+\b/g);
    if (!words || words.length < 2) {
      return;
    }

    const starter = `${words[0]} ${words[1]}`;
    starterCounts.set(starter, (starterCounts.get(starter) || 0) + 1);
  });

  return [...starterCounts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0);
}

function collectTextSuspiciousSegments(text, sentences, aiMatches, extraPatterns = []) {
  const phraseMatches = findSuspiciousSegments(text, aiMatches);
  const flaggedSentences = sentences.filter((sentence) =>
    aiStyleSignals.some((signal) => sentence.match(signal.regex))
    || extraPatterns.some((pattern) => pattern.test(sentence))
  );

  return [...new Set([...phraseMatches, ...flaggedSentences.slice(0, 3)])];
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Unable to read image file."));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load image preview."));
    image.src = dataUrl;
  });
}

function analyzeImagePixels(image) {
  const maxDimension = 320;
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);

  const { data } = context.getImageData(0, 0, width, height);
  const blockVariances = [];
  const sentenceReasons = [];
  let smoothCount = 0;
  let sampleCount = 0;
  let highlightClipCount = 0;
  let edgeTotal = 0;
  let edgeSamples = 0;
  let boundaryDiff = 0;
  let boundaryCount = 0;
  let interiorDiff = 0;
  let interiorCount = 0;

  const luminanceAt = (x, y) => {
    const index = (y * width + x) * 4;
    return (data[index] * 0.299) + (data[index + 1] * 0.587) + (data[index + 2] * 0.114);
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];

      if (r > 245 && g > 245 && b > 245) {
        highlightClipCount += 1;
      }

      if (x < width - 1 && y < height - 1) {
        const current = luminanceAt(x, y);
        const right = luminanceAt(x + 1, y);
        const down = luminanceAt(x, y + 1);
        const diff = (Math.abs(current - right) + Math.abs(current - down)) / 2;
        edgeTotal += diff;
        edgeSamples += 1;
        sampleCount += 1;

        if (diff < 8) {
          smoothCount += 1;
        }

        if ((x + 1) % 8 === 0 || (y + 1) % 8 === 0) {
          boundaryDiff += diff;
          boundaryCount += 1;
        } else {
          interiorDiff += diff;
          interiorCount += 1;
        }
      }
    }
  }

  for (let blockY = 0; blockY < height; blockY += 16) {
    for (let blockX = 0; blockX < width; blockX += 16) {
      const values = [];
      for (let y = blockY; y < Math.min(blockY + 16, height); y += 1) {
        for (let x = blockX; x < Math.min(blockX + 16, width); x += 1) {
          values.push(luminanceAt(x, y));
        }
      }

      if (values.length) {
        blockVariances.push(standardDeviation(values));
      }
    }
  }

  const smoothRatio = sampleCount ? smoothCount / sampleCount : 0;
  const averageEdge = edgeSamples ? edgeTotal / edgeSamples : 0;
  const boundaryAverage = boundaryCount ? boundaryDiff / boundaryCount : 0;
  const interiorAverage = interiorCount ? interiorDiff / interiorCount : 0;
  const blockVarianceSpread = standardDeviation(blockVariances);
  const highlightRatio = (width * height) ? highlightClipCount / (width * height) : 0;

  let score = 12;

  if (smoothRatio > 0.78) {
    score += 18;
    sentenceReasons.push("Large smooth regions suggest over-processed or synthetic-looking texture.");
  }
  if (boundaryAverage > interiorAverage * 1.22 && boundaryAverage > 10) {
    score += 16;
    sentenceReasons.push("Compression-style block boundaries are stronger than nearby interior detail.");
  }
  if (blockVarianceSpread > 18) {
    score += 14;
    sentenceReasons.push("Different areas of the image have uneven noise or detail levels.");
  }
  if (averageEdge < 9 && Math.max(image.width, image.height) > 700) {
    score += 10;
    sentenceReasons.push("The image is unusually soft for its size, which can happen after synthetic upscaling or heavy filtering.");
  }
  if (averageEdge > 42 && smoothRatio > 0.65) {
    score += 10;
    sentenceReasons.push("Sharp edges combined with flat textures can indicate retouching or generation artifacts.");
  }
  if (highlightRatio > 0.16) {
    score += 8;
    sentenceReasons.push("A large amount of highlight clipping can hide texture and reduce authenticity cues.");
  }

  return {
    score: clamp(Math.round(score), 0, 100),
    reasons: sentenceReasons,
    metrics: {
      width: image.width,
      height: image.height,
      smoothRatio: Number(smoothRatio.toFixed(3)),
      averageEdge: Number(averageEdge.toFixed(2)),
      boundaryAverage: Number(boundaryAverage.toFixed(2)),
      interiorAverage: Number(interiorAverage.toFixed(2)),
      blockVarianceSpread: Number(blockVarianceSpread.toFixed(2)),
      highlightRatio: Number(highlightRatio.toFixed(3))
    }
  };
}

async function prepareUploadedImage(file) {
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImageElement(dataUrl);
  const forensic = analyzeImagePixels(image);

  return {
    file,
    name: file.name,
    size: file.size,
    type: file.type || "unknown",
    dataUrl,
    width: image.width,
    height: image.height,
    forensic
  };
}

function analyzeClaim(text) {
  const misinformation = collectMatches(text, misinformationSignals);
  const suspicious = [...misinformation.matches];
  const explanations = [];
  let corrected = "No specific correction available. Verify the claim with reliable sources.";
  let misinformationScore = clamp(18 + misinformation.total, 0, 100);
  let label = "Needs Verification";

  for (const entry of knownFalsePatterns) {
    if (entry.pattern.test(text)) {
      misinformationScore = clamp(misinformationScore + 45, 0, 100);
      corrected = entry.correction;
      suspicious.push(text);
      label = "False";
      explanations.push("The claim matches a widely debunked misinformation pattern.");
      break;
    }
  }

  if (label !== "False" && misinformationScore >= 65) {
    label = "Misleading";
    explanations.push("The wording relies on absolutes or sensational language, which weakens credibility.");
  }

  if (!explanations.length) {
    explanations.push("The claim does not strongly match the built-in false-claim list, so it needs external verification.");
  }

  return {
    content_type: label,
    truth_classification: label === "False" ? "False" : label === "Misleading" ? "Misleading" : "Needs Verification",
    ai_generated_probability: `${clamp(12 + Math.round(text.length / 30), 0, 55)}%`,
    misinformation_score: `${misinformationScore}%`,
    suspicious_segments: [...new Set(findSuspiciousSegments(text, suspicious))],
    explanation: explanations.join(" "),
    corrected_information: corrected,
    deepfake_likelihood: "0%",
    key_reasons: [],
    final_verdict: label
  };
}

function analyzeText(text) {
  const aiSignals = collectMatches(text, aiStyleSignals);
  const misinfoSignals = collectMatches(text, misinformationSignals);
  const sentences = sentenceList(text);
  const words = text.match(/\b[\w'-]+\b/g) || [];
  const averageSentenceLength = sentences.length
    ? sentences.reduce((sum, sentence) => sum + sentence.split(/\s+/).length, 0) / sentences.length
    : 0;
  const uniqueWordRatio = words.length
    ? new Set(words.map((word) => word.toLowerCase())).size / words.length
    : 1;
  const repeatedStarters = countRepeatedStarters(sentences);

  const repeatedTransitions = aiSignals.matches.length >= 2;
  const lowSpecificity = /\b(various|many ways|important topic|advantages and disadvantages|significant impact|in many aspects|in numerous ways)\b/i.test(text);
  const balancedTemplatePhrasing = /\b(on the one hand|on the other hand|not only\b.*\bbut also|both\b.*\band)\b/i.test(text);
  const noConcreteDetails = words.length > 70 && !/\d/.test(text) && !/\b(I|my|we|our|yesterday|today|last week|last month)\b/i.test(text);
  const commaHeavySentences = sentences.filter((sentence) => (sentence.match(/,/g) || []).length >= 2).length;
  const sentenceLengths = sentences.map((sentence) => sentence.split(/\s+/).length);
  const sentenceLengthSpread = standardDeviation(sentenceLengths);
  const paragraphCount = text.split(/\n\s*\n/).filter(Boolean).length;
  const lowSentenceVariation = sentences.length >= 4 && sentenceLengthSpread < 6;
  const formalToneDensity = (text.match(/\b(additionally|furthermore|moreover|therefore|thus|overall|however)\b/gi) || []).length;
  const longAbstractPassage = words.length > 120 && noConcreteDetails;

  let aiProbability = clamp(
    24
      + aiSignals.total
      + (repeatedTransitions ? 12 : 0)
      + (lowSpecificity ? 12 : 0)
      + (balancedTemplatePhrasing ? 10 : 0)
      + (noConcreteDetails ? 12 : 0)
      + Math.min(repeatedStarters * 6, 18)
      + (commaHeavySentences >= 2 ? 8 : 0)
      + (lowSentenceVariation ? 10 : 0)
      + (formalToneDensity >= 3 ? 8 : 0)
      + (longAbstractPassage ? 12 : 0)
      + (paragraphCount === 1 && words.length > 140 ? 5 : 0),
    0,
    100
  );

  if (averageSentenceLength > 22) {
    aiProbability = clamp(aiProbability + 8, 0, 100);
  }
  if (uniqueWordRatio < 0.58 && words.length > 80) {
    aiProbability = clamp(aiProbability + 10, 0, 100);
  }

  let contentType = "Human-written";
  if (aiProbability >= 60) {
    contentType = "AI-generated";
  } else if (aiProbability >= 45) {
    contentType = "Possibly manipulated or uncertain";
  }

  const explanationParts = [];
  if (aiSignals.matches.length) {
    explanationParts.push("The text includes common AI-style transition phrases and generic academic filler.");
  }
  if (lowSpecificity) {
    explanationParts.push("Several parts are broad and unspecific, which can happen in generated text.");
  }
  if (repeatedStarters > 0) {
    explanationParts.push("Multiple sentences begin in a similar way, which can signal machine-generated structure.");
  }
  if (noConcreteDetails) {
    explanationParts.push("The passage stays abstract and avoids concrete details, dates, or personal context.");
  }
  if (lowSentenceVariation) {
    explanationParts.push("Sentence lengths are unusually uniform, which is common in generated text.");
  }
  if (!explanationParts.length) {
    explanationParts.push("The writing does not show strong built-in signs of generated text, though heuristic checks are limited.");
  }

  return {
    content_type: contentType,
    truth_classification: misinfoSignals.total >= 35 ? "Misleading" : "Needs Verification",
    ai_generated_probability: `${aiProbability}%`,
    misinformation_score: `${clamp(10 + misinfoSignals.total, 0, 100)}%`,
    suspicious_segments: collectTextSuspiciousSegments(
      text,
      sentences,
      [...aiSignals.matches, ...misinfoSignals.matches],
      [
        /\b(various|many ways|important topic|advantages and disadvantages|significant impact)\b/i,
        /\b(on the one hand|on the other hand|both\b.*\band)\b/i
      ]
    ),
    explanation: explanationParts.join(" "),
    corrected_information: "If factual accuracy matters, confirm any claims in the text with current trusted sources.",
    deepfake_likelihood: "0%",
    key_reasons: [],
    final_verdict: contentType
  };
}

function analyzeImageDescription(text, uploadedImage = null) {
  const reasons = [];
  let deepfakeScore = uploadedImage?.forensic?.score ?? 18;

  deepfakeSignals.forEach((signal) => {
    const matches = text.match(signal.regex);
    if (matches) {
      deepfakeScore += signal.weight * matches.length;
      reasons.push(signal.reason);
    }
  });

  if (uploadedImage?.forensic?.reasons?.length) {
    reasons.push(...uploadedImage.forensic.reasons);
  }

  if (uploadedImage) {
    reasons.push(`Analyzed uploaded image: ${uploadedImage.name} (${uploadedImage.width}x${uploadedImage.height}).`);
  }

  if (!reasons.length) {
    reasons.push("No strong manipulation clues were described, but the assessment is limited because it is based only on text.");
  }

  deepfakeScore = clamp(deepfakeScore, 0, 100);

  let verdict = "Needs Verification";
  if (deepfakeScore >= 75) {
    verdict = "Likely manipulated or deepfake-like";
  } else if (deepfakeScore >= 45) {
    verdict = "Possibly manipulated";
  } else {
    verdict = "Low obvious deepfake suspicion";
  }

  return {
    content_type: "Possibly manipulated or uncertain",
    truth_classification: "Needs Verification",
    ai_generated_probability: `${clamp(deepfakeScore - 5, 0, 100)}%`,
    misinformation_score: "0%",
    suspicious_segments: [
      ...new Set([
        ...findSuspiciousSegments(text, ["lighting", "shadow", "background", "skin", "face", "fingers", "texture"]),
        ...(uploadedImage ? [
          `smooth_ratio:${uploadedImage.forensic.metrics.smoothRatio}`,
          `block_variance_spread:${uploadedImage.forensic.metrics.blockVarianceSpread}`,
          `average_edge:${uploadedImage.forensic.metrics.averageEdge}`
        ] : [])
      ])
    ],
    explanation: uploadedImage
      ? "The result combines the written description with direct client-side image checks for smoothness, block artifacts, sharpness, and uneven texture patterns."
      : "The description was checked for unrealistic lighting, facial inconsistency, warped backgrounds, and unnatural textures.",
    corrected_information: "Use the original file, metadata, reverse-image search, and frame-level forensic tools for confirmation because this browser check is heuristic.",
    deepfake_likelihood: `${deepfakeScore}%`,
    key_reasons: [...new Set(reasons)],
    final_verdict: verdict
  };
}

async function fetchApiStatus() {
  try {
    const response = await fetch(`${getBackendBaseUrl()}/api/status`);
    const payload = await response.json();
    apiStatus = payload;
    if (payload.aiConfigured) {
      setStatusNote(`AI mode active via ${payload.provider} using ${payload.model}.`);
      return;
    }

    if (payload.acceptsBrowserKey && getEnteredApiKey()) {
      setStatusNote(`Backend reached at ${getBackendBaseUrl()}. AI will use the API key entered in this page.`);
      return;
    }

    setStatusNote(`Backend reached at ${getBackendBaseUrl()}, but no API key is active. Enter a key above or configure OPENAI_API_KEY on the server.`);
  } catch (error) {
    apiStatus = { aiConfigured: false, model: "", provider: "none", acceptsBrowserKey: false };
    setStatusNote(`Could not reach backend at ${getBackendBaseUrl()}. Start the server there or update the Backend URL field.`);
  }
}

async function analyzeWithApi({ mode, text, uploadedImage }) {
  const response = await fetch(`${getBackendBaseUrl()}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      mode,
      text,
      imageDataUrl: uploadedImage?.dataUrl || "",
      apiKey: apiStatus.aiConfigured ? "" : getEnteredApiKey()
    })
  });

  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "AI analysis failed.");
  }

  return payload;
}

async function analyze() {
  const text = input.value.trim();
  let uploadedImage = uploadedImageState;

  if (currentMode === "image" && imageInput.files.length && !uploadedImageState) {
    uploadedImage = await prepareUploadedImage(imageInput.files[0]);
    uploadedImageState = uploadedImage;
  }

  if (!text && !(currentMode === "image" && uploadedImage)) {
    output.textContent = JSON.stringify({
      content_type: "",
      truth_classification: "",
      ai_generated_probability: "",
      misinformation_score: "",
      suspicious_segments: [],
      explanation: "Please provide some input to analyze.",
      corrected_information: "",
      deepfake_likelihood: "",
      key_reasons: [],
      final_verdict: ""
    }, null, 2);
    return;
  }

  const fallbackResult = currentMode === "claim"
    ? analyzeClaim(text)
    : currentMode === "text"
      ? analyzeText(text)
      : analyzeImageDescription(text, uploadedImage);

  if (!apiStatus.aiConfigured && !getEnteredApiKey()) {
    fallbackResult.explanation = `${fallbackResult.explanation} Result source: local heuristic mode.`;
    output.textContent = JSON.stringify(fallbackResult, null, 2);
    return;
  }

  try {
    const apiResult = await analyzeWithApi({
      mode: currentMode,
      text,
      uploadedImage
    });

    const mergedResult = {
      ...fallbackResult,
      ...apiResult.result,
      explanation: `${apiResult.result.explanation} Result source: OpenAI API (${apiResult.model}).`
    };
    output.textContent = JSON.stringify(mergedResult, null, 2);
  } catch (error) {
    fallbackResult.explanation = `${fallbackResult.explanation} Result source: local heuristic fallback because the AI request failed.`;
    output.textContent = JSON.stringify(fallbackResult, null, 2);
    setStatusNote(`AI request failed, using local heuristics. ${error.message}`);
  }
}

modeButtons.forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

analyzeButton.addEventListener("click", () => {
  analyze().catch(() => {
    output.textContent = JSON.stringify({
      content_type: "Possibly manipulated or uncertain",
      truth_classification: "Needs Verification",
      ai_generated_probability: "",
      misinformation_score: "",
      suspicious_segments: [],
      explanation: "The app could not analyze the provided content. Try another image or reload the page.",
      corrected_information: "",
      deepfake_likelihood: "",
      key_reasons: [],
      final_verdict: "Needs Verification"
    }, null, 2);
  });
});

sampleButton.addEventListener("click", () => {
  input.value = samples[currentMode];
  analyze();
});

imageInput.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  uploadedImageState = null;

  if (!file) {
    imagePreview.classList.remove("visible");
    imagePreview.removeAttribute("src");
    imageMeta.textContent = "No image selected.";
    return;
  }

  imageMeta.textContent = "Loading image...";

  try {
    uploadedImageState = await prepareUploadedImage(file);
    imagePreview.src = uploadedImageState.dataUrl;
    imagePreview.classList.add("visible");
    imageMeta.textContent = `${uploadedImageState.name} | ${uploadedImageState.width}x${uploadedImageState.height} | ${(uploadedImageState.size / 1024).toFixed(1)} KB`;
  } catch (error) {
    imagePreview.classList.remove("visible");
    imagePreview.removeAttribute("src");
    imageMeta.textContent = "Could not load that image for analysis.";
  }
});

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(output.textContent);
    copyButton.textContent = "Copied";
    window.setTimeout(() => {
      copyButton.textContent = "Copy JSON";
    }, 1200);
  } catch (error) {
    copyButton.textContent = "Copy Failed";
    window.setTimeout(() => {
      copyButton.textContent = "Copy JSON";
    }, 1200);
  }
});

setMode(currentMode);
fetchApiStatus();
backendUrlInput.addEventListener("change", fetchApiStatus);
apiKeyInput.addEventListener("input", fetchApiStatus);


