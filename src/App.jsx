import React, { useEffect, useRef, useState } from 'react';
import {
  APP_VERSION,
  DEFAULT_WEB_AUTH,
  normalizeState,
} from './data';
import {
  isHostSyncClient,
  listStateBackups,
  currentSyncConfig,
  readSyncConflictSummary,
  readStoredFile,
  resolveSyncConflict,
  resolveSyncConflictSelections,
  restoreStateBackup,
  setCloseToTray,
  startLanServer,
  stopLanServer,
} from './desktop';
import { readFullBackupPackage } from './compatibilityBackup';
import {
  normalizeRichTextImages,
} from './richText';
import { projectNoteSheets } from './projectNotes';
import { notesPatchFromSheets } from './projectNoteHelpers';
import { collectReferencedPaths } from './stateReferences';
import { fetchWebAuthStatus, getLastSyncStatus, isRemoteBuildBookClient, loadAppState, saveAppState, webLogin, webLogout } from './storage';
import { THEME_CSS_VARS, normalizeTheme } from './theme';
import { ConfirmProvider } from './ConfirmDialog';
import SyncConflictReviewModal from './SyncConflictReviewModal';
import {
  BusyNotice,
  Header,
  Imports,
  Parts,
  Projects,
  Search,
  Settings,
} from './AppViews';

const TABS = [
  ['projects', 'Projects'],
  ['completed-projects', 'Completed Projects', 'child'],
  ['parts', 'Parts Library'],
  ['search', 'Search'],
  ['imports', 'Imports'],
  ['settings', 'Settings'],
];

const SETTINGS_SECTIONS = [
  ['workspace', 'Workspace Setup'],
  ['maintenance', 'Maintenance'],
  ['network', 'Network & Sync'],
];

const SYNC_BOOTSTRAP_KEY = 'buildbook-sync-bootstrap';
const BUILDBOOK_SYNC_PORT = 8788;

function randomSecret() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  const values = new Uint8Array(16);
  crypto?.getRandomValues?.(values);
  return values.length ? [...values].map((byte) => byte.toString(16).padStart(2, '0')).join('') : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function externalizeStateInlineDataImages(state) {
  let changed = false;
  const projects = await Promise.all((state.projects || []).map(async (project) => {
    let nextProject = project;
    const notes = await normalizeRichTextImages(project.notes, `project-note-images/${project.id}`);
    const currentNoteSheets = projectNoteSheets(project);
    const noteSheets = await Promise.all(currentNoteSheets.map(async (sheet) => {
      const content = await normalizeRichTextImages(sheet.content, `project-note-images/${project.id}`);
      if (content !== sheet.content) changed = true;
      return content !== sheet.content ? { ...sheet, content } : sheet;
    }));
    if (notes !== project.notes) {
      changed = true;
      nextProject = { ...nextProject, notes };
    }
    if (noteSheets.some((sheet, index) => sheet !== currentNoteSheets[index])) {
      nextProject = { ...nextProject, ...notesPatchFromSheets(noteSheets) };
    }
    if (project.instructions) {
      const intro = await normalizeRichTextImages(project.instructions.intro, `project-instructions/${project.id}/intro`);
      const currentSteps = project.instructions.steps || [];
      const steps = await Promise.all(currentSteps.map(async (step) => {
        const body = await normalizeRichTextImages(step.body, `project-instructions/${project.id}/steps`);
        if (body !== step.body) changed = true;
        return body !== step.body ? { ...step, body } : step;
      }));
      if (intro !== project.instructions.intro || steps.some((step, index) => step !== currentSteps[index])) {
        changed = true;
        nextProject = { ...nextProject, instructions: { ...project.instructions, intro, steps } };
      }
    }
    return nextProject;
  }));
  return changed ? { ...state, projects } : state;
}

function stateHasInlineDataImages(state) {
  const needsRepair = (html) => {
    const text = String(html || '');
    return /<img\b[^>]*src=["']data:image\//i.test(text)
      || (/<img\b[^>]*src=["']blob:/i.test(text) && /data-project-image-path=/i.test(text));
  };
  return (state.projects || []).some((project) => (
    needsRepair(project.notes)
    || projectNoteSheets(project).some((sheet) => needsRepair(sheet.content))
    || needsRepair(project.instructions?.intro)
    || (project.instructions?.steps || []).some((step) => needsRepair(step.body))
  ));
}

function textSelectionTarget(target) {
  return target?.closest?.('input, textarea, [contenteditable="true"]') || null;
}

function targetHasSelection(target) {
  if (!target) return false;
  if ('selectionStart' in target && 'selectionEnd' in target) return target.selectionStart !== target.selectionEnd;
  const selection = window.getSelection?.();
  return Boolean(selection && !selection.isCollapsed && selection.toString());
}

export default function App() {
  const [tab, setTab] = useState('projects');
  const [settingsSection, setSettingsSection] = useState('workspace');
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [loginName, setLoginName] = useState('admin');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loadBusy, setLoadBusy] = useState(true);
  const [stateBackups, setStateBackups] = useState([]);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreError, setRestoreError] = useState('');
  const [saveState, setSaveState] = useState('saved');
  const [connectionState, setConnectionState] = useState(isRemoteBuildBookClient() ? 'checking' : 'local');
  const [syncConflictSummary, setSyncConflictSummary] = useState(null);
  const [showConflictReview, setShowConflictReview] = useState(false);
  const [desktopNotice, setDesktopNotice] = useState('');
  const [remoteUnsaved, setRemoteUnsaved] = useState(false);
  const syncConfig = currentSyncConfig();
  const [bootstrapProgress, setBootstrapProgress] = useState(() => {
    if (!window.__TAURI_INTERNALS__) return null;
    return sessionStorage.getItem(SYNC_BOOTSTRAP_KEY)
      ? { stage: 'Connecting to host', detail: 'Loading notes and settings...', current: 0, total: 0, complete: false }
      : null;
  });
  const saveTimerRef = useRef(null);
  const saveSequenceRef = useRef(0);
  const saveChainRef = useRef(Promise.resolve());
  const stateRef = useRef(null);
  const saveStateRef = useRef('saved');
  const bootstrapStartedRef = useRef(false);
  const lastPersistedStateRef = useRef('');
  const selectionGuardRef = useRef({ source: null, x: 0, y: 0, block: false, timer: 0 });

  const persistedStateText = (value) => JSON.stringify(normalizeState(value), null, 2);

  const applyDesktopSyncStatus = (status = getLastSyncStatus()) => {
    if (!window.__TAURI_INTERNALS__) return;
    setConnectionState(status?.status || 'local');
  };

  const refreshConnectionStatus = async () => {
    if (window.__TAURI_INTERNALS__) {
      applyDesktopSyncStatus();
      return;
    }
    if (!isRemoteBuildBookClient()) {
      setConnectionState('local');
      return;
    }
    try {
      const status = await fetchWebAuthStatus();
      if (status.loginEnabled && status.loginRequired && !status.authenticated) {
        setConnectionState('login-required');
        return;
      }
      setConnectionState('connected');
    } catch (error) {
      setConnectionState('disconnected');
    }
  };

  const reloadState = async () => {
    setLoadBusy(true);
    setLoadError('');
    try {
      if (sessionStorage.getItem(SYNC_BOOTSTRAP_KEY)) {
        setBootstrapProgress({ stage: 'Syncing host data', detail: 'Loading notes, settings, and project records...', current: 0, total: 0, complete: false });
      }
      const loaded = await loadAppState();
      lastPersistedStateRef.current = persistedStateText(loaded);
      setState(loaded);
      setStateBackups([]);
      setRestoreError('');
      if (window.__TAURI_INTERNALS__) applyDesktopSyncStatus();
      else await refreshConnectionStatus();
    } catch (error) {
      setState(null);
      setLoadError(String(error?.message || error));
      listStateBackups().then(setStateBackups).catch(() => setStateBackups([]));
      if (isRemoteBuildBookClient()) {
        setConnectionState('disconnected');
      }
    } finally {
      setLoadBusy(false);
    }
  };

  const restoreFromStateBackup = async (fileName) => {
    setRestoreBusy(true);
    setRestoreError('');
    try {
      await restoreStateBackup(fileName);
      await reloadState();
    } catch (error) {
      setRestoreError(String(error?.message || error));
    } finally {
      setRestoreBusy(false);
    }
  };

  const restoreFromFullBackupFile = async (file) => {
    if (!file) return;
    setRestoreBusy(true);
    setRestoreError('');
    try {
      const restored = await readFullBackupPackage(file);
      await saveAppState(restored);
      lastPersistedStateRef.current = persistedStateText(restored);
      setState(restored);
      setLoadError('');
    } catch (error) {
      setRestoreError(String(error?.message || error));
    } finally {
      setRestoreBusy(false);
    }
  };

  const submitWebLogin = async () => {
    setLoginBusy(true);
    setLoginError('');
    try {
      await webLogin(loginName.trim() || 'admin', loginPassword);
      setLoginPassword('');
      await reloadState();
      await refreshConnectionStatus();
    } catch (error) {
      setLoginError(String(error?.message || error));
    } finally {
      setLoginBusy(false);
    }
  };

  useEffect(() => {
    const handleSyncStatus = (event) => applyDesktopSyncStatus(event.detail);
    window.addEventListener('buildbook-sync-status', handleSyncStatus);
    return () => window.removeEventListener('buildbook-sync-status', handleSyncStatus);
  }, []);

  useEffect(() => {
    const handleDesktopNotice = (event) => setDesktopNotice(String(event.detail?.message || ''));
    window.addEventListener('buildbook-desktop-notice', handleDesktopNotice);
    return () => window.removeEventListener('buildbook-desktop-notice', handleDesktopNotice);
  }, []);

  useEffect(() => {
    if (!window.__TAURI_INTERNALS__ || connectionState !== 'conflict') {
      setSyncConflictSummary(null);
      return undefined;
    }
    let active = true;
    readSyncConflictSummary()
      .then((summary) => {
        if (active) {
          setSyncConflictSummary(summary);
          setShowConflictReview(true);
        }
      })
      .catch(() => {
        if (active) {
          setSyncConflictSummary({ hasConflict: true, items: [] });
          setShowConflictReview(true);
        }
      });
    return () => {
      active = false;
    };
  }, [connectionState]);

  useEffect(() => {
    reloadState();
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    saveStateRef.current = saveState;
  }, [saveState]);

  useEffect(() => {
    if (!state) return;
    const theme = normalizeTheme(state.theme);
    Object.entries(THEME_CSS_VARS).forEach(([key, cssVar]) => {
      document.documentElement.style.setProperty(cssVar, theme[key]);
    });
  }, [state?.theme]);

  useEffect(() => () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
  }, []);

  const updateState = (recipe) => {
    setState((current) => {
      const next = normalizeState(typeof recipe === 'function' ? recipe(current) : recipe);
      const saveSequence = saveSequenceRef.current + 1;
      saveSequenceRef.current = saveSequence;
      saveStateRef.current = 'saving';
      setSaveState('saving');
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        saveChainRef.current = saveChainRef.current
          .catch(() => {})
          .then(() => saveAppState(next))
          .then(() => {
            if (saveSequenceRef.current === saveSequence) {
              applyDesktopSyncStatus();
              if (getLastSyncStatus()?.status === 'conflict') {
                const message = 'error: Sync conflict. Resolve before host sync can continue.';
                saveStateRef.current = message;
                setSaveState(message);
                setShowConflictReview(true);
                return;
              }
              lastPersistedStateRef.current = persistedStateText(next);
              saveStateRef.current = 'saved';
              setSaveState('saved');
              if (isRemoteBuildBookClient()) {
                setRemoteUnsaved(false);
                setConnectionState('connected');
              }
            }
          })
          .catch((error) => {
            console.error(error);
            if (saveSequenceRef.current === saveSequence) {
              const message = `error: ${String(error?.message || error).slice(0, 160)}`;
              saveStateRef.current = message;
              setSaveState(message);
              applyDesktopSyncStatus();
              if (window.__TAURI_INTERNALS__ && getLastSyncStatus()?.status === 'conflict') {
                setShowConflictReview(true);
              }
              if (isRemoteBuildBookClient()) {
                setRemoteUnsaved(true);
                setConnectionState('disconnected');
              }
            }
          });
      }, 450);
      return next;
    });
  };

  useEffect(() => {
    if (!state) return;
    if (isHostSyncClient()) {
      stopLanServer().catch(() => {});
      return;
    }
    const lan = state.lanServer || {};
    const webAuth = state.webAuth || DEFAULT_WEB_AUTH;
    const hostMode = syncConfig?.mode === 'host';
    const desiredPort = hostMode ? BUILDBOOK_SYNC_PORT : (lan.port || 8787);
    const browserEnabled = !hostMode || lan.enabled === true;
    const requireToken = hostMode && !lan.enabled ? true : lan.requireToken !== false;
    if (webAuth.enabled && !webAuth.sessionSecret) {
      updateState((current) => ({ ...current, webAuth: { ...(current.webAuth || DEFAULT_WEB_AUTH), sessionSecret: randomSecret() } }));
      return;
    }
    if ((lan.enabled || hostMode) && requireToken && !lan.token) {
      const token = crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      updateState((current) => ({ ...current, lanServer: { ...(current.lanServer || {}), token } }));
      return;
    }
    if ((lan.enabled || hostMode) && (lan.token || !requireToken)) {
      startLanServer(desiredPort, lan.token || '', requireToken, webAuth, browserEnabled).catch((error) => console.error(error));
      return;
    }
    stopLanServer().catch(() => {});
  }, [
    state?.lanServer?.enabled,
    state?.lanServer?.port,
    state?.lanServer?.token,
    state?.lanServer?.requireToken,
    state?.webAuth?.enabled,
    state?.webAuth?.scope,
    state?.webAuth?.username,
    state?.webAuth?.passwordSalt,
    state?.webAuth?.passwordHash,
    state?.webAuth?.sessionSecret,
    state?.webAuth?.rememberDays,
    syncConfig?.mode,
  ]);

  useEffect(() => {
    if (!state) return;
    setCloseToTray(state.closeToTray).catch((error) => console.error(error));
  }, [state?.closeToTray]);

  useEffect(() => {
    if (!remoteUnsaved) return undefined;
    const warnBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [remoteUnsaved]);

  useEffect(() => {
    if (!state || !isHostSyncClient() || !sessionStorage.getItem(SYNC_BOOTSTRAP_KEY) || bootstrapStartedRef.current) return undefined;
    bootstrapStartedRef.current = true;
    let cancelled = false;
    const cachePaths = async (label, paths) => {
      for (let index = 0; index < paths.length; index += 1) {
        if (cancelled) return;
        setBootstrapProgress({
          stage: label,
          detail: paths[index].split(/[\\/]/).pop() || paths[index],
          current: index + 1,
          total: paths.length,
          complete: false,
        });
        try {
          await readStoredFile(paths[index]);
        } catch {
          // Cache misses are non-fatal; the file can still be loaded on demand later.
        }
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    };
    const runBootstrap = async () => {
      const allPaths = collectReferencedPaths(state);
      const thumbnailPaths = allPaths.filter((path) => /thumb|thumbnail/i.test(path));
      const thumbnailSet = new Set(thumbnailPaths);
      const immediatePaths = allPaths
        .filter((path) => !thumbnailSet.has(path))
        .filter((path) => /\.(png|jpe?g|webp|gif|svg|txt|csv|json|md|pdf)$/i.test(path))
        .slice(0, 120);
      const immediateSet = new Set([...thumbnailPaths, ...immediatePaths]);
      const backgroundPaths = allPaths.filter((path) => !immediateSet.has(path));
      await cachePaths('Downloading thumbnails', thumbnailPaths);
      await cachePaths('Caching common files', immediatePaths);
      if (!cancelled && backgroundPaths.length) {
        setBootstrapProgress({
          stage: 'Caching larger files',
          detail: `${backgroundPaths.length} remaining files will cache in the background.`,
          current: 0,
          total: backgroundPaths.length,
          complete: false,
        });
        cachePaths('Caching larger files', backgroundPaths).then(() => {
          if (cancelled) return;
          sessionStorage.removeItem(SYNC_BOOTSTRAP_KEY);
          setBootstrapProgress({ stage: 'Client cache ready', detail: 'Host connection finished.', current: 1, total: 1, complete: true });
          window.setTimeout(() => setBootstrapProgress(null), 2500);
        });
        return;
      }
      if (!cancelled) {
        sessionStorage.removeItem(SYNC_BOOTSTRAP_KEY);
        setBootstrapProgress({ stage: 'Client cache ready', detail: 'Host connection finished.', current: 1, total: 1, complete: true });
        window.setTimeout(() => setBootstrapProgress(null), 2500);
      }
    };
    runBootstrap();
    return () => {
      cancelled = true;
    };
  }, [state]);

  useEffect(() => {
    if (!window.__TAURI_INTERNALS__ && !isRemoteBuildBookClient()) return undefined;
    const timer = window.setInterval(async () => {
      if (!stateRef.current || saveStateRef.current === 'saving') return;
      if (isRemoteBuildBookClient() && saveStateRef.current.startsWith('error')) {
        try {
          await refreshConnectionStatus();
        } catch {
          // Keep unsaved browser edits visible until the user retries or refreshes intentionally.
        }
        return;
      }
      try {
        await refreshConnectionStatus();
        const loaded = await loadAppState();
        const loadedText = persistedStateText(loaded);
        if (loadedText === lastPersistedStateRef.current) return;
        lastPersistedStateRef.current = loadedText;
        setState(loaded);
        setSaveState('saved');
      } catch (error) {
        console.error(error);
        if (isRemoteBuildBookClient()) {
          setConnectionState('disconnected');
        }
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!state || !stateHasInlineDataImages(state)) return;
    externalizeStateInlineDataImages(state)
      .then((nextState) => {
        if (nextState !== state) updateState(nextState);
      })
      .catch((error) => console.error(error));
  }, [state]);

  if (!state) {
    if (!loadError || loadBusy) {
      return (
        <div className="loading">
          <strong>{bootstrapProgress?.stage || 'Loading BuildBook...'}</strong>
          {bootstrapProgress?.detail && <span>{bootstrapProgress.detail}</span>}
        </div>
      );
    }
    return (
      <div className="access-gate">
        <section className="panel access-gate-panel">
          <h1>BuildBook Access</h1>
          <p>{loadError}</p>
          {loadError.includes('access code') && (
            <>
              <label>
                Access code
                <input value={accessCode} onChange={(event) => setAccessCode(event.target.value)} placeholder="Enter access code" />
              </label>
              <button
                onClick={() => {
                  localStorage.setItem('buildbook-lan-token', accessCode.trim());
                  reloadState();
                }}
                disabled={!accessCode.trim()}
              >
                Connect
              </button>
            </>
          )}
          {loadError.includes('login') && (
            <>
              <label>
                Username
                <input value={loginName} onChange={(event) => setLoginName(event.target.value)} placeholder="admin" autoComplete="username" />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && submitWebLogin()}
                  autoComplete="current-password"
                />
              </label>
              <button onClick={submitWebLogin} disabled={loginBusy || !loginPassword}>
                {loginBusy ? 'Logging in...' : 'Log In'}
              </button>
              {loginError && <p className="error-text">{loginError}</p>}
            </>
          )}
          {!loadError.includes('access code') && !loadError.includes('login') && (
            <>
              <div className="startup-recovery-actions">
                <button onClick={reloadState} disabled={restoreBusy}>Retry</button>
                <label className={`file-picker header-picker ${restoreBusy ? 'disabled-picker' : ''}`}>
                  Restore full backup
                  <input
                    type="file"
                    accept=".zip"
                    disabled={restoreBusy}
                    onChange={(event) => restoreFromFullBackupFile(event.target.files?.[0])}
                  />
                </label>
              </div>
              {stateBackups.length > 0 && (
                <div className="startup-backups">
                  <h2>Automatic JSON backups</h2>
                  {stateBackups.slice(0, 8).map((backup) => (
                    <div className="startup-backup-row" key={backup.fileName}>
                      <span>{backup.kind} - {new Date(Number(backup.modifiedMs)).toLocaleString()}</span>
                      <button className="secondary" onClick={() => restoreFromStateBackup(backup.fileName)} disabled={restoreBusy}>Restore</button>
                    </div>
                  ))}
                </div>
              )}
              {restoreBusy && <BusyNotice label="Restoring..." />}
              {restoreError && <p className="error-text">{restoreError}</p>}
            </>
          )}
        </section>
      </div>
    );
  }

  const handlePointerDownCapture = (event) => {
    const source = textSelectionTarget(event.target);
    selectionGuardRef.current = {
      source,
      x: event.clientX,
      y: event.clientY,
      block: false,
      timer: selectionGuardRef.current.timer,
    };
  };

  const handlePointerUpCapture = (event) => {
    const guard = selectionGuardRef.current;
    if (!guard.source) return;
    const moved = Math.hypot(event.clientX - guard.x, event.clientY - guard.y) > 5;
    if (!moved && !targetHasSelection(guard.source)) return;
    window.clearTimeout(guard.timer);
    selectionGuardRef.current = {
      ...guard,
      block: true,
      timer: window.setTimeout(() => {
        selectionGuardRef.current = { source: null, x: 0, y: 0, block: false, timer: 0 };
      }, 160),
    };
  };

  const handleClickCapture = (event) => {
    if (!selectionGuardRef.current.block) return;
    event.preventDefault();
    event.stopPropagation();
    selectionGuardRef.current = { source: null, x: 0, y: 0, block: false, timer: 0 };
  };

  const resolveDesktopConflict = async (choice) => {
    try {
      const result = await resolveSyncConflict(choice);
      const loaded = normalizeState(JSON.parse(result.contents));
      lastPersistedStateRef.current = persistedStateText(loaded);
      setState(loaded);
      setSaveState('saved');
      applyDesktopSyncStatus(result);
      setSyncConflictSummary(null);
      setShowConflictReview(false);
    } catch (error) {
      setConnectionState('conflict');
      setSaveState(`error: ${String(error?.message || error).slice(0, 160)}`);
      throw error;
    }
  };

  const resolveDesktopConflictSelections = async (selections) => {
    try {
      const result = await resolveSyncConflictSelections(selections);
      const loaded = normalizeState(JSON.parse(result.contents));
      lastPersistedStateRef.current = persistedStateText(loaded);
      setState(loaded);
      setSaveState('saved');
      applyDesktopSyncStatus(result);
      setSyncConflictSummary(null);
      setShowConflictReview(false);
    } catch (error) {
      setConnectionState('conflict');
      setSaveState(`error: ${String(error?.message || error).slice(0, 160)}`);
      throw error;
    }
  };

  const connectionLabel = connectionState === 'login-required' ? 'Login required'
    : connectionState === 'disconnected' ? 'Disconnected'
      : connectionState === 'connected' ? 'Connected'
        : connectionState === 'offline' ? 'Offline'
          : connectionState === 'conflict' ? 'Conflict'
            : connectionState === 'host' ? 'Host'
              : connectionState === 'local' ? ''
                : 'Checking';
  const saveLabel = saveState.startsWith('error') ? saveState : saveState.charAt(0).toUpperCase() + saveState.slice(1);

  return (
    <ConfirmProvider>
    <div className="app" onPointerDownCapture={handlePointerDownCapture} onPointerUpCapture={handlePointerUpCapture} onClickCapture={handleClickCapture}>
      <aside className="sidebar">
        <div className="brand">
          <strong>BuildBook</strong>
          <span>v{APP_VERSION}</span>
        </div>
        {TABS.map(([key, label, type]) => (
          <button key={key} className={`${tab === key ? 'active' : ''} ${type === 'child' ? 'sub-nav' : ''}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
        {tab === 'settings' && SETTINGS_SECTIONS.map(([key, label]) => (
          <button
            key={key}
            className={`settings-sub-nav ${settingsSection === key ? 'active' : ''}`}
            onClick={() => setSettingsSection(key)}
          >
            {label}
          </button>
        ))}
        <div className={`sidebar-status ${connectionState === 'local' ? 'local-status' : ''}`}>
          {connectionState !== 'local' && <span className={`connection-state connection-${connectionState}`}>{connectionLabel}</span>}
          <span className={`save-state ${saveState.startsWith('error') ? 'error' : saveState}`}>
            {connectionState !== 'local' && ' - '}
            {saveLabel}
          </span>
        </div>
      </aside>
      <main className="workspace">
        {showConflictReview && (
          <SyncConflictReviewModal
            summary={syncConflictSummary}
            onCancel={() => setShowConflictReview(false)}
            onResolveAll={resolveDesktopConflict}
            onResolve={resolveDesktopConflictSelections}
          />
        )}
        {bootstrapProgress && (
          <div className={`sync-bootstrap ${bootstrapProgress.complete ? 'complete' : ''}`}>
            <div>
              <strong>{bootstrapProgress.stage}</strong>
              <span>{bootstrapProgress.detail}</span>
            </div>
            {bootstrapProgress.total > 0 && (
              <progress value={bootstrapProgress.current} max={bootstrapProgress.total} />
            )}
          </div>
        )}
        {desktopNotice && (
          <div className="workspace-notice">
            <span>{desktopNotice}</span>
            <button className="ghost" onClick={() => setDesktopNotice('')}>Dismiss</button>
          </div>
        )}
        {tab === 'projects' && <Projects state={state} updateState={updateState} />}
        {tab === 'completed-projects' && <Projects state={state} updateState={updateState} initialFilter="completed" lockedFilter />}
        {tab === 'parts' && <Parts state={state} updateState={updateState} />}
        {tab === 'search' && <Search state={state} setTab={setTab} />}
        {tab === 'imports' && <Imports state={state} updateState={updateState} />}
        {tab === 'settings' && <Settings state={state} updateState={updateState} activeSection={settingsSection} />}
      </main>
    </div>
    </ConfirmProvider>
  );
}
