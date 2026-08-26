import { useMemo, useState, useRef, useEffect } from "react";
import "./App.css";

const WEBHOOK_URL = import.meta.env.VITE_N8N_WEBHOOK_URL || "";

function siblingWebhookUrl(pathName) {
  const raw = WEBHOOK_URL.trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    const slash = url.pathname.lastIndexOf("/");
    url.pathname = `${url.pathname.slice(0, slash + 1)}${pathName}`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return raw.replace(/\/[^/]*\/?$/, `/${pathName}`);
  }
}

const STATUS_URL = siblingWebhookUrl("script-studio-status");
const DEFAULT_DOWNLOAD_URL = siblingWebhookUrl("script-studio-download");

const POLL_INTERVAL_START_MS = 6000;
const POLL_INTERVAL_MAX_MS = 20000;
const POLL_BACKOFF_AFTER_POLLS = 5;
const POLL_TIMEOUT_MS = 20 * 60 * 1000;
const JOB_LOOKUP_GRACE_MS = 90 * 1000;
const FETCH_TIMEOUT_MS = 20000;
const MAX_NETWORK_RETRIES_PER_POLL = 3;

function pollIntervalForAttempt(attempt) {
  if (attempt <= POLL_BACKOFF_AFTER_POLLS) return POLL_INTERVAL_START_MS;
  return POLL_INTERVAL_MAX_MS;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const options = {
  intent: ["Create New Script", "Rewrite Existing Script"],
  contentType: ["Instagram Reel", "Short Video", "Long Video"],
  niche: [
    "Real Estate",
    "Entertainment",
    "Finance",
    "Business",
    "Marketing",
    "Technology",
    "Education",
    "Fitness",
    "Lifestyle",
    "Personal Brand",
    "Other",
  ],
  platform: ["Instagram Reels", "TikTok", "YouTube Shorts"],
  duration: [
    "15 seconds",
    "30 seconds",
    "45 seconds",
    "60 seconds",
    "90 seconds",
    "3 minutes",
    "5 minutes",
    "10 minutes",
  ],
  targetAudience: ["Gen Z", "General"],
  market: ["Pakistan", "India", "Global", "Other"],
  language: [
    "Natural Pakistani Roman Urdu + English",
    "Pure Roman Urdu",
    "Urdu + English",
    "English",
  ],
  scriptStyle: [
    "Educational",
    "Storytelling",
    "Problem to Solution",
    "Myth Busting",
    "Listicle",
    "Authority",
    "Casual",
    "Controversial",
    "News/Trend",
  ],
  creatorPersonality: [
    "Friendly Expert",
    "Straight Talker",
    "Teacher",
    "Storyteller",
    "Young Entrepreneur",
    "Real Estate Expert",
    "Funny/Sarcastic",
    "Premium/Luxury",
  ],
  tone: [
    "Casual",
    "Friendly",
    "Serious",
    "Bold",
    "Emotional",
    "Funny",
    "Conversational",
  ],
  energy: ["Calm", "Natural", "Medium", "High", "Viral"],
  yesNo: ["Yes", "No"],
  trend: ["Off", "Relevant Only", "Smart Mode", "Heavy Trend"],
  research: ["Off", "Basic", "Deep"],
  referenceFocus: [
    "Hook",
    "Structure",
    "Tone",
    "Pacing",
    "Storytelling",
    "Language",
    "CTA",
  ],
  saveTo: ["Abdul Hadi", "Taabish", "Random Account"],
};

// Multi-select configurations
const NICHE_MAX = options.niche.length;
const SCRIPT_STYLE_MAX = options.scriptStyle.length;
const CREATOR_PERSONALITY_MAX = options.creatorPersonality.length;
const REFERENCE_FOCUS_MAX = 3;

const defaults = {
  intent: "Create New Script",
  contentType: "Instagram Reel",
  niche: ["Technology"],
  idea: "",
  existingScript: "",
  platform: "Instagram Reels",
  duration: "30 seconds",
  targetAudience: "Gen Z",
  market: "Pakistan",
  language: "Natural Pakistani Roman Urdu + English",
  scriptStyle: ["Educational"],
  creatorPersonality: ["Funny/Sarcastic"],
  tone: "Casual",
  energy: "High",
  showAlternatives: "Yes",
  currentTrends: "Smart Mode",
  research: "Basic",
  referenceVideoUrl: "",
  referenceTranscript: "",
  referenceAnalysisFocus: ["Hook"],
  saveScriptTo: "Abdul Hadi",
};

function Field({ label, children, full = false, hint }) {
  return (
    <label className={full ? "field full" : "field"}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function SelectField({ label, value, onChange, items }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {items.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </Field>
  );
}

function MultiSelectField({ label, values, onChange, items, max = 3, hint, full = false }) {
  const toggle = (item) => {
    const isActive = values.includes(item);

    if (isActive) {
      onChange(values.filter((v) => v !== item));
      return;
    }

    if (values.length >= max) return;
    onChange([...values, item]);
  };

  const defaultHint =
    max > 1
      ? `Pick up to ${max}${values.length > 1 ? " — first pick is the primary structure" : ""}`
      : undefined;

  return (
    <Field label={label} full={full} hint={hint ?? defaultHint}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "8px",
          marginTop: "4px",
        }}
      >
        {items.map((item) => {
          const active = values.includes(item);
          const disabled = !active && values.length >= max;

          return (
            <button
              type="button"
              key={item}
              onClick={() => toggle(item)}
              disabled={disabled}
              style={{
                padding: "6px 12px",
                borderRadius: "999px",
                border: active ? "1px solid #7c5cff" : "1px solid #3a3a4a",
                background: active ? "#7c5cff" : "transparent",
                color: active ? "#fff" : disabled ? "#666" : "#ddd",
                fontSize: "13px",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.5 : 1,
                transition: "all 0.15s ease",
              }}
            >
              {active && values.length > 1 ? `${values.indexOf(item) + 1}. ` : ""}
              {item}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

function normaliseResponse(value) {
  let data = value;

  if (Array.isArray(data)) {
    data = data[0] || {};
  }

  if (data?.data && typeof data.data === "object") {
    data = data.data;
  }

  if (data?.result && typeof data.result === "object") {
    data = data.result;
  }

  return data || {};
}

function getScriptData(value) {
  const data = normaliseResponse(value);

  if (data.script && typeof data.script === "object") {
    return data.script;
  }

  if (data.output && typeof data.output === "object") {
    if (data.output.script && typeof data.output.script === "object") {
      return data.output.script;
    }
    return data.output;
  }

  return data;
}

function getFullScript(value) {
  const data = normaliseResponse(value);
  const script = getScriptData(value);

  const candidates = [
    script?.fullScript,
    script?.finalText,
    script?.script,
    script?.full_script,
    script?.scriptText,
    data?.fullScript,
    data?.finalText,
    data?.script,
    data?.full_script,
    data?.output?.script?.fullScript,
    data?.output?.script?.finalText,
    data?.output?.fullScript,
    data?.output?.finalText,
  ];

  for (const item of candidates) {
    if (typeof item === "string" && item.trim().length > 0) {
      return item.trim();
    }
  }

  return "";
}

function getAnalysis(value) {
  const data = normaliseResponse(value);
  const script = getScriptData(value);

  return data?.analysis || script?.analysis || {};
}

function getAlternativeHooks(value) {
  const data = normaliseResponse(value);
  const script = getScriptData(value);

  return data?.alternativeHooks || script?.alternativeHooks || [];
}

function getVisualBeats(value) {
  const data = normaliseResponse(value);
  const script = getScriptData(value);

  return data?.visualBeats || script?.visualBeats || [];
}

async function readResponse(response) {
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";

  if (!text.trim()) {
    return {
      empty: true,
      data: null,
      contentType,
      rawText: "",
    };
  }

  if (
    contentType.includes("application/json") ||
    text.trim().startsWith("{") ||
    text.trim().startsWith("[")
  ) {
    try {
      return {
        empty: false,
        data: JSON.parse(text),
        contentType,
        rawText: text,
      };
    } catch {
      throw new Error(
        "n8n returned invalid JSON. Check the Respond to Webhook node Response Body."
      );
    }
  }

  return {
    empty: false,
    data: null,
    contentType,
    rawText: text,
  };
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function App() {
  const [mode, setMode] = useState("manual");
  const [form, setForm] = useState(defaults);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [bulkDone, setBulkDone] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(null);
  const pollAbortRef = useRef(false);
  const submitInFlightRef = useRef(false);

  useEffect(() => {
    return () => {
      pollAbortRef.current = true;
    };
  }, []);

  const set = (key, value) =>
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));

  const valid = useMemo(() => Boolean(WEBHOOK_URL.trim()), []);

  const runManual = async () => {
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;

    setError("");
    setResult(null);
    setBulkDone(false);

    if (!WEBHOOK_URL.trim()) {
      submitInFlightRef.current = false;
      setError("Set VITE_N8N_WEBHOOK_URL in frontend/.env first.");
      return;
    }

    if (!form.idea.trim()) {
      submitInFlightRef.current = false;
      setError("Idea is required.");
      return;
    }

    if (!Array.isArray(form.niche) || form.niche.length === 0) {
      submitInFlightRef.current = false;
      setError("Pick at least one Niche.");
      return;
    }

    if (!Array.isArray(form.scriptStyle) || form.scriptStyle.length === 0) {
      submitInFlightRef.current = false;
      setError("Pick at least one Script Style.");
      return;
    }

    if (!Array.isArray(form.creatorPersonality) || form.creatorPersonality.length === 0) {
      submitInFlightRef.current = false;
      setError("Pick at least one Creator Personality.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          inputMode: "manual",
          request: form,
        }),
      });

      const parsed = await readResponse(response);

      if (!response.ok) {
        const serverMessage =
          parsed.data?.error ||
          parsed.data?.message ||
          `Request failed (${response.status}).`;

        throw new Error(serverMessage);
      }

      if (parsed.empty) {
        throw new Error(
          "n8n returned an empty response. In the Respond to Webhook node, set Respond With = JSON and return the script JSON."
        );
      }

      if (!parsed.data) {
        throw new Error(
          "n8n did not return JSON. Check the Respond to Webhook node."
        );
      }

      const normalised = normaliseResponse(parsed.data);

      if (
        normalised.success === false ||
        normalised.status === "error"
      ) {
        throw new Error(
          normalised.error ||
            normalised.message ||
            "Script generation failed in n8n."
        );
      }

      const fullScript = getFullScript(parsed.data);

      if (!fullScript) {
        throw new Error(
          "n8n responded successfully, but no fullScript/finalText was found in the response."
        );
      }

      setResult(parsed.data);
    } catch (e) {
      setError(e?.message || "Request failed.");
    } finally {
      setLoading(false);
      submitInFlightRef.current = false;
    }
  };

  const pollBulkJob = async (jobId) => {
    const startedAt = Date.now();
    pollAbortRef.current = false;

    let attempt = 0;
    let consecutiveNetworkFailures = 0;

    while (!pollAbortRef.current) {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        throw new Error(
          "Timed out waiting for bulk generation. The job may still be running in n8n."
        );
      }

      attempt += 1;
      await sleep(pollIntervalForAttempt(attempt));

      let statusResponse;
      let parsed;

      try {
        statusResponse = await fetchWithTimeout(
          `${STATUS_URL}?jobId=${encodeURIComponent(jobId)}`,
          {
            method: "GET",
            headers: { Accept: "application/json" },
            cache: "no-store",
          }
        );

        parsed = await readResponse(statusResponse);
        consecutiveNetworkFailures = 0;
      } catch {
        consecutiveNetworkFailures += 1;

        if (consecutiveNetworkFailures >= MAX_NETWORK_RETRIES_PER_POLL) {
          setBulkProgress((previous) => ({
            totalRows: previous?.totalRows || 0,
            status: "processing",
            networkWarning: true,
          }));
        }

        continue;
      }

      if (!statusResponse.ok || parsed.empty || !parsed.data) {
        continue;
      }

      const data = normaliseResponse(parsed.data);
      const elapsed = Date.now() - startedAt;

      if (data.success === false) {
        if (elapsed < JOB_LOOKUP_GRACE_MS || data.retryable) {
          setBulkProgress((previous) => ({
            totalRows: previous?.totalRows || data.totalRows || 0,
            status: "processing",
          }));
          continue;
        }

        throw new Error(data.error || "Bulk job could not be found.");
      }

      setBulkProgress({
        totalRows: Number(data.totalRows || 0),
        status: data.status || "processing",
      });

      if (String(data.status || "").toLowerCase() === "completed") {
        return data;
      }

      if (String(data.status || "").toLowerCase() === "failed") {
        throw new Error(data.error || "Bulk generation failed in n8n.");
      }
    }

    throw new Error("Polling was cancelled.");
  };

  const downloadBulkResult = async (job) => {
    const downloadUrl = job?.downloadPath
      ? new URL(job.downloadPath, WEBHOOK_URL).toString()
      : `${DEFAULT_DOWNLOAD_URL}?jobId=${encodeURIComponent(job.jobId)}`;

    let response;
    try {
      response = await fetchWithTimeout(
        downloadUrl,
        {
          method: "GET",
          headers: { Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/octet-stream" },
          cache: "no-store",
        },
        60000
      );
    } catch {
      throw new Error(
        "Could not reach n8n to download the file (connection timed out or was blocked)."
      );
    }

    if (!response.ok) {
      let message = `Download failed (${response.status}).`;

      try {
        const parsed = await readResponse(response);
        const data = normaliseResponse(parsed.data);
        message = data?.error || data?.message || message;
      } catch {
        // Keep HTTP error message
      }

      throw new Error(message);
    }

    const blob = await response.blob();

    if (!blob.size) {
      throw new Error("n8n returned an empty XLSX file.");
    }

    let fileName = job.fileName || "script-results.xlsx";
    const disposition = response.headers.get("content-disposition") || "";

    const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    const plainMatch = disposition.match(/filename="?([^";]+)"?/i);

    if (utf8Match?.[1]) {
      try {
        fileName = decodeURIComponent(utf8Match[1]);
      } catch {
        fileName = utf8Match[1];
      }
    } else if (plainMatch?.[1]) {
      fileName = plainMatch[1];
    }

    downloadBlob(blob, fileName);
  };

  const runBulk = async () => {
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;

    setError("");
    setResult(null);
    setBulkDone(false);
    setBulkProgress(null);

    if (!WEBHOOK_URL.trim()) {
      submitInFlightRef.current = false;
      setError("Set VITE_N8N_WEBHOOK_URL in frontend/.env first.");
      return;
    }

    if (!file) {
      submitInFlightRef.current = false;
      setError("Choose a CSV or XLSX file.");
      return;
    }

    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".csv") && !lowerName.endsWith(".xlsx")) {
      submitInFlightRef.current = false;
      setError("Only CSV and XLSX files are supported.");
      return;
    }

    setLoading(true);

    try {
      const fd = new FormData();

      fd.append("inputMode", "bulk");
      fd.append("bulkDefaultSaveScriptTo", form.saveScriptTo);
      fd.append("file", file, file.name);

      const response = await fetch(WEBHOOK_URL, {
        method: "POST",
        body: fd,
        headers: {
          Accept: "application/json",
        },
      });

      const parsed = await readResponse(response);

      if (!response.ok) {
        const data = normaliseResponse(parsed.data);
        const message =
          data?.error ||
          data?.message ||
          `Bulk request failed (${response.status}).`;
        throw new Error(message);
      }

      if (parsed.empty || !parsed.data) {
        throw new Error(
          "n8n returned an empty response when starting the bulk job."
        );
      }

      const startData = normaliseResponse(parsed.data);

      if (startData.success === false) {
        throw new Error(
          startData.error || "n8n rejected the bulk request."
        );
      }

      const jobId = startData.jobId;

      if (!jobId) {
        throw new Error("n8n did not return a jobId.");
      }

      if (String(startData.status || "").toLowerCase() === "failed") {
        throw new Error(
          startData.error || "Bulk generation failed before it could start."
        );
      }

      setBulkProgress({
        totalRows: Number(startData.totalRows || 0),
        status: "processing",
      });

      const finalStatus = await pollBulkJob(jobId);
      await downloadBulkResult(finalStatus);

      setBulkDone(true);
      setBulkProgress(null);
    } catch (e) {
      setError(e?.message || "Bulk request failed.");
    } finally {
      setLoading(false);
      setBulkProgress(null);
      submitInFlightRef.current = false;
    }
  };

  const copyScript = async () => {
    const text = getFullScript(result);

    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setError("Could not copy the script.");
    }
  };

  const downloadTxt = () => {
    const text = getFullScript(result);

    if (!text) return;

    const blob = new Blob([text], {
      type: "text/plain;charset=utf-8",
    });

    downloadBlob(blob, "script.txt");
  };

  const analysis = getAnalysis(result);
  const alternativeHooks = getAlternativeHooks(result);
  const visualBeats = getVisualBeats(result);
  const fullScript = getFullScript(result);

  return (
    <div className="app">
      <div className="reel-rail reel-rail-left" aria-hidden="true" />
      <div className="reel-rail reel-rail-right" aria-hidden="true" />

      <header className="hero">
        <div className="marquee" aria-hidden="true" />

        <div className="hero-top">
          <div>
            <div className="eyebrow">
              <span className="eyebrow-dot" />
              AI Script Studio
            </div>

            <h1>
              Ready-to-record scripts,
              <br />
              without the <span className="hl">form clutter.</span>
            </h1>

            <p>
              Use the same AI engine manually or generate multiple
              scripts from one spreadsheet.
            </p>
          </div>

          <div className="status-chip" title={valid ? "Webhook URL configured" : "Webhook URL missing"}>
            <span className={"api-dot " + (valid ? "ok" : "bad")} />
            {valid ? "LIVE" : "OFFLINE"}
          </div>
        </div>
      </header>

      <main className="shell">
        <div className="mode-tabs">
          <button
            className={mode === "manual" ? "active" : ""}
            onClick={() => {
              setMode("manual");
              setError("");
            }}
          >
            <span className="tab-index">01</span>
            Manual Script
          </button>

          <button
            className={mode === "bulk" ? "active" : ""}
            onClick={() => {
              setMode("bulk");
              setError("");
            }}
          >
            <span className="tab-index">02</span>
            Bulk Spreadsheet
          </button>
        </div>

        {error && (
          <div className="alert error">
            <span className="alert-icon">!</span>
            {error}
          </div>
        )}

        {bulkProgress && (
          <div className="alert info">
            <span className="alert-icon">
              <span className="mini-spinner" />
            </span>
            Generating{" "}
            {bulkProgress.totalRows ? bulkProgress.totalRows : ""} script
            {bulkProgress.totalRows === 1 ? "" : "s"}... this can take a
            few minutes for larger sheets.
          </div>
        )}

        {bulkDone && (
          <div className="alert success">
            <span className="alert-icon">✓</span>
            All available rows were processed. Your{" "}
            <b>script-results.xlsx</b> download has started.
          </div>
        )}

        {mode === "manual" ? (
          <>
            <section className="card">
              <div className="section-title">
                <span className="slate">SCENE 01</span>
                Script brief
              </div>

              <div className="grid">
                <SelectField
                  label="What do you want to do?"
                  value={form.intent}
                  onChange={(v) => set("intent", v)}
                  items={options.intent}
                />

                <SelectField
                  label="Content Type"
                  value={form.contentType}
                  onChange={(v) => set("contentType", v)}
                  items={options.contentType}
                />

                <MultiSelectField
                  label="Niche"
                  values={form.niche}
                  onChange={(v) => set("niche", v)}
                  items={options.niche}
                  max={NICHE_MAX}
                  full
                  hint="Pick as many as you want"
                />

                <Field label="Idea" full>
                  <textarea
                    value={form.idea}
                    onChange={(e) =>
                      set("idea", e.target.value)
                    }
                    placeholder="Drop your idea here..."
                  />
                </Field>

                {form.intent === "Rewrite Existing Script" && (
                  <Field
                    label="Existing Script (only if improving / rewriting)"
                    full
                  >
                    <textarea
                      value={form.existingScript}
                      onChange={(e) =>
                        set(
                          "existingScript",
                          e.target.value
                        )
                      }
                      placeholder="Paste the script you want to improve..."
                    />
                  </Field>
                )}

                <SelectField
                  label="Platform"
                  value={form.platform}
                  onChange={(v) => set("platform", v)}
                  items={options.platform}
                />

                <SelectField
                  label="Duration"
                  value={form.duration}
                  onChange={(v) => set("duration", v)}
                  items={options.duration}
                />

                <SelectField
                  label="Target Audience"
                  value={form.targetAudience}
                  onChange={(v) =>
                    set("targetAudience", v)
                  }
                  items={options.targetAudience}
                />

                <SelectField
                  label="Market"
                  value={form.market}
                  onChange={(v) => set("market", v)}
                  items={options.market}
                />

                <SelectField
                  label="Language"
                  value={form.language}
                  onChange={(v) => set("language", v)}
                  items={options.language}
                />

                <MultiSelectField
                  label="Script Style"
                  values={form.scriptStyle}
                  onChange={(v) => set("scriptStyle", v)}
                  items={options.scriptStyle}
                  max={SCRIPT_STYLE_MAX}
                  full
                  hint={
                    form.scriptStyle.length > 1
                      ? "1st = main structure, others = blended in as a technique"
                      : "Pick as many as you want — 1st is the main structure"
                  }
                />

                <MultiSelectField
                  label="Creator Personality"
                  values={form.creatorPersonality}
                  onChange={(v) => set("creatorPersonality", v)}
                  items={options.creatorPersonality}
                  max={CREATOR_PERSONALITY_MAX}
                  full
                  hint="Pick as many as you want"
                />

                <SelectField
                  label="Tone"
                  value={form.tone}
                  onChange={(v) => set("tone", v)}
                  items={options.tone}
                />

                <SelectField
                  label="Energy"
                  value={form.energy}
                  onChange={(v) => set("energy", v)}
                  items={options.energy}
                />

                <SelectField
                  label="Alternative Hooks & Visual Ideas"
                  value={form.showAlternatives}
                  onChange={(v) =>
                    set("showAlternatives", v)
                  }
                  items={options.yesNo}
                />

                <SelectField
                  label="Current Trends"
                  value={form.currentTrends}
                  onChange={(v) =>
                    set("currentTrends", v)
                  }
                  items={options.trend}
                />

                <SelectField
                  label="Research"
                  value={form.research}
                  onChange={(v) =>
                    set("research", v)
                  }
                  items={options.research}
                />

                <Field label="Reference Video URL">
                  <input
                    value={form.referenceVideoUrl}
                    onChange={(e) =>
                      set(
                        "referenceVideoUrl",
                        e.target.value
                      )
                    }
                    placeholder="https://..."
                  />
                </Field>

                <MultiSelectField
                  label="Reference Analysis Focus"
                  values={form.referenceAnalysisFocus}
                  onChange={(v) => set("referenceAnalysisFocus", v)}
                  items={options.referenceFocus}
                  max={REFERENCE_FOCUS_MAX}
                />

                <Field label="Reference Transcript" full>
                  <textarea
                    value={form.referenceTranscript}
                    onChange={(e) =>
                      set(
                        "referenceTranscript",
                        e.target.value
                      )
                    }
                    placeholder="Optional transcript..."
                  />
                </Field>

                <SelectField
                  label="Save Script To"
                  value={form.saveScriptTo}
                  onChange={(v) =>
                    set("saveScriptTo", v)
                  }
                  items={options.saveTo}
                />
              </div>

              <button
                className="primary"
                onClick={runManual}
                disabled={loading}
              >
                {loading && <span className="spinner" />}
                {loading ? "Generating..." : "Generate Script"}
              </button>
            </section>

            {result && fullScript && (
              <section className="result card">
                <div className="result-head">
                  <div>
                    <div className="section-title">
                      <span className="slate">TAKE 01</span>
                      Generated script
                    </div>

                    <div className="score-row">
                      <div
                        className="score-ring"
                        style={{
                          "--pct": Math.min(
                            100,
                            Math.max(0, analysis?.overallScore ?? 0)
                          ),
                        }}
                      >
                        <span>{analysis?.overallScore ?? 0}</span>
                      </div>
                      <span className="muted">out of 100</span>
                    </div>
                  </div>

                  <div className="actions">
                    <button onClick={copyScript}>Copy Script</button>
                    <button onClick={downloadTxt}>Download TXT</button>
                  </div>
                </div>

                <div className="script-box">
                  <span className="pin" aria-hidden="true" />
                  <div className="label">SCRIPT</div>
                  <pre>{fullScript}</pre>
                </div>

                {alternativeHooks.length > 0 && (
                  <div className="sub-card">
                    <div className="label">ALTERNATIVE HOOKS</div>

                    {alternativeHooks.map((x, i) => (
                      <div className="line-item" key={i}>
                        <span className="line-num">{i + 1}</span> {x}
                      </div>
                    ))}
                  </div>
                )}

                {visualBeats.length > 0 && (
                  <div className="sub-card">
                    <div className="label">VISUAL IDEAS</div>

                    {visualBeats.map((x, i) => (
                      <div className="line-item" key={i}>
                        <b>{x?.line || ""}</b>
                        <span>{x?.visual || ""}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        ) : (
          <section className="card">
            <div className="section-title">
              <span className="slate">SCENE 02</span>
              Bulk generation
            </div>

            <p className="muted">
              Upload a CSV or XLSX where each row is one script request.
            </p>

            <div className="upload">
              <input
                id="file"
                type="file"
                accept=".csv,.xlsx"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />

              <label htmlFor="file">
                <span className="upload-icon" aria-hidden="true">
                  ⏏
                </span>
                {file ? file.name : "Choose CSV or XLSX"}
              </label>
            </div>

            <SelectField
              label="Default Save Script To"
              value={form.saveScriptTo}
              onChange={(v) => set("saveScriptTo", v)}
              items={options.saveTo}
            />

            <div className="bulk-note">
              <b>Minimum column:</b> Idea
            </div>

            <button className="primary" onClick={runBulk} disabled={loading}>
              {loading && <span className="spinner" />}
              {loading ? "Generating all scripts..." : "Generate All Scripts"}
            </button>
          </section>
        )}
      </main>
    </div>
  );
}