import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { relaunch } from '@tauri-apps/plugin-process';
import { check as checkForTauriUpdate } from '@tauri-apps/plugin-updater';
import { APP_VERSION, DEFAULT_STATE, DEFAULT_THEME, DEFAULT_WEB_AUTH, makeId, normalizeState } from './data';
import { clearSyncCheckout, cleanupOrphanedFiles, deleteManagedFiles, discoverBuildBookHosts, downloadBytes, generateSyncPairingCode, isHostSyncClient, lanServerStatus, openExternalUrl, openStoredFile, pairBuildBookHost, readSyncConfig, readSyncStatusDashboard, readStoredFile, revokePairedDevice, resetManagedStorage, scanStorage, startLanServer, stopLanServer, writeSyncConfig } from './desktop';
import { buildFullBackupPackage, buildWebFullBackupPackage, readFullBackupPackage } from './compatibilityBackup';
import { collectReferencedPaths } from './stateReferences';
import { isRemoteBuildBookClient, webLogout } from './storage';
import { cssColor, normalizeTheme, themeExportBytes, validHexColor } from './theme';
import { GITHUB_LATEST_RELEASE_API, GITHUB_REPOSITORY_URL, appReleaseChannel, fetchReleaseSummary, isNewerVersion } from './update';
import ThemeEditorModal from './ThemeEditorModal';
import TemplatePreviewModal from './TemplatePreviewModal';
import { useAppConfirm } from './ConfirmDialog';
import { BusyNotice, Header } from './sharedUi';
import { normalizeRevisionSettings, projectTrackedStorageRows } from './revisionHelpers';

const SYNC_BOOTSTRAP_KEY = 'buildbook-sync-bootstrap';
const BUILDBOOK_SYNC_PORT = 8788;

function compactBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function randomSecret() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  const values = new Uint8Array(16);
  crypto?.getRandomValues?.(values);
  return values.length ? [...values].map((byte) => byte.toString(16).padStart(2, '0')).join('') : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function pbkdf2Hex(password, salt, iterations) {
  if (!crypto?.subtle) return sha256Hex(`${salt}\0${password}`);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations },
    key,
    256,
  );
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashWebPassword(password, salt = randomSecret()) {
  const iterations = DEFAULT_WEB_AUTH.passwordIterations;
  return {
    passwordSalt: salt,
    passwordHash: await pbkdf2Hex(password, salt, iterations),
    passwordAlgorithm: 'pbkdf2-sha256',
    passwordIterations: iterations,
  };
}

export default function Settings({ state, updateState, activeSection = 'workspace' }) {
  const confirm = useAppConfirm();
  const remoteClient = isRemoteBuildBookClient();
  const hostSyncClient = isHostSyncClient();
  const [showTemplatePreview, setShowTemplatePreview] = useState(false);
  const [showThemeEditor, setShowThemeEditor] = useState(false);
  const [showRevisionSettings, setShowRevisionSettings] = useState(false);
  const [restoreError, setRestoreError] = useState('');
  const [backupNotice, setBackupNotice] = useState('');
  const [backupExportBusy, setBackupExportBusy] = useState(false);
  const [backupRestoreBusy, setBackupRestoreBusy] = useState(false);
  const [lanNotice, setLanNotice] = useState('');
  const [lanError, setLanError] = useState('');
  const [lanBusy, setLanBusy] = useState(false);
  const [lanQr, setLanQr] = useState('');
  const [lanAccessUrl, setLanAccessUrl] = useState('');
  const [storageScan, setStorageScan] = useState(null);
  const [storageBusy, setStorageBusy] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [selectedOrphans, setSelectedOrphans] = useState(new Set());
  const [showFullReset, setShowFullReset] = useState(false);
  const [resetPhrase, setResetPhrase] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState('');
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateNotice, setUpdateNotice] = useState('');
  const [updateError, setUpdateError] = useState('');
  const [availableReleaseUrl, setAvailableReleaseUrl] = useState('');
  const [availableUpdate, setAvailableUpdate] = useState(null);
  const [updateProgress, setUpdateProgress] = useState('');
  const [webPassword, setWebPassword] = useState('');
  const [webPasswordConfirm, setWebPasswordConfirm] = useState('');
  const [webAuthNotice, setWebAuthNotice] = useState('');
  const [webAuthError, setWebAuthError] = useState('');
  const [syncConfig, setSyncConfig] = useState(null);
  const [syncDeviceName, setSyncDeviceName] = useState('');
  const [syncHostUrl, setSyncHostUrl] = useState('');
  const [syncPairingCode, setSyncPairingCode] = useState('');
  const [syncHosts, setSyncHosts] = useState([]);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncNotice, setSyncNotice] = useState('');
  const [syncError, setSyncError] = useState('');
  const [syncDashboard, setSyncDashboard] = useState(null);
  const [syncPrefetchProgress, setSyncPrefetchProgress] = useState('');
  const syncClientMode = syncConfig?.mode === 'client';
  const syncHostMode = syncConfig?.mode === 'host';
  const networkControlledByHost = remoteClient || hostSyncClient || syncClientMode;
  const syncClientNeedsRepair = syncClientMode && Boolean(syncDashboard?.lastSyncError);

  const updateTemplate = (patch) => {
    updateState((current) => ({ ...current, template: { ...current.template, ...patch } }));
  };

  const updateLanServer = (patch) => {
    updateState((current) => ({ ...current, lanServer: { ...(current.lanServer || {}), ...patch } }));
  };

  const updateWebAuth = (patch) => {
    updateState((current) => ({ ...current, webAuth: { ...(current.webAuth || DEFAULT_WEB_AUTH), ...patch } }));
  };

  const updateTheme = (theme) => {
    updateState((current) => ({ ...current, theme: normalizeTheme(theme) }));
  };

  const updateRevisionSettings = (revisionSettings) => {
    updateState((current) => ({ ...current, revisionSettings: normalizeRevisionSettings(revisionSettings) }));
  };

  useEffect(() => {
    if (remoteClient) return;
    readSyncConfig()
      .then((config) => {
        setSyncConfig(config);
        setSyncDeviceName(config.deviceName || '');
        setSyncHostUrl(config.hostUrl || '');
        setSyncPairingCode('');
      })
      .catch((error) => setSyncError(String(error)));
  }, [remoteClient]);

  useEffect(() => {
    if (remoteClient) return undefined;
    let active = true;
    const loadDashboard = async () => {
      try {
        const dashboard = await readSyncStatusDashboard();
        if (active) setSyncDashboard(dashboard);
      } catch {
        if (active) setSyncDashboard(null);
      }
    };
    loadDashboard();
    const timer = window.setInterval(loadDashboard, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [remoteClient, syncConfig?.mode, syncConfig?.pairedDevices?.length, syncConfig?.pairingCodeExpiresAt]);

  const saveDeviceName = async () => {
    if (!syncConfig || !syncDeviceName.trim()) return;
    setSyncBusy(true);
    setSyncError('');
    try {
      const saved = await writeSyncConfig({ ...syncConfig, deviceName: syncDeviceName.trim() });
      setSyncConfig(saved);
      readSyncStatusDashboard().then(setSyncDashboard).catch(() => {});
      setSyncNotice('Device name saved.');
    } catch (error) {
      setSyncError(String(error));
    } finally {
      setSyncBusy(false);
    }
  };

  const createHostFromThisComputer = async () => {
    if (!syncConfig) return;
    const confirmed = await confirm({
      title: 'Create host',
      message: 'Make this computer the authoritative BuildBook host using its current projects, parts, settings, and files?',
      confirmLabel: 'Create Host',
    });
    if (!confirmed) return;
    setSyncBusy(true);
    setSyncError('');
    setSyncNotice('');
    try {
      const saved = await writeSyncConfig({
        ...syncConfig,
        mode: 'host',
        deviceName: syncDeviceName.trim() || syncConfig.deviceName,
        hostUrl: '',
        hostToken: '',
        clientAuthToken: '',
        hostRevision: '',
        pendingSync: false,
        lastConnectedAt: 0,
        lastSyncError: '',
      });
      setSyncConfig(saved);
      readSyncStatusDashboard().then(setSyncDashboard).catch(() => {});
      updateLanServer({
        port: BUILDBOOK_SYNC_PORT,
        requireToken: state.lanServer?.requireToken !== false,
        token: state.lanServer?.token || (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`),
      });
      setSyncNotice(`This computer is now the BuildBook host. Sync runs on port ${BUILDBOOK_SYNC_PORT}.`);
    } catch (error) {
      setSyncError(String(error));
    } finally {
      setSyncBusy(false);
    }
  };

  const discoverHosts = async () => {
    setSyncBusy(true);
    setSyncError('');
    setSyncNotice('');
    try {
      const primaryPort = state.lanServer?.port || 8787;
      const ports = [...new Set([BUILDBOOK_SYNC_PORT, primaryPort, 8787])];
      const hostGroups = await Promise.all(ports.map((port) => discoverBuildBookHosts(port).catch(() => [])));
      const hosts = hostGroups
        .flat()
        .filter((host) => host.deviceId !== syncConfig?.deviceId)
        .filter((host, index, list) => list.findIndex((item) => item.deviceId === host.deviceId) === index);
      setSyncHosts(hosts);
      setSyncNotice(hosts.length ? `Found ${hosts.length} BuildBook host${hosts.length === 1 ? '' : 's'}.` : 'No BuildBook hosts were found on this network.');
    } catch (error) {
      setSyncError(String(error));
    } finally {
      setSyncBusy(false);
    }
  };

  const generatePairingCode = async () => {
    setSyncBusy(true);
    setSyncError('');
    setSyncNotice('');
    try {
      const saved = await generateSyncPairingCode();
      setSyncConfig(saved);
      readSyncStatusDashboard().then(setSyncDashboard).catch(() => {});
      setSyncNotice(`Pairing code: ${saved.pairingCode}. It expires in 10 minutes.`);
    } catch (error) {
      setSyncError(String(error));
    } finally {
      setSyncBusy(false);
    }
  };

  const revokeDevice = async (deviceId) => {
    const confirmed = await confirm({
      title: 'Revoke device',
      message: 'Revoke this computer from host sync?',
      confirmLabel: 'Revoke',
      danger: true,
    });
    if (!confirmed) return;
    setSyncBusy(true);
    setSyncError('');
    try {
      const saved = await revokePairedDevice(deviceId);
      setSyncConfig(saved);
      readSyncStatusDashboard().then(setSyncDashboard).catch(() => {});
      setSyncNotice('Device revoked.');
    } catch (error) {
      setSyncError(String(error));
    } finally {
      setSyncBusy(false);
    }
  };

  const refreshSyncDashboard = async () => {
    setSyncError('');
    try {
      const dashboard = await readSyncStatusDashboard();
      setSyncDashboard(dashboard);
      setSyncNotice('Sync dashboard refreshed.');
    } catch (error) {
      setSyncError(String(error));
    }
  };

  const clearCheckout = async (path) => {
    const confirmed = await confirm({
      title: 'Clear checkout',
      message: 'Clear this file checkout? Only do this if the other computer is no longer editing it.',
      confirmLabel: 'Clear',
      danger: true,
    });
    if (!confirmed) return;
    setSyncBusy(true);
    setSyncError('');
    try {
      await clearSyncCheckout(path);
      const dashboard = await readSyncStatusDashboard();
      setSyncDashboard(dashboard);
      setSyncNotice('File checkout cleared.');
    } catch (error) {
      setSyncError(String(error));
    } finally {
      setSyncBusy(false);
    }
  };

  const connectToHost = async () => {
    if (!syncConfig || !syncHostUrl.trim()) return;
    if (!syncPairingCode.trim()) {
      setSyncError('Enter the pairing code from the host computer.');
      return;
    }
    const confirmed = await confirm({
      title: 'Connect to host',
      message: 'Use this host as the authoritative BuildBook source? This computer will keep a local cache, but its current standalone data will not be merged or uploaded.',
      confirmLabel: 'Connect',
    });
    if (!confirmed) return;
    setSyncBusy(true);
    setSyncError('');
    setSyncNotice('');
    try {
      const paired = await pairBuildBookHost(syncHostUrl, syncPairingCode.trim());
      const info = paired.host;
      const clientAuthToken = paired.deviceToken;
      if (!info.hostingEnabled) {
        throw new Error(`${info.deviceName || 'That computer'} is serving BuildBook, but it has not been configured as an authoritative host.`);
      }
      const saved = await writeSyncConfig({
        ...syncConfig,
        mode: 'client',
        deviceName: syncDeviceName.trim() || syncConfig.deviceName,
        hostUrl: info.url,
        hostToken: '',
        clientAuthToken,
        hostRevision: '',
        pendingSync: false,
        lastConnectedAt: 0,
        lastSyncError: '',
      });
      setSyncConfig(saved);
      readSyncStatusDashboard().then(setSyncDashboard).catch(() => {});
      setSyncHostUrl(info.url);
      setSyncPairingCode('');
      setSyncNotice(`Connected to ${info.deviceName}. Loading host data...`);
      sessionStorage.setItem(SYNC_BOOTSTRAP_KEY, '1');
      window.setTimeout(() => window.location.reload(), 250);
    } catch (error) {
      setSyncError(String(error));
    } finally {
      setSyncBusy(false);
    }
  };

  const returnToLocalMode = async () => {
    if (!syncConfig) return;
    setSyncBusy(true);
    setSyncError('');
    try {
      const saved = await writeSyncConfig({
        ...syncConfig,
        mode: 'local',
        hostUrl: '',
        hostToken: '',
        clientAuthToken: '',
        hostRevision: '',
        pendingSync: false,
        lastConnectedAt: 0,
        lastSyncError: '',
      });
      setSyncConfig(saved);
      readSyncStatusDashboard().then(setSyncDashboard).catch(() => {});
      setSyncHostUrl('');
      setSyncPairingCode('');
      setSyncHosts([]);
      setSyncNotice('This computer is using its standalone local data.');
    } catch (error) {
      setSyncError(String(error));
    } finally {
      setSyncBusy(false);
    }
  };

  const prefetchClientCache = async () => {
    const paths = [...collectReferencedPaths(state)]
      .filter((path) => typeof path === 'string' && path.trim())
      .slice(0, 500);
    if (!paths.length) {
      setSyncNotice('No project files are available to cache.');
      return;
    }
    setSyncBusy(true);
    setSyncError('');
    setSyncNotice('');
    try {
      let cached = 0;
      let failed = 0;
      for (let index = 0; index < paths.length; index += 1) {
        setSyncPrefetchProgress(`Caching ${index + 1} of ${paths.length}`);
        try {
          await readStoredFile(paths[index]);
          cached += 1;
        } catch {
          failed += 1;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      setSyncNotice(`Client cache updated. Cached ${cached} file${cached === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}.`);
    } catch (error) {
      setSyncError(String(error));
    } finally {
      setSyncBusy(false);
      setSyncPrefetchProgress('');
    }
  };

  const exportTheme = () => {
    downloadBytes(
      `buildbook-theme-v${APP_VERSION}.json`,
      themeExportBytes(state.theme),
      'application/json',
    );
  };

  const regenerateLanToken = () => {
    const token = crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    updateLanServer({ token });
  };

  const toggleLanServer = () => {
    if (state.lanServer?.enabled) {
      updateLanServer({ enabled: false });
      return;
    }
    updateLanServer({
      enabled: true,
      requireToken: state.lanServer?.requireToken !== false,
      token: state.lanServer?.token || (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    });
  };

  const saveWebPassword = async () => {
    setWebAuthError('');
    setWebAuthNotice('');
    if (webPassword.length < 8) {
      setWebAuthError('Use at least 8 characters for the admin password.');
      return;
    }
    if (webPassword !== webPasswordConfirm) {
      setWebAuthError('Password confirmation does not match.');
      return;
    }
    try {
      const hashed = await hashWebPassword(webPassword);
      updateWebAuth({ ...hashed, sessionSecret: randomSecret() });
      setWebPassword('');
      setWebPasswordConfirm('');
      setWebAuthNotice('Admin password saved.');
    } catch (error) {
      setWebAuthError(String(error?.message || error));
    }
  };

  const setWebLoginEnabled = (enabled) => {
    setWebAuthError('');
    setWebAuthNotice('');
    if (enabled && !state.webAuth?.passwordHash) {
      setWebAuthError('Set an admin password before enabling web login.');
      return;
    }
    updateWebAuth({ enabled, sessionSecret: state.webAuth?.sessionSecret || randomSecret() });
  };

  const logoutWebSession = async () => {
    setWebAuthError('');
    try {
      await webLogout();
      window.location.reload();
    } catch (error) {
      setWebAuthError(String(error?.message || error));
    }
  };

  useEffect(() => {
    let active = true;
    const syncLanServer = async () => {
      setLanBusy(true);
      setLanError('');
      try {
        const hostMode = syncConfig?.mode === 'host';
        const desiredPort = hostMode ? BUILDBOOK_SYNC_PORT : (state.lanServer?.port || 8787);
        const browserEnabled = !hostMode || state.lanServer?.enabled === true;
        const requireToken = hostMode && !state.lanServer?.enabled ? true : state.lanServer?.requireToken !== false;
        if ((state.lanServer?.enabled || hostMode) && requireToken && !state.lanServer?.token) {
          updateLanServer({ token: crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}` });
          return;
        }
        if (networkControlledByHost) {
          const token = state.lanServer?.token || '';
          const hostUrl = syncConfig?.hostUrl || '';
          const hostAccessEnabled = state.lanServer?.enabled === true;
          const accessUrl = hostAccessEnabled && hostUrl ? (requireToken && token ? `${hostUrl}?access=${encodeURIComponent(token)}` : hostUrl) : '';
          const qr = accessUrl ? await QRCode.toDataURL(accessUrl, { margin: 1, width: 180, color: { dark: '#0d1117', light: '#ffffff' } }) : '';
          if (active) {
            setLanNotice(accessUrl ? `LAN server running at ${hostUrl}` : '');
            setLanAccessUrl(accessUrl);
            setLanQr(qr);
          }
          return;
        }
        if (state.lanServer?.enabled || hostMode) {
          const token = state.lanServer?.token || '';
          const info = await startLanServer(desiredPort, token || '', requireToken, state.webAuth || DEFAULT_WEB_AUTH, browserEnabled);
          const showBrowserAccess = state.lanServer?.enabled === true;
          const accessUrl = showBrowserAccess && info.url ? (requireToken ? `${info.url}?access=${encodeURIComponent(token)}` : info.url) : '';
          const qr = accessUrl ? await QRCode.toDataURL(accessUrl, { margin: 1, width: 180, color: { dark: '#0d1117', light: '#ffffff' } }) : '';
          if (active) {
            setLanNotice(info.url ? `${hostMode ? 'Sync host' : 'LAN server'} running at ${info.url}` : `${hostMode ? 'Sync host' : 'LAN server'} running.`);
            setLanAccessUrl(accessUrl);
            setLanQr(qr);
          }
        } else {
          const status = await lanServerStatus();
          if (status.running) await stopLanServer();
          if (active) {
            setLanNotice('');
            setLanAccessUrl('');
            setLanQr('');
          }
        }
      } catch (error) {
        if (active) setLanError(String(error));
      } finally {
        if (active) setLanBusy(false);
      }
    };
    syncLanServer();
    return () => { active = false; };
  }, [
    state.lanServer?.enabled,
    state.lanServer?.port,
    state.lanServer?.token,
    state.lanServer?.requireToken,
    networkControlledByHost,
    syncConfig?.mode,
    syncConfig?.hostUrl,
    state.webAuth?.enabled,
    state.webAuth?.scope,
    state.webAuth?.username,
    state.webAuth?.passwordHash,
    state.webAuth?.sessionSecret,
    state.webAuth?.rememberDays,
  ]);

  const exportBackup = async () => {
    setBackupExportBusy(true);
    setRestoreError('');
    setBackupNotice('');
    try {
      const bytes = await buildWebFullBackupPackage(state);
      downloadBytes(`buildbook-full-backup-v${APP_VERSION}.zip`, bytes, 'application/zip');
      setBackupNotice('Full backup exported successfully.');
    } catch (error) {
      setRestoreError(String(error));
    } finally {
      setBackupExportBusy(false);
    }
  };

  const restoreBackup = async (file) => {
    if (!file) return;
    const confirmed = await confirm({
      title: 'Restore backup',
      message: 'Restore will replace all current BuildBook data with this backup, including projects, parts, files, images, documents, imports, and settings. Continue?',
      confirmLabel: 'Restore',
      danger: true,
    });
    if (!confirmed) return;
    setBackupRestoreBusy(true);
    setRestoreError('');
    setBackupNotice('');
    try {
      const restored = file.name.toLowerCase().endsWith('.zip')
        ? await readFullBackupPackage(file)
        : normalizeState(JSON.parse(await file.text()), { preserveImportedCategories: true });
      updateState(() => restored);
      setBackupNotice('Backup restored successfully.');
    } catch (error) {
      setRestoreError(String(error));
    } finally {
      setBackupRestoreBusy(false);
    }
  };

  const runStorageScan = async () => {
    setStorageBusy(true);
    setStorageError('');
    try {
      const scan = await scanStorage(collectReferencedPaths(state));
      setStorageScan(scan);
      setSelectedOrphans(new Set((scan.orphans || []).slice(0, 80).map((file) => file.path)));
    } catch (error) {
      setStorageError(String(error));
    } finally {
      setStorageBusy(false);
    }
  };

  const runStorageCleanup = async () => {
    const deletePaths = [...selectedOrphans];
    if (!deletePaths.length) return;
    const confirmed = await confirm({
      title: 'Delete selected files',
      message: `Delete ${deletePaths.length} selected unreferenced stored files?`,
      confirmLabel: 'Delete Selected',
      danger: true,
    });
    if (!confirmed) return;
    setStorageBusy(true);
    setStorageError('');
    try {
      const scan = await cleanupOrphanedFiles(collectReferencedPaths(state), deletePaths);
      setStorageScan(scan);
      setSelectedOrphans(new Set((scan.orphans || []).slice(0, 80).map((file) => file.path)));
    } catch (error) {
      setStorageError(String(error));
    } finally {
      setStorageBusy(false);
    }
  };

  const runFullStorageCleanup = async () => {
    const deletePaths = (storageScan?.orphans || []).map((file) => file.path);
    if (!deletePaths.length) return;
    const confirmed = await confirm({
      title: 'Delete all orphaned files',
      message: `Delete all ${deletePaths.length} orphaned stored files? This cannot be undone.`,
      confirmLabel: 'Delete All',
      danger: true,
    });
    if (!confirmed) return;
    setStorageBusy(true);
    setStorageError('');
    try {
      const scan = await cleanupOrphanedFiles(collectReferencedPaths(state), deletePaths);
      setStorageScan(scan);
      setSelectedOrphans(new Set());
    } catch (error) {
      setStorageError(String(error));
    } finally {
      setStorageBusy(false);
    }
  };

  const runFullReset = async () => {
    if (resetPhrase.trim() !== 'delete all') return;
    setResetBusy(true);
    setResetError('');
    try {
      const resetResult = await resetManagedStorage();
      updateState(() => normalizeState(JSON.parse(JSON.stringify(DEFAULT_STATE))));
      setStorageScan(null);
      setSelectedOrphans(new Set());
      const retainedCount = resetResult?.retainedFiles?.length || 0;
      setBackupNotice(retainedCount
        ? `BuildBook has been reset. ${retainedCount} file${retainedCount === 1 ? '' : 's'} still in use could not be deleted; close other programs and run storage cleanup later.`
        : 'BuildBook has been reset to first-install defaults.');
      setShowFullReset(false);
      setResetPhrase('');
    } catch (error) {
      setResetError(String(error));
    } finally {
      setResetBusy(false);
    }
  };

  const checkForUpdates = async () => {
    setUpdateBusy(true);
    setUpdateNotice('');
    setUpdateError('');
    setAvailableReleaseUrl('');
    setAvailableUpdate(null);
    setUpdateProgress('');
    try {
      const channel = appReleaseChannel();
      let releaseSummary = null;
      try {
        releaseSummary = await fetchReleaseSummary();
      } catch {
        releaseSummary = null;
      }
      const latestLive = releaseSummary?.live?.tag_name || '';
      const liveReference = latestLive ? ` Latest live: ${latestLive}.` : '';
      if (window.__TAURI_INTERNALS__) {
        const update = await checkForTauriUpdate();
        const release = channel === 'test' ? releaseSummary?.test : releaseSummary?.live;
        const latestVersion = release?.tag_name || release?.name || '';
        if (update) {
          setAvailableUpdate(update);
          setAvailableReleaseUrl(GITHUB_REPOSITORY_URL);
          setUpdateNotice(`${channel === 'test' ? 'Test update' : 'Update'} available: v${update.version}. Installed: v${APP_VERSION}.${liveReference}`);
        } else if (latestVersion && isNewerVersion(latestVersion, APP_VERSION)) {
          setAvailableReleaseUrl(release?.html_url || GITHUB_REPOSITORY_URL);
          setUpdateNotice(`${channel === 'test' ? 'Test update' : 'Update'} available: ${latestVersion}. Installed: v${APP_VERSION}. Installer metadata is not available yet; open the release page to install manually.${liveReference}`);
        } else {
          setUpdateNotice(`BuildBook ${channel} channel is up to date. Installed: v${APP_VERSION}.${liveReference}`);
        }
        return;
      }
      let release = channel === 'test' ? releaseSummary?.test : releaseSummary?.live;
      if (!release && channel === 'live') {
        const response = await fetch(GITHUB_LATEST_RELEASE_API, {
          headers: { Accept: 'application/vnd.github+json' },
        });
        if (response.status !== 404) {
          if (!response.ok) throw new Error(`Could not check updates. GitHub returned ${response.status}.`);
          release = await response.json();
        }
      }
      if (!release) {
        setUpdateNotice('No published BuildBook releases found yet.');
        return;
      }
      const latestVersion = release.tag_name || release.name || '';
      if (isNewerVersion(latestVersion, APP_VERSION)) {
        setUpdateNotice(`${channel === 'test' ? 'Test update' : 'Update'} available: ${latestVersion}. Installed: v${APP_VERSION}.${liveReference}`);
        setAvailableReleaseUrl(GITHUB_REPOSITORY_URL);
      } else {
        setUpdateNotice(`BuildBook ${channel} channel is up to date. Installed: v${APP_VERSION}.${liveReference}`);
      }
    } catch (error) {
      setUpdateError(String(error));
    } finally {
      setUpdateBusy(false);
    }
  };

  const installUpdate = async () => {
    if (!availableUpdate) return;
    setUpdateBusy(true);
    setUpdateError('');
    setUpdateProgress('Preparing update download...');
    try {
      let received = 0;
      let total = 0;
      await availableUpdate.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength || 0;
          setUpdateProgress('Downloading update...');
        } else if (event.event === 'Progress') {
          received += event.data.chunkLength || 0;
          const percent = total ? Math.min(100, Math.round((received / total) * 100)) : 0;
          setUpdateProgress(total ? `Downloading update... ${percent}%` : 'Downloading update...');
        } else if (event.event === 'Finished') {
          setUpdateProgress('Installing update...');
        }
      });
      setUpdateNotice('Update installed. Restarting BuildBook...');
      await relaunch();
    } catch (error) {
      setUpdateProgress('');
      setUpdateError(String(error));
    } finally {
      setUpdateBusy(false);
    }
  };

  const toggleOrphan = (path) => {
    setSelectedOrphans((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="settings-page">
      <Header title="Settings" subtitle="Manage workspace defaults, appearance, and system preferences." />
      {activeSection === 'workspace' && (
        <>
      <section className="panel settings-section">
        <div className="settings-section-row">
          <div className="settings-copy">
            <h2>Project Template</h2>
            <p>Configure default tabs, step tags, and checklist starters for new projects.</p>
          </div>
          <div className="settings-actions">
            <button className="secondary" onClick={() => setShowTemplatePreview(true)}>Edit Template</button>
          </div>
        </div>
      </section>
      <section className="panel settings-section">
        <div className="settings-section-row">
          <div className="settings-copy">
            <h2>Tracked Files Settings</h2>
            <p>Configure tracked file types, revision retention, linked-file snapshots, and timing.</p>
          </div>
          <div className="settings-actions">
            <button className="secondary" onClick={() => setShowRevisionSettings(true)}>Open Editor</button>
          </div>
        </div>
      </section>
      <section className="panel settings-section">
        <div className="settings-section-row">
          <div className="settings-copy">
            <h2>Color Theme</h2>
            <p>Adjust colors, preview theme tokens, or export a portable theme file.</p>
          </div>
          <div className="settings-actions">
            <button className="secondary" onClick={exportTheme}>Export</button>
            <button className="secondary" onClick={() => setShowThemeEditor(true)}>Open Editor</button>
          </div>
        </div>
      </section>
        </>
      )}
      {activeSection === 'maintenance' && (
        <>
      <section className="panel settings-section">
        <div className="settings-section-row">
          <div className="settings-copy">
            <h2>Software Updates</h2>
            <p>Check GitHub Releases for a newer BuildBook installer.</p>
          </div>
          <div className="settings-actions">
            <button className="secondary" onClick={checkForUpdates} disabled={updateBusy}>{updateBusy ? 'Checking...' : 'Check for Updates'}</button>
            {availableUpdate && <button onClick={installUpdate} disabled={updateBusy}>Install Update</button>}
            {availableReleaseUrl && <button className="secondary" onClick={() => openExternalUrl(availableReleaseUrl)}>Open Repo Page</button>}
          </div>
        </div>
        {updateBusy && <BusyNotice label={updateProgress || 'Checking for updates...'} />}
        {updateNotice && <p className="success-text">{updateNotice}</p>}
        {updateError && <p className="error-text">{updateError}</p>}
      </section>
      <section className="panel settings-section">
        <div className="settings-section-row">
          <div className="settings-copy">
            <h2>Backup and Restore</h2>
            <p>Export a portable zip of project data and assets, or restore from a prior backup.</p>
          </div>
          <div className="settings-actions">
            <label className={`file-picker header-picker settings-file-action ${backupExportBusy || backupRestoreBusy ? 'disabled-picker' : ''}`}>
              <input
                type="file"
                accept=".zip,.json"
                disabled={backupExportBusy || backupRestoreBusy}
                onChange={(event) => {
                  restoreBackup(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              {backupRestoreBusy ? 'Restoring...' : 'Restore'}
            </label>
            <button className="secondary" onClick={exportBackup} disabled={backupExportBusy || backupRestoreBusy}>{backupExportBusy ? 'Exporting...' : 'Export Backup'}</button>
          </div>
        </div>
        {backupRestoreBusy && <BusyNotice label="Restoring backup..." />}
        {backupNotice && <p className="success-text">{backupNotice}</p>}
        {restoreError && <p className="error-text">{restoreError}</p>}
      </section>
      <section className="panel settings-section">
        <div className="settings-section-row">
          <div className="settings-copy">
            <h2>Storage Cleanup</h2>
            <p>Find orphaned files and thumbnails no longer referenced by any project.</p>
          </div>
          <div className="settings-actions">
            <button
              className="secondary"
              onClick={runStorageScan}
              disabled={storageBusy || hostSyncClient}
              title={hostSyncClient ? 'This setting is only editable on the host computer.' : undefined}
            >
              {storageBusy ? 'Working...' : 'Scan Storage'}
            </button>
            {storageScan && <button onClick={runStorageCleanup} disabled={storageBusy || !selectedOrphans.size}>Delete Selected</button>}
            {storageScan && <button className="danger-fill" onClick={runFullStorageCleanup} disabled={storageBusy || !storageScan.orphans?.length}>Delete All Orphaned Files</button>}
          </div>
        </div>
        {storageScan && (
          <div className="settings-list">
            <span>{storageScan.fileCount} stored files, {Math.round(storageScan.totalBytes / 1024 / 1024)} MB total.</span>
            <span>{storageScan.orphanCount} orphan files, {Math.round(storageScan.orphanBytes / 1024 / 1024)} MB recoverable.</span>
            {storageScan.deletedCount ? <span>{storageScan.deletedCount} files deleted.</span> : null}
          </div>
        )}
        {storageScan?.orphans?.length ? (
          <div className="orphan-file-list">
            <div className="orphan-toolbar">
              <button type="button" className="ghost" onClick={() => setSelectedOrphans(new Set((storageScan.orphans || []).slice(0, 80).map((file) => file.path)))}>Select Visible</button>
              <button type="button" className="ghost" onClick={() => setSelectedOrphans(new Set())}>Select None</button>
              <span>{selectedOrphans.size} selected</span>
            </div>
            {storageScan.orphans.slice(0, 80).map((file) => (
              <label key={file.path} className="orphan-file-row">
                <input type="checkbox" checked={selectedOrphans.has(file.path)} onChange={() => toggleOrphan(file.path)} />
                <span>{file.relativePath || file.name}</span>
                <small>{Math.max(1, Math.round(file.size / 1024))} KB</small>
                <small>{file.modifiedAt ? new Date(Number(file.modifiedAt)).toLocaleDateString() : ''}</small>
                <button
                  type="button"
                  className="ghost"
                  onClick={async (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    try {
                      await openStoredFile(file.path);
                    } catch (error) {
                      setStorageError(String(error));
                    }
                  }}
                >
                  Open
                </button>
              </label>
            ))}
            {storageScan.orphans.length > 80 && <p>{storageScan.orphans.length - 80} more orphan files hidden. Only visible checked files will be cleaned.</p>}
          </div>
        ) : null}
        {storageError && <p className="error-text">{storageError}</p>}
        {hostSyncClient && <p className="settings-note">Storage cleanup must be run on the host computer.</p>}
      </section>
        </>
      )}
      {activeSection === 'network' && (
        <>
      <section className="panel settings-section">
        <div className="settings-section-row">
          <div className="settings-copy">
            <h2>Multi-Computer Setup</h2>
            <p>Use this installation locally, make it the authoritative host, or pair it with another BuildBook host.</p>
          </div>
          {syncConfig && <span className={`sync-mode-badge sync-mode-${syncConfig.mode}`}>{syncConfig.mode}</span>}
        </div>
        {remoteClient ? (
          <p className="settings-note">Host and client setup must be changed from the desktop app.</p>
        ) : (
          <>
            <div className="sync-device-row">
              <label>
                This computer
                <input value={syncDeviceName} onChange={(event) => setSyncDeviceName(event.target.value)} placeholder="Workshop PC" />
              </label>
              <button className="secondary" onClick={saveDeviceName} disabled={syncBusy || !syncDeviceName.trim()}>Save Name</button>
              {syncConfig?.deviceId && <span className="settings-note">Device ID: {syncConfig.deviceId}</span>}
            </div>
            {syncClientMode ? (
              <div className="sync-client-summary">
                <div>
                  <strong>Connected Host</strong>
                  <span>{syncConfig?.hostUrl || 'Host address not set'}</span>
                </div>
                <div className="settings-actions left-actions">
                  <button className="secondary" onClick={prefetchClientCache} disabled={syncBusy}>Prefetch Client Cache</button>
                  <button className="secondary" onClick={refreshSyncDashboard} disabled={syncBusy}>Refresh Status</button>
                  <button className="danger-fill" onClick={returnToLocalMode} disabled={syncBusy}>Unlink From Host</button>
                </div>
                <p className="settings-note">Network access and web login settings are controlled by the host computer.</p>
              </div>
            ) : (
              <div className="sync-mode-actions">
                <button onClick={createHostFromThisComputer} disabled={syncBusy || !syncConfig}>Create Host from This Computer</button>
                <button className="secondary" onClick={generatePairingCode} disabled={syncBusy || syncConfig?.mode !== 'host'}>Generate Pairing Code</button>
                <button className="secondary" onClick={prefetchClientCache} disabled={syncBusy || syncConfig?.mode !== 'client'}>Prefetch Client Cache</button>
                <button className="secondary" onClick={returnToLocalMode} disabled={syncBusy || !syncConfig || syncConfig.mode === 'local'}>Use Standalone Local Data</button>
              </div>
            )}
            {syncPrefetchProgress && <p className="settings-note">{syncPrefetchProgress}</p>}
            {syncConfig?.pairingCode && syncConfig?.pairingCodeExpiresAt > Math.floor(Date.now() / 1000) && (
              <div className="sync-pairing-code">
                <strong>{syncConfig.pairingCode}</strong>
                <span>Expires {new Date(syncConfig.pairingCodeExpiresAt * 1000).toLocaleTimeString()}</span>
              </div>
            )}
            {syncConfig?.mode === 'host' && Boolean(syncConfig?.pairedDevices?.length) && (
              <div className="sync-device-list">
                {(syncConfig.pairedDevices || []).map((device) => (
                  <div key={device.deviceId} className={`sync-device-card ${device.revoked ? 'revoked' : ''}`}>
                    <div>
                      <strong>{device.deviceName || 'BuildBook Computer'}</strong>
                      <span>{device.revoked ? 'Revoked' : `Last seen ${device.lastSeenAt ? new Date(device.lastSeenAt * 1000).toLocaleString() : 'never'}`}</span>
                    </div>
                    {!device.revoked && <button className="danger-fill" onClick={() => revokeDevice(device.deviceId)} disabled={syncBusy}>Revoke</button>}
                  </div>
                ))}
              </div>
            )}
            {syncDashboard && (
              <div className="sync-dashboard">
                <div>
                  <strong>Sync Status</strong>
                  <span>{syncDashboard.pendingSync ? 'Pending local changes' : syncDashboard.mode === 'client' ? 'Connected cache' : syncDashboard.mode === 'host' ? 'Host ready' : 'Standalone'}</span>
                </div>
                {syncDashboard.mode === 'client' ? (
                  <div>
                    <strong>Paired Device</strong>
                    <span>Managed by host</span>
                  </div>
                ) : (
                  <div>
                    <strong>Paired Devices</strong>
                    <span>{(syncDashboard.pairedDevices || []).filter((device) => !device.revoked).length} active, {(syncDashboard.pairedDevices || []).filter((device) => device.revoked).length} revoked</span>
                  </div>
                )}
                {syncDashboard.mode === 'client' && (
                <div>
                  <strong>Client Cache</strong>
                  <span>{syncDashboard.cacheFileCount || 0} files, {compactBytes(syncDashboard.cacheBytes || 0)}</span>
                </div>
                )}
                {syncDashboard.hostUrl && (
                  <div>
                    <strong>Host</strong>
                    <span>{syncDashboard.hostUrl}</span>
                  </div>
                )}
                {syncDashboard.lastConnectedAt ? (
                  <div>
                    <strong>Last sync</strong>
                    <span>{new Date(syncDashboard.lastConnectedAt * 1000).toLocaleString()}</span>
                  </div>
                ) : null}
                {syncDashboard.pairingLockedUntil > Math.floor(Date.now() / 1000) && (
                  <div className="sync-warning">
                    <strong>Pairing locked</strong>
                    <span>Try again after {new Date(syncDashboard.pairingLockedUntil * 1000).toLocaleTimeString()}.</span>
                  </div>
                )}
                {syncDashboard.lastSyncError && (
                  <div className="sync-warning">
                    <strong>Last error</strong>
                    <span>{syncDashboard.lastSyncError}</span>
                  </div>
                )}
                {syncDashboard.activeCheckouts?.length ? (
                  <div className="sync-checkouts">
                    <strong>Checked Out Files</strong>
                    {syncDashboard.activeCheckouts.map((lease) => (
                      <span key={`${lease.path}-${lease.deviceId}`}>
                        {lease.path.split(/[\\/]/).pop()} by {lease.deviceName} until {new Date(lease.expiresAt * 1000).toLocaleTimeString()}
                        {syncDashboard.mode === 'host' && (
                          <button className="ghost compact-action" onClick={() => clearCheckout(lease.path)} disabled={syncBusy}>Clear</button>
                        )}
                      </span>
                    ))}
                  </div>
                ) : syncDashboard.mode === 'host' ? (
                  <div>
                    <strong>Checked Out Files</strong>
                    <span>None</span>
                  </div>
                ) : null}
                <div className="sync-dashboard-actions">
                  <button className="secondary" onClick={refreshSyncDashboard} disabled={syncBusy}>Refresh Dashboard</button>
                </div>
              </div>
            )}
            {syncConfig?.mode !== 'host' && (!syncClientMode || syncClientNeedsRepair) && <div className="sync-connect-panel">
              <div className="section-title">
                <h3>Connect to a Host</h3>
                <button className="secondary" onClick={discoverHosts} disabled={syncBusy}>{syncBusy ? 'Working...' : 'Find Hosts'}</button>
              </div>
              {syncHosts.length > 0 && (
                <div className="sync-host-list">
                  {syncHosts.map((host) => (
                    <button
                      key={host.deviceId}
                      type="button"
                      className="secondary"
                      onClick={() => setSyncHostUrl(host.url)}
                    >
                      <strong>{host.deviceName}</strong>
                      <span>{host.url}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="sync-connect-row">
                <label>
                  Host address
                  <input value={syncHostUrl} onChange={(event) => setSyncHostUrl(event.target.value)} placeholder={`http://192.168.1.20:${BUILDBOOK_SYNC_PORT}`} />
                </label>
                <label>
                  Pairing code
                  <input value={syncPairingCode} onChange={(event) => setSyncPairingCode(event.target.value)} placeholder="8 digit code from host" />
                </label>
                <button onClick={connectToHost} disabled={syncBusy || !syncHostUrl.trim() || !syncPairingCode.trim()}>Connect</button>
              </div>
            </div>}
          </>
        )}
        {syncNotice && <p className="success-text">{syncNotice}</p>}
        {syncError && <p className="error-text">{syncError}</p>}
      </section>
      <section className="panel settings-section">
        <div className="settings-section-row">
          <div className="settings-copy">
            <h2>Local Network Access</h2>
            <p>Serve BuildBook to devices on your Wi-Fi. Leave off unless actively in use.</p>
          </div>
          {!networkControlledByHost && <div className="settings-actions">
            <button
              className={state.lanServer?.enabled ? 'danger-fill' : 'secondary'}
              onClick={toggleLanServer}
              disabled={lanBusy}
            >
              {lanBusy ? 'Working...' : state.lanServer?.enabled ? 'Turn Off' : 'Turn On'}
            </button>
          </div>}
        </div>
        {networkControlledByHost ? (
          lanAccessUrl ? (
            <div className="lan-access-box">
              {lanQr && <img src={lanQr} alt="BuildBook LAN access QR code" />}
              <div>
                <strong>Address</strong>
                <p>{lanAccessUrl}</p>
              </div>
            </div>
          ) : (
            <p className="settings-note">Local access is disabled on the host computer.</p>
          )
        ) : (
          <>
            <div className="lan-settings-grid">
              <label>
                Port
                <input
                  type="number"
                  min="1024"
                  max="65535"
                  value={state.lanServer?.port || 8787}
                  onChange={(event) => updateLanServer({ port: Number(event.target.value) || 8787 })}
                  disabled={state.lanServer?.enabled || syncHostMode}
                />
              </label>
              <button className="secondary" onClick={regenerateLanToken} disabled={lanBusy || state.lanServer?.enabled}>
                Regenerate Access Code
              </button>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={state.lanServer?.requireToken !== false}
                onChange={(event) => updateLanServer({ requireToken: event.target.checked })}
                disabled={state.lanServer?.enabled}
              />
              Require access token
            </label>
            {syncHostMode && <p className="settings-note">Multi-computer sync runs on port {BUILDBOOK_SYNC_PORT}. Browser access can be toggled here without disconnecting paired computers.</p>}
            {state.lanServer?.enabled && (
              <div className="lan-access-box">
                {lanQr && <img src={lanQr} alt="BuildBook LAN access QR code" />}
                <div>
                  <strong>Address</strong>
                  <p>{lanNotice.replace('LAN server running at ', '')}</p>
                  <strong>Access URL</strong>
                  <p>{lanAccessUrl}</p>
                  <span>{state.lanServer?.requireToken === false ? 'Token is off. Anyone on the network can open this address.' : 'Scan the QR code once. The phone browser remembers the access code.'}</span>
                </div>
              </div>
            )}
          </>
        )}
        {!networkControlledByHost && lanNotice && <p className="success-text">{lanNotice}</p>}
        {lanError && <p className="error-text">{lanError}</p>}
        {!networkControlledByHost && <p>Use the shown address from your phone while connected to the same Wi-Fi network.</p>}
      </section>
      <section className="panel settings-section">
        <div className="settings-section-row">
          <div className="settings-copy">
            <h2>Web Login Security</h2>
            <p>Require an admin login for browser access when using a domain or reverse proxy.</p>
          </div>
          <label className="check-row settings-toggle">
            <input
              type="checkbox"
              checked={Boolean(state.webAuth?.enabled)}
              onChange={(event) => setWebLoginEnabled(event.target.checked)}
              disabled={networkControlledByHost}
            />
            Require admin login
          </label>
        </div>
        {remoteClient && (
          <div className="settings-actions left-actions">
            <button className="secondary" onClick={logoutWebSession}>Log Out This Browser</button>
          </div>
        )}
        <div className="web-auth-grid">
          <label>
            Apply login to
            <select value={state.webAuth?.scope || 'domain'} onChange={(event) => updateWebAuth({ scope: event.target.value })} disabled={networkControlledByHost}>
              <option value="domain">Domain/proxy access only</option>
              <option value="all">All browser access</option>
            </select>
          </label>
          <label>
            Admin username
            <input value={state.webAuth?.username || 'admin'} onChange={(event) => updateWebAuth({ username: event.target.value || 'admin' })} disabled={networkControlledByHost} />
          </label>
          <label>
            Remember device days
            <input
              type="number"
              min="1"
              max="365"
              value={state.webAuth?.rememberDays || 30}
              onChange={(event) => updateWebAuth({ rememberDays: Number(event.target.value) || 30 })}
              disabled={networkControlledByHost}
            />
          </label>
          <label>
            Allowed domains
            <input
              value={state.webAuth?.allowedHosts || ''}
              onChange={(event) => updateWebAuth({ allowedHosts: event.target.value })}
              placeholder="buildbook.example.com, *.tailnet.ts.net"
              disabled={networkControlledByHost}
            />
          </label>
        </div>
        {networkControlledByHost ? (
          <p className="settings-note">Password changes are only available in the host desktop app. Open BuildBook on the host computer to change the admin password.</p>
        ) : (
          <div className="web-auth-password-row">
            <label>
              New password
              <input type="password" value={webPassword} onChange={(event) => setWebPassword(event.target.value)} autoComplete="new-password" />
            </label>
            <label>
              Confirm password
              <input type="password" value={webPasswordConfirm} onChange={(event) => setWebPasswordConfirm(event.target.value)} autoComplete="new-password" />
            </label>
            <button className="secondary" onClick={saveWebPassword}>Save Password</button>
          </div>
        )}
        <p className="settings-note">
          Password status: {state.webAuth?.passwordHash ? 'set' : 'not set'}. Local desktop use never requires this login. Local IP and localhost access are always allowed.
        </p>
        {webAuthNotice && <p className="success-text">{webAuthNotice}</p>}
        {webAuthError && <p className="error-text">{webAuthError}</p>}
      </section>
        </>
      )}
      {activeSection === 'maintenance' && (
        <>
      <section className="panel settings-section">
        <div className="settings-section-row">
          <div className="settings-copy">
            <h2>Background Operation</h2>
            <p>Keep BuildBook available from the tray when the desktop window is closed.</p>
          </div>
          <label className="check-row settings-toggle">
            <input
              type="checkbox"
              checked={Boolean(state.closeToTray)}
              onChange={(event) => updateState((current) => ({ ...current, closeToTray: event.target.checked }))}
            />
            Keep running in tray
          </label>
        </div>
      </section>
      <section className="panel settings-section danger-settings">
        <div className="settings-section-row">
          <div className="settings-copy">
            <h2>Reset BuildBook</h2>
            <p>Delete managed uploads and restore all projects, parts, categories, and settings to first-install defaults.</p>
          </div>
          <div className="settings-actions">
            <button className="danger-fill" disabled={hostSyncClient} title={hostSyncClient ? 'This setting is only editable on the host computer.' : undefined} onClick={() => {
              setResetError('');
              setResetPhrase('');
              setShowFullReset(true);
            }}>Full Reset</button>
          </div>
        </div>
        {hostSyncClient && <p className="settings-note">A full reset must be started on the host computer.</p>}
      </section>
        </>
      )}
      {showTemplatePreview && (
        <TemplatePreviewModal
          template={state.template}
          onClose={() => setShowTemplatePreview(false)}
          onUpdate={updateTemplate}
        />
      )}
      {showThemeEditor && (
        <ThemeEditorModal
          theme={state.theme}
          onClose={() => setShowThemeEditor(false)}
          onSave={updateTheme}
        />
      )}
      {showRevisionSettings && (
        <RevisionSettingsModal
          revisionSettings={state.revisionSettings}
          projects={state.projects}
          template={state.template}
          onUpdateTemplate={updateTemplate}
          onClose={() => setShowRevisionSettings(false)}
          onSave={updateRevisionSettings}
        />
      )}
      {showFullReset && (
        <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && !resetBusy && setShowFullReset(false)}>
          <div className="modal compact-modal reset-modal">
            <h2>Reset BuildBook</h2>
            <p>This permanently deletes all uploaded BuildBook data and resets the app to default settings. Files linked outside BuildBook are not deleted.</p>
            <label>
              Type delete all to confirm
              <input autoFocus value={resetPhrase} onChange={(event) => setResetPhrase(event.target.value)} placeholder="delete all" disabled={resetBusy} />
            </label>
            {resetError && <p className="error-text">{resetError}</p>}
            <div className="modal-footer">
              <button className="secondary" disabled={resetBusy} onClick={() => setShowFullReset(false)}>Cancel</button>
              <button className="danger-fill" disabled={resetBusy || resetPhrase.trim() !== 'delete all'} onClick={runFullReset}>
                {resetBusy ? 'Resetting...' : 'Delete All and Reset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RevisionSettingsModal({ revisionSettings, projects, template, onUpdateTemplate, onClose, onSave }) {
  const [draft, setDraft] = useState(() => normalizeRevisionSettings(revisionSettings));
  const [newTracker, setNewTracker] = useState({ name: '', extensions: '', color: '#58a6ff' });
  const [dragTrackerId, setDragTrackerId] = useState('');
  const [dragTrackerOverId, setDragTrackerOverId] = useState('');
  const [dragTrackerPosition, setDragTrackerPosition] = useState('before');
  const trackerDragRef = useRef(null);
  const overridingProjects = projects.filter((project) => project.revisionSettingsOverride);
  const projectStorage = useMemo(() => (
    projects
      .map((project) => ({
        id: project.id,
        name: project.name,
        rows: projectTrackedStorageRows(project).slice(0, 3),
        totalBytes: projectTrackedStorageRows(project).reduce((total, row) => total + row.size, 0),
      }))
      .filter((project) => project.totalBytes > 0)
      .sort((a, b) => b.totalBytes - a.totalBytes || a.name.localeCompare(b.name))
  ), [projects]);
  const addTracker = () => {
    if (!newTracker.name.trim()) return;
    onUpdateTemplate({
      fileTrackers: [
        ...template.fileTrackers,
        { id: makeId('tracker'), name: newTracker.name.trim(), extensions: newTracker.extensions.trim(), color: newTracker.color || '#58a6ff', programPath: '' },
      ],
    });
    setNewTracker({ name: '', extensions: '', color: '#58a6ff' });
  };
  const updateTracker = (trackerId, patch) => {
    onUpdateTemplate({
      fileTrackers: template.fileTrackers.map((tracker) => tracker.id === trackerId ? { ...tracker, ...patch } : tracker),
    });
  };
  const reorderTracker = (sourceId, targetId, position = 'before') => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const current = [...template.fileTrackers];
    const sourceIndex = current.findIndex((tracker) => tracker.id === sourceId);
    let targetIndex = current.findIndex((tracker) => tracker.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [moved] = current.splice(sourceIndex, 1);
    targetIndex = current.findIndex((tracker) => tracker.id === targetId);
    current.splice(targetIndex + (position === 'after' ? 1 : 0), 0, moved);
    onUpdateTemplate({ fileTrackers: current });
  };
  const trackerDropAtPoint = (x, y) => {
    const row = document.elementFromPoint(x, y)?.closest?.('[data-template-tracker-id]');
    if (!row) return { id: '', position: 'before' };
    const rect = row.getBoundingClientRect();
    return { id: row.dataset.templateTrackerId || '', position: y > rect.top + rect.height / 2 ? 'after' : 'before' };
  };
  const startTrackerDrag = (event, trackerId) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    trackerDragRef.current = { trackerId };
    setDragTrackerId(trackerId);
    setDragTrackerOverId('');
    setDragTrackerPosition('before');
  };
  const moveTrackerDrag = (event) => {
    const drag = trackerDragRef.current;
    if (!drag) return;
    const target = trackerDropAtPoint(event.clientX, event.clientY);
    setDragTrackerOverId(target.id && target.id !== drag.trackerId ? target.id : '');
    setDragTrackerPosition(target.position);
  };
  const endTrackerDrag = (event) => {
    const drag = trackerDragRef.current;
    if (!drag) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const target = trackerDropAtPoint(event.clientX, event.clientY);
    reorderTracker(drag.trackerId, dragTrackerOverId || target.id, dragTrackerPosition || target.position);
    trackerDragRef.current = null;
    setDragTrackerId('');
    setDragTrackerOverId('');
    setDragTrackerPosition('before');
  };

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal theme-modal revision-modal">
        <div className="section-title">
          <h2>Tracked Files Settings</h2>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
        <div className="revision-sections">
          <section className="revision-card">
            <h3>Retention</h3>
            <div className="revision-settings-grid">
              <label className="revision-field">
                <span>Stored revisions</span>
                <input
                  type="number"
                  min="1"
                  value={draft.maxRevisions}
                  onChange={(event) => setDraft((current) => ({ ...current, maxRevisions: Math.max(1, Number(event.target.value) || 1) }))}
                />
              </label>
              <label className="revision-field">
                <span>Retention mode</span>
                <select value={draft.retentionMode} onChange={(event) => setDraft((current) => ({ ...current, retentionMode: event.target.value === 'hybrid' ? 'hybrid' : 'last-n' }))}>
                  <option value="last-n">Last N revisions</option>
                  <option value="hybrid">Hybrid trim</option>
                </select>
              </label>
            </div>
            <label className="revision-toggle-row">
              <input type="checkbox" checked={draft.saveAllRevisions} onChange={(event) => setDraft((current) => ({ ...current, saveAllRevisions: event.target.checked }))} />
              <div>
                <strong>Save all revisions</strong>
                <span>Ignore trimming and keep every stored revision.</span>
              </div>
            </label>
            <p className="revision-note">
              {draft.retentionMode === 'hybrid'
                ? `Hybrid mode keeps the last saved revision for each of the last 7 days, one per older month, and the newest ${draft.maxRevisions} revisions overall.`
                : `Standard mode keeps the newest ${draft.maxRevisions} revisions for each tracked item.`}
            </p>
          </section>
          <section className="revision-card">
            <h3>Capture</h3>
            <label className="revision-toggle-row">
              <input type="checkbox" checked={draft.trackLinkedFiles} onChange={(event) => setDraft((current) => ({ ...current, trackLinkedFiles: event.target.checked }))} />
              <div>
                <strong>Track linked files and folders</strong>
                <span>Keep live links for open actions, but store BuildBook snapshots for revision history.</span>
              </div>
            </label>
            <label className="revision-toggle-row">
              <input type="checkbox" checked={draft.delayEnabled} onChange={(event) => setDraft((current) => ({ ...current, delayEnabled: event.target.checked }))} />
              <div>
                <strong>Delay repeat revision checks</strong>
                <span>Wait after a saved revision before checking the same tracked item again.</span>
              </div>
            </label>
            <label className="revision-field revision-delay-field">
              <span>Delay minutes</span>
              <input
                type="number"
                min="1"
                value={draft.delayMinutes}
                disabled={!draft.delayEnabled}
                onChange={(event) => setDraft((current) => ({ ...current, delayMinutes: Math.max(1, Number(event.target.value) || 1) }))}
              />
            </label>
          </section>
        </div>
        <section className="revision-card tracked-files-editor">
          <h3>Tracked File Types</h3>
          <div className="tracker-row">
            <input value={newTracker.name} onChange={(event) => setNewTracker((current) => ({ ...current, name: event.target.value }))} placeholder="Tracker name" />
            <input value={newTracker.extensions} onChange={(event) => setNewTracker((current) => ({ ...current, extensions: event.target.value }))} placeholder=".pdf,.dxf" />
            <input aria-label="Tracker color" type="color" value={validHexColor(newTracker.color) ? newTracker.color : '#58a6ff'} onChange={(event) => setNewTracker((current) => ({ ...current, color: event.target.value }))} />
            <button onClick={addTracker}>Add</button>
          </div>
          <div className="tracked-files-list">
            {template.fileTrackers.map((tracker) => (
              <div
                key={tracker.id}
                data-template-tracker-id={tracker.id}
                className={`tracker-edit-row ${dragTrackerId === tracker.id ? 'dragging' : ''} ${dragTrackerOverId === tracker.id ? `drop-${dragTrackerPosition}` : ''}`}
              >
                <span
                  className="drag-handle"
                  title="Drag to reorder"
                  onPointerDown={(event) => startTrackerDrag(event, tracker.id)}
                  onPointerMove={moveTrackerDrag}
                  onPointerUp={endTrackerDrag}
                  onPointerCancel={endTrackerDrag}
                >
                  ::
                </span>
                <input value={tracker.name} onChange={(event) => updateTracker(tracker.id, { name: event.target.value })} placeholder="Tracker name" />
                <input value={tracker.extensions || ''} onChange={(event) => updateTracker(tracker.id, { extensions: event.target.value })} placeholder=".pdf,.dxf" />
                <input aria-label={`${tracker.name} color`} type="color" value={validHexColor(tracker.color) ? tracker.color : '#58a6ff'} onChange={(event) => updateTracker(tracker.id, { color: event.target.value })} />
                <button className="ghost danger-button" onClick={() => onUpdateTemplate({ fileTrackers: template.fileTrackers.filter((item) => item.id !== tracker.id) })}>Delete</button>
              </div>
            ))}
          </div>
        </section>
        <section className="revision-card tracker-color-preview">
          <h3>Tracked File Type Colors</h3>
          <div>
            {template.fileTrackers.map((tracker) => (
              <strong key={tracker.id} style={{ color: validHexColor(tracker.color) ? tracker.color : '#58a6ff' }}>
                {tracker.name || 'Untitled'}
              </strong>
            ))}
          </div>
        </section>
        <div className="settings-list revision-summary">
          <span>Projects overriding these settings: {overridingProjects.length ? overridingProjects.map((project) => project.name).join(', ') : 'None'}</span>
        </div>
        <div className="revision-storage-list">
          <h3>Tracked File Storage by Project</h3>
          {projectStorage.length ? projectStorage.map((project) => (
            <div key={project.id} className="revision-storage-row">
              <div>
                <strong>{project.name}</strong>
                <span>{Math.max(1, Math.round(project.totalBytes / 1024))} KB</span>
              </div>
              <ul>
                {project.rows.map((row) => (
                  <li key={row.key}>
                    <span>{row.name}</span>
                    <small>{Math.max(1, Math.round(row.size / 1024))} KB</small>
                  </li>
                ))}
              </ul>
            </div>
          )) : <p>No tracked project files yet.</p>}
        </div>
        <div className="modal-footer">
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button onClick={() => { onSave(draft); onClose(); }}>Save</button>
        </div>
      </div>
    </div>
  );
}

