import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Boxes, CheckCircle2, CircleAlert, Download, LoaderCircle, Package, Plug2, Plus, RefreshCw,
  Search, ShieldAlert, ShieldCheck, Store, Trash2, Wrench, X,
} from 'lucide-react';
import { Dialog, EmptyState, Notice, PageHeader } from './ui.js';
import { useI18n } from '../i18n/I18nContext.js';
import { osApi, type Agent } from '../os/api.js';
import {
  ExtensionApiError, extensionsApi,
  type CapabilityProfile, type ExtensionPackage, type ExtensionSummary, type InstallPlanView,
  type Installation, type Marketplace, type McpServer, type PluginToolRecord, type ScopeName,
  type SecretMetadata, type TrustLevel, type ValidationResponse,
} from '../extensions/api.js';
import {
  categoriesOf, filterPackages, isAdmin, isMember, parseToolInput, permissionTone, planBlockers,
  pluginTemplate, scopeKey, skillTemplate, summarizeProfile,
} from '../extensions/model.js';

type Tab = 'skills' | 'plugins' | 'marketplaces' | 'tools';
const SCOPES: ScopeName[] = ['instance', 'organization', 'project', 'agent', 'user'];
const TRUSTS: TrustLevel[] = ['official', 'verified', 'community', 'untrusted'];

const errorText = (error: unknown, fallback: string): string =>
  error instanceof ExtensionApiError ? error.message : error instanceof Error ? error.message : fallback;

function TrustBadge({ trust }: { trust: TrustLevel }) {
  return <span className={`ext-trust ext-trust-${trust}`}>{trust}</span>;
}

function PermissionChips({ permissions }: { permissions: Array<{ name: string; sensitivity: string }> }) {
  const { t } = useI18n();
  if (!permissions.length) return <span className="subtle">{t('ext.noPermissions')}</span>;
  return <span className="ext-chips">
    {permissions.map((permission) => (
      <span key={permission.name} className={`ext-perm ext-perm-${permissionTone(permission.sensitivity as never)}`} title={t(`ext.permission${permission.sensitivity.charAt(0).toUpperCase()}${permission.sensitivity.slice(1)}`)}>
        {permission.name}
      </span>
    ))}
  </span>;
}

function ScopeTargetField({ scope, value, onChange, agents, organizations, disabled }: {
  scope: ScopeName; value: string; onChange: (value: string) => void;
  agents: Agent[]; organizations: Array<{ id: string; name: string }>; disabled: boolean;
}) {
  const { t } = useI18n();
  if (scope === 'instance') return <p className="subtle">{t('ext.scopeTargetHint')}</p>;
  if (scope === 'agent') {
    return <label className="os-field">{t('ext.scopeTarget')}
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required>
        <option value="">{t('ext.selectTarget')}</option>
        {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} — {agent.specialization}</option>)}
      </select>
    </label>;
  }
  if (scope === 'organization') {
    return <label className="os-field">{t('ext.scopeTarget')}
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required>
        <option value="">{t('ext.selectTarget')}</option>
        {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
      </select>
      {!organizations.length && <span className="subtle">{t('ext.noTargets')}</span>}
    </label>;
  }
  return <label className="os-field">{t('ext.scopeTarget')}
    <input value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} maxLength={120} placeholder={scope === 'user' ? 'user-id' : 'project-id'} />
    <span className="subtle">{t('ext.scopeTargetHint')}</span>
  </label>;
}

function InstallDialog({ pkg, agents, organizations, onClose, onInstalled }: {
  pkg: ExtensionPackage; agents: Agent[]; organizations: Array<{ id: string; name: string }>;
  onClose: () => void; onInstalled: () => void;
}) {
  const { t } = useI18n();
  const initialScope = (pkg.scope.find((scope) => scope === 'agent') ?? pkg.scope[0] ?? 'instance') as ScopeName;
  const [scope, setScope] = useState<ScopeName>(initialScope);
  const [scopeId, setScopeId] = useState('');
  const [version, setVersion] = useState(pkg.latestVersion);
  const [autoLoad, setAutoLoad] = useState(pkg.autoLoad);
  const [approve, setApprove] = useState(false);
  const [plan, setPlan] = useState<InstallPlanView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsTarget = scope !== 'instance';
  useEffect(() => {
    let cancelled = false;
    if (needsTarget && !scopeId) { setPlan(null); return; }
    extensionsApi.plan(pkg.id, { scope, scopeId: scopeId || undefined, version })
      .then((next) => { if (!cancelled) { setPlan(next); setError(null); } })
      .catch((err: unknown) => { if (!cancelled) { setPlan(null); setError(errorText(err, t('ext.errorGeneric'))); } });
    return () => { cancelled = true; };
  }, [pkg.id, scope, scopeId, version, needsTarget, t]);

  const waitingForTarget = needsTarget && !scopeId;
  const blocked = planBlockers(plan);
  const approvalRequired = Boolean(plan?.requiresApproval);
  const canSubmit = Boolean(plan?.canInstall) && (!approvalRequired || approve) && (!needsTarget || Boolean(scopeId)) && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await extensionsApi.install(pkg.id, { scope, scopeId: scopeId || undefined, version, autoLoad, approvePermissions: approve });
      onInstalled();
      onClose();
    } catch (err) {
      setError(errorText(err, t('ext.errorGeneric')));
    } finally {
      setBusy(false);
    }
  }

  return <Dialog title={t('ext.installTitle')} description={pkg.name} icon={Download} onClose={onClose}
    footer={<div className="os-dialog-actions">
      <button type="button" className="button ghost" onClick={onClose}>{t('ext.cancel')}</button>
      <button type="button" className="button primary" disabled={!canSubmit} onClick={() => void submit()}>
        {busy ? <LoaderCircle size={15} className="os-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />} {t('ext.install')}
      </button>
    </div>}>
    <div className="ext-form">
      {error && <div className="os-alert" role="alert"><CircleAlert size={15} aria-hidden="true" />{error}</div>}
      <div className="ext-form-row">
        <label className="os-field">{t('ext.scope')}
          <select value={scope} onChange={(event) => { setScope(event.target.value as ScopeName); setScopeId(''); }}>
            {SCOPES.filter((entry) => pkg.scope.includes(entry)).map((entry) => <option key={entry} value={entry}>{t(scopeKey(entry))}</option>)}
          </select>
        </label>
        <label className="os-field">{t('ext.version')}
          <select value={version} onChange={(event) => setVersion(event.target.value)}>
            {pkg.versions.map((entry) => <option key={entry.version} value={entry.version}>{entry.version}</option>)}
          </select>
        </label>
      </div>
      <ScopeTargetField scope={scope} value={scopeId} onChange={setScopeId} agents={agents} organizations={organizations} disabled={busy} />
      <label className="ext-check">
        <input type="checkbox" checked={autoLoad} onChange={(event) => setAutoLoad(event.target.checked)} />
        <span>{t('ext.autoLoad')}</span>
      </label>
      <p className="subtle">{t('ext.autoLoadHint')}</p>

      <section className="ext-plan" aria-live="polite">
        <h3>{t('ext.installPreview')}</h3>
        {waitingForTarget && <p className="subtle">{t('ext.selectTargetToPlan')}</p>}
        {!waitingForTarget && !plan && !error && <p className="os-loading"><LoaderCircle size={15} className="os-spin" aria-hidden="true" />{t('ext.loading')}</p>}
        {!waitingForTarget && plan && <>
          <p className={plan.canInstall ? 'os-ok' : 'os-bad'}>{plan.canInstall ? t('ext.planReady') : t('ext.planBlocked')}</p>
          <ul className="ext-plan-nodes">
            {plan.nodes.map((node) => <li key={node.key}>
              <strong>{node.name}</strong> <span className="subtle">{node.key}@{node.version}{node.isRoot ? ' · root' : ''}</span>
              {node.requiresApproval && <span className="ext-flag"><ShieldAlert size={13} aria-hidden="true" />{t('ext.requiresApproval')}</span>}
            </li>)}
          </ul>
          {blocked.length > 0 && <div className="os-alert" role="alert"><CircleAlert size={15} aria-hidden="true" />
            <ul>{blocked.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>}
          {plan.warnings.length > 0 && <div className="ext-warn"><ShieldAlert size={15} aria-hidden="true" /><ul>{plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
          <div className="ext-permissions"><span className="subtle">{t('ext.permissions')}</span><PermissionChips permissions={plan.permissions} /></div>
          {approvalRequired && <label className="ext-check ext-check-warn">
            <input type="checkbox" checked={approve} onChange={(event) => setApprove(event.target.checked)} />
            <span>{t('ext.approvePermissions')} — {t('ext.approvePermissionsHint')}</span>
          </label>}
        </>}
      </section>
    </div>
  </Dialog>;
}

function PackageDetails({ pkg, role, agents, organizations, onClose, onChanged, onInstall }: {
  pkg: ExtensionPackage; role: string | undefined; agents: Agent[]; organizations: Array<{ id: string; name: string }>;
  onClose: () => void; onChanged: () => Promise<void>; onInstall: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rollbackVersion, setRollbackVersion] = useState<Record<string, string>>({});
  const member = isMember(role);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try { await action(); await onChanged(); }
    catch (err) { setError(errorText(err, t('ext.errorGeneric'))); }
    finally { setBusy(null); }
  };

  return <Dialog title={pkg.name} description={pkg.key} icon={Package} onClose={onClose}
    footer={<div className="os-dialog-actions">
      <button type="button" className="button ghost" onClick={onClose}>{t('ext.close')}</button>
      {member && pkg.status !== 'revoked' && <button type="button" className="button primary" onClick={onInstall}><Download size={15} aria-hidden="true" />{t('ext.install')}</button>}
    </div>}>
    <div className="ext-detail">
      {error && <div className="os-alert" role="alert"><CircleAlert size={15} aria-hidden="true" />{error}</div>}
      <p dir="auto">{pkg.description}</p>
      <div className="ext-meta-grid">
        <div><span className="subtle">{t('ext.version')}</span><strong>{pkg.latestVersion}</strong></div>
        <div><span className="subtle">{t('ext.author')}</span><strong>{pkg.author}</strong></div>
        <div><span className="subtle">{t('ext.category')}</span><strong>{pkg.category}</strong></div>
        <div><span className="subtle">{t('ext.trust')}</span><TrustBadge trust={pkg.trust} /></div>
        <div><span className="subtle">{t('ext.executionModel')}</span><strong>{pkg.executionModel}</strong></div>
        <div><span className="subtle">{t('ext.checksum')}</span><code title={pkg.checksum}>{pkg.checksum.slice(0, 22)}…</code></div>
      </div>
      {pkg.marketplace && <p className="subtle">{t('ext.source')}: {pkg.marketplace.name} · {pkg.marketplace.pinned ? t('ext.pinned') : pkg.marketplace.url}</p>}
      <section>
        <h3>{t('ext.capabilities')}</h3>
        <div className="ext-chips">{pkg.capabilities.map((capability) => <span key={capability} className="os-chip small">{capability}</span>)}</div>
      </section>
      <section>
        <h3>{t('ext.permissions')}</h3>
        <PermissionChips permissions={pkg.permissions} />
      </section>
      {pkg.dependencies.length > 0 && <section>
        <h3>{t('ext.dependencies')}</h3>
        <ul>{pkg.dependencies.map((dependency) => <li key={dependency.id}>{dependency.id} <code>{dependency.version}</code></li>)}</ul>
      </section>}
      {pkg.requirements?.tools && pkg.requirements.tools.length > 0 && <section>
        <h3>{t('ext.requiredTools')}</h3>
        <div className="ext-chips">{pkg.requirements.tools.map((tool) => <span key={tool} className="os-chip small">{tool}</span>)}</div>
      </section>}
      {pkg.security && <section className="ext-security">
        <h3>{t('ext.securityReview')}</h3>
        <ul>
          <li>{t('ext.executesCode')}: <strong>{pkg.security.executesCode ? t('ext.yes') : t('ext.no')}</strong></li>
          <li>{t('ext.networkAccess')}: <strong>{pkg.security.networkAccess ? t('ext.yes') : t('ext.no')}</strong></li>
          <li>{t('ext.lifecycleHooks')}: <strong>{pkg.security.lifecycleHooks ? t('ext.yes') : t('ext.no')}</strong></li>
          <li>{t('ext.secretsRequired')}: <strong>{pkg.security.secrets.length ? pkg.security.secrets.join(', ') : t('ext.none')}</strong></li>
        </ul>
        {pkg.security.notes.map((note) => <p key={note} className="subtle">{note}</p>)}
        <p className="subtle">{t('ext.securityNote')}</p>
      </section>}
      <section>
        <h3>{t('ext.versions')}</h3>
        <ul className="ext-version-list">
          {pkg.versions.map((entry) => <li key={entry.version}>
            <code>{entry.version}</code> <span className="subtle">{new Date(entry.publishedAt).toLocaleString()}</span>
            {entry.yanked && <span className="ext-flag">{t('ext.yanked')}</span>}
          </li>)}
        </ul>
      </section>
      <section>
        <h3>{t('ext.installations')}</h3>
        {!pkg.installations.length && <p className="subtle">{t('ext.noInstallations')}</p>}
        {pkg.installations.map((installation) => <div key={installation.id} className="ext-installation">
          <div className="ext-installation-head">
            <strong>{t(scopeKey(installation.scope))}{installation.scopeId ? ` · ${installation.scopeId}` : ''}</strong>
            <span className="subtle">{installation.version}</span>
            <span className={`ext-status ext-status-${installation.status}`}>{installation.status}</span>
            <span className={`ext-status ${installation.enabled ? 'ext-status-enabled' : 'ext-status-disabled'}`}>{installation.enabled ? t('ext.enabled') : t('ext.disabled')}</span>
          </div>
          {!installation.permissionsApproved && <p className="ext-warn"><ShieldAlert size={14} aria-hidden="true" />{t('ext.pendingApproval')}</p>}
          <div className="ext-installation-actions">
            {!installation.permissionsApproved && isAdmin(role) && <button type="button" className="button small primary" disabled={busy !== null} onClick={() => void run(`approve-${installation.id}`, () => extensionsApi.approve(installation.id))}>{t('ext.approve')}</button>}
            {installation.permissionsApproved && (installation.enabled
              ? <button type="button" className="button small ghost" disabled={busy !== null} onClick={() => void run(`disable-${installation.id}`, () => extensionsApi.disable(installation.id))}>{t('ext.disable')}</button>
              : <button type="button" className="button small primary" disabled={busy !== null} onClick={() => void run(`enable-${installation.id}`, () => extensionsApi.enable(installation.id))}>{t('ext.enable')}</button>)}
            {installation.updateAvailable && <button type="button" className="button small" disabled={busy !== null} onClick={() => void run(`update-${installation.id}`, () => extensionsApi.update(installation.id, { version: installation.updateAvailable ?? undefined, approvePermissions: true }))}>
              {t('ext.update')} → {installation.updateAvailable}
            </button>}
            {pkg.versions.length > 1 && <span className="ext-rollback">
              <select value={rollbackVersion[installation.id] ?? ''} onChange={(event) => setRollbackVersion((current) => ({ ...current, [installation.id]: event.target.value }))} aria-label={t('ext.rollbackTo')}>
                <option value="">{t('ext.rollbackTo')}</option>
                {pkg.versions.filter((entry) => entry.version !== installation.version).map((entry) => <option key={entry.version} value={entry.version}>{entry.version}</option>)}
              </select>
              <button type="button" className="button small ghost" disabled={busy !== null || !rollbackVersion[installation.id]} onClick={() => void run(`rollback-${installation.id}`, () => extensionsApi.rollback(installation.id, { version: rollbackVersion[installation.id] ?? '', approvePermissions: true }))}>{t('ext.rollback')}</button>
            </span>}
            <button type="button" className="button small ghost" disabled={busy !== null} onClick={() => {
              if (!window.confirm(t('ext.uninstallConfirm'))) return;
              void run(`uninstall-${installation.id}`, () => extensionsApi.uninstall(installation.id));
            }}><Trash2 size={14} aria-hidden="true" />{t('ext.uninstall')}</button>
            {busy?.endsWith(installation.id) && <LoaderCircle size={15} className="os-spin" aria-hidden="true" />}
          </div>
        </div>)}
      </section>
      {pkg.warnings.length > 0 && <div className="ext-warn"><ShieldAlert size={15} aria-hidden="true" /><ul>{pkg.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
    </div>
  </Dialog>;
}

function AddMarketplaceDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => Promise<void> }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [ref, setRef] = useState('main');
  const [refType, setRefType] = useState<'branch' | 'tag' | 'commit'>('branch');
  const [repoPath, setRepoPath] = useState('');
  const [trust, setTrust] = useState<TrustLevel>('community');
  const [autoLoad, setAutoLoad] = useState(false);
  const [credential, setCredential] = useState('');
  const [preview, setPreview] = useState<Array<{ key: string; version: string; ok: boolean; errors: Array<{ path: string; message: string }> }> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runPreview() {
    setBusy('preview'); setError(null);
    try {
      const result = await extensionsApi.previewMarketplace({ url: url.trim(), ref: ref.trim(), refType, path: repoPath.trim() || undefined });
      setPreview(result.packages);
    } catch (err) { setPreview(null); setError(errorText(err, t('ext.errorGeneric'))); }
    finally { setBusy(null); }
  }

  async function add() {
    setBusy('add'); setError(null);
    try {
      await extensionsApi.addMarketplace({
        name: name.trim() || undefined, url: url.trim(), ref: ref.trim(), refType,
        path: repoPath.trim() || undefined, trust, autoLoad, credential: credential.trim() || undefined,
      });
      await onAdded();
      onClose();
    } catch (err) { setError(errorText(err, t('ext.errorGeneric'))); }
    finally { setBusy(null); }
  }

  return <Dialog title={t('ext.addMarketplace')} icon={Store} onClose={onClose}
    footer={<div className="os-dialog-actions">
      <button type="button" className="button ghost" onClick={onClose}>{t('ext.cancel')}</button>
      <button type="button" className="button" disabled={!url.trim() || busy !== null} onClick={() => void runPreview()}>{busy === 'preview' ? <LoaderCircle size={15} className="os-spin" aria-hidden="true" /> : <Search size={15} aria-hidden="true" />}{t('ext.preview')}</button>
      <button type="button" className="button primary" disabled={!url.trim() || busy !== null} onClick={() => void add()}>{busy === 'add' ? <LoaderCircle size={15} className="os-spin" aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}{t('ext.add')}</button>
    </div>}>
    <div className="ext-form">
      {error && <div className="os-alert" role="alert"><CircleAlert size={15} aria-hidden="true" />{error}</div>}
      <label className="os-field">{t('ext.marketplaceName')}<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} /></label>
      <label className="os-field">{t('ext.marketplaceUrl')}<input required value={url} onChange={(event) => setUrl(event.target.value)} dir="ltr" placeholder="https://github.com/org/marketplace" maxLength={500} /></label>
      <div className="ext-form-row">
        <label className="os-field">{t('ext.refType')}
          <select value={refType} onChange={(event) => setRefType(event.target.value as typeof refType)}>
            <option value="branch">{t('ext.refBranch')}</option>
            <option value="tag">{t('ext.refTag')}</option>
            <option value="commit">{t('ext.refCommit')}</option>
          </select>
        </label>
        <label className="os-field">{t('ext.ref')}<input value={ref} onChange={(event) => setRef(event.target.value)} dir="ltr" maxLength={200} /></label>
      </div>
      <label className="os-field">{t('ext.repoPath')}<input value={repoPath} onChange={(event) => setRepoPath(event.target.value)} dir="ltr" placeholder="packages" maxLength={200} /></label>
      <div className="ext-form-row">
        <label className="os-field">{t('ext.trustLevel')}
          <select value={trust} onChange={(event) => setTrust(event.target.value as TrustLevel)}>
            {TRUSTS.map((entry) => <option key={entry} value={entry}>{t(`ext.trust${entry.charAt(0).toUpperCase()}${entry.slice(1)}`)}</option>)}
          </select>
        </label>
        <label className="os-field">{t('ext.credential')}<input type="password" value={credential} onChange={(event) => setCredential(event.target.value)} dir="ltr" autoComplete="off" maxLength={4000} />
          <span className="subtle">{t('ext.credentialHint')}</span>
        </label>
      </div>
      <label className="ext-check"><input type="checkbox" checked={autoLoad} onChange={(event) => setAutoLoad(event.target.checked)} /><span>{t('ext.autoLoad')}</span></label>
      <p className="subtle">{t('ext.autoLoadHint')}</p>
      {preview && <section className="ext-plan">
        <h3>{t('ext.preview')}</h3>
        <ul>{preview.map((entry) => <li key={entry.key}>
          <strong>{entry.key}</strong> <span className="subtle">{entry.version}</span> {entry.ok ? <CheckCircle2 size={14} className="os-ok" aria-hidden="true" /> : <CircleAlert size={14} className="os-bad" aria-hidden="true" />}
          {!entry.ok && <ul>{entry.errors.map((issue) => <li key={`${issue.path}-${issue.message}`} className="os-bad">{issue.path}: {issue.message}</li>)}</ul>}
        </li>)}</ul>
      </section>}
    </div>
  </Dialog>;
}

function CreatePackageDialog({ kind, onClose, onCreated }: { kind: 'skill' | 'plugin'; onClose: () => void; onCreated: () => Promise<void> }) {
  const { t } = useI18n();
  const [manifest, setManifest] = useState(kind === 'skill' ? skillTemplate() : pluginTemplate());
  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function parse(): unknown | null {
    try { return JSON.parse(manifest) as unknown; }
    catch { setError(t('ext.invalidJson')); return null; }
  }

  async function validate() {
    const parsed = parse();
    if (parsed === null) return;
    setBusy('validate'); setError(null);
    try { setValidation(await extensionsApi.validate(kind, parsed)); }
    catch (err) { setError(errorText(err, t('ext.errorGeneric'))); }
    finally { setBusy(null); }
  }

  async function save() {
    const parsed = parse();
    if (parsed === null) return;
    setBusy('save'); setError(null);
    try {
      await extensionsApi.createPackage(kind, parsed);
      await onCreated();
      onClose();
    } catch (err) { setError(errorText(err, t('ext.errorGeneric'))); }
    finally { setBusy(null); }
  }

  return <Dialog title={kind === 'skill' ? t('ext.createSkill') : t('ext.createPlugin')} icon={Boxes} onClose={onClose}
    footer={<div className="os-dialog-actions">
      <button type="button" className="button ghost" onClick={onClose}>{t('ext.cancel')}</button>
      <button type="button" className="button" disabled={busy !== null} onClick={() => void validate()}>{busy === 'validate' ? <LoaderCircle size={15} className="os-spin" aria-hidden="true" /> : <ShieldCheck size={15} aria-hidden="true" />}{t('ext.validate')}</button>
      <button type="button" className="button primary" disabled={busy !== null || !validation?.ok} onClick={() => void save()}>{busy === 'save' ? <LoaderCircle size={15} className="os-spin" aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}{t('ext.savePrivately')}</button>
    </div>}>
    <div className="ext-form">
      {error && <div className="os-alert" role="alert"><CircleAlert size={15} aria-hidden="true" />{error}</div>}
      <div className="ext-form-row">
        <p className="subtle">{t('ext.manifestHint')}</p>
        <button type="button" className="button small ghost" onClick={() => { setManifest(kind === 'skill' ? skillTemplate() : pluginTemplate()); setValidation(null); }}>{t('ext.loadTemplate')}</button>
      </div>
      <label className="os-field">{t('ext.manifestJson')}
        <textarea className="ext-manifest" value={manifest} onChange={(event) => { setManifest(event.target.value); setValidation(null); }} spellCheck={false} dir="ltr" rows={18} />
      </label>
      {validation && <section className={`ext-plan ${validation.ok ? '' : 'ext-plan-invalid'}`}>
        <h3>{validation.ok ? t('ext.validManifest') : t('ext.invalidManifest')}</h3>
        {validation.errors.length > 0 && <ul>{validation.errors.map((issue) => <li key={`${issue.path}-${issue.message}`} className="os-bad">{issue.path}: {issue.message}</li>)}</ul>}
        {validation.warnings.length > 0 && <ul>{validation.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
        {validation.permissionReview.length > 0 && <div className="ext-permissions"><span className="subtle">{t('ext.permissions')}</span><PermissionChips permissions={validation.permissionReview} /></div>}
        <p className="subtle">{t('ext.publishUnsupported')}</p>
      </section>}
    </div>
  </Dialog>;
}

export function ExtensionsHub() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('skills');
  const [summary, setSummary] = useState<ExtensionSummary | null>(null);
  const [packages, setPackages] = useState<ExtensionPackage[] | null>(null);
  const [marketplaces, setMarketplaces] = useState<Marketplace[] | null>(null);
  const [tools, setTools] = useState<{ core: Array<{ id: string; name: string; risk: string }>; plugin: PluginToolRecord[]; registered: number } | null>(null);
  const [mcp, setMcp] = useState<McpServer[] | null>(null);
  const [secrets, setSecrets] = useState<SecretMetadata[] | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([]);
  const [filters, setFilters] = useState({ query: '', category: '', marketplace: '', scope: '', installed: false, enabled: false });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [installTarget, setInstallTarget] = useState<ExtensionPackage | null>(null);
  const [showMarketplace, setShowMarketplace] = useState(false);
  const [createKind, setCreateKind] = useState<'skill' | 'plugin' | null>(null);
  const [secretName, setSecretName] = useState('');
  const [secretValue, setSecretValue] = useState('');

  const role = summary?.role;
  const member = isMember(role);
  const admin = isAdmin(role);

  const loadPackages = useCallback(async () => {
    const list = await extensionsApi.packages();
    setPackages(list);
    return list;
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [nextSummary, list] = await Promise.all([extensionsApi.summary(), extensionsApi.packages()]);
      setSummary(nextSummary);
      setPackages(list);
      setError(null);
    } catch (err) {
      setError(errorText(err, t('ext.errorGeneric')));
    }
  }, [t]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        if (tab === 'marketplaces') {
          const list = await extensionsApi.marketplaces();
          if (!cancelled) setMarketplaces(list);
        } else if (tab === 'tools') {
          const [toolList, mcpList] = await Promise.all([extensionsApi.tools(), extensionsApi.mcp()]);
          if (!cancelled) { setTools(toolList); setMcp(mcpList); }
          if (admin) {
            try { const secretList = await extensionsApi.secrets(); if (!cancelled) setSecrets(secretList); } catch { if (!cancelled) setSecrets(null); }
          }
        }
      } catch (err) {
        if (!cancelled) setError(errorText(err, t('ext.errorGeneric')));
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [tab, admin, t]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [agentList, orgList] = await Promise.all([osApi.agents(), osApi.organizations()]);
        if (!cancelled) {
          setAgents(agentList);
          setOrganizations(orgList.map((organization) => ({ id: organization.id, name: organization.name })));
        }
      } catch { /* targets are optional; free-text ids remain available */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const details = useMemo(() => packages?.find((pkg) => pkg.id === detailsId) ?? null, [packages, detailsId]);
  const visible = useMemo(() => packages ? filterPackages(packages, { ...filters, kind: tab === 'plugins' ? 'plugin' : 'skill' }) : [], [packages, filters, tab]);
  const categories = useMemo(() => packages ? categoriesOf(packages, tab === 'plugins' ? 'plugin' : 'skill') : [], [packages, tab]);

  async function refreshAfterChange(message: string) {
    setNotice(message);
    setError(null);
    await loadAll();
    if (detailsId) {
      try { await extensionsApi.package(detailsId); } catch { setDetailsId(null); }
    }
    if (tab === 'marketplaces') setMarketplaces(await extensionsApi.marketplaces());
    if (tab === 'tools') { setTools(await extensionsApi.tools()); setMcp(await extensionsApi.mcp()); if (admin) setSecrets(await extensionsApi.secrets().catch(() => null)); }
  }

  async function marketplaceAction(key: string, action: () => Promise<unknown>, success: string) {
    setBusy(key); setError(null);
    try { await action(); await refreshAfterChange(t(success)); }
    catch (err) { setError(errorText(err, t('ext.errorGeneric'))); }
    finally { setBusy(null); }
  }

  async function addSecret(event: React.FormEvent) {
    event.preventDefault();
    if (!secretName.trim() || !secretValue) return;
    setBusy('secret'); setError(null);
    try {
      await extensionsApi.addSecret({ name: secretName.trim().toUpperCase(), value: secretValue });
      setSecretName(''); setSecretValue('');
      setSecrets(await extensionsApi.secrets());
      setNotice(t('ext.secretSaved'));
    } catch (err) { setError(errorText(err, t('ext.errorGeneric'))); }
    finally { setBusy(null); }
  }

  const tabs: Array<{ id: Tab; label: string; icon: typeof Boxes; count: number }> = [
    { id: 'skills', label: t('ext.tabSkills'), icon: Boxes, count: summary?.skills ?? 0 },
    { id: 'plugins', label: t('ext.tabPlugins'), icon: Plug2, count: summary?.plugins ?? 0 },
    { id: 'marketplaces', label: t('ext.tabMarketplaces'), icon: Store, count: summary?.marketplaces ?? 0 },
    { id: 'tools', label: t('ext.tabTools'), icon: Wrench, count: summary?.tools ?? 0 },
  ];

  return <div className="os-page ext-page">
    <PageHeader icon={Boxes} eyebrow={t('ext.eyebrow')} title={t('ext.title')} description={t('ext.subtitle')}
      action={<div className="ext-head-actions">
        {member && <button type="button" className="button" onClick={() => setCreateKind('skill')}><Plus size={15} aria-hidden="true" />{t('ext.createSkill')}</button>}
        {member && <button type="button" className="button" onClick={() => setCreateKind('plugin')}><Plus size={15} aria-hidden="true" />{t('ext.createPlugin')}</button>}
        {admin && <button type="button" className="button primary" onClick={() => setShowMarketplace(true)}><Store size={15} aria-hidden="true" />{t('ext.addMarketplace')}</button>}
      </div>} />

    <div className="ext-stats">
      <div><span className="subtle">{t('ext.installed')}</span><strong>{summary?.installed ?? 0}</strong></div>
      <div><span className="subtle">{t('ext.enabled')}</span><strong>{summary?.enabled ?? 0}</strong></div>
      <div><span className="subtle">{t('ext.pendingApproval')}</span><strong>{summary?.pendingApproval ?? 0}</strong></div>
      <div><span className="subtle">{t('ext.pluginTools')}</span><strong>{summary?.tools ?? 0}</strong></div>
      <div><span className="subtle">{t('ext.mcpServers')}</span><strong>{summary?.mcpServers ?? 0}</strong></div>
    </div>

    {error && <div className="os-alert" role="alert"><CircleAlert size={16} aria-hidden="true" />{error}</div>}
    {notice && <div className="ext-success" role="status"><CheckCircle2 size={16} aria-hidden="true" />{notice}</div>}

    <div className="os-tabs" role="tablist">
      {tabs.map((entry) => <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} className={`os-tab ${tab === entry.id ? 'is-active' : ''}`} onClick={() => setTab(entry.id)}>
        <entry.icon size={15} aria-hidden="true" />{entry.label}<span className="ext-count">{entry.count}</span>
      </button>)}
    </div>

    {(tab === 'skills' || tab === 'plugins') && <>
      <div className="os-toolbar ext-toolbar">
        <label className="os-search"><Search size={15} aria-hidden="true" /><input value={filters.query} onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))} placeholder={t('ext.search')} aria-label={t('ext.search')} /></label>
        <select value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))} aria-label={t('ext.filterCategory')}>
          <option value="">{t('ext.allCategories')}</option>
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
        <select value={filters.marketplace} onChange={(event) => setFilters((current) => ({ ...current, marketplace: event.target.value }))} aria-label={t('ext.filterMarketplace')}>
          <option value="">{t('ext.allMarketplaces')}</option>
          {[...new Map((packages ?? []).filter((pkg) => pkg.marketplace).map((pkg) => [pkg.marketplace!.id, pkg.marketplace!.name])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select value={filters.scope} onChange={(event) => setFilters((current) => ({ ...current, scope: event.target.value }))} aria-label={t('ext.filterScope')}>
          <option value="">{t('ext.allScopes')}</option>
          {SCOPES.map((scope) => <option key={scope} value={scope}>{t(scopeKey(scope))}</option>)}
        </select>
        <label className="ext-check compact"><input type="checkbox" checked={filters.installed} onChange={(event) => setFilters((current) => ({ ...current, installed: event.target.checked }))} /><span>{t('ext.installedOnly')}</span></label>
        <label className="ext-check compact"><input type="checkbox" checked={filters.enabled} onChange={(event) => setFilters((current) => ({ ...current, enabled: event.target.checked }))} /><span>{t('ext.enabledOnly')}</span></label>
      </div>

      {packages === null && <p className="os-loading"><LoaderCircle size={16} className="os-spin" aria-hidden="true" />{t('ext.loading')}</p>}
      {packages !== null && visible.length === 0 && <EmptyState icon={tab === 'plugins' ? Plug2 : Boxes} title={tab === 'plugins' ? t('ext.emptyPlugins') : t('ext.emptySkills')} />}
      {visible.length > 0 && <div className="ext-grid">
        {visible.map((pkg) => <article key={pkg.id} className={`ext-card panel panel-pad ${pkg.status === 'revoked' ? 'ext-card-revoked' : ''}`}>
          <header className="ext-card-head">
            <div>
              <h2 dir="auto">{pkg.name}</h2>
              <span className="subtle">{pkg.key} · {pkg.latestVersion}</span>
            </div>
            <TrustBadge trust={pkg.trust} />
          </header>
          <p className="ext-card-desc" dir="auto">{pkg.description}</p>
          <div className="ext-chips">
            <span className="os-chip small">{pkg.category}</span>
            <span className="os-chip small">{pkg.type}</span>
            {pkg.requiresApproval && <span className="os-chip small ext-chip-warn"><ShieldAlert size={12} aria-hidden="true" />{t('ext.requiresApproval')}</span>}
            {pkg.installed && <span className="os-chip small ext-chip-ok">{t('ext.installed')}</span>}
            {pkg.enabled && <span className="os-chip small ext-chip-ok">{t('ext.enabled')}</span>}
            {pkg.status === 'revoked' && <span className="os-chip small ext-chip-bad">{t('ext.revoked')}</span>}
          </div>
          <footer className="ext-card-foot">
            <span className="subtle">{pkg.permissions.length} {t('ext.permissions')} · {pkg.installations.length} {t('ext.installations')}</span>
            <span className="ext-card-actions">
              <button type="button" className="button small ghost" onClick={() => setDetailsId(pkg.id)}>{t('ext.details')}</button>
              {member && pkg.status !== 'revoked' && <button type="button" className="button small primary" onClick={() => setInstallTarget(pkg)}>{t('ext.install')}</button>}
            </span>
          </footer>
        </article>)}
      </div>}
    </>}

    {tab === 'marketplaces' && <>
      {marketplaces === null && <p className="os-loading"><LoaderCircle size={16} className="os-spin" aria-hidden="true" />{t('ext.loading')}</p>}
      {marketplaces && marketplaces.length === 0 && <EmptyState icon={Store} title={t('ext.emptyMarketplaces')} />}
      {marketplaces && marketplaces.length > 0 && <div className="ext-market-list">
        {marketplaces.map((marketplace) => <article key={marketplace.id} className="panel panel-pad ext-market">
          <header className="ext-market-head">
            <div>
              <h2>{marketplace.name}</h2>
              <span className="subtle" dir="ltr">{marketplace.url}</span>
            </div>
            <span className={`ext-status ext-status-${marketplace.status}`}>{marketplace.status}</span>
          </header>
          <div className="ext-meta-grid">
            <div><span className="subtle">{t('ext.ref')}</span><strong dir="ltr">{marketplace.ref} ({marketplace.refType})</strong></div>
            <div><span className="subtle">{t('ext.trust')}</span><TrustBadge trust={marketplace.trust} /></div>
            <div><span className="subtle">{t('ext.packageCount')}</span><strong>{marketplace.packageCount}</strong></div>
            <div><span className="subtle">{t('ext.lastSync')}</span><strong>{marketplace.lastSyncAt ? new Date(marketplace.lastSyncAt).toLocaleString() : t('ext.never')}</strong></div>
            <div><span className="subtle">{t('ext.autoLoad')}</span><strong>{marketplace.autoLoad ? t('ext.yes') : t('ext.no')}</strong></div>
            <div><span className="subtle">{t('ext.credential')}</span><strong>{marketplace.secretConfigured ? t('ext.configured') : t('ext.none')}</strong></div>
          </div>
          {marketplace.pinned && <p className="subtle">{t('ext.pinned')}</p>}
          {marketplace.lastError && <div className="os-alert" role="alert"><CircleAlert size={15} aria-hidden="true" />{marketplace.lastError}</div>}
          <footer className="ext-market-actions">
            {admin && !marketplace.readOnly && <button type="button" className="button small" disabled={busy !== null} onClick={() => void marketplaceAction(`sync-${marketplace.id}`, () => extensionsApi.syncMarketplace(marketplace.id), 'ext.syncSuccess')}>
              {busy === `sync-${marketplace.id}` ? <LoaderCircle size={14} className="os-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}{t('ext.sync')}
            </button>}
            {admin && !marketplace.readOnly && <button type="button" className="button small ghost" disabled={busy !== null} onClick={() => {
              if (!window.confirm(t('ext.removeMarketplaceConfirm'))) return;
              void marketplaceAction(`remove-${marketplace.id}`, () => extensionsApi.removeMarketplace(marketplace.id), 'ext.marketplaceRemoved');
            }}><Trash2 size={14} aria-hidden="true" />{t('ext.removeMarketplace')}</button>}
            {marketplace.readOnly && <span className="subtle">{t('ext.readOnly')}</span>}
          </footer>
        </article>)}
      </div>}
    </>}

    {tab === 'tools' && <>
      {tools === null && <p className="os-loading"><LoaderCircle size={16} className="os-spin" aria-hidden="true" />{t('ext.loading')}</p>}
      {tools && <div className="ext-tools-grid">
        <section className="panel panel-pad">
          <h2>{t('ext.pluginTools')} <span className="subtle">({tools.plugin.length})</span></h2>
          {tools.plugin.length === 0 && <p className="subtle">{t('ext.emptyTools')}</p>}
          {tools.plugin.length > 0 && <div className="ext-table-wrap"><table className="ext-table">
            <thead><tr><th>{t('ext.toolId')}</th><th>{t('ext.risk')}</th><th>{t('ext.permissions')}</th><th>{t('ext.health')}</th><th>{t('ext.active')}</th></tr></thead>
            <tbody>{tools.plugin.map((tool) => <tr key={tool.toolId}>
              <td><code>{tool.toolId}</code><div className="subtle">{tool.name}</div></td>
              <td><span className={`ext-perm ext-perm-${tool.risk}`}>{tool.risk}</span></td>
              <td>{tool.permissions.length ? tool.permissions.join(', ') : <span className="subtle">{t('ext.none')}</span>}</td>
              <td><span className={`ext-health ext-health-${tool.health}`}>{tool.health}</span></td>
              <td>{tool.active ? t('ext.yes') : t('ext.no')}</td>
            </tr>)}</tbody>
          </table></div>}
        </section>

        <section className="panel panel-pad">
          <h2>{t('ext.mcpServers')} <span className="subtle">({mcp?.length ?? 0})</span></h2>
          {mcp && mcp.length === 0 && <p className="subtle">{t('ext.noMcp')}</p>}
          {mcp && mcp.length > 0 && <ul className="ext-mcp-list">{mcp.map((server) => <li key={server.id}>
            <div>
              <strong>{server.name}</strong> <span className="subtle">{server.transport} · {server.packageKey ?? server.installationId}</span>
              <div className="subtle">{t('ext.lastCheck')}: {server.lastCheckAt ? new Date(server.lastCheckAt).toLocaleString() : t('ext.never')} · {t('ext.discoveredTools')}: {server.discoveredTools}</div>
              {server.lastError && <div className="os-bad">{server.lastError}</div>}
            </div>
            <div className="ext-mcp-actions">
              <span className={`ext-health ext-health-${server.health}`}>{server.health}</span>
              {member && <button type="button" className="button small" disabled={busy !== null} onClick={() => void marketplaceAction(`mcp-${server.id}`, () => extensionsApi.mcpHealth(server.id), 'ext.healthChecked')}>
                {busy === `mcp-${server.id}` ? <LoaderCircle size={14} className="os-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}{t('ext.checkHealth')}
              </button>}
            </div>
          </li>)}</ul>}
        </section>

        <section className="panel panel-pad">
          <h2>{t('ext.coreTools')} <span className="subtle">({tools.core.length})</span></h2>
          <div className="ext-chips">{tools.core.map((tool) => <span key={tool.id} className={`os-chip small ext-perm-${tool.risk}`}>{tool.id}</span>)}</div>
        </section>

        {admin && <section className="panel panel-pad">
          <h2>{t('ext.secrets')}</h2>
          <p className="subtle">{t('ext.secretHint')}</p>
          <form className="ext-form-row" onSubmit={(event) => void addSecret(event)}>
            <label className="os-field">{t('ext.secretName')}<input value={secretName} onChange={(event) => setSecretName(event.target.value.toUpperCase())} dir="ltr" placeholder="MY_SERVICE_TOKEN" maxLength={64} /></label>
            <label className="os-field">{t('ext.secretValue')}<input type="password" value={secretValue} onChange={(event) => setSecretValue(event.target.value)} dir="ltr" autoComplete="new-password" maxLength={8000} /></label>
            <button type="submit" className="button primary" disabled={busy !== null || !secretName.trim() || !secretValue}>{busy === 'secret' ? <LoaderCircle size={15} className="os-spin" aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}{t('ext.addSecret')}</button>
          </form>
          {secrets && secrets.length > 0 && <ul className="ext-secret-list">{secrets.map((secret) => <li key={secret.id}>
            <code>{secret.name}</code> <span className="subtle">{secret.purpose} · {new Date(secret.updatedAt).toLocaleDateString()}</span>
            <button type="button" className="icon-button" aria-label={t('ext.deleteSecret')} onClick={() => void marketplaceAction(`secret-${secret.name}`, () => extensionsApi.deleteSecret(secret.name), 'ext.secretDeleted')}><Trash2 size={14} /></button>
          </li>)}</ul>}
        </section>}
      </div>}
    </>}

    {details && <PackageDetails pkg={details} role={role} agents={agents} organizations={organizations} onClose={() => setDetailsId(null)}
      onChanged={async () => { await refreshAfterChange(t('ext.updated')); }}
      onInstall={() => { setInstallTarget(details); setDetailsId(null); }} />}
    {installTarget && <InstallDialog pkg={installTarget} agents={agents} organizations={organizations} onClose={() => setInstallTarget(null)}
      onInstalled={() => { void refreshAfterChange(t('ext.installSuccess')); }} />}
    {showMarketplace && <AddMarketplaceDialog onClose={() => setShowMarketplace(false)} onAdded={() => refreshAfterChange(t('ext.marketplaceAdded'))} />}
    {createKind && <CreatePackageDialog kind={createKind} onClose={() => setCreateKind(null)} onCreated={() => refreshAfterChange(t('ext.created'))} />}
  </div>;
}
