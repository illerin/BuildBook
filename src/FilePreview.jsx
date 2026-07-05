import React, { useEffect, useRef, useState } from 'react';
import { assetUrl, openStoredFile, readShellThumbnail, readStoredFile } from './desktop';
import { IMAGE_EXTENSIONS, fileExtension } from './files';
import { MODEL_TRIANGLE_LIMIT, isValidTriangle, limitTriangles, parseDxf, parseObj, parseStl } from './filePreviewParsers';
import { parseCsv } from './supplierImport';
import { cssColor } from './theme';
import { readZipEntries, zipEntryText } from './zip';

const TEXT_EXTENSIONS = ['.txt', '.md', '.json', '.ino', '.cpp', '.c', '.h', '.hpp', '.py', '.js', '.ts', '.tsx', '.jsx', '.html', '.css'];
const SHELL_THUMBNAIL_EXTENSIONS = ['.sldprt', '.sldasm', '.slddrw', '.dwg', '.step', '.stp'];
const EXTERNAL_VIEWER_MESSAGES = {
  '.dwg': 'DWG preview is not available inline. Open this file in a CAD app.',
  '.step': 'STEP preview is not available inline yet. Open this file in your 3D/CAD app.',
  '.stp': 'STEP preview is not available inline yet. Open this file in your 3D/CAD app.',
  '.xls': 'Excel preview is not available inline yet. Open this spreadsheet in Excel or export it as CSV for preview.',
};

const PREVIEW_CACHE_LIMIT = 32;
const previewCache = new Map();

function runWhenIdle(callback) {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    const id = window.requestIdleCallback(callback, { timeout: 1200 });
    return () => window.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(callback, 0);
  return () => window.clearTimeout(id);
}

function previewCacheKey(file, type) {
  return `${type}:${file?.path || ''}:${file?.contentHash || ''}:${file?.size || ''}:${file?.createdAt || ''}`;
}

function getPreviewCache(key) {
  if (!previewCache.has(key)) return null;
  const value = previewCache.get(key);
  previewCache.delete(key);
  previewCache.set(key, value);
  return value;
}

function setPreviewCache(key, value) {
  previewCache.set(key, value);
  while (previewCache.size > PREVIEW_CACHE_LIMIT) {
    previewCache.delete(previewCache.keys().next().value);
  }
}

function StoredPreviewImage({ path, alt = '', className = '', style }) {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    if (!path) {
      setSrc('');
      return undefined;
    }
    const direct = assetUrl(path);
    setSrc(direct);
    return () => {
      active = false;
    };
  }, [path]);

  if (!path || failed) return null;
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

function ShellThumbnailPreview({ file }) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setSrc('');
    setError('');

    readShellThumbnail(file.path, 768)
      .then((bytes) => {
        if (!active || !bytes?.length) {
          if (active) setError('Windows did not return a thumbnail for this file.');
          return;
        }
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/bmp' }));
        setSrc(objectUrl);
      })
      .catch((thumbnailError) => {
        if (active) setError(String(thumbnailError || 'Windows did not return a thumbnail for this file.'));
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.path]);

  if (src) {
    return (
      <div className="shell-thumbnail-preview">
        <img src={src} alt="" draggable={false} />
        <span>Windows thumbnail preview</span>
      </div>
    );
  }

  return (
    <div className="file-preview-empty">
      <strong>{file.name}</strong>
      <p>{error || 'Loading Windows thumbnail...'}</p>
      <button className="ghost" onClick={() => openStoredFile(file.path)}>Open File</button>
    </div>
  );
}

export function PdfPreview({ path, title, className = 'file-preview-frame' }) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!path) {
      setSrc('');
      setError('');
      return undefined;
    }
    if (/^(blob:|data:|https?:)/i.test(path)) {
      setSrc(path);
      setError('');
      return undefined;
    }
    let active = true;
    let objectUrl = '';
    setSrc('');
    setError('');
    readStoredFile(path)
      .then((bytes) => {
        if (!active || !bytes?.length) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        setSrc(objectUrl);
      })
      .catch(() => {
        if (active) setError('Could not preview this PDF.');
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  if (error) {
    return (
      <div className="file-preview-empty">
        <p>{error}</p>
        <button className="ghost" onClick={() => openStoredFile(path)}>Open PDF</button>
      </div>
    );
  }

  if (!src) return <div className="file-preview-empty">Loading PDF...</div>;
  const separator = src.includes('#') ? '&' : '#';
  return <iframe className={className} title={title} src={`${src}${separator}pagemode=bookmarks&navpanes=1`} />;
}

function TextFilePreview({ file }) {
  const [content, setContent] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const cacheKey = previewCacheKey(file, 'text');
    const cached = getPreviewCache(cacheKey);
    if (cached) {
      setContent(cached.content || '');
      setError(cached.error || '');
      return undefined;
    }
    let active = true;
    setContent('');
    setError('');
    readStoredFile(file.path)
      .then((bytes) => new TextDecoder().decode(bytes))
      .then((text) => {
        const nextContent = text.slice(0, 20000);
        setPreviewCache(cacheKey, { content: nextContent, error: '' });
        if (active) setContent(nextContent);
      })
      .catch(() => {
        const nextError = 'Preview is not available for this file yet.';
        setPreviewCache(cacheKey, { content: '', error: nextError });
        if (active) setError(nextError);
      });
    return () => {
      active = false;
    };
  }, [file]);

  if (error) {
    return (
      <div className="file-preview-empty">
        <p>{error}</p>
        <button className="ghost" onClick={() => openStoredFile(file.path)}>Open File</button>
      </div>
    );
  }

  return <pre className="file-preview-text">{content || 'Loading preview...'}</pre>;
}

function CsvPreview({ file }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    const cacheKey = previewCacheKey(file, 'csv');
    const cached = getPreviewCache(cacheKey);
    if (cached) {
      setRows(cached.rows || []);
      return undefined;
    }
    let active = true;
    readStoredFile(file.path)
      .then((bytes) => new TextDecoder().decode(bytes))
      .then((text) => {
        const nextRows = parseCsv(text).slice(0, 40).map((row) => row.slice(0, 12));
        setPreviewCache(cacheKey, { rows: nextRows });
        if (active) setRows(nextRows);
      })
      .catch(() => {
        setPreviewCache(cacheKey, { rows: [] });
        if (active) setRows([]);
      });
    return () => {
      active = false;
    };
  }, [file]);

  if (!rows.length) return <div className="file-preview-empty">Spreadsheet preview is available for CSV files. Open Excel files in their app.</div>;

  return <SpreadsheetPreview rows={rows} />;
}

function SpreadsheetPreview({ rows }) {
  return (
    <div className="spreadsheet-preview">
      <table>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${rowIndex}-${row.join('-')}`}>
              {row.map((cell, cellIndex) => <td key={`${cellIndex}-${cell}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function xmlDoc(text) {
  return new DOMParser().parseFromString(text, 'application/xml');
}

function cellColumnIndex(reference = '') {
  const letters = reference.match(/[A-Z]+/i)?.[0]?.toUpperCase() || 'A';
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function parseSharedStrings(text) {
  if (!text) return [];
  return [...xmlDoc(text).getElementsByTagName('si')].map((item) =>
    [...item.getElementsByTagName('t')].map((node) => node.textContent || '').join(''),
  );
}

function firstWorksheetPath(workbookText, relsText) {
  const workbook = xmlDoc(workbookText);
  const firstSheet = workbook.getElementsByTagName('sheet')[0];
  const relationshipId = firstSheet?.getAttribute('r:id');
  const rel = [...xmlDoc(relsText).getElementsByTagName('Relationship')]
    .find((item) => item.getAttribute('Id') === relationshipId);
  const target = rel?.getAttribute('Target') || 'worksheets/sheet1.xml';
  return `xl/${target.replace(/^\/?xl\//, '')}`;
}

function parseXlsxRows(sheetText, sharedStrings) {
  const sheet = xmlDoc(sheetText);
  return [...sheet.getElementsByTagName('row')].slice(0, 40).map((row) => {
    const values = [];
    [...row.getElementsByTagName('c')].slice(0, 80).forEach((cell) => {
      const column = cellColumnIndex(cell.getAttribute('r') || '');
      if (column > 11) return;
      const type = cell.getAttribute('t');
      const raw = cell.getElementsByTagName('v')[0]?.textContent || '';
      const inline = cell.getElementsByTagName('t')[0]?.textContent || '';
      values[column] = type === 's' ? sharedStrings[Number(raw)] || '' : type === 'inlineStr' ? inline : raw;
    });
    return Array.from({ length: Math.min(12, Math.max(1, values.length)) }, (_, index) => values[index] || '');
  }).filter((row) => row.some((cell) => String(cell).trim()));
}

function XlsxPreview({ file }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const cacheKey = previewCacheKey(file, 'xlsx');
    const cached = getPreviewCache(cacheKey);
    if (cached) {
      setRows(cached.rows || []);
      setError(cached.error || '');
      return undefined;
    }
    let active = true;
    setRows([]);
    setError('');
    const cancelIdle = runWhenIdle(() => {
      readStoredFile(file.path)
        .then(async (bytes) => {
          const entries = await readZipEntries(bytes);
          const sharedStrings = parseSharedStrings(await zipEntryText(entries, 'xl/sharedStrings.xml'));
          const sheetPath = firstWorksheetPath(
            await zipEntryText(entries, 'xl/workbook.xml'),
            await zipEntryText(entries, 'xl/_rels/workbook.xml.rels'),
          );
          return parseXlsxRows(await zipEntryText(entries, sheetPath), sharedStrings);
        })
        .then((nextRows) => {
          setPreviewCache(cacheKey, { rows: nextRows, error: '' });
          if (active) setRows(nextRows);
        })
        .catch((nextError) => {
          const errorText = String(nextError);
          setPreviewCache(cacheKey, { rows: [], error: errorText });
          if (active) setError(errorText);
        });
    });
    return () => {
      active = false;
      cancelIdle();
    };
  }, [file]);

  if (error) return <div className="file-preview-empty">{error}</div>;
  if (!rows.length) return <div className="file-preview-empty">Loading Excel preview...</div>;
  return <SpreadsheetPreview rows={rows} />;
}

function FolderPreview({ file }) {
  const files = file.folderFiles || [];
  return (
    <div className="folder-preview">
      <div className="section-title">
        <h3>{file.name}</h3>
        <span>{files.length} files</span>
      </div>
      {files.length ? files.map((child) => (
        <div key={child.id || child.relativePath || child.name} className="folder-preview-row">
          <span>{child.relativePath || child.name}</span>
          <button className="ghost" onClick={() => openStoredFile(child.path)}>Open</button>
        </div>
      )) : <p>No files found in this folder.</p>}
    </div>
  );
}

function StlPreview({ file }) {
  const canvasRef = useRef(null);
  const trianglesRef = useRef([]);
  const viewRef = useRef({ rotationX: -0.55, rotationY: 0.65, zoom: 1 });
  const dragRef = useRef(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  const redraw = () => drawStl(canvasRef.current, trianglesRef.current, viewRef.current);

  useEffect(() => {
    const cacheKey = previewCacheKey(file, 'stl');
    const cached = getPreviewCache(cacheKey);
    if (cached?.triangles?.length) {
      trianglesRef.current = cached.triangles;
      viewRef.current = { rotationX: -0.55, rotationY: 0.65, zoom: 1 };
      setError('');
      setReady(true);
      requestAnimationFrame(redraw);
      return undefined;
    }
    let active = true;
    setError('');
    setReady(false);
    const cancelIdle = runWhenIdle(() => {
      readStoredFile(file.path)
        .then((bytes) => {
          if (!active) return;
          const triangles = limitTriangles(parseStl(bytes), MODEL_TRIANGLE_LIMIT);
          if (!triangles.length) {
            setError('No previewable STL geometry was found.');
            return;
          }
          setPreviewCache(cacheKey, { triangles });
          trianglesRef.current = triangles;
          viewRef.current = { rotationX: -0.55, rotationY: 0.65, zoom: 1 };
          setReady(true);
          requestAnimationFrame(redraw);
        })
        .catch(() => {
          if (active) setError('Could not preview this STL.');
        });
    });
    return () => {
      active = false;
      cancelIdle();
      trianglesRef.current = [];
    };
  }, [file]);

  useEffect(() => {
    if (ready) redraw();
  }, [ready]);

  const rotate = (event) => {
    if (!dragRef.current) return;
    const dx = event.clientX - dragRef.current.x;
    const dy = event.clientY - dragRef.current.y;
    dragRef.current = { x: event.clientX, y: event.clientY };
    viewRef.current = {
      ...viewRef.current,
      rotationX: viewRef.current.rotationX + dy * 0.01,
      rotationY: viewRef.current.rotationY + dx * 0.01,
    };
    redraw();
  };

  const zoom = (event) => {
    event.preventDefault();
    const nextZoom = viewRef.current.zoom * Math.exp(-event.deltaY * 0.001);
    viewRef.current = { ...viewRef.current, zoom: Math.max(0.25, Math.min(6, nextZoom)) };
    redraw();
  };

  if (error) return <OpenFallback file={file} message={error} />;

  return (
    <div className="model-preview">
      <canvas
        ref={canvasRef}
        width="720"
        height="520"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerMove={rotate}
        onPointerUp={() => { dragRef.current = null; }}
        onPointerCancel={() => { dragRef.current = null; }}
        onWheel={zoom}
      />
      <span>{ready ? 'Drag to rotate. Scroll to zoom.' : 'Loading STL preview...'}</span>
    </div>
  );
}

function ObjPreview({ file }) {
  const canvasRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const cacheKey = previewCacheKey(file, 'obj');
    const cached = getPreviewCache(cacheKey);
    if (cached?.triangles?.length) {
      setError('');
      requestAnimationFrame(() => drawStl(canvasRef.current, cached.triangles));
      return undefined;
    }
    let active = true;
    setError('');
    const cancelIdle = runWhenIdle(() => {
      readStoredFile(file.path)
        .then((bytes) => new TextDecoder().decode(bytes))
        .then((text) => {
          if (!active) return;
          const triangles = limitTriangles(parseObj(text), MODEL_TRIANGLE_LIMIT);
          if (!triangles.length) {
            setError('No previewable OBJ geometry was found.');
            return;
          }
          setPreviewCache(cacheKey, { triangles });
          drawStl(canvasRef.current, triangles);
        })
        .catch(() => {
          if (active) setError('Could not preview this OBJ.');
        });
    });
    return () => {
      active = false;
      cancelIdle();
    };
  }, [file]);

  if (error) return <OpenFallback file={file} message={error} />;

  return (
    <div className="model-preview">
      <canvas ref={canvasRef} width="720" height="520" />
      <span>Shaded OBJ preview</span>
    </div>
  );
}

function DxfPreview({ file }) {
  const canvasRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const cacheKey = previewCacheKey(file, 'dxf');
    const cached = getPreviewCache(cacheKey);
    if (cached?.shapes?.length) {
      setError('');
      requestAnimationFrame(() => drawDxf(canvasRef.current, cached.shapes));
      return undefined;
    }
    let active = true;
    setError('');
    const cancelIdle = runWhenIdle(() => {
      readStoredFile(file.path)
        .then((bytes) => new TextDecoder().decode(bytes))
        .then((text) => {
          if (!active) return;
          const shapes = parseDxf(text);
          if (!shapes.length) {
            setError('No previewable DXF geometry was found.');
            return;
          }
          setPreviewCache(cacheKey, { shapes });
          drawDxf(canvasRef.current, shapes);
        })
        .catch(() => {
          if (active) setError('Could not preview this DXF.');
        });
    });
    return () => {
      active = false;
      cancelIdle();
    };
  }, [file]);

  if (error) return <OpenFallback file={file} message={error} />;

  return (
    <div className="cad-preview">
      <canvas ref={canvasRef} width="720" height="520" />
      <span>DXF preview</span>
    </div>
  );
}

function drawStl(canvas, triangles, view = { rotationX: -0.55, rotationY: 0.65, zoom: 1 }) {
  if (!canvas) return;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = cssColor('--field', '#151a20');
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (!triangles.length) return;

  const validTriangles = triangles.filter(isValidTriangle);
  const points = validTriangles.flat();
  if (!points.length) return;
  const min = [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis])));
  const center = [0, 1, 2].map((axis) => (min[axis] + max[axis]) / 2);
  const size = Math.max(...[0, 1, 2].map((axis) => max[axis] - min[axis])) || 1;
  const scale = Math.min(canvas.width, canvas.height) * 0.72 * (view.zoom || 1) / size;
  const sinX = Math.sin(view.rotationX ?? -0.55);
  const cosX = Math.cos(view.rotationX ?? -0.55);
  const sinY = Math.sin(view.rotationY ?? 0.65);
  const cosY = Math.cos(view.rotationY ?? 0.65);

  const projected = validTriangles.map((triangle) => {
    const pts = triangle.map(([x, y, z]) => {
      const px = x - center[0];
      const py = y - center[1];
      const pz = z - center[2];
      const y1 = py * cosX - pz * sinX;
      const z1 = py * sinX + pz * cosX;
      const x2 = px * cosY + z1 * sinY;
      const z2 = -px * sinY + z1 * cosY;
      return [canvas.width / 2 + x2 * scale, canvas.height / 2 - y1 * scale, z2];
    });
    const depth = pts.reduce((total, point) => total + point[2], 0) / 3;
    return { pts, depth };
  }).sort((a, b) => b.depth - a.depth);

  projected.forEach(({ pts }) => {
    context.beginPath();
    context.moveTo(pts[0][0], pts[0][1]);
    context.lineTo(pts[1][0], pts[1][1]);
    context.lineTo(pts[2][0], pts[2][1]);
    context.closePath();
    context.fillStyle = cssColor('--accent', '#4da3ff');
    context.fill();
    context.strokeStyle = cssColor('--text-soft', '#c9d0d7');
    context.stroke();
  });
}

function drawDxf(canvas, shapes) {
  if (!canvas) return;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = cssColor('--field', '#151a20');
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (!shapes.length) return;

  const points = shapes.flatMap((shape) => {
    if (shape.type === 'line') return shape.points;
    if (shape.type === 'circle' || shape.type === 'arc') {
      return [
        [shape.center[0] - shape.radius, shape.center[1] - shape.radius],
        [shape.center[0] + shape.radius, shape.center[1] + shape.radius],
      ];
    }
    return [];
  });
  const minX = Math.min(...points.map((point) => point[0]));
  const maxX = Math.max(...points.map((point) => point[0]));
  const minY = Math.min(...points.map((point) => point[1]));
  const maxY = Math.max(...points.map((point) => point[1]));
  const width = maxX - minX || 1;
  const height = maxY - minY || 1;
  const margin = 28;
  const scale = Math.min((canvas.width - margin * 2) / width, (canvas.height - margin * 2) / height);
  const map = ([x, y]) => [margin + (x - minX) * scale, margin + (maxY - y) * scale];

  context.strokeStyle = cssColor('--accent', '#4da3ff');
  context.lineWidth = 2;
  shapes.forEach((shape) => {
    context.beginPath();
    if (shape.type === 'line') {
      const start = map(shape.points[0]);
      const end = map(shape.points[1]);
      context.moveTo(start[0], start[1]);
      context.lineTo(end[0], end[1]);
    }
    if (shape.type === 'circle') {
      const center = map(shape.center);
      context.arc(center[0], center[1], shape.radius * scale, 0, Math.PI * 2);
    }
    if (shape.type === 'arc') {
      const center = map(shape.center);
      context.arc(center[0], center[1], shape.radius * scale, -shape.end * Math.PI / 180, -shape.start * Math.PI / 180);
    }
    context.stroke();
  });
}

function OpenFallback({ file, message }) {
  return (
    <div className="file-preview-empty">
      <p>{message}</p>
      <button className="ghost" onClick={() => openStoredFile(file.path)}>Open File</button>
    </div>
  );
}

export function FilePreview({ file }) {
  if (!file) return <div className="file-preview-empty">Choose a latest file to preview.</div>;
  if (file.type === 'folder') return <FolderPreview file={file} />;
  if (!file.path) return <div className="file-preview-empty">This sample file does not have a local path yet.</div>;

  const extension = fileExtension(file.name);
  if (extension === '.pdf') return <PdfPreview path={file.path} title={file.name} />;
  if (IMAGE_EXTENSIONS.includes(extension)) return <StoredPreviewImage className="file-preview-image" path={file.path} alt="" />;
  if (TEXT_EXTENSIONS.includes(extension)) return <TextFilePreview file={file} />;
  if (extension === '.csv') return <CsvPreview file={file} />;
  if (extension === '.xlsx') return <XlsxPreview file={file} />;
  if (extension === '.stl') return <StlPreview file={file} />;
  if (extension === '.obj') return <ObjPreview file={file} />;
  if (extension === '.dxf') return <DxfPreview file={file} />;
  if (SHELL_THUMBNAIL_EXTENSIONS.includes(extension)) return <ShellThumbnailPreview file={file} />;

  if (EXTERNAL_VIEWER_MESSAGES[extension]) {
    return (
      <div className="file-preview-empty">
        <strong>{file.name}</strong>
        <p>{EXTERNAL_VIEWER_MESSAGES[extension]}</p>
        <button className="ghost" onClick={() => openStoredFile(file.path)}>Open File</button>
      </div>
    );
  }

  return (
    <div className="file-preview-empty">
      <strong>{file.name}</strong>
      <p>Inline preview is not wired for this file type yet.</p>
      <button className="ghost" onClick={() => openStoredFile(file.path)}>Open File</button>
    </div>
  );
}

export function isPreviewableFile(file) {
  const extension = fileExtension(file?.name || '');
  return Boolean(file?.path) && (
    extension === '.pdf'
    || IMAGE_EXTENSIONS.includes(extension)
    || TEXT_EXTENSIONS.includes(extension)
    || ['.csv', '.xlsx', '.stl', '.obj', '.dxf'].includes(extension)
    || SHELL_THUMBNAIL_EXTENSIONS.includes(extension)
    || Boolean(EXTERNAL_VIEWER_MESSAGES[extension])
  );
}

export function ExpandedPartFileModal({ file, onClose }) {
  if (!file?.path) return null;
  const extension = fileExtension(file.name);
  const isImage = file.previewType === 'image' || IMAGE_EXTENSIONS.includes(extension);

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal expanded-preview-modal ${isImage ? 'image-preview-modal' : ''}`}>
        <div className="section-title">
          <h2>{file.name}</h2>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
        {extension === '.pdf' ? (
          <PdfPreview path={file.path} title={file.name} className="pdf-preview expanded" />
        ) : isImage ? (
          <StoredPreviewImage className="expanded-preview-image" path={file.path} alt="" />
        ) : (
          <FilePreview file={file} />
        )}
      </div>
    </div>
  );
}

export function ExpandablePdfPreview({ pdf, onExpand, className = 'pdf-preview compact', label = 'Click to expand' }) {
  if (!pdf?.path) return null;
  return (
    <div className="pdf-preview-click-target" onClick={onExpand}>
      <PdfPreview path={pdf.path} title={pdf.name} className={className} />
      <div className="pdf-preview-overlay">{label}</div>
    </div>
  );
}
