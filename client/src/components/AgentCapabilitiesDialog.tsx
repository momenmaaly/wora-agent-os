/**
 * WORA extensions — agent capability profile inspector.
 * Shows exactly what an agent can use, why something is blocked, and lets an
 * authorized operator change the deny/grant policy or test an assigned tool.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, CircleAlert, LoaderCircle, Play, RefreshCw, Save, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Dialog } from './ui.js';
import { useI18n } from '../i18n/I18nContext.js';
import { osApi } from '../os/api.js';
import {
  ExtensionApiError, extensionsApi, type AgentPolicy, type CapabilityProfile,
} from '../extensions/api.js';
import { parseToolInput, summarizeProfile } from '../extensions/model.js';

const errorText = (error: unknown, fallback: string): string =>
  error instanceof ExtensionApiError ? error.message : error instanceof Error ? error.message : fallback;

const splitList = (value: string): string[] =>
  value.split(/[,،\n]/u).map((entry) => entry.trim()).filter(Boolean);

export function AgentCapabilitiesDialog({ agentId, agentName, onClose }: { agentId: string; agentName: string; onClose: () => void }) {
  const { t } = useI18n();
  const [profile, setProfile] = useState<CapabilityProfile | null>(null);
  const [policy, setPolicy] = useState<AgentPolicy | null>(null);
  const [role, setRole] = useState<string>('viewer');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [deniedPackages, setDeniedPackages] = useState('');
  const [deniedTools, setDeniedTools] = useState('');
  const [extraPermissions, setExtraPermissions] = useState('');
  const [autoLoad, setAutoLoad] = useState(true);
  const [toolId, setToolId] = useState('');
  const [toolInput, setToolInput] = useState('{"text":"hello"}');
  const [toolResult, setToolResult] = useState<string | null>(null);

  const apply = useCallback((nextProfile: CapabilityProfile, nextPolicy: AgentPolicy) => {
    setProfile(nextProfile);
    setPolicy(nextPolicy);
    setDeniedPackages(nextPolicy.deniedPackages.join(', '));
    setDeniedTools(nextPolicy.deniedTools.join(', '));
    setExtraPermissions(nextPolicy.extraPermissions.join(', '));
    setAutoLoad(nextPolicy.autoLoad);
    const firstTool = nextProfile.plugins.flatMap((plugin) => plugin.tools)[0] ?? '';
    setToolId((current) => current || firstTool);
  }, []);

  const load = useCallback(async () => {
    setBusy('load'); setError(null);
    try {
      const [capabilities, roles] = await Promise.all([
        extensionsApi.capabilities(agentId),
        osApi.roles().catch(() => null),
      ]);
      apply(capabilities.profile, capabilities.policy);
      if (roles) setRole(roles.me.role);
    } catch (err) { setError(errorText(err, t('ext.errorGeneric'))); }
    finally { setBusy(null); }
  }, [agentId, apply, t]);

  useEffect(() => { void load(); }, [load]);

  const summary = useMemo(() => summarizeProfile(profile), [profile]);
  const tools = useMemo(() => profile?.plugins.flatMap((plugin) => plugin.tools.map((tool) => ({ tool, plugin }))) ?? [], [profile]);
  const canEdit = role === 'member' || role === 'admin' || role === 'owner';
  const canGrant = role === 'admin' || role === 'owner';

  async function savePolicy() {
    setBusy('policy'); setError(null);
    try {
      const result = await extensionsApi.setPolicy(agentId, {
        deniedPackages: splitList(deniedPackages),
        deniedTools: splitList(deniedTools),
        extraPermissions: canGrant ? splitList(extraPermissions) : policy?.extraPermissions ?? [],
        autoLoad,
      });
      apply(result.profile, result.policy);
      setNotice(t('ext.policySaved'));
    } catch (err) { setError(errorText(err, t('ext.errorGeneric'))); }
    finally { setBusy(null); }
  }

  async function resolveNow() {
    setBusy('resolve'); setError(null);
    try {
      const next = await extensionsApi.resolve(agentId);
      setProfile(next);
      setNotice(t('ext.resolvedSaved'));
    } catch (err) { setError(errorText(err, t('ext.errorGeneric'))); }
    finally { setBusy(null); }
  }

  async function runTool() {
    if (!toolId) return;
    const parsed = parseToolInput(toolInput);
    if (!parsed.ok) { setError(t(parsed.error === 'invalid-json' ? 'ext.invalidJson' : 'ext.inputMustBeObject')); return; }
    setBusy('tool'); setError(null); setToolResult(null);
    try {
      const result = await extensionsApi.executeTool(agentId, toolId, parsed.value);
      setToolResult(JSON.stringify({ ok: result.ok, error: result.error ?? null, durationMs: result.durationMs, output: result.output ?? null }, null, 2));
    } catch (err) {
      setToolResult(JSON.stringify({ ok: false, error: errorText(err, t('ext.toolDenied')) }, null, 2));
    } finally { setBusy(null); }
  }

  return <Dialog title={t('ext.agentCapabilities')} description={`${agentName} · ${agentId}`} icon={ShieldCheck} onClose={onClose}
    footer={<div className="os-dialog-actions">
      <button type="button" className="button ghost" onClick={onClose}>{t('ext.close')}</button>
      <button type="button" className="button" disabled={busy !== null} onClick={() => void resolveNow()}>
        {busy === 'resolve' ? <LoaderCircle size={15} className="os-spin" aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}{t('ext.resolveCapabilities')}
      </button>
      {canEdit && <button type="button" className="button primary" disabled={busy !== null} onClick={() => void savePolicy()}>
        {busy === 'policy' ? <LoaderCircle size={15} className="os-spin" aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}{t('ext.savePolicy')}
      </button>}
    </div>}>
    <div className="ext-detail">
      {error && <div className="os-alert" role="alert"><CircleAlert size={15} aria-hidden="true" />{error}</div>}
      {notice && <div className="ext-success" role="status"><ShieldCheck size={15} aria-hidden="true" />{notice}</div>}
      {!profile && busy === 'load' && <p className="os-loading"><LoaderCircle size={16} className="os-spin" aria-hidden="true" />{t('ext.loading')}</p>}
      {profile && <>
        <div className="ext-stats">
          <div><span className="subtle">{t('ext.skills')}</span><strong>{summary.skills}</strong></div>
          <div><span className="subtle">{t('ext.plugins')}</span><strong>{summary.plugins}</strong></div>
          <div><span className="subtle">{t('ext.tools')}</span><strong>{summary.tools}</strong></div>
          <div><span className="subtle">{t('ext.blockedCapabilities')}</span><strong className={summary.blocked ? 'os-bad' : ''}>{summary.blocked}</strong></div>
        </div>
        <p className="subtle">{t('ext.digest')}: <code>{profile.digest}</code> · {t('ext.resolvedAt')}: {new Date(profile.resolvedAt).toLocaleString()}</p>

        <section>
          <h3>{t('ext.assignedSkills')}</h3>
          {profile.skills.length === 0 && <p className="subtle">{t('ext.noAssignedSkills')}</p>}
          {profile.skills.map((skill) => <div key={skill.installationId} className="ext-installation">
            <div className="ext-installation-head">
              <strong>{skill.name}</strong><span className="subtle">{skill.key}@{skill.version}</span>
              <span className="ext-status">{skill.scope}{skill.scopeId ? ` · ${skill.scopeId}` : ''}</span>
              {skill.autoLoad && <span className="os-chip small ext-chip-ok">{t('ext.autoLoaded')}</span>}
            </div>
            <div className="ext-chips">{skill.permissions.map((permission) => <span key={permission} className="os-chip small">{permission}</span>)}</div>
            <p className="subtle">{t('ext.instructionsDigest')}: <code>{skill.instructionDigest}</code></p>
          </div>)}
        </section>

        <section>
          <h3>{t('ext.assignedPlugins')}</h3>
          {profile.plugins.length === 0 && <p className="subtle">{t('ext.noAssignedPlugins')}</p>}
          {profile.plugins.map((plugin) => <div key={plugin.installationId} className="ext-installation">
            <div className="ext-installation-head">
              <strong>{plugin.name}</strong><span className="subtle">{plugin.key}@{plugin.version}</span>
              <span className="ext-status">{plugin.executionMode}</span>
              <span className="ext-status">{plugin.scope}{plugin.scopeId ? ` · ${plugin.scopeId}` : ''}</span>
            </div>
            <div className="ext-chips">{plugin.tools.map((tool) => <span key={tool} className="os-chip small">{tool}</span>)}</div>
          </div>)}
        </section>

        <section>
          <h3>{t('ext.tools')}</h3>
          <div className="ext-chips">{profile.tools.length ? profile.tools.map((tool) => <span key={tool} className="os-chip small">{tool}</span>) : <span className="subtle">{t('ext.none')}</span>}</div>
        </section>

        <section>
          <h3>{t('ext.permissions')}</h3>
          <div className="ext-chips">{profile.permissions.length ? profile.permissions.map((permission) => <span key={permission} className="os-chip small">{permission}</span>) : <span className="subtle">{t('ext.none')}</span>}</div>
        </section>

        {profile.blocked.length > 0 && <section>
          <h3><ShieldAlert size={16} aria-hidden="true" /> {t('ext.blockedCapabilities')}</h3>
          <ul className="ext-blocked">{profile.blocked.map((entry) => <li key={`${entry.installationId}-${entry.key}`}>
            <strong>{entry.key}</strong> <span className="subtle">({entry.kind})</span> — {entry.reason}
          </li>)}</ul>
        </section>}

        <section className="ext-policy">
          <h3>{t('ext.policy')}</h3>
          <p className="subtle">{t('ext.policyHint')}</p>
          <label className="ext-check"><input type="checkbox" checked={autoLoad} disabled={!canEdit} onChange={(event) => setAutoLoad(event.target.checked)} /><span>{t('ext.autoLoadAgent')}</span></label>
          <label className="os-field">{t('ext.deniedPackages')}<input value={deniedPackages} disabled={!canEdit} onChange={(event) => setDeniedPackages(event.target.value)} dir="ltr" placeholder="wora.echo-mcp, wora.qa-testing" /></label>
          <label className="os-field">{t('ext.deniedTools')}<input value={deniedTools} disabled={!canEdit} onChange={(event) => setDeniedTools(event.target.value)} dir="ltr" placeholder="wora.echo-mcp.echo" /></label>
          {canGrant && <label className="os-field">{t('ext.extraPermissions')}<input value={extraPermissions} disabled={!canGrant} onChange={(event) => setExtraPermissions(event.target.value)} dir="ltr" placeholder="memory:read, repository.read" /></label>}
        </section>

        <section>
          <h3>{t('ext.testTool')}</h3>
          {tools.length === 0 && <p className="subtle">{t('ext.noPluginTools')}</p>}
          {tools.length > 0 && <>
            <label className="os-field">{t('ext.toolId')}
              <select value={toolId} onChange={(event) => setToolId(event.target.value)}>
                {tools.map(({ tool, plugin }) => <option key={tool} value={tool}>{tool} — {plugin.key}</option>)}
              </select>
            </label>
            <label className="os-field">{t('ext.toolInput')}
              <textarea value={toolInput} onChange={(event) => setToolInput(event.target.value)} dir="ltr" rows={4} spellCheck={false} />
            </label>
            <button type="button" className="button" disabled={busy !== null || !toolId} onClick={() => void runTool()}>
              {busy === 'tool' ? <LoaderCircle size={15} className="os-spin" aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}{t('ext.runTool')}
            </button>
            {toolResult && <pre className="ext-output" dir="ltr">{toolResult}</pre>}
          </>}
        </section>
      </>}
    </div>
  </Dialog>;
}
