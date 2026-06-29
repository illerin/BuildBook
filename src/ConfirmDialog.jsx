import React, { createContext, useContext, useState } from 'react';

const ConfirmContext = createContext(null);

export function useAppConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('Confirm dialog is not available.');
  return confirm;
}

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);

  const confirm = ({ title = 'Confirm action', message, confirmLabel = 'Confirm', danger = false }) => new Promise((resolve) => {
    setRequest({ title, message, confirmLabel, danger, resolve });
  });

  const close = (answer) => {
    if (request?.resolve) request.resolve(answer);
    setRequest(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && close(false)}>
          <div className="modal confirm-modal">
            <div className="modal-header">
              <h2>{request.title}</h2>
            </div>
            <p>{request.message}</p>
            <div className="modal-actions">
              <button className="secondary" onClick={() => close(false)}>Cancel</button>
              <button className={request.danger ? 'danger-fill' : ''} onClick={() => close(true)}>{request.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
