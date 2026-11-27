import { useLayoutEffect, useRef, useState } from 'react';
import { Feedback, useObjectUrl } from './components';
import { UiError } from './errors';
import { MAX_SCAN_IMAGE_BYTES, MAX_SCAN_PAGES, MAX_SCAN_PDF_MIB } from './scanPdf';
import type { ScanImage } from './scanPdf';
import { useExamCamera } from './useExamCamera';
import type { CapturedImage } from './useExamCamera';
import { Icon } from './icons';

type Page = CapturedImage & { id: number };

type CameraScanProps = {
  visible: boolean;
  busy: boolean;
  demo: boolean;
  uploadStatus?: string;
  uploadError?: string;
  onClose: () => void;
  onContinue: (images: readonly ScanImage[]) => void;
};

function PagePreview({ page, number }: { page: Page; number: number }) {
  const url = useObjectUrl(page.jpeg);

  return url && (
    <>
      <img className="scan-media" src={url} width={page.width} height={page.height} alt={'Captured exam page ' + number} />
      <a className="scan-image-link" href={url} target="_blank" rel="noreferrer">View full-size page (opens in a new tab)</a>
    </>
  );
}

function PageThumbnail({ page }: { page: Page }) {
  const url = useObjectUrl(page.thumbnail);
  return <span className="page-thumbnail" aria-hidden="true">{url ? <img src={url} alt="" /> : <Icon name="document" />}</span>;
}

export default function CameraScan({ visible, busy, demo, uploadStatus, uploadError, onClose, onContinue }: CameraScanProps) {
  const camera = useExamCamera(visible);
  const [pages, setPages] = useState<Page[]>([]);
  const [selected, setSelected] = useState<number>();
  const [capturing, setCapturing] = useState(false);
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const nextPageId = useRef(1);
  const retakeId = useRef<number | undefined>(undefined);
  const capturePending = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const discard = useRef<HTMLDialogElement>(null);
  const keepPages = useRef<HTMLButtonElement>(null);
  const cancelScan = useRef<HTMLButtonElement>(null);
  const focusPreview = useRef(false);
  const selectedIndex = pages.findIndex(page => page.id === selected);
  const selectedPage = pages[selectedIndex];
  const cameraActive = camera.phase !== 'idle';
  const photoBytes = pages.reduce((total, page) => total + page.jpeg.size, 0);
  const photoSize = photoBytes < 1024 * 1024 ? Math.ceil(photoBytes / 1024) + ' KiB' : (photoBytes / 1024 / 1024).toFixed(2) + ' MiB';
  const locked = busy || capturing;
  const startCamera = camera.start;

  useLayoutEffect(() => {
    heading.current?.focus();
    void startCamera();
  }, [startCamera]);

  useLayoutEffect(() => {
    if (focusPreview.current && !cameraActive) {
      focusPreview.current = false;
      (previewHeading.current ?? heading.current)?.focus();
    }
  }, [cameraActive, pages]);

  function start(pageId?: number) {
    retakeId.current = pageId;
    setError(undefined);
    setStatus(undefined);
    heading.current?.focus();
    void startCamera();
  }

  async function takePicture() {
    if (capturePending.current || !camera.ready) return;
    capturePending.current = true;
    setCapturing(true);
    setError(undefined);
    try {
      const image = await camera.capture();
      if (!image) return;
      const replacing = retakeId.current;
      const keptBytes = photoBytes - (replacing === undefined ? 0 : (selectedPage?.jpeg.size ?? 0));
      if (keptBytes + image.jpeg.size > MAX_SCAN_IMAGE_BYTES) {
        throw new UiError('The scan would exceed ' + MAX_SCAN_PDF_MIB + ' MiB. Remove a page or split the scan before trying again.');
      }
      const id = replacing ?? nextPageId.current++;
      focusPreview.current = true;
      setPages(replacing === undefined ? [...pages, { ...image, id }] : pages.map(page => page.id === id ? { ...image, id } : page));
      setSelected(id);
      setStatus(replacing === undefined ? 'Page ' + (pages.length + 1) + ' captured.' : 'Page ' + (selectedIndex + 1) + ' replaced.');
    } catch (failure) {
      setError(failure instanceof UiError ? failure.message : 'The photo could not be captured. Try again.');
    } finally {
      capturePending.current = false;
      setCapturing(false);
    }
  }

  function removePage() {
    const remaining = pages.filter(page => page.id !== selected);
    focusPreview.current = true;
    setSelected(remaining[Math.min(selectedIndex, remaining.length - 1)]?.id);
    setPages(remaining);
    setError(undefined);
    setStatus('Page ' + (selectedIndex + 1) + ' removed.');
  }

  function movePage(offset: number) {
    const target = selectedIndex + offset;
    if (!selectedPage || target < 0 || target >= pages.length) return;
    const reordered = pages.slice();
    reordered.splice(selectedIndex, 1);
    reordered.splice(target, 0, selectedPage);
    focusPreview.current = true;
    setPages(reordered);
    setStatus('Page moved to position ' + (target + 1) + ' of ' + pages.length + '.');
  }

  let cameraStatus = status;
  if (capturing) cameraStatus = 'Capturing page…';
  else if (camera.phase === 'opening') cameraStatus = 'Opening camera…';
  else if (camera.phase === 'live') {
    cameraStatus = !camera.ready ? 'Waiting for the live preview…'
      : retakeId.current === undefined ? 'Camera is open.' : 'Ready to retake page ' + (selectedIndex + 1) + '.';
  }

  return (
    <section className="panel camera-panel" id="camera-scan" aria-labelledby="scan-heading">
      <div className="section-heading">
        <div className="section-title"><span className="icon-tile"><Icon name="camera" /></span><h3 id="scan-heading" tabIndex={-1} ref={heading}>Scan with Camera</h3></div>
        <div className="status-line"><p className="tag">{pages.length} {pages.length === 1 ? 'page' : 'pages'} captured</p><p className="identifier">{photoSize} in photos</p></div>
      </div>
      <p className="scan-hint">Keep the page flat and well lit. Fit all four corners in the preview and check that small text is readable.</p>
      <Feedback status={cameraStatus} error={error ?? camera.error} pending={capturing || camera.phase === 'opening'} />

      <div className="scan-layout">
        <div className="scan-stage">
          <div className="video-frame" hidden={!cameraActive}>
            <video ref={camera.video} className="scan-media" aria-label="Live camera preview"
              muted playsInline onLoadedData={camera.markReady} onPlaying={camera.markReady} />
            {camera.ready && <div className="scan-guides" aria-hidden="true"><i /><i /><i /><i /></div>}
          </div>
          {cameraActive ? (
            <div className="actions">
              <button type="button" className="primary" disabled={locked || !camera.ready || camera.phase !== 'live'}
                onClick={() => void takePicture()}><Icon name="camera" /> Capture</button>
              <button type="button" disabled={locked} onClick={() => {
                focusPreview.current = true;
                camera.stop();
                setStatus('Camera closed.');
              }}>Close camera</button>
            </div>
          ) : (
            <>
              {selectedPage && <>
                <h4 tabIndex={-1} ref={previewHeading}>Page {selectedIndex + 1} preview</h4>
                <PagePreview page={selectedPage} number={selectedIndex + 1} />
              </>}
              <div className="actions">
                <button type="button" className="primary" disabled={locked || pages.length >= MAX_SCAN_PAGES}
                  onClick={() => start()}>{pages.length ? 'Add Page' : 'Open camera'}</button>
                {selectedPage && <button type="button" disabled={locked} onClick={() => start(selectedPage.id)}>Retake</button>}
              </div>
            </>
          )}
        </div>

        <section className="scan-pages" aria-labelledby="scan-pages-heading">
          <h4 id="scan-pages-heading">Captured pages</h4>
          {pages.length === 0 ? <p>No pages captured yet.</p> : (
            <>
              <ol className="scan-page-list" role="list">
                {pages.map((page, index) => (
                  <li key={page.id}>
                    <button type="button" disabled={locked || cameraActive} aria-pressed={page.id === selected}
                      onClick={() => setSelected(page.id)} aria-label={'Preview page ' + (index + 1)}>
                      <PageThumbnail page={page} /><span>Page {index + 1}</span>
                    </button>
                  </li>
                ))}
              </ol>
              <div className="actions">
                <button type="button" disabled={locked || cameraActive || selectedIndex <= 0}
                  onClick={() => movePage(-1)}>Move earlier</button>
                <button type="button" disabled={locked || cameraActive || selectedIndex >= pages.length - 1}
                  onClick={() => movePage(1)}>Move later</button>
                <button type="button" className="quiet" disabled={locked || cameraActive}
                  onClick={removePage}>Remove</button>
              </div>
            </>
          )}
          <p>Up to {MAX_SCAN_PAGES} pages and {MAX_SCAN_PDF_MIB} MiB per scan.</p>
        </section>
      </div>

      <div className="scan-footer">
        <p>{demo
          ? 'Demo mode opens the sample draft for review. The scan stays in this browser.'
          : 'Continuing uploads an image-only PDF. The exam server must support scanned PDFs to create a draft.'}</p>
        <Feedback status={uploadStatus} error={uploadError} pending={Boolean(uploadStatus)} />
        <div className="actions">
          <button type="button" className="primary" disabled={locked || cameraActive || !pages.length} onClick={() => {
            setError(undefined);
            camera.stop();
            onContinue(pages);
          }}>Continue <Icon name="arrow" /></button>
          <button type="button" ref={cancelScan} disabled={busy} onClick={() => {
            camera.stop();
            if (pages.length) {
              discard.current?.showModal();
              keepPages.current?.focus();
            } else {
              onClose();
            }
          }}>Cancel</button>
        </div>
      </div>
      <dialog className="confirmation-dialog" ref={discard} aria-labelledby="discard-scan-title" aria-describedby="discard-scan-help"
        onClose={() => cancelScan.current?.focus()}>
        <h3 id="discard-scan-title">Discard captured pages?</h3>
        <p id="discard-scan-help">The pages in this scan will be deleted when you leave the capture studio.</p>
        <div className="actions">
          <button type="button" ref={keepPages} onClick={() => discard.current?.close()}>Keep pages</button>
          <button type="button" className="danger" onClick={() => {
            discard.current?.close();
            onClose();
          }}>Discard scan</button>
        </div>
      </dialog>
    </section>
  );
}
