import React, { useEffect, useState } from 'react';
import { assetUrl, isHostSyncClient, readStoredFile } from './desktop';
import { imageMimeTypeFromBytes } from './files';

export function BusyNotice({ label }) {
  if (!label) return null;
  return (
    <div className="busy-notice" role="status" aria-live="polite">
      <span className="busy-spinner" />
      <span>{label}</span>
    </div>
  );
}

export function Header({ title, subtitle, children }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {children && <div className="header-actions">{children}</div>}
    </header>
  );
}

export function StoredImage({ path, alt = '', className = '', style, fallback = null }) {
  const [src, setSrc] = useState(path && /^(blob:|data:|https?:)/i.test(path) ? path : '');
  const [failed, setFailed] = useState(false);
  const directSrc = path ? assetUrl(path) : '';

  useEffect(() => {
    setFailed(false);
    if (!path) {
      setSrc('');
      return undefined;
    }

    if (/^(blob:|data:|https?:)/i.test(path)) {
      setSrc(path);
      return undefined;
    }

    let active = true;
    let objectUrl = '';

    readStoredFile(path, false, isHostSyncClient())
      .then((bytes) => {
        if (!active || !bytes?.length) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: imageMimeTypeFromBytes(bytes, path) }));
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!active) return;
        setSrc(directSrc);
        setFailed(false);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, directSrc]);

  if (!src) return failed && fallback ? fallback : null;
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      draggable={false}
      loading="lazy"
      decoding="async"
      onError={() => {
        setSrc('');
        setFailed(true);
      }}
    />
  );
}
