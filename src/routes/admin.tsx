import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import { useState, useEffect } from "react";
import { Shield, Users, Key, BarChart3, Eye, EyeOff, Trash2, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const ADMIN_PASSWORD_KEY = "dyad-admin-auth";
const ADMIN_PASSWORD = "admin1234";

const PROVIDER_KEYS = [
  { id: "google", label: "Google Gemini", placeholder: "AIza..." },
  { id: "openai", label: "OpenAI", placeholder: "sk-..." },
  { id: "anthropic", label: "Anthropic", placeholder: "sk-ant-..." },
  { id: "openrouter", label: "OpenRouter", placeholder: "sk-or-..." },
];

function getStoredSettings(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem("dyad-browser-ipc-settings") ?? "{}");
  } catch {
    return {};
  }
}

function getAdminStats() {
  const settings = getStoredSettings();
  const providerSettings = (settings.providerSettings as Record<string, unknown>) ?? {};
  const configuredProviders = PROVIDER_KEYS.filter(
    (p) => !!(providerSettings as Record<string, Record<string, unknown>>)[p.id]?.apiKey,
  ).length;

  const allKeys = Object.keys(localStorage);
  const appKeys = allKeys.filter((k) => k.startsWith("dyad-"));

  return {
    configuredProviders,
    totalLocalStorageKeys: appKeys.length,
    settingsSize: JSON.stringify(settings).length,
  };
}

function AdminLogin({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === ADMIN_PASSWORD) {
      sessionStorage.setItem(ADMIN_PASSWORD_KEY, "true");
      onLogin();
    } else {
      setError("Incorrect password");
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 w-full max-w-sm shadow-2xl">
        <div className="flex flex-col items-center mb-6">
          <div className="bg-indigo-600 rounded-full p-3 mb-3">
            <Shield className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-white">Admin Panel</h1>
          <p className="text-gray-400 text-sm mt-1">Enter your admin password to continue</p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
            className="bg-gray-800 border-gray-600 text-white placeholder:text-gray-500"
            autoFocus
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white">
            Sign In
          </Button>
        </form>
        <p className="text-gray-600 text-xs text-center mt-4">Default password: admin1234</p>
      </div>
    </div>
  );
}

type Tab = "dashboard" | "keys" | "users";

function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const stats = getAdminStats();
  const settings = getStoredSettings();
  const providerSettings = (settings.providerSettings as Record<string, Record<string, { value?: string }>>) ?? {};

  const [keyValues, setKeyValues] = useState<Record<string, string>>(() => {
    const result: Record<string, string> = {};
    for (const p of PROVIDER_KEYS) {
      result[p.id] = providerSettings[p.id]?.apiKey?.value ?? "";
    }
    return result;
  });
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [saveStatus, setSaveStatus] = useState<Record<string, "idle" | "saved">>(
    Object.fromEntries(PROVIDER_KEYS.map((p) => [p.id, "idle"])),
  );

  const handleSaveKey = (providerId: string) => {
    const stored = getStoredSettings();
    const ps = (stored.providerSettings as Record<string, unknown>) ?? {};
    const updated = {
      ...stored,
      providerSettings: {
        ...ps,
        [providerId]: {
          ...((ps[providerId] as Record<string, unknown>) ?? {}),
          apiKey: keyValues[providerId] ? { value: keyValues[providerId], encryptionType: "plaintext" } : undefined,
        },
      },
    };
    localStorage.setItem("dyad-browser-ipc-settings", JSON.stringify(updated));
    setSaveStatus((prev) => ({ ...prev, [providerId]: "saved" }));
    setTimeout(() => setSaveStatus((prev) => ({ ...prev, [providerId]: "idle" })), 2000);
  };

  const handleClearKey = (providerId: string) => {
    setKeyValues((prev) => ({ ...prev, [providerId]: "" }));
    const stored = getStoredSettings();
    const ps = (stored.providerSettings as Record<string, unknown>) ?? {};
    const updated = {
      ...stored,
      providerSettings: {
        ...ps,
        [providerId]: { ...((ps[providerId] as Record<string, unknown>) ?? {}), apiKey: undefined },
      },
    };
    localStorage.setItem("dyad-browser-ipc-settings", JSON.stringify(updated));
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "dashboard", label: "Dashboard", icon: <BarChart3 className="w-4 h-4" /> },
    { id: "keys", label: "API Keys", icon: <Key className="w-4 h-4" /> },
    { id: "users", label: "Users", icon: <Users className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 rounded-lg p-1.5">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-lg font-bold">Dyad Admin Panel</h1>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-gray-400 hover:text-white"
          onClick={() => { sessionStorage.removeItem(ADMIN_PASSWORD_KEY); window.location.reload(); }}
        >
          Sign Out
        </Button>
      </header>

      <div className="flex">
        <nav className="w-56 bg-gray-900 border-r border-gray-800 min-h-[calc(100vh-57px)] p-4 flex flex-col gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors w-full text-left ${
                activeTab === tab.id
                  ? "bg-indigo-600 text-white"
                  : "text-gray-400 hover:text-white hover:bg-gray-800"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>

        <main className="flex-1 p-8">
          {activeTab === "dashboard" && (
            <div>
              <h2 className="text-xl font-bold mb-6">Dashboard Overview</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                <StatCard
                  label="Configured AI Providers"
                  value={String(stats.configuredProviders)}
                  sub="out of 4 supported"
                  color="indigo"
                />
                <StatCard
                  label="Local Storage Keys"
                  value={String(stats.totalLocalStorageKeys)}
                  sub="Dyad data entries"
                  color="emerald"
                />
                <StatCard
                  label="Settings Size"
                  value={`${(stats.settingsSize / 1024).toFixed(1)} KB`}
                  sub="JSON stored in browser"
                  color="amber"
                />
              </div>

              <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold">Provider Status</h3>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-gray-400 hover:text-white"
                    onClick={() => window.location.reload()}
                  >
                    <RefreshCw className="w-4 h-4 mr-1" /> Refresh
                  </Button>
                </div>
                <div className="flex flex-col gap-2">
                  {PROVIDER_KEYS.map((p) => {
                    const hasKey = !!providerSettings[p.id]?.apiKey?.value;
                    return (
                      <div
                        key={p.id}
                        className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0"
                      >
                        <span className="text-sm text-gray-300">{p.label}</span>
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            hasKey
                              ? "bg-emerald-900/50 text-emerald-400"
                              : "bg-gray-800 text-gray-500"
                          }`}
                        >
                          {hasKey ? "Configured" : "Not set"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {activeTab === "keys" && (
            <div>
              <h2 className="text-xl font-bold mb-2">API Key Management</h2>
              <p className="text-gray-400 text-sm mb-6">
                Keys are stored in browser localStorage. They persist until you clear browser data.
              </p>
              <div className="flex flex-col gap-4">
                {PROVIDER_KEYS.map((p) => (
                  <div
                    key={p.id}
                    className="bg-gray-900 border border-gray-700 rounded-xl p-5"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-sm">{p.label}</h3>
                      {keyValues[p.id] && (
                        <button
                          onClick={() => handleClearKey(p.id)}
                          className="text-red-400 hover:text-red-300 flex items-center gap-1 text-xs"
                        >
                          <Trash2 className="w-3 h-3" /> Clear
                        </button>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          type={showKeys[p.id] ? "text" : "password"}
                          placeholder={p.placeholder}
                          value={keyValues[p.id]}
                          onChange={(e) => setKeyValues((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          className="bg-gray-800 border-gray-600 text-white placeholder:text-gray-600 pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowKeys((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                        >
                          {showKeys[p.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleSaveKey(p.id)}
                        className={
                          saveStatus[p.id] === "saved"
                            ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                            : "bg-indigo-600 hover:bg-indigo-700 text-white"
                        }
                      >
                        {saveStatus[p.id] === "saved" ? "Saved ✓" : "Save"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "users" && (
            <div>
              <h2 className="text-xl font-bold mb-2">User Management</h2>
              <p className="text-gray-400 text-sm mb-6">
                This is a browser-based instance — user management connects to your local session.
              </p>
              <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold">Current Session</h3>
                  <span className="text-xs bg-emerald-900/50 text-emerald-400 px-2 py-0.5 rounded-full">
                    Active
                  </span>
                </div>
                <div className="flex flex-col gap-3 text-sm">
                  <Row label="Session Type" value="Browser (anonymous)" />
                  <Row label="Storage" value="localStorage" />
                  <Row label="AI Access" value={stats.configuredProviders > 0 ? `${stats.configuredProviders} provider(s) configured` : "No providers configured"} />
                  <Row label="Admin Access" value="Granted (this session)" />
                </div>
                <div className="mt-5 pt-4 border-t border-gray-800">
                  <p className="text-gray-400 text-xs mb-3">
                    To add multi-user support with persistent accounts, deploy a backend database (Postgres via Replit) and integrate an auth provider.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-gray-600 text-gray-300 hover:bg-gray-800"
                    onClick={() => window.open("https://docs.replit.com/cloud-services/deployments/about-deployments", "_blank")}
                  >
                    <Plus className="w-4 h-4 mr-1" /> Learn about deployment
                  </Button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  color: "indigo" | "emerald" | "amber";
}) {
  const colorMap = {
    indigo: "bg-indigo-900/30 border-indigo-700/50 text-indigo-400",
    emerald: "bg-emerald-900/30 border-emerald-700/50 text-emerald-400",
    amber: "bg-amber-900/30 border-amber-700/50 text-amber-400",
  };
  return (
    <div className={`rounded-xl border p-5 ${colorMap[color]}`}>
      <div className="text-3xl font-bold text-white">{value}</div>
      <div className="text-sm font-medium mt-1">{label}</div>
      <div className="text-xs text-gray-400 mt-0.5">{sub}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-800 last:border-0">
      <span className="text-gray-400">{label}</span>
      <span className="text-gray-200 font-medium">{value}</span>
    </div>
  );
}

function AdminPage() {
  const [isAuthed, setIsAuthed] = useState(
    sessionStorage.getItem(ADMIN_PASSWORD_KEY) === "true",
  );

  useEffect(() => {
    document.title = "Dyad Admin";
  }, []);

  if (!isAuthed) {
    return <AdminLogin onLogin={() => setIsAuthed(true)} />;
  }

  return <AdminDashboard />;
}

export const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin",
  component: AdminPage,
});
