import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import * as api from '@/api';
import type {
  GitHubAppInfo,
  GitHubInstallation,
} from '@/types';

// ── Create app form ──

function CreateAppForm({ onCreated, onCancel }: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('openseed-');
  const [owner, setOwner] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const { redirectPath } = await api.createGitHubApp(trimmed, owner.trim() || undefined);
      window.open(redirectPath, '_blank');
      pollRef.current = setInterval(async () => {
        try {
          const apps = await api.fetchGitHubApps();
          if (apps.some(a => a.name === trimmed || a.slug?.startsWith(trimmed.toLowerCase()))) {
            if (pollRef.current) clearInterval(pollRef.current);
            onCreated();
          }
        } catch { /* keep polling */ }
      }, 3000);
      timeoutRef.current = setTimeout(() => {
        if (pollRef.current) clearInterval(pollRef.current);
      }, 10 * 60 * 1000);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border-default bg-surface p-5 flex flex-col gap-3">
      <div className="text-[11px] text-text-secondary tracking-[0.03em] uppercase">New GitHub App</div>
      {error && (
        <div className="text-[12.5px] text-error bg-error/5 border border-error/10 rounded-md px-3 py-2">{error}</div>
      )}
      <div className="flex gap-2.5">
        <div className="flex-1 flex flex-col gap-1">
          <label className="text-[11px] text-text-faint">App name</label>
          <input
            autoFocus
            placeholder="openseed-alpha"
            value={name}
            onChange={e => setName(e.target.value)}
            className="text-[13.5px] px-3 py-2 rounded-md border border-border-light bg-bg focus:outline-none focus:border-text-primary/30 font-mono"
            onKeyDown={e => e.key === 'Enter' && submit()}
          />
        </div>
        <div className="flex-1 flex flex-col gap-1">
          <label className="text-[11px] text-text-faint">Organization (blank for personal)</label>
          <input
            placeholder="my-org"
            value={owner}
            onChange={e => setOwner(e.target.value)}
            className="text-[13.5px] px-3 py-2 rounded-md border border-border-light bg-bg focus:outline-none focus:border-text-primary/30 font-mono"
            onKeyDown={e => e.key === 'Enter' && submit()}
          />
        </div>
      </div>
      <p className="text-[11.5px] text-text-faint leading-relaxed">
        This opens GitHub in a new tab. Review the permissions and click "Create GitHub App". You'll be redirected back when done.
      </p>
      <div className="flex justify-end gap-2 mt-1">
        <button onClick={onCancel} disabled={busy} className="text-[13px] text-text-muted hover:text-text-primary px-3 py-1.5 transition-colors">
          Cancel
        </button>
        <button onClick={submit} disabled={busy || !name.trim()} className="text-[13px] font-medium bg-text-primary text-white px-4 py-1.5 rounded-full disabled:opacity-30 transition-opacity">
          {busy ? 'Waiting for GitHub…' : 'Create'}
        </button>
      </div>
    </div>
  );
}

// ── Installation list within an app card ──

function InstallationRow({ inst, slug, onActivated }: {
  inst: GitHubInstallation;
  slug: string;
  onActivated: () => void;
}) {
  const [activating, setActivating] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activate = async () => {
    setActivating(true);
    setError(null);
    try {
      await api.activateGitHubApp(slug, inst.id);
      setDone(true);
      onActivated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActivating(false);
    }
  };

  const repoLabel = inst.repository_selection === 'all' ? 'all repos' : 'selected repos';

  return (
    <div className="flex items-center justify-between px-5 py-3 border-t border-border-light/50 hover:bg-bg/40 transition-colors">
      <div className="flex items-center gap-2.5">
        <span className="text-[13.5px] text-text-primary">{inst.account.login}</span>
        <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#f0ede7] text-text-muted">{repoLabel}</span>
      </div>
      <div className="flex items-center gap-2">
        {error && <span className="text-[11px] text-error">{error}</span>}
        {done ? (
          <span className="text-[12px] text-alive/70">Activated</span>
        ) : (
          <button
            onClick={activate}
            disabled={activating}
            className="text-[12px] font-medium bg-text-primary text-white px-3 py-1 rounded-full disabled:opacity-30 transition-opacity"
          >
            {activating ? '…' : 'Activate'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── App card ──

function AppCard({ app, onDeleted, onActivated }: {
  app: GitHubAppInfo;
  onDeleted: () => void;
  onActivated: () => void;
}) {
  const [installations, setInstallations] = useState<GitHubInstallation[] | null>(null);
  const [loadingInstalls, setLoadingInstalls] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const checkInstallations = async () => {
    setLoadingInstalls(true);
    setError(null);
    try {
      const installs = await api.fetchGitHubAppInstallations(app.slug);
      setInstallations(installs);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingInstalls(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete GitHub App "${app.slug}"? This removes it from GitHub and locally.`)) return;
    setDeleting(true);
    try {
      await api.deleteGitHubApp(app.slug);
      onDeleted();
    } catch (err: any) {
      setError(err.message);
      setDeleting(false);
    }
  };

  const ownerLabel = app.owner?.login || 'personal';
  const installUrl = `https://github.com/apps/${app.slug}/installations/new`;

  return (
    <div className="rounded-lg border border-border-light overflow-hidden">
      <div className="group flex items-center justify-between px-5 py-3.5 bg-surface border-b border-border-light/60">
        <div className="flex items-baseline gap-2.5 min-w-0">
          <span className="text-[14.5px] font-semibold text-text-primary tracking-[-0.02em]">{app.slug || app.name}</span>
          <span className="text-[12px] font-mono text-text-muted">{ownerLabel}</span>
          <span className="text-[10.5px] uppercase tracking-[0.05em] text-text-faint font-medium">id: {app.id}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <a
            href={installUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] text-text-muted hover:text-text-primary transition-colors"
          >
            Install on GitHub
          </a>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="opacity-0 group-hover:opacity-100 text-[13px] text-text-faint hover:text-error transition-all leading-none"
            title="Delete app"
          >
            {deleting ? '…' : '×'}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-5 py-2.5 text-[12.5px] text-error bg-error/5 border-t border-error/10">{error}</div>
      )}

      {installations !== null ? (
        installations.length > 0 ? (
          installations.map(inst => (
            <InstallationRow key={inst.id} inst={inst} slug={app.slug} onActivated={onActivated} />
          ))
        ) : (
          <div className="px-5 py-3 text-[12.5px] text-text-faint italic">
            No installations found.{' '}
            <a href={installUrl} target="_blank" rel="noopener noreferrer" className="text-text-muted hover:text-text-primary underline">
              Install it on GitHub first
            </a>.
          </div>
        )
      ) : (
        <button
          onClick={checkInstallations}
          disabled={loadingInstalls}
          className="w-full px-5 py-2.5 text-[12.5px] text-text-faint hover:text-text-secondary hover:bg-bg/40 transition-colors border-t border-border-light/50 text-left"
        >
          {loadingInstalls ? 'Checking…' : 'Check installations'}
        </button>
      )}
    </div>
  );
}

// ── Main section ──

export function GitHubAppsSection() {
  const [apps, setApps] = useState<GitHubAppInfo[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const result = await api.fetchGitHubApps();
      setApps(result);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <h3 className="text-[15px] font-semibold text-text-primary mb-1">GitHub Apps</h3>
      <p className="text-[12px] text-text-muted mb-6 leading-relaxed">
        Create GitHub Apps for your creatures. Each app gets its own identity and fine-grained permissions.
      </p>

      {error && (
        <div className="text-[12.5px] text-error bg-error/5 border border-error/10 rounded-md px-3.5 py-2.5 mb-4">{error}</div>
      )}

      {loading ? (
        <p className="text-[12px] text-text-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {apps.map(app => (
            <AppCard key={app.id} app={app} onDeleted={load} onActivated={load} />
          ))}

          {creating ? (
            <CreateAppForm
              onCreated={() => { setCreating(false); load(); }}
              onCancel={() => setCreating(false)}
            />
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="self-start text-[13px] text-text-muted hover:text-text-primary transition-colors mt-1"
            >
              + Create GitHub App
            </button>
          )}

          {!apps.length && !creating && (
            <div className="py-10 text-center">
              <p className="text-[13.5px] text-text-muted">No GitHub Apps created yet.</p>
              <p className="text-[12.5px] text-text-faint mt-1">Create one to give your creatures their own GitHub identity.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
