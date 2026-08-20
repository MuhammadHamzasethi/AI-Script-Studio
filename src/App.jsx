import { useMemo, useState, useRef, useEffect } from "react";
import "./App.css";

const WEBHOOK_URL = import.meta.env.VITE_N8N_WEBHOOK_URL || "";

// The bulk flow is asynchronous. The POST creates/persists a job and
// returns a jobId. Status and download use sibling n8n webhook paths.
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

const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes safety cutoff
const JOB_LOOKUP_GRACE_MS = 90 * 1000; // allow n8n/data-table propagation

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

const defaults = {
  intent: "Create New Script",
  contentType: "Instagram Reel",
  niche: "Technology",
  idea: "",
  existingScript: "",
  platform: "Instagram Reels",
  duration: "30 seconds",
  targetAudience: "Gen Z",
  market: "Pakistan",
  language: "Natural Pakistani Roman Urdu + English",
  scriptStyle: "Educational",
  creatorPersonality: "Funny/Sarcastic",
  tone: "Casual",
  energy: "High",
  showAlternatives: "Yes",
  currentTrends: "Smart Mode",
  research: "Basic",
  referenceVideoUrl: "",
  referenceTranscript: "",
  referenceAnalysisFocus: "Hook",
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

/*
  n8n can return the script in several shapes depending on how the
  Respond to Webhook node is configured.

  Supported examples:

  1. { status: "success", script: {...}, analysis: {...} }
  2. { success: true, data: { status: "success", script: {...} } }
  3. { result: {...} }
  4. [{ status: "success", script: {...} }]

  This function normalises all of them so the UI does not break.
*/
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

  return (
    script?.fullScript ||
    data?.fullScript ||
    data?.finalText ||
    script?.finalText ||
    ""
  );
}

function getAnalysis(value) {
  const data = normaliseResponse(value);
  const script = getScriptData(value);

  return data?.analysis || script?.analysis || {};
}

function getAlternativeHooks(value) {
  const data = normaliseResponse(value);
  const script = getScriptData(value);

  return (
    data?.alternativeHooks ||
    script?.alternativeHooks ||
    []
  );
}

function getVisualBeats(value) {
  const data = normaliseResponse(value);
  const script = getScriptData(value);

  return data?.visualBeats || script?.visualBeats || [];
}

/*
  Important:
  Do NOT call response.json() directly.

  If n8n sends an empty response, response.json() throws:
  "Failed to execute 'json' on 'Response':
   Unexpected end of JSON input"

  We first read the response as text, then JSON.parse only when
  there is actually content.
*/
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
  const [bulkProgress, setBulkProgress] = useState(null); // { totalRows, status }
  const pollAbortRef = useRef(false);
  // Extra guard on top of `disabled={loading}` so a double-click or a
  // duplicate React event (e.g. StrictMode double-invoke) can never fire
  // two submissions before the first setLoading(true) re-render lands.
  const submitInFlightRef = useRef(false);

  useEffect(() => {
    return () => {
      // Stop polling if the component unmounts mid-job.
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

  // Poll the status endpoint until the job completes, fails, or times out.
  // A missing row is treated as transient because n8n may answer the first
  // status request before the Data Table insert is visible.
  const pollBulkJob = async (jobId) => {
    const startedAt = Date.now();
    pollAbortRef.current = false;

    while (!pollAbortRef.current) {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        throw new Error(
          "Timed out waiting for bulk generation. The job may still be running in n8n."
        );
      }

      await sleep(POLL_INTERVAL_MS);

      let statusResponse;
      let parsed;

      try {
        statusResponse = await fetch(
          `${STATUS_URL}?jobId=${encodeURIComponent(jobId)}`,
          {
            method: "GET",
            headers: { Accept: "application/json" },
            cache: "no-store",
          }
        );

        parsed = await readResponse(statusResponse);
      } catch {
        // Network/CORS hiccup: keep polling until the overall timeout.
        continue;
      }

      if (!statusResponse.ok || parsed.empty || !parsed.data) {
        continue;
      }

      const data = normaliseResponse(parsed.data);
      const elapsed = Date.now() - startedAt;

      // "Unknown or expired jobId" immediately after creation is not fatal.
      // Give the Data Table time to become visible to the status webhook.
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

    const response = await fetch(downloadUrl, {
      method: "GET",
      headers: { Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/octet-stream" },
      cache: "no-store",
    });

    if (!response.ok) {
      let message = `Download failed (${response.status}).`;

      try {
        const parsed = await readResponse(response);
        const data = normaliseResponse(parsed.data);
        message = data?.error || data?.message || message;
      } catch {
        // Keep the HTTP error message.
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

      // IMPORTANT: the n8n gateway expects the multipart field to be named
      // exactly "file".
      fd.append("file", file, file.name);

      // Step 1: create/persist the job. The gateway responds with jobId
      // before the expensive row generation finishes.
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
          "n8n returned an empty response when starting the bulk job. Make sure the imported gateway is ACTIVE and its Webhook Response mode is 'Using Respond to Webhook Node'."
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
        throw new Error(
          "n8n did not return a jobId. Re-import the fixed gateway and make sure 'Respond — Bulk Job Created' is connected."
        );
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

      // Step 2: poll the persistent Data Table job record.
      const finalStatus = await pollBulkJob(jobId);

      // Step 3: download the real XLSX binary from n8n.
      // We deliberately do NOT use atob()/base64 in the browser.
      await downloadBulkResult(finalStatus);

      setBulkDone(true);
      setBulkProgress(null);
    } catch (e) {
      setError(e?.message || "Bulk request failed.");
    } finally {
      setLoading(false);
      // Keep the final success message visible, but remove the spinner.
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
            few minutes for larger sheets. Feel free to leave this tab
            open — it'll keep checking automatically.
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

                <SelectField
                  label="Niche"
                  value={form.niche}
                  onChange={(v) => set("niche", v)}
                  items={options.niche}
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

                {form.intent ===
                  "Rewrite Existing Script" && (
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

                <SelectField
                  label="Script Style"
                  value={form.scriptStyle}
                  onChange={(v) =>
                    set("scriptStyle", v)
                  }
                  items={options.scriptStyle}
                />

                <SelectField
                  label="Creator Personality"
                  value={form.creatorPersonality}
                  onChange={(v) =>
                    set("creatorPersonality", v)
                  }
                  items={options.creatorPersonality}
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

                <Field label="Reference Analysis Focus">
                  <select
                    value={form.referenceAnalysisFocus}
                    onChange={(e) =>
                      set(
                        "referenceAnalysisFocus",
                        e.target.value
                      )
                    }
                  >
                    {options.referenceFocus.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Reference Transcript" full>
                  <textarea
                    value={form.referenceTranscript}
                    onChange={(e) =>
                      set(
                        "referenceTranscript",
                        e.target.value
                      )
                    }
                    placeholder="Optional transcript or captions from the reference video..."
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
                {loading
                  ? "Generating..."
                  : "Generate Script"}
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
                      <div className="score-ring" style={{ "--pct": Math.min(100, Math.max(0, analysis?.overallScore ?? 0)) }}>
                        <span>{analysis?.overallScore ?? 0}</span>
                      </div>
                      <span className="muted">out of 100</span>
                    </div>
                  </div>

                  <div className="actions">
                    <button onClick={copyScript}>
                      Copy Script
                    </button>

                    <button onClick={downloadTxt}>
                      Download TXT
                    </button>
                  </div>
                </div>

                <div className="script-box">
                  <span className="pin" aria-hidden="true" />
                  <div className="label">
                    SCRIPT
                  </div>

                  <pre>{fullScript}</pre>
                </div>

                {alternativeHooks.length > 0 && (
                  <div className="sub-card">
                    <div className="label">
                      ALTERNATIVE HOOKS
                    </div>

                    {alternativeHooks.map((x, i) => (
                      <div
                        className="line-item"
                        key={i}
                      >
                        <span className="line-num">{i + 1}</span> {x}
                      </div>
                    ))}
                  </div>
                )}

                {visualBeats.length > 0 && (
                  <div className="sub-card">
                    <div className="label">
                      VISUAL IDEAS
                    </div>

                    {visualBeats.map((x, i) => (
                      <div
                        className="line-item"
                        key={i}
                      >
                        <b>
                          {x?.line || ""}
                        </b>

                        <span>
                          {x?.visual || ""}
                        </span>
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
              Upload a CSV or XLSX where each row is one
              script request. A Google Sheet can be
              exported as XLSX/CSV and uploaded here.
              Larger sheets run in the background — this
              page will keep checking on progress and
              start the download automatically when it's
              ready.
            </p>

            <div className="upload">
              <input
                id="file"
                type="file"
                accept=".csv,.xlsx"
                onChange={(e) =>
                  setFile(
                    e.target.files?.[0] || null
                  )
                }
              />

              <label htmlFor="file">
                <span className="upload-icon" aria-hidden="true">⏏</span>
                {file
                  ? file.name
                  : "Choose CSV or XLSX"}
              </label>
            </div>

            <SelectField
              label="Default Save Script To"
              value={form.saveScriptTo}
              onChange={(v) =>
                set("saveScriptTo", v)
              }
              items={options.saveTo}
            />

            <div className="bulk-note">
              <b>Minimum column:</b> Idea
              <br />
              <b>Optional:</b> Niche, Platform,
              Duration, TargetAudience, Market,
              Language, ScriptStyle, CreatorPersonality,
              Tone, Energy, CurrentTrends, Research,
              ExistingScript, ReferenceVideoUrl,
              ReferenceTranscript, ReferenceAnalysisFocus,
              SaveScriptTo
            </div>

            <button
              className="primary"
              onClick={runBulk}
              disabled={loading}
            >
              {loading && <span className="spinner" />}
              {loading
                ? "Generating all scripts..."
                : "Generate All Scripts"}
            </button>
          </section>
        )}
      </main>
    </div>
  );
}