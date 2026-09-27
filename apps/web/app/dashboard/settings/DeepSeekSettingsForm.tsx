"use client";

import { useActionState } from "react";
import {
  removeDeepSeekKey,
  saveDeepSeekSettings,
  testDeepSeekSettings,
  type SettingsState,
} from "./actions";

const field = "rounded-md border border-border px-3 py-2 text-sm";
const labelCls = "flex flex-col gap-1 text-sm font-medium text-foreground";
const hintCls = "text-xs font-normal text-muted-foreground";

function TestResult({ state }: { state: NonNullable<SettingsState> }) {
  const t = state.test;
  return (
    <div
      className={`rounded-md px-3 py-2 text-sm ${
        state.ok ? "bg-green-500/10 text-green-700" : "bg-red-500/10 text-red-600"
      }`}
    >
      <p>{state.ok ? `✓ ${state.message}` : state.error}</p>
      {t?.balance && <p className="mt-1 text-xs">Balance: {t.balance}</p>}
      {t && t.models.length > 0 && <p className="mt-1 text-xs">Models on this key: {t.models.join(", ")}</p>}
    </div>
  );
}

export function DeepSeekSettingsForm({
  hint,
  model,
  baseUrl,
  serverModel,
  defaultBaseUrl,
  modelOptions,
  hasServerKey,
}: {
  hint: string | null;
  model: string;
  baseUrl: string;
  serverModel: string;
  defaultBaseUrl: string;
  modelOptions: { id: string; label: string }[];
  hasServerKey: boolean;
}) {
  const [saveState, saveAction, saving] = useActionState<SettingsState, FormData>(
    saveDeepSeekSettings,
    undefined,
  );
  const [testState, testAction, testing] = useActionState<SettingsState, FormData>(
    testDeepSeekSettings,
    undefined,
  );
  // After a test/save, also offer the models this key actually has (DeepSeek renames them).
  const keyModels = saveState?.test?.models ?? testState?.test?.models ?? [];
  const options = [
    ...modelOptions,
    ...keyModels.filter((id) => !modelOptions.some((o) => o.id === id)).map((id) => ({ id, label: id })),
  ];
  const knownModel = options.some((o) => o.id === model);

  return (
    <>
      <form action={saveAction} className="flex flex-col gap-4">
        <label className={labelCls}>
          API key
          <input
            name="api_key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            className={field}
            placeholder={hint ? `Saved key ••••${hint} — leave blank to keep it` : "sk-…"}
          />
          <span className={hintCls}>
            Create one at{" "}
            <a
              href="https://platform.deepseek.com/api_keys"
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              platform.deepseek.com/api_keys
            </a>
            . Usage is billed to your DeepSeek account.
            {!hint && hasServerKey && " Without one, the server's shared key is used."}
          </span>
        </label>

        <label className={labelCls}>
          Model
          <select name="model" defaultValue={knownModel ? model : ""} className={`${field} bg-card`}>
            <option value="">Server default ({serverModel})</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <details
          className="rounded-md border border-border px-4 py-3"
          open={Boolean(baseUrl || (model && !knownModel))}
        >
          <summary className="cursor-pointer text-sm font-medium">Advanced</summary>
          <div className="mt-3 flex flex-col gap-4">
            <label className={labelCls}>
              Custom model ID
              <input
                name="custom_model"
                defaultValue={knownModel ? "" : model}
                className={field}
                placeholder="Overrides the model above, e.g. a newer DeepSeek model"
              />
            </label>
            <label className={labelCls}>
              API base URL
              <input
                name="base_url"
                defaultValue={baseUrl}
                inputMode="url"
                className={field}
                placeholder={defaultBaseUrl}
              />
              <span className={hintCls}>
                Only used with your own key. Any OpenAI-compatible https endpoint.
              </span>
            </label>
          </div>
        </details>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saving || testing} className="btn-primary">
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="submit"
            formAction={testAction}
            disabled={saving || testing}
            className="btn-secondary"
          >
            {testing ? "Testing…" : "Test connection"}
          </button>
          {saveState?.ok && <span className="text-sm text-green-700">{saveState.message}</span>}
          {saveState?.error && <span className="text-sm text-red-600">{saveState.error}</span>}
        </div>

        {testState && <TestResult state={testState} />}
      </form>

      {hint && (
        <form
          action={removeDeepSeekKey}
          onSubmit={(e) => {
            if (!confirm("Remove your DeepSeek API key?")) e.preventDefault();
          }}
          className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"
        >
          <p className="text-sm text-muted-foreground">
            {hasServerKey
              ? "Remove your key to fall back to the server's shared key."
              : "Removing your key turns AI generation off."}
          </p>
          <button type="submit" className="btn-secondary text-red-600">
            Remove my key
          </button>
        </form>
      )}
    </>
  );
}
