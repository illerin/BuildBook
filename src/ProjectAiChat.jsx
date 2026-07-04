import React, { useEffect, useState } from 'react';
import { normalizeProjectAiPermissions } from './data';
import {
  AI_PROVIDER_OPTIONS,
  applyAiActions,
  buildProjectAiContext,
  buildProjectAiImages,
  createAiConnection,
  appendProjectAiAudit,
  filterAiActions,
  loadAiConnections,
  loadProjectAiAudit,
  loadProjectAiConnectionId,
  loadProjectChat,
  loadProjectAiMemory,
  providerDefaultEndpoint,
  saveAiConnections,
  saveProjectAiMemory,
  saveProjectAiConnectionId,
  saveProjectChat,
  sendProjectAiMessage,
} from './projectAi';

const ACCESS_ROWS = [
  ['overview', 'Overview', 'Notes, checklist, and next steps'],
  ['instructions', 'Instructions', 'Introduction and build steps'],
  ['photos', 'Photos', 'Photo images, names, and notes'],
  ['parts', 'Project Parts', 'Linked parts and quantities'],
  ['files', 'Files', 'File metadata and supported text-file contents'],
  ['libraryParts', 'Parts Library', 'Search, inspect, and optionally create library parts'],
  ['webResearch', 'Web Research', 'Allow supported cloud providers to search the web'],
];

function usageSummary(usage) {
  if (!usage) return '';
  const input = usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokenCount ?? usage.inputTokenCount;
  const output = usage.completion_tokens ?? usage.output_tokens ?? usage.candidatesTokenCount ?? usage.outputTokenCount;
  const total = usage.total_tokens ?? usage.totalTokenCount;
  return [
    input != null ? `${input} input` : '',
    output != null ? `${output} output` : '',
    total != null ? `${total} total tokens` : '',
  ].filter(Boolean).join(' | ');
}

export default function ProjectAiChat({
  project,
  parts,
  categories,
  template,
  permissions,
  onUpdatePermissions,
  onUpdateProject,
  onCreatePart,
}) {
  const [view, setView] = useState('chat');
  const [settingsView, setSettingsView] = useState('connection');
  const [connections, setConnections] = useState(loadAiConnections);
  const [connectionId, setConnectionId] = useState('');
  const [messages, setMessages] = useState(() => loadProjectChat(project.id));
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [memory, setMemory] = useState(() => loadProjectAiMemory(project.id));
  const [audit, setAudit] = useState(() => loadProjectAiAudit(project.id));
  const safePermissions = normalizeProjectAiPermissions(permissions);
  const connection = connections.profiles.find((profile) => profile.id === connectionId) || connections.profiles[0];

  useEffect(() => {
    setMessages(loadProjectChat(project.id));
    setMemory(loadProjectAiMemory(project.id));
    setAudit(loadProjectAiAudit(project.id));
    setConnectionId(loadProjectAiConnectionId(project.id, connections));
  }, [project.id]);

  useEffect(() => {
    saveProjectChat(project.id, messages);
  }, [messages, project.id]);

  const sendMessage = async (event) => {
    event?.preventDefault();
    const text = prompt.trim();
    if (!text || busy) return;
    const userMessage = { id: crypto.randomUUID?.() || String(Date.now()), role: 'user', content: text };
    const history = [...messages, userMessage];
    setMessages(history);
    setPrompt('');
    setBusy(true);
    setNotice('');
    try {
      const context = await buildProjectAiContext({ project, parts, permissions: safePermissions, memory });
      const wantsImages = connection.visionEnabled && /\b(photo|photos|image|images|picture|pictures|visual|look|see|inspect)\b/i.test(text);
      const images = wantsImages ? await buildProjectAiImages(project, safePermissions) : [];
      const result = await sendProjectAiMessage({
        connection,
        context,
        history: messages,
        prompt: text,
        permissions: safePermissions,
        images,
        toolContext: { project, parts, categories, template, permissions: safePermissions },
      });
      const auditEntries = [
        ...result.audit,
        {
          at: new Date().toISOString(),
          tool: 'assistant_response',
          status: 'completed',
          provider: connection.provider,
          model: connection.model,
          proposedChanges: result.actions.length,
        },
      ];
      setAudit(appendProjectAiAudit(project.id, auditEntries));
      setMessages((current) => [...current, {
        id: crypto.randomUUID?.() || `${Date.now()}-assistant`,
        role: 'assistant',
        content: result.content,
        actions: result.actions,
        actionsApplied: false,
        usage: result.usage,
        sources: result.sources,
      }]);
    } catch (error) {
      const message = String(error?.message || error);
      setNotice(message);
      setAudit(appendProjectAiAudit(project.id, [{
        at: new Date().toISOString(),
        tool: 'assistant_request',
        status: 'error',
        provider: connection.provider,
        model: connection.model,
        error: message,
      }]));
    } finally {
      setBusy(false);
    }
  };

  const applyActions = (messageId, actions) => {
    const allowedActions = filterAiActions(actions, safePermissions);
    if (!allowedActions.length) {
      setNotice('These changes are no longer allowed by the current project access settings.');
      return;
    }
    const partDrafts = allowedActions.filter((action) => action.type === 'create_part');
    const projectActions = allowedActions.filter((action) => action.type !== 'create_part');
    if (projectActions.length) onUpdateProject(applyAiActions(project, projectActions, parts));
    partDrafts.forEach((draft) => onCreatePart(project.id, draft));
    setAudit(appendProjectAiAudit(project.id, [{
      at: new Date().toISOString(),
      tool: 'apply_proposed_changes',
      status: 'applied',
      actions: allowedActions.map((action) => action.type),
    }]));
    setMessages((current) => current.map((message) => (
      message.id === messageId ? { ...message, actionsApplied: true } : message
    )));
  };

  const updateConnection = (patch) => {
    setConnections((current) => ({
      ...current,
      profiles: current.profiles.map((profile) => profile.id === connection.id ? { ...profile, ...patch } : profile),
    }));
  };

  const selectConnection = (profileId) => {
    setConnectionId(profileId);
    saveProjectAiConnectionId(project.id, profileId);
  };

  const addConnection = () => {
    const profile = createAiConnection();
    setConnections((current) => ({ ...current, activeProfileId: profile.id, profiles: [...current.profiles, profile] }));
    selectConnection(profile.id);
  };

  const removeConnection = () => {
    if (connections.profiles.length <= 1) return;
    const profiles = connections.profiles.filter((profile) => profile.id !== connection.id);
    const profileId = profiles[0].id;
    setConnections({ activeProfileId: profileId, profiles });
    selectConnection(profileId);
  };

  const changeProvider = (provider) => {
    updateConnection({
      provider,
      endpoint: providerDefaultEndpoint(provider),
      webSearchEnabled: false,
    });
  };

  const persistConnection = () => {
    const saved = saveAiConnections({ ...connections, activeProfileId: connection.id });
    setConnections(saved);
    setConnectionId(saveProjectAiConnectionId(project.id, connection.id));
    setNotice('AI connection profiles saved on this device.');
  };

  const persistMemory = () => {
    setMemory(saveProjectAiMemory(project.id, memory));
    setNotice('Project AI memory saved on this device.');
  };

  return (
    <section className="panel ai-chat-panel">
      <div className="ai-chat-header">
        <div>
          <h2>AI Chat</h2>
          <p>Context is limited to this project and the Parts Library.</p>
        </div>
        <div className="segmented-control">
          <button className={view === 'chat' ? 'active' : ''} onClick={() => setView('chat')}>Chat</button>
          <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}>Settings</button>
        </div>
      </div>

      {view === 'chat' && (
        <>
          <div className="ai-messages">
            {!messages.length && <p className="empty-copy">Start a project-scoped chat. Access is controlled in Settings.</p>}
            {messages.map((message) => (
              <article key={message.id} className={`ai-message ${message.role}`}>
                <strong>{message.role === 'user' ? 'You' : 'AI'}</strong>
                <div>{message.content}</div>
                {!!message.sources?.length && (
                  <div className="ai-source-list">
                    <strong>Sources</strong>
                    {message.sources.map((source) => (
                      <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}</a>
                    ))}
                  </div>
                )}
                {!!message.actions?.length && (
                  <div className="ai-actions">
                    <span>
                      {message.actions.length} change{message.actions.length === 1 ? '' : 's'} proposed:
                      {' '}{message.actions.map((action) => action.type.replaceAll('_', ' ')).join(', ')}
                    </span>
                    {message.actions.filter((action) => action.type === 'create_part').map((draft, index) => (
                      <details className="ai-part-draft" key={`${draft.name}-${index}`}>
                        <summary>Review new part: {draft.name}</summary>
                        <dl>
                          <dt>Specifications</dt><dd>{draft.specSummary || 'Not provided'}</dd>
                          <dt>Product URL</dt><dd>{draft.productUrl || 'Not provided'}</dd>
                          <dt>Notes</dt><dd>{draft.notes || 'Not provided'}</dd>
                          <dt>Project link</dt><dd>{draft.linkToProject ? `Yes, quantity ${draft.quantity || 1}` : 'No'}</dd>
                          <dt>Possible duplicates</dt><dd>{draft.possibleDuplicates?.length ? draft.possibleDuplicates.map((part) => part.name).join(', ') : 'None found'}</dd>
                        </dl>
                      </details>
                    ))}
                    <button
                      disabled={message.actionsApplied}
                      onClick={() => applyActions(message.id, message.actions)}
                    >
                      {message.actionsApplied ? 'Applied' : 'Review and Apply'}
                    </button>
                  </div>
                )}
                {usageSummary(message.usage) && <small className="ai-usage">{usageSummary(message.usage)}</small>}
              </article>
            ))}
            {busy && <p className="empty-copy">Reading allowed project context...</p>}
          </div>
          {notice && <p className={notice.includes('saved') ? 'success-text' : 'error-text'}>{notice}</p>}
          <form className="ai-prompt" onSubmit={sendMessage}>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask about this project..." rows={3} />
            <button disabled={busy || !prompt.trim()}>{busy ? 'Sending...' : 'Send'}</button>
          </form>
        </>
      )}

      {view === 'settings' && (
        <div className="ai-settings">
          <div className="segmented-control ai-settings-tabs">
            <button className={settingsView === 'connection' ? 'active' : ''} onClick={() => setSettingsView('connection')}>Connection</button>
            <button className={settingsView === 'access' ? 'active' : ''} onClick={() => setSettingsView('access')}>Project Access</button>
            <button className={settingsView === 'memory' ? 'active' : ''} onClick={() => setSettingsView('memory')}>Memory & Audit</button>
          </div>
          {settingsView === 'connection' && (
            <div className="ai-connection-form">
              <p>Each device can keep its own named AI profiles. Credentials and profile selection are not synchronized.</p>
              <p>API keys are currently stored in this device's application/browser storage. Use restricted keys and do not share the device profile.</p>
              <div className="ai-profile-row">
                <label>
                  Connection profile
                  <select value={connection.id} onChange={(event) => selectConnection(event.target.value)}>
                    {connections.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                  </select>
                </label>
                <button className="secondary" onClick={addConnection}>Add Profile</button>
                <button className="ghost danger-button" disabled={connections.profiles.length <= 1} onClick={removeConnection}>Remove</button>
              </div>
              <label>Profile name<input value={connection.name} onChange={(event) => updateConnection({ name: event.target.value })} placeholder="Workshop AI" /></label>
              <label>
                Provider
                <select value={connection.provider} onChange={(event) => changeProvider(event.target.value)}>
                  {AI_PROVIDER_OPTIONS.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
                </select>
              </label>
              <label>Endpoint<input value={connection.endpoint} onChange={(event) => updateConnection({ endpoint: event.target.value })} placeholder={providerDefaultEndpoint(connection.provider)} /></label>
              <label>Model<input value={connection.model} onChange={(event) => updateConnection({ model: event.target.value })} placeholder="Provider model id" /></label>
              <label>
                API key {connection.provider === 'openai-compatible' ? '(optional)' : ''}
                <input type="password" value={connection.apiKey} onChange={(event) => updateConnection({ apiKey: event.target.value })} autoComplete="off" />
              </label>
              {connection.provider === 'openai-compatible' && (
                <p>Use this for Ollama, LM Studio, vLLM, llama.cpp, OpenRouter-compatible gateways, or another Chat Completions server. The server must allow requests from BuildBook.</p>
              )}
              <div className="ai-capability-options">
                <label className="check-row"><input type="checkbox" checked={connection.toolsEnabled} onChange={(event) => updateConnection({ toolsEnabled: event.target.checked })} />Structured BuildBook tools</label>
                <label className="check-row"><input type="checkbox" checked={connection.visionEnabled} onChange={(event) => updateConnection({ visionEnabled: event.target.checked })} />Vision/image input</label>
                <label className="check-row" title={connection.provider === 'openai-compatible' ? 'Provider-managed web search is only configured for the built-in cloud adapters.' : undefined}>
                  <input
                    type="checkbox"
                    checked={connection.webSearchEnabled}
                    disabled={connection.provider === 'openai-compatible'}
                    onChange={(event) => updateConnection({ webSearchEnabled: event.target.checked })}
                  />
                  Provider web search
                </label>
              </div>
              <div><button onClick={persistConnection}>Save Connection</button></div>
            </div>
          )}
          {settingsView === 'access' && (
            <div>
              <p>No other projects are included. Read/write access only enables user-reviewed changes.</p>
              <div className="ai-access-list">
                {ACCESS_ROWS.map(([key, label, description]) => (
                  <label key={key}>
                    <span><strong>{label}</strong><small>{description}</small></span>
                    <select value={safePermissions[key]} onChange={(event) => onUpdatePermissions({ ...safePermissions, [key]: event.target.value })}>
                      <option value="none">{key === 'webResearch' ? 'Disabled' : 'No access'}</option>
                      <option value="read">{key === 'webResearch' ? 'Enabled' : 'Read'}</option>
                      {key !== 'webResearch' && <option value="write">Read / write</option>}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          )}
          {settingsView === 'memory' && (
            <div className="ai-memory-settings">
              <p>Memory is a short, user-controlled project summary sent with future chats. It stays on this device.</p>
              <label>
                Project memory
                <textarea rows={7} value={memory} onChange={(event) => setMemory(event.target.value)} placeholder="Stable decisions, constraints, preferred parts, unresolved questions..." />
              </label>
              <div><button onClick={persistMemory}>Save Memory</button></div>
              <div className="ai-audit-list">
                <h3>Recent AI Activity</h3>
                {audit.length ? audit.slice(-20).reverse().map((entry, index) => (
                  <div key={`${entry.at}-${index}`}>
                    <strong>{entry.tool?.replaceAll('_', ' ') || 'activity'}</strong>
                    <span>{entry.status} | {entry.at ? new Date(entry.at).toLocaleString() : ''}</span>
                  </div>
                )) : <p>No AI activity recorded for this project on this device.</p>}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
