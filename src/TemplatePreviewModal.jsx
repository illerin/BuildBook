import React, { useState } from 'react';

export default function TemplatePreviewModal({ template, onClose, onUpdate }) {
  const [newStep, setNewStep] = useState('');
  const [newChecklist, setNewChecklist] = useState('');
  const [selectedSteps, setSelectedSteps] = useState([]);

  const addStep = () => {
    if (!newStep.trim()) return;
    onUpdate({ steps: [...template.steps, newStep.trim()] });
    setNewStep('');
  };

  const toggleSelectedStep = (step) => {
    setSelectedSteps((current) => (
      current.includes(step) ? current.filter((item) => item !== step) : [...current, step]
    ));
  };

  const deleteSelectedSteps = () => {
    if (!selectedSteps.length) return;
    onUpdate({ steps: template.steps.filter((step) => !selectedSteps.includes(step)) });
    setSelectedSteps([]);
  };

  const addChecklist = () => {
    if (!newChecklist.trim()) return;
    onUpdate({ checklist: [...template.checklist, newChecklist.trim()] });
    setNewChecklist('');
  };

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal template-modal">
        <div className="section-title">
          <h2>Project Template</h2>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
        <section className="template-mock">
          <div className="project-card template-card">
            <div className="project-card-image">
              <div>Project</div>
              <span className="status-badge status-active">active</span>
            </div>
            <div className="project-card-body">
              <strong>Template Preview</strong>
              <div className="project-step-tags">
                {template.steps.slice(0, 5).map((step) => <span key={step}>{step}</span>)}
              </div>
              <div className="mini-meta">
                <span>{template.checklist.length} default tasks</span>
              </div>
            </div>
          </div>
          <div className="template-preview-panels">
            <article>
              <h3>Step Buttons</h3>
              <div className="inline-entry">
                <input value={newStep} onChange={(event) => setNewStep(event.target.value)} placeholder="New step" />
                <button onClick={addStep}>Add</button>
                {selectedSteps.length > 0 && (
                  <button className="danger-fill" onClick={deleteSelectedSteps}>Delete Selected</button>
                )}
              </div>
              <div className="step-tags template-tags">
                {template.steps.map((step) => (
                  <button
                    key={step}
                    className={`tag ${selectedSteps.includes(step) ? 'selected-delete' : 'active'}`}
                    onClick={() => toggleSelectedStep(step)}
                  >
                    {step}
                  </button>
                ))}
              </div>
            </article>
            <article>
              <h3>Default Checklist</h3>
              <div className="inline-entry">
                <input value={newChecklist} onChange={(event) => setNewChecklist(event.target.value)} placeholder="Default task" />
                <button onClick={addChecklist}>Add</button>
              </div>
              {template.checklist.map((item) => (
                <div key={item} className="list-line">
                  <span>{item}</span>
                  <button className="ghost" onClick={() => onUpdate({ checklist: template.checklist.filter((text) => text !== item) })}>Delete</button>
                </div>
              ))}
            </article>
          </div>
        </section>
      </div>
    </div>
  );
}
