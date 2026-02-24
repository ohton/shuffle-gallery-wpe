console.log('app.js loaded');

// Info API endpoint (keep as a constant near the top for easy configuration)
const convertinfoapiurl = 'http://localhost:8000/info/';

const _sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Retry configuration ---
const MAX_FETCH_RETRIES = 4;

// Timing constants (replace magic numbers)
const VIDEO_METADATA_WAIT_MS = 1000; // wait for video metadata
const NO_DATA_RETRY_MS = 3000; // wait when no data fetched
const ANIMATION_DISPLAY_MS = 10000; // display time for animated content
const STATIC_DISPLAY_MS = 11000; // display time for static images
const VIDEO_SHORT_FALLBACK_MS = 3000; // fallback wait for very short/unknown videos
const MIN_VIDEO_DISPLAY_MS = 10000; // minimum wait for videos
const VIDEO_META_PAD_MS = 1000; // padding when calculating video wait
// Toggle for video URL mode: true uses transcoded /bestFit, false uses raw
const USE_VIDEO_BEST_FIT = false;

// Pan animation state (weak map to avoid leaks)
const panRafIds = new WeakMap();

// Background blur amount (pixels)
const BG_BLUR_PX = 5;

function cancelPan(el) {
    try {
        if (!el) return;
        const id = panRafIds.get(el);
        if (typeof id === 'number') cancelAnimationFrame(id);
        panRafIds.delete(el);
    } catch (e) { /* ignore */ }
}

function startPan(el, durationMs, orientation = 'vertical') {
    try {
        if (!el || !durationMs || durationMs <= 0) return;
        cancelPan(el);
        const start = performance.now();
        let from, to, axis;
        if (orientation === 'horizontal') {
            from = 0; // left
            to = 100; // right
            axis = 'x';
        } else {
            from = 100; // bottom
            to = 0; // top
            axis = 'y';
        }
        function step(now) {
            const t = Math.min(1, (now - start) / durationMs);
            const val = from + (to - from) * t;
            if (axis === 'x') el.style.objectPosition = `${val}% 50%`;
            else el.style.objectPosition = `50% ${val}%`;
            if (t < 1) {
                const raf = requestAnimationFrame(step);
                panRafIds.set(el, raf);
            } else {
                panRafIds.delete(el);
            }
        }
        // set initial position and start
        if (axis === 'x') el.style.objectPosition = `${from}% 50%`;
        else el.style.objectPosition = `50% ${from}%`;
        const raf = requestAnimationFrame(step);
        panRafIds.set(el, raf);
    } catch (e) { /* ignore */ }
}

// NOTE: binary <-> base64 helpers removed; we now use media URLs directly.

async function fetchWithRetry(url, options) {
    let attempt = 0;
    let lastErr = null;
    while (attempt < MAX_FETCH_RETRIES) {
        try {
            const res = await fetch(url, options);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res;
        } catch (e) {
            lastErr = e;
            const backoff = Math.pow(2, attempt) * 500 + Math.random() * 200;
            console.warn(`fetchWithRetry attempt ${attempt + 1} failed, retrying in ${Math.round(backoff)}ms`, e);
            // wait
            // eslint-disable-next-line no-await-in-loop
            await _sleep(backoff);
            attempt += 1;
        }
    }
    throw lastErr;
}

let query_text = '';
let pictureQuery = '';

// DOM related nodes - only resolve in browser environment
let randomImage = null;
let mainImage = null;
let randomVideo = null;
let randomVideoLarge = null;
// temporary flag: when true, front video should keep looping (short clips)
let frontTempLoop = false;
// Two sets of elements for crossfade
let imgBg1 = null;
let imgMain1 = null;
let vidBg1 = null;
let vidMain1 = null;
let imgBg2 = null;
let imgMain2 = null;
let vidBg2 = null;
let vidMain2 = null;
let exifToggleButton = null;
let exifContainer = null;
let exifTextP = null;
let settingsBtn = null;
let settingsPopup = null;
let settingsContainer = null;
let settingsOverlayCheckbox = null;
let settingsMetadataCheckbox = null;

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    try {
        const url = new URL(document.location.href);
        const params = new URLSearchParams(url.search);
        query_text = params.get('text');
        if (query_text == null) query_text = '';

        pictureQuery = encodeURIComponent('{"type":100,"text":"' + query_text + '"}');
        pictureQuery = encodeURIComponent('{"type":100,"text":"' + query_text + '"}');

        // Get both sets of elements for crossfade
        imgBg1 = document.getElementById("img-bg-1");
        imgMain1 = document.getElementById("img-main-1");
        vidBg1 = document.getElementById("vid-bg-1");
        vidMain1 = document.getElementById("vid-main-1");
        imgBg2 = document.getElementById("img-bg-2");
        imgMain2 = document.getElementById("img-main-2");
        vidBg2 = document.getElementById("vid-bg-2");
        vidMain2 = document.getElementById("vid-main-2");
        // Ensure background layers start with configured blur
        try {
            [imgBg1, imgBg2, vidBg1, vidBg2].forEach(el => { if (el) el.style.filter = `blur(${BG_BLUR_PX}px)`; });
        } catch (e) { /* ignore */ }
        // Legacy references for compatibility
        randomImage = imgBg1;
        mainImage = imgMain1;
        randomVideo = vidBg1;
        randomVideoLarge = vidMain1;
        // Ensure background videos will restart if they unexpectedly end
        try {
            if (randomVideo) {
                randomVideo.loop = true;
                randomVideo.addEventListener('ended', () => {
                    try { randomVideo.currentTime = 0; randomVideo.play().catch(() => {}); } catch (e) { /* ignore */ }
                });
            }
            if (randomVideoLarge) {
                randomVideoLarge.addEventListener('ended', () => {
                    try {
                        // If we're temporarily looping short clips, resume play instead
                        if (frontTempLoop) {
                            try { randomVideoLarge.play().catch(() => {}); } catch (e) { /* ignore */ }
                            return;
                        }
                        // hide the front video when it ends and ensure background plays
                        randomVideoLarge.classList.remove('visible');
                        randomVideoLarge.currentTime = 0;
                        try { randomVideoLarge.pause(); } catch (e) { /* ignore */ }
                        if (randomVideo && randomVideo.paused) randomVideo.play().catch(() => {});
                    } catch (e) { /* ignore */ }
                });
            }
        } catch (e) { /* ignore */ }
        exifToggleButton = document.getElementById('exif-toggle');
        exifContainer = document.getElementById('exif-container');
        exifTextP = document.getElementById('exif-text-p');
        settingsBtn = document.getElementById('settings-btn');
        settingsPopup = document.getElementById('settings-popup');
        settingsContainer = document.getElementById('settings-container');
        settingsOverlayCheckbox = document.getElementById('settings-overlay-checkbox');
        settingsMetadataCheckbox = document.getElementById('settings-metadata-checkbox');

        // Move settings button to left-top for easier access
        try {
            if (settingsBtn) {
                settingsBtn.style.position = 'fixed';
                settingsBtn.style.top = '12px';
                settingsBtn.style.left = '12px';
                // clear any right-side positioning
                settingsBtn.style.right = '';
                settingsBtn.style.zIndex = 10001;
            }
        } catch (e) {
            // ignore
        }
        // Move settings container and popup to left-top as well (if present)
        try {
            if (settingsContainer) {
                settingsContainer.style.position = 'fixed';
                settingsContainer.style.top = '8px';
                settingsContainer.style.left = '8px';
                settingsContainer.style.right = '';
                settingsContainer.style.zIndex = 10000;
            }
        } catch (e) { /* ignore */ }
        try {
            if (settingsPopup) {
                settingsPopup.style.position = 'fixed';
                settingsPopup.style.top = '40px';
                settingsPopup.style.left = '12px';
                settingsPopup.style.right = '';
                settingsPopup.style.zIndex = 10000;
            }
        } catch (e) { /* ignore */ }

        // Mutation observer to restart animation when background changed
        if (typeof MutationObserver !== 'undefined' && randomImage && mainImage) {
            const o = new MutationObserver(() => {
                randomImage.style.animation = 'none';
                // force reflow
                // eslint-disable-next-line no-unused-expressions
                randomImage.offsetHeight;
                randomImage.style.animation = null;
            });
            o.observe(mainImage, { attributes: true, attributeFilter: ["style"] });
        }
    } catch (e) {
        console.warn('app.js: DOM initialization skipped (non-browser environment)', e);
    }
}


let bgimgurl;
let bgimg;
let is_animation;
let abFileTypeFromInfo = null;
let infoItemName = null;
let infoUsed = false;
let infoKeywords = null;
let infoMetadata = null;
// Track the info of the media currently displayed on screen
let currentInfoName = null;
let currentInfoKeywords = null;
let currentInfoMetadata = null;
let currentMediaUrl = null;
// Leaflet map instance used inside overlay (if any)
let infoOverlayMap = null;
// Prefetch storage: when preloadImages is called in background it will populate this
let prefetchedInfo = null;
// UI setting: whether to show info name/keywords overlay. Default: false (non表示)
let showInfoOverlayEnabled = false;
// whether to show metadata/raw JSON inside the info overlay
let showInfoMetadataEnabled = false;
// Track which image element is currently visible (for crossfade)
let useMainImageLayer = false;

// Removed legacy convert API fallback; Info API only flow

// Build media content URL from info result
function buildMediaUrlFromInfo(infoUrl, infoResult) {
    try {
        const infoU = new URL(infoUrl);
        const origin = infoU.origin; // e.g. http://hostname.local
        let dirPath = (infoResult.directory && infoResult.directory.path) || '';
        let dirName = (infoResult.directory && infoResult.directory.name) || '';
        let fileName = infoResult.name || '';

        // normalize and sanitize
        dirPath = String(dirPath || '').trim().replace(/\\/g, '/');
        dirName = String(dirName || '').trim();
        fileName = String(fileName || '').trim();

        let segments = [];
        if (dirPath) {
            // remove leading/trailing slashes then split
            const cleaned = dirPath.replace(/^\/+|\/+$/g, '');
            if (cleaned.length) segments = segments.concat(cleaned.split('/'));
        }
        if (dirName) segments.push(dirName);
        if (fileName) segments.push(fileName);

        // filter out '.' or empty segments (defensive against API returning '.')
        segments = segments.map(s => (s || '').trim()).filter(s => s && s !== '.' && s !== './');

        const encoded = segments.map(s => encodeURIComponent(s)).join('/');
        // If the original filename is HEIC (or other raster images), request the
        // 1080-converted variant so the server returns a web-friendly converted
        // file (webp). However, if the item is an APNG (animated PNG) we must
        // use the original source (do NOT request /1080) so animation is preserved.
        const ext = (fileName.split('.').pop() || '').toLowerCase();
        // For images request the converted /1080 variant so the server
        // can return a web-friendly converted file. Do NOT apply this
        // for known video extensions — leave video URLs unchanged.
        const imageExts = ['heic', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif'];
        const videoExts = ['mp4', 'webm', 'ogg', 'mkv'];
        // detect APNG from metadata keywords if present; don't convert APNG
        // to /1080 because that would lose animation.
        try {
            const metaKeywords = (infoResult && infoResult.metadata && infoResult.metadata.keywords) || [];
            const hasApng = Array.isArray(metaKeywords) && metaKeywords.some(k => typeof k === 'string' && k.toLowerCase().includes('apng'));
            if (imageExts.includes(ext) && !videoExts.includes(ext)) {
                if (hasApng) {
                    return `${origin}/pgapi/gallery/content/${encoded}`;
                }
                return `${origin}/pgapi/gallery/content/${encoded}/1080`;
            }
            if (videoExts.includes(ext)) {
                return USE_VIDEO_BEST_FIT
                    ? `${origin}/pgapi/gallery/content/${encoded}/bestFit`
                    : `${origin}/pgapi/gallery/content/${encoded}`;
            }
        } catch (e) {
            // if metadata inspection fails, fall back to converted variant for images
            if (imageExts.includes(ext) && !videoExts.includes(ext)) {
                return `${origin}/pgapi/gallery/content/${encoded}/1080`;
            }
        }
        if (videoExts.includes(ext)) {
            return USE_VIDEO_BEST_FIT
                ? `${origin}/pgapi/gallery/content/${encoded}/bestFit`
                : `${origin}/pgapi/gallery/content/${encoded}`;
        }
        return `${origin}/pgapi/gallery/content/${encoded}`;
    } catch (e) {
        console.warn('buildMediaUrlFromInfo failed', e);
        return null;
    }
}

// show/hide overlay with info item name (only when info-based flow succeeded)
function showInfoNameOverlay(name, keywords) {
    if (typeof document === 'undefined') return;
    let el = document.getElementById('info-name-overlay');
    if (!el) {
        el = document.createElement('aside');
        el.id = 'info-name-overlay';
        // left column, up to 1/3 width, full height
        el.style.position = 'fixed';
        el.style.right = '0';
        el.style.top = '0';
        el.style.bottom = '0';
        el.style.width = '33vw';
        el.style.maxWidth = '480px';
        el.style.padding = '12px 14px';
        // increase opacity for better legibility
        el.style.background = 'rgba(12,12,16,0.5)';
        el.style.color = '#fff';
        // base font size tuned for ~13" FHD displays
        el.style.fontSize = '16px';
        // prefer Japanese UI fonts for filenames
        el.style.fontFamily = 'Noto Sans JP, "Yu Gothic UI", "Meiryo", "Hiragino Kaku Gothic ProN", "Segoe UI", Arial, sans-serif';
        el.style.zIndex = 10000;
        // prevent native scrollbars; we'll visually fade long content
        el.style.overflow = 'hidden';
        el.style.boxSizing = 'border-box';
        el.style.backdropFilter = 'blur(4px)';
        el.style.borderLeft = '1px solid rgba(255,255,255,0.04)';
        // ensure children can position relative to container
        el.style.position = 'fixed';
        document.body.appendChild(el);
    }
    // Ensure any previous Leaflet instance / DOM is removed before re-render
    try {
        if (infoOverlayMap) {
            try { infoOverlayMap.remove(); } catch (e) { /* ignore */ }
            infoOverlayMap = null;
        }
    } catch (e) { /* ignore */ }
    try {
        const prev = document.getElementById('info-leaflet-map');
        if (prev && prev.parentNode) {
            try { prev.parentNode.removeChild(prev); } catch (e) { /* ignore */ }
        }
    } catch (e) { /* ignore */ }
    // build multi-line content
    el.innerHTML = '';
    const title = document.createElement('div');
    title.style.fontWeight = '700';
    title.style.fontSize = '20px';
    title.style.lineHeight = '1.1';
    title.style.fontFamily = 'Noto Sans JP, "Yu Gothic UI", "Meiryo", "Hiragino Kaku Gothic ProN", "Segoe UI", Arial, sans-serif';
    title.style.marginBottom = '10px';
    title.textContent = name || '';
    el.appendChild(title);

    // Basic metadata (Date / Size / Filesize) - always show these when available
    try {
        const meta = currentInfoMetadata || infoMetadata || null;
        if (meta && Object.keys(meta).length) {
            const basic = document.createElement('div');
            basic.style.marginBottom = '8px';
            basic.style.fontSize = '15px';
            // creation date (show even when detailed metadata is disabled)
            if (meta.creationDate || meta.creationDate === 0) {
                const d = new Date(Number(meta.creationDate));
                const p = document.createElement('div');
                p.textContent = `Date: ${isNaN(d.getTime()) ? meta.creationDate : d.toLocaleString()}`;
                p.style.fontSize = '22px';
                basic.appendChild(p);
            }
            // size
            if (meta.size && meta.size.width && meta.size.height) {
                const p = document.createElement('div');
                p.textContent = `Size: ${meta.size.width}×${meta.size.height}`;
                p.style.fontSize = '15px';
                basic.appendChild(p);
            }
            // file size
            if (meta.fileSize) {
                const p = document.createElement('div');
                const kb = Math.round(Number(meta.fileSize) / 1024);
                p.textContent = `Filesize: ${kb} KB`;
                p.style.fontSize = '15px';
                basic.appendChild(p);
            }
            el.appendChild(basic);
        }
    } catch (e) {
        // ignore
    }

    // Compose metadata, keywords and raw JSON inside a single content body whose
    // max-height is relative to the viewport so larger fonts get more room.
    const contentBody = document.createElement('div');
    contentBody.style.overflow = 'hidden';
    contentBody.style.maxHeight = 'calc(100vh - 200px)';
    contentBody.style.position = 'relative';
    contentBody.style.paddingRight = '8px';
    try {
        // detailed metadata (GPS etc.) only when metadata display enabled
        if (showInfoMetadataEnabled && (currentInfoMetadata || infoMetadata) && Object.keys(currentInfoMetadata || infoMetadata || {}).length) {
            const md = currentInfoMetadata || infoMetadata;
            const metaWrap = document.createElement('div');
            metaWrap.style.marginBottom = '8px';
            metaWrap.style.fontSize = '12px';
            // GPS
            if (md.positionData && md.positionData.GPSData) {
                const gd = md.positionData.GPSData;
                if (gd.latitude !== null && gd.longitude !== null) {
                    const p = document.createElement('div');
                    p.textContent = `GPS: ${gd.latitude}, ${gd.longitude}`;
                    p.style.fontSize = '12px';
                    metaWrap.appendChild(p);
                }
            }
            contentBody.appendChild(metaWrap);
        }
    } catch (e) {
        // ignore metadata rendering errors
    }

    // Keywords list
    if (Array.isArray(keywords) && keywords.length) {
        const kTitle = document.createElement('div');
        kTitle.style.fontWeight = '600';
        kTitle.style.margin = '6px 0 6px 0';
        kTitle.style.fontSize = '16px';
        kTitle.textContent = 'Keywords:';
        el.appendChild(kTitle);

        const kwWrap = document.createElement('div');
        kwWrap.style.display = 'flex';
        kwWrap.style.flexWrap = 'wrap';
        kwWrap.style.gap = '8px';
        kwWrap.style.marginBottom = '8px';
        kwWrap.style.overflow = 'hidden';

        keywords.forEach(kw => {
            const chip = document.createElement('span');
            chip.textContent = String(kw || '').trim();
            chip.style.display = 'inline-block';
            chip.style.padding = '6px 10px';
            chip.style.borderRadius = '10px';
            chip.style.background = 'rgba(255,255,255,0.04)';
            chip.style.border = '1px solid rgba(255,255,255,0.06)';
            chip.style.color = '#fff';
            chip.style.fontSize = '16px';
            chip.style.lineHeight = '1';
            chip.style.whiteSpace = 'nowrap';
            chip.style.overflow = 'hidden';
            chip.style.textOverflow = 'ellipsis';
            chip.title = chip.textContent;
            kwWrap.appendChild(chip);
        });
        contentBody.appendChild(kwWrap);
    }

    // small raw metadata area for copy/debug (only when metadata display enabled)
    if (showInfoMetadataEnabled && typeof infoMetadata !== 'undefined' && infoMetadata) {
        const raw = document.createElement('pre');
        raw.style.fontSize = '13px';
        raw.style.background = 'transparent';
        raw.style.color = '#ddd';
        raw.style.margin = '8px 0 0 0';
        raw.style.whiteSpace = 'pre-wrap';
        raw.style.wordBreak = 'break-word';
        raw.style.overflow = 'hidden';
        raw.textContent = JSON.stringify(infoMetadata, null, 2);
        contentBody.appendChild(raw);
    }
    // attach the content body (meta/keywords/raw) to main container
    el.appendChild(contentBody);
    // Map rendering: show Leaflet map if GPS data exists (independent of keywords)
    try {
        const md = currentInfoMetadata || infoMetadata || null;
        const gps = md && md.positionData && md.positionData.GPSData;
        const latRaw = gps && gps.latitude;
        const lonRaw = gps && gps.longitude;
        // Coerce to numbers and ensure finite values; reject empty strings or non-numeric values
        const latNum = (latRaw === null || typeof latRaw === 'undefined' || latRaw === '') ? NaN : Number(latRaw);
        const lonNum = (lonRaw === null || typeof lonRaw === 'undefined' || lonRaw === '') ? NaN : Number(lonRaw);
        if (Number.isFinite(latNum) && Number.isFinite(lonNum)) {
            const mapDiv = document.getElementById('info-leaflet-map') || document.createElement('div');
            mapDiv.id = 'info-leaflet-map';
            mapDiv.style.width = '100%';
            // Make the map square: use aspect-ratio so height matches width.
            mapDiv.style.height = 'auto';
            mapDiv.style.aspectRatio = '1 / 1';
            // Ensure reasonable min/max heights so it remains visible but not overly large
            mapDiv.style.minHeight = '200px';
            mapDiv.style.maxHeight = '60vh';
            mapDiv.style.marginTop = '8px';
            // append if not already in DOM
            if (!mapDiv.parentNode) contentBody.appendChild(mapDiv);
            try {
                if (typeof L !== 'undefined') {
                    if (infoOverlayMap) {
                        try { infoOverlayMap.remove(); } catch (e) { /* ignore */ }
                        infoOverlayMap = null;
                    }
                    infoOverlayMap = L.map(mapDiv.id, { scrollWheelZoom: false, dragging: true, zoomControl: true }).setView([latNum, lonNum], 13);
                    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                        attribution: '&copy; OpenStreetMap contributors'
                    }).addTo(infoOverlayMap);
                    L.marker([latNum, lonNum]).addTo(infoOverlayMap);
                    // Ensure Leaflet recalculates layout after being inserted/shown.
                    try {
                        infoOverlayMap.whenReady(() => {
                            // timeout gives browser a tick to layout the container
                            setTimeout(() => {
                                try { infoOverlayMap.invalidateSize(); } catch (e) { /* ignore */ }
                            }, 120);
                        });
                    } catch (e) {
                        // ignore
                    }
                }
            } catch (e) {
                console.warn('Leaflet init failed', e);
            }
        } else {
            // No GPS: ensure any previous map instance or DOM node is removed
            try {
                if (infoOverlayMap) {
                    try { infoOverlayMap.remove(); } catch (e) { /* ignore */ }
                    infoOverlayMap = null;
                }
            } catch (e) {
                // ignore
            }
            const existingMap = document.getElementById('info-leaflet-map');
            if (existingMap && existingMap.parentNode) {
                try { existingMap.parentNode.removeChild(existingMap); } catch (e) { /* ignore */ }
            }
        }
    } catch (e) {
        // ignore map rendering errors
    }
    // append a bottom fade to visually indicate truncated content instead of showing scrollbars
    let fade = document.getElementById('info-name-overlay-fade');
    if (!fade) {
        fade = document.createElement('div');
        fade.id = 'info-name-overlay-fade';
        fade.style.position = 'absolute';
        fade.style.left = '0';
        fade.style.right = '0';
        fade.style.bottom = '0';
        fade.style.height = '48px';
        fade.style.pointerEvents = 'none';
        fade.style.background = 'linear-gradient(rgba(12,12,16,0), rgba(12,12,16,0.95))';
        el.appendChild(fade);
        // add padding so content isn't obscured by fade; increase slightly for larger fonts
        el.style.paddingBottom = '88px';
    }
    el.style.display = 'block';
}

function hideInfoNameOverlay() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('info-name-overlay');
    if (el) {
        el.style.display = 'none';
        // remove leaflet map instance if present
        if (infoOverlayMap) {
            try { infoOverlayMap.remove(); } catch (e) { /* ignore */ }
            infoOverlayMap = null;
        }
        // also remove DOM map container if present
        const md = document.getElementById('info-leaflet-map');
        if (md && md.parentNode) md.parentNode.removeChild(md);
    }
}

async function preloadImages(commit = true) {
    // let randomstr = Math.random().toString(32).substring(2);
    // bgimgurl = `${rootUrl}/${pictureQuery}?${randomstr}`;
    // Prefer info-based flow: get an info URL from convertinfoapiurl, then fetch info and build media URL
    // local slots so background prefetch doesn't clobber globals
    let _bgimgurl = null;
    let _abFileTypeFromInfo = null;
    let _infoItemName = null;
    let _infoUsed = false;
    let _infoKeywords = null;
    let _infoMetadata = null;
    try {
        try {
            const ciRes = await fetchWithRetry(convertinfoapiurl, {});
            const ciJson = await ciRes.json();
            const infoUrl = ciJson && ciJson.url;
            if (infoUrl) {
                const infoRes = await fetchWithRetry(infoUrl, {});
                const infoJson = await infoRes.json();
                const infoResult = infoJson && infoJson.result;
                if (infoResult) {
                    // determine file type from name
                    const name = infoResult.name || '';
                    const ext = (name.split('.').pop() || '').toLowerCase();
                    if (ext === 'jpg' || ext === 'jpeg') _abFileTypeFromInfo = 'JPG';
                    else if (ext === 'png') _abFileTypeFromInfo = 'PNG';
                    else if (ext === 'gif') _abFileTypeFromInfo = 'GIF';
                    else if (ext === 'heic') _abFileTypeFromInfo = 'JPG';
                    else if (['mp4','webm','ogg','mkv'].includes(ext)) _abFileTypeFromInfo = 'video';
                    else _abFileTypeFromInfo = null;

                    // store metadata/keywords for later decisions (skip keywords containing '|')
                    _infoMetadata = infoResult.metadata || null;
                    const rawKeywords = (_infoMetadata && _infoMetadata.keywords) || [];
                    _infoKeywords = rawKeywords.filter(k => typeof k === 'string' && k.indexOf('|') === -1).map(k => k.trim().toLowerCase());

                    const mediaUrl = buildMediaUrlFromInfo(infoUrl, infoResult);
                    if (mediaUrl) {
                            // If we still didn't infer type, try to detect HEIC from name or url (robust against uppercase)
                            if (!_abFileTypeFromInfo) {
                                try {
                                    const nameIsHeic = /\.heic$/i.test(infoResult.name || '');
                                    const urlHasHeic = /\.heic/i.test(mediaUrl);
                                    if (nameIsHeic || urlHasHeic || mediaUrl.endsWith('/1080')) {
                                        _abFileTypeFromInfo = 'JPG';
                                    }
                                } catch (e) {
                                    // ignore
                                }
                            }
                        _bgimgurl = mediaUrl;
                        _infoItemName = infoResult.name || null;
                        _infoUsed = true;
                    }
                }
            }
        } catch (ie) {
            console.warn('preloadImages: info-based flow failed, falling back', ie);
        }

        // If info-based did not provide a media URL, do not fall back to legacy endpoints
        if (!_bgimgurl) {
            _infoItemName = null;
            _infoUsed = false;
            console.warn('preloadImages: no media URL from info API; skipping legacy fetches');
            _bgimgurl = null;
        }

    } catch (e) {
        console.warn('preloadImages: info fetch failed', e);
        _bgimgurl = null;
    }

    if (!_bgimgurl) {
        console.error('preloadImages: no media URL from info API');
        return null;
    }

    console.log('preloadImages url=', _bgimgurl, 'inferredType=', _abFileTypeFromInfo, 'commit=', !!commit);

    if (commit) {
        // apply to globals for immediate consumption
        bgimgurl = _bgimgurl;
        abFileTypeFromInfo = _abFileTypeFromInfo;
        infoItemName = _infoItemName;
        infoUsed = _infoUsed;
        infoKeywords = _infoKeywords;
        infoMetadata = _infoMetadata;
        return {
            bgimgurl: _bgimgurl,
            abFileTypeFromInfo: _abFileTypeFromInfo,
            infoItemName: _infoItemName,
            infoUsed: _infoUsed,
            infoKeywords: _infoKeywords,
            infoMetadata: _infoMetadata
        };
    }
    // store as prefetched info for next cycle
    prefetchedInfo = {
        bgimgurl: _bgimgurl,
        abFileTypeFromInfo: _abFileTypeFromInfo,
        infoItemName: _infoItemName,
        infoUsed: _infoUsed,
        infoKeywords: _infoKeywords,
        infoMetadata: _infoMetadata
    };
    return prefetchedInfo;
}

// Helper: apply image background and toggle visibility/styles
function applyImageBackground(imageUrl, is_animation, posX) {
    // Simplified image handling for new layered layout using <img> elements.
    // Stop/hide videos
    try {
        if (randomVideo && !randomVideo.paused) { randomVideo.pause(); }
        if (randomVideoLarge && !randomVideoLarge.paused) { randomVideoLarge.pause(); }
    } catch (e) { /* ignore */ }

    // Ensure image elements are unhidden when showing images (robust for both sets)
    try {
        [imgBg1, imgMain1, imgBg2, imgMain2].forEach(el => {
            if (!el) return;
            try { el.hidden = false; } catch (e) { /* ignore */ }
        });
    } catch (e) { /* ignore */ }

    // If elements are missing, nothing to do
    if (!randomImage && !mainImage) return;

    // Animated images: set both sources and show them (GIF/APNG will animate in <img>)
    if (is_animation) {
        if (randomImage) { randomImage.src = imageUrl; randomImage.style.objectFit = 'cover'; randomImage.classList.add('visible'); }
        if (mainImage) { mainImage.src = imageUrl; mainImage.style.objectFit = 'contain'; mainImage.classList.add('visible'); }
        if (randomVideo) randomVideo.classList.remove('visible');
        if (randomVideoLarge) randomVideoLarge.classList.remove('visible');
        return;
    }

    // Static images: true crossfade using alternating sets
    try {
        // Determine which set to use next
        const nextBg = useMainImageLayer ? imgBg2 : imgBg1;
        const nextMain = useMainImageLayer ? imgMain2 : imgMain1;
        const prevBg = useMainImageLayer ? imgBg1 : imgBg2;
        const prevMain = useMainImageLayer ? imgMain1 : imgMain2;
        
        // Preload the new image first
        const preloadImg = new Image();
        preloadImg.onload = () => {
            // Set sources on the next set (while invisible)
            if (nextBg) {
                nextBg.src = imageUrl;
                nextBg.style.objectFit = 'cover';
                // set initial objectPosition based on orientation (will be adjusted after preloadImg loads)
                nextBg.style.objectPosition = '50% 100%';
            }
            if (nextMain) {
                nextMain.src = imageUrl;
                nextMain.style.objectFit = 'contain';
            }
            
            // Crossfade: fade in next set while fading out previous set
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    // Fade in new set
                            if (nextBg) nextBg.classList.add('visible');
                            if (nextMain) nextMain.classList.add('visible');
                            // Ensure any playing videos are fully stopped/hidden when images show
                            try {
                                [vidBg1, vidMain1, vidBg2, vidMain2, randomVideo, randomVideoLarge].forEach(v => {
                                    if (!v) return;
                                    try { v.classList.remove('visible'); } catch (e) { /* ignore */ }
                                    try { v.pause(); } catch (e) { /* ignore */ }
                                    try { v.currentTime = 0; } catch (e) { /* ignore */ }
                                    try { v.src = ''; } catch (e) { /* ignore */ }
                                    try { v.hidden = true; } catch (e) { /* ignore */ }
                                    try { v.style.filter = ''; } catch (e) { /* ignore */ }
                                    try { v.style.zIndex = ''; } catch (e) { /* ignore */ }
                                });
                            } catch (e) { /* ignore */ }
                    // Fade out old set
                    if (prevBg) prevBg.classList.remove('visible');
                    if (prevMain) prevMain.classList.remove('visible');
                    // cancel pan on the previous bg and start pan on the new one
                    try { if (prevBg) cancelPan(prevBg); } catch (e) { /* ignore */ }
                    try {
                        if (nextBg && !is_animation) {
                            // decide pan orientation based on loaded image aspect ratio if available
                            const w = preloadImg.naturalWidth || 0;
                            const h = preloadImg.naturalHeight || 0;
                            const orientation = (w > h) ? 'horizontal' : 'vertical';
                            // set appropriate start pos
                            if (orientation === 'horizontal') nextBg.style.objectPosition = '0% 50%';
                            else nextBg.style.objectPosition = '50% 100%';
                            startPan(nextBg, STATIC_DISPLAY_MS, orientation);
                        }
                    } catch (e) { /* ignore */ }
                    // Toggle for next cycle
                    useMainImageLayer = !useMainImageLayer;
                });
            });
        };
        preloadImg.onerror = () => {
            console.warn('Image preload failed, applying without fade');
            if (nextBg) {
                nextBg.src = imageUrl;
                nextBg.style.objectFit = 'cover';
                nextBg.style.objectPosition = '50% 100%';
                nextBg.classList.add('visible');
            }
            if (nextMain) {
                nextMain.src = imageUrl;
                nextMain.style.objectFit = 'contain';
                nextMain.classList.add('visible');
            }
            if (prevBg) { prevBg.classList.remove('visible'); try { cancelPan(prevBg); } catch (e) { /* ignore */ } }
            // Ensure videos are stopped/hidden on image fallback as well
            try {
                [vidBg1, vidMain1, vidBg2, vidMain2, randomVideo, randomVideoLarge].forEach(v => {
                    if (!v) return;
                    try { v.classList.remove('visible'); } catch (e) { /* ignore */ }
                    try { v.pause(); } catch (e) { /* ignore */ }
                    try { v.currentTime = 0; } catch (e) { /* ignore */ }
                    try { v.src = ''; } catch (e) { /* ignore */ }
                    try { v.hidden = true; } catch (e) { /* ignore */ }
                });
            } catch (e) { /* ignore */ }
            if (nextBg && !is_animation) {
                // best-effort: assume vertical pan on error fallback
                try { nextBg.style.objectPosition = '50% 100%'; startPan(nextBg, STATIC_DISPLAY_MS, 'vertical'); } catch (e) { /* ignore */ }
            }
            if (prevMain) prevMain.classList.remove('visible');
            useMainImageLayer = !useMainImageLayer;
        };
        preloadImg.src = imageUrl;
        
        // Hide all videos
        if (vidBg1) vidBg1.classList.remove('visible');
        if (vidMain1) vidMain1.classList.remove('visible');
        if (vidBg2) vidBg2.classList.remove('visible');
        if (vidMain2) vidMain2.classList.remove('visible');
    } catch (e) {
        // fallback: set background via inline styles if anything fails
        try {
            const bg = `url(${imageUrl})`;
            if (randomImage) { randomImage.style.backgroundImage = bg; randomImage.classList.add('visible'); }
            if (mainImage) { mainImage.style.backgroundImage = bg; mainImage.classList.add('visible'); }
        } catch (ie) { /* ignore */ }
    }
}

// Helper: show video from direct URL and wait appropriate time
async function showVideoFromUrl(mediaUrl) {
    if (!randomVideo || !randomVideoLarge) return;
    // Use background video as looping cover, and main video as front play
    try {
        // Ensure video elements are visible/unhidden when switching from images
        try { if (randomVideo) randomVideo.hidden = false; } catch (e) { /* ignore */ }
        try { if (randomVideoLarge) randomVideoLarge.hidden = false; } catch (e) { /* ignore */ }

        // Hide all image elements to avoid leftover image visibility during transition
        try {
            [imgBg1, imgMain1, imgBg2, imgMain2].forEach(el => {
                if (!el) return;
                try { el.classList.remove('visible'); } catch (e) { /* ignore */ }
                try { el.hidden = true; } catch (e) { /* ignore */ }
                try { cancelPan(el); } catch (e) { /* ignore */ }
            });
        } catch (e) { /* ignore */ }

        randomVideo.src = mediaUrl;
        randomVideo.loop = true;
        randomVideo.muted = true;
        randomVideo.classList.add('visible');
        try {
            // Ensure background video keeps blur and sits under the front video
            try { randomVideo.style.filter = `blur(${BG_BLUR_PX}px)`; } catch (e) { /* ignore */ }
            try { randomVideo.style.zIndex = 1000; } catch (e) { /* ignore */ }
            randomVideo.load();
            await randomVideo.play();
        } catch (e) { /* ignore autoplay errors */ }

        randomVideoLarge.src = mediaUrl;
        randomVideoLarge.loop = false;
        randomVideoLarge.muted = true;
        // front video plays once
        randomVideoLarge.classList.remove('visible');
        // Immediately inspect metadata when available and decide
        // whether to enable a temporary loop for very short clips.
        let _metaListener = null;
        _metaListener = () => {
            try {
                const d = Number(randomVideoLarge.duration) || 0;
                const dMs = Math.round((d || 0) * 1000);
                if (!d || isNaN(d) || dMs === 0 || dMs < MIN_VIDEO_DISPLAY_MS) {
                    frontTempLoop = true;
                    try { randomVideoLarge.loop = true; } catch (e) { /* ignore */ }
                } else {
                    frontTempLoop = false;
                    try { randomVideoLarge.loop = false; } catch (e) { /* ignore */ }
                }
                // ensure playback starts as soon as possible for short clips
                try { randomVideoLarge.play().catch(() => {}); } catch (e) { /* ignore */ }
            } catch (e) { /* ignore */ }
            try { randomVideoLarge.removeEventListener('loadedmetadata', _metaListener); } catch (e) { /* ignore */ }
        };
        try { randomVideoLarge.addEventListener('loadedmetadata', _metaListener); } catch (e) { /* ignore */ }
        try {
            // Ensure front video has no blur and sits above the background
            try { randomVideoLarge.style.filter = 'none'; } catch (e) { /* ignore */ }
            try { randomVideoLarge.style.zIndex = 1001; } catch (e) { /* ignore */ }
            randomVideoLarge.load();
            await randomVideoLarge.play();
        } catch (e) { /* ignore */ }
        // fade in front video
        requestAnimationFrame(() => { randomVideoLarge.classList.add('visible'); });

        // hide images
        try {
            [imgBg1, imgMain1, imgBg2, imgMain2].forEach(el => { if (el) { try { el.classList.remove('visible'); } catch (e){} } });
        } catch (e) { /* ignore */ }

        // wait for metadata then decide whether the front video should loop
        await _sleep(VIDEO_METADATA_WAIT_MS);
        const dur = Number(randomVideoLarge.duration) || 0;
        const durMs = Math.round((dur || 0) * 1000);
        if (!dur || isNaN(dur) || durMs <= 0) {
            // unknown duration -> treat as short: ensure temp-loop is enabled
            if (!frontTempLoop) {
                try { randomVideoLarge.loop = true; frontTempLoop = true; } catch (e) { /* ignore */ }
            }
            await _sleep(VIDEO_SHORT_FALLBACK_MS);
            try {
                frontTempLoop = false;
                randomVideoLarge.loop = false;
                randomVideoLarge.classList.remove('visible');
                randomVideoLarge.currentTime = 0;
                randomVideoLarge.pause();
                try { randomVideoLarge.hidden = true; } catch (e) { /* ignore */ }
            } catch (e) { /* ignore */ }
        } else if (durMs < MIN_VIDEO_DISPLAY_MS) {
            // short clip -> ensure temp-loop is enabled immediately
            if (!frontTempLoop) {
                try { randomVideoLarge.loop = true; frontTempLoop = true; } catch (e) { /* ignore */ }
            }
            await _sleep(MIN_VIDEO_DISPLAY_MS);
            try {
                frontTempLoop = false;
                randomVideoLarge.loop = false;
                randomVideoLarge.classList.remove('visible');
                randomVideoLarge.currentTime = 0;
                randomVideoLarge.pause();
                try { randomVideoLarge.hidden = true; } catch (e) { /* ignore */ }
            } catch (e) { /* ignore */ }
        } else {
            // sufficiently long: play once but ensure at least MIN_VIDEO_DISPLAY_MS
            const waitMs = Math.max(MIN_VIDEO_DISPLAY_MS, durMs - VIDEO_META_PAD_MS);
            await _sleep(waitMs);
            try {
                frontTempLoop = false;
                randomVideoLarge.classList.remove('visible');
                randomVideoLarge.currentTime = 0;
                randomVideoLarge.pause();
                try { randomVideoLarge.hidden = true; } catch (e) { /* ignore */ }
            } catch (e) { /* ignore */ }
        }
    } catch (e) {
        console.warn('showVideoFromUrl failed', e);
    }
}


let cycleMedia = async () => {
    try {
        // If a prefetched item exists (from previous cycle), consume it instead
        if (prefetchedInfo && prefetchedInfo.bgimgurl) {
            bgimgurl = prefetchedInfo.bgimgurl;
            abFileTypeFromInfo = prefetchedInfo.abFileTypeFromInfo;
            infoItemName = prefetchedInfo.infoItemName;
            infoUsed = prefetchedInfo.infoUsed;
            infoKeywords = prefetchedInfo.infoKeywords;
            infoMetadata = prefetchedInfo.infoMetadata;
            // clear prefetch slot
            prefetchedInfo = null;
        } else {
            await preloadImages(true);
        }

        // Ensure we have a media URL (info-based flow sets `bgimgurl`)
        if (!bgimgurl) {
            console.warn('cycleMedia: no media URL available, retrying after delay');
            await _sleep(NO_DATA_RETRY_MS);
            return 'no-data';
        }

        // Note: do not hide the overlay here — keep overlay visibility
        // controlled by the user's setting so it doesn't flicker during
        // media crossfades/transitions.

        // Prefer file type inferred from info API
        let fileType = abFileTypeFromInfo;
        console.log('detected fileType=', fileType, 'inferred=', abFileTypeFromInfo);
        if (!fileType) {
            console.error('cycleMedia: no file type inferred from Info API; aborting (no fallback)');
            await _sleep(NO_DATA_RETRY_MS);
            return 'no-type';
        }
        // clear inference after use
        abFileTypeFromInfo = null;

        if (fileType === 'GIF') {
            is_animation = true;
            applyImageBackground(bgimgurl, true);
            // record as currently displayed
            currentInfoName = infoItemName;
            currentInfoKeywords = infoKeywords;
            currentInfoMetadata = infoMetadata;
            currentMediaUrl = bgimgurl;
        } else if (fileType === 'JPG') {
            is_animation = false;
            try {
                // EXIF from binary is no longer needed; prefer info metadata if available
                if (infoMetadata) displayExif(infoMetadata);
            } catch (e) {
                console.warn('displayExif via metadata failed', e);
            }
            applyImageBackground(bgimgurl, false, 'center');
            // record as currently displayed
            currentInfoName = infoItemName;
            currentInfoKeywords = infoKeywords;
            currentInfoMetadata = infoMetadata;
            currentMediaUrl = bgimgurl;
        } else if (fileType === 'PNG') {
            // imageUrl is bgimgurl
            // Determine APNG by keywords when available; no binary fallback
            const isApng = Array.isArray(infoKeywords) && infoKeywords.includes('apng');
            if (!isApng) {
                is_animation = false;
                applyImageBackground(bgimgurl, false, '20vw');
                const img = new Image();
                img.onload = () => {
                    if ((img.naturalWidth / img.naturalHeight) < 1.6 && mainImage) {
                        mainImage.style.backgroundPositionX = '10vw';
                    }
                    console.log(img.naturalWidth / img.naturalHeight);
                };
                img.src = bgimgurl;
                // record as currently displayed even for non-APNG PNGs
                currentInfoName = infoItemName;
                currentInfoKeywords = infoKeywords;
                currentInfoMetadata = infoMetadata;
                currentMediaUrl = bgimgurl;
            } else {
                is_animation = true;
                applyImageBackground(bgimgurl, true);
                // record as currently displayed
                currentInfoName = infoItemName;
                currentInfoKeywords = infoKeywords;
                currentInfoMetadata = infoMetadata;
                currentMediaUrl = bgimgurl;
            }
        }

        if (fileType === 'video') {
            // mark current before awaiting so toggle shows correct info
            currentInfoName = infoItemName;
            currentInfoKeywords = infoKeywords;
            currentInfoMetadata = infoMetadata;
            currentMediaUrl = bgimgurl;
            await showVideoFromUrl(bgimgurl);
            // show overlay for videos according to user setting — keep overlay
            // visible when enabled so it doesn't blink away for items without
            // metadata during transitions.
            if (showInfoOverlayEnabled) {
                showInfoNameOverlay(currentInfoName, currentInfoKeywords);
            } else {
                hideInfoNameOverlay();
            }
            return;
        } else {
            if (randomVideo) randomVideo.hidden = true;
            if (randomVideoLarge) randomVideoLarge.hidden = true;
            if (randomImage) randomImage.hidden = false;
        }

        try { preloadImages(false); } catch (e) { console.warn('preloadImages background failed', e); }

        // show overlay after applying image so it reflects the shown media
        if (!fileType || fileType !== 'video') {
            // For images, keep overlay visible when the user enabled it.
            if (showInfoOverlayEnabled) {
                showInfoNameOverlay(currentInfoName, currentInfoKeywords);
            } else {
                hideInfoNameOverlay();
            }
        }

        if (is_animation) {
            await _sleep(ANIMATION_DISPLAY_MS);
            console.log(`${ANIMATION_DISPLAY_MS}ms`);
        } else {
            await _sleep(STATIC_DISPLAY_MS);
            console.log(`${STATIC_DISPLAY_MS}ms`);
        }
        return 'ok';
    } catch (e) {
        console.error('cycleMedia: unexpected error', e);
        try { await _sleep(NO_DATA_RETRY_MS); } catch (ie) { }
        return 'error';
    }
};

// Populate EXIF text area; keeps content concise
// Populate EXIF panel with structured fields and provide copy/close controls
function displayExif(exif) {
    if (typeof document === 'undefined') return;
    try {
        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value || '-';
        };
        // date/time: support EXIF-like object and Info API metadata (creationDate in ms)
        let dateText = '-';
        if (exif.DateTime || exif.DateTimeOriginal || exif.CreateDate) {
            dateText = exif.DateTime || exif.DateTimeOriginal || exif.CreateDate;
        } else if (exif.creationDate || exif.creationDate === 0) {
            try {
                const d = new Date(Number(exif.creationDate));
                if (!isNaN(d.getTime())) dateText = d.toISOString();
            } catch (e) {
                // ignore
            }
        }
        setText('exif-date', dateText || '-');

        // GPS: convert to decimal degrees if available
        const gpsToDecimal = (gpsArray, ref) => {
            try {
                if (!gpsArray || gpsArray.length < 3) return null;
                // gpsArray often [deg, min, sec]
                const deg = Number(gpsArray[0]);
                const min = Number(gpsArray[1]);
                const sec = Number(gpsArray[2]);
                let dec = deg + (min / 60) + (sec / 3600);
                if (ref === 'S' || ref === 'W') dec = -dec;
                return Math.round(dec * 1e6) / 1e6; // 6 decimal places
            } catch (e) {
                return null;
            }
        };

        let gpsText = '-';
        try {
            // EXIF-style GPS arrays
            const lat = gpsToDecimal(exif.GPSLatitude, exif.GPSLatitudeRef);
            const lon = gpsToDecimal(exif.GPSLongitude, exif.GPSLongitudeRef);
            if (lat !== null && lon !== null) {
                gpsText = `${lat}, ${lon}`;
            } else if (exif.positionData && exif.positionData.GPSData) {
                // Info API style
                const gd = exif.positionData.GPSData;
                if (gd.latitude !== null && gd.longitude !== null) {
                    gpsText = `${gd.latitude}, ${gd.longitude}`;
                }
            }
        } catch (e) {
            // ignore
        }
        setText('exif-gps', gpsText);

        // Keywords: try several tags (XPKeywords may be byte array)
        const decodeXP = (xp) => {
            try {
                if (!xp) return null;
                if (Array.isArray(xp)) {
                    // interpret as UTF-16LE bytes
                    let chars = [];
                    for (let i = 0; i < xp.length; i += 2) {
                        const lo = xp[i] || 0;
                        const hi = xp[i + 1] || 0;
                        const code = lo + (hi << 8);
                        if (code === 0) break;
                        chars.push(String.fromCharCode(code));
                    }
                    return chars.join('');
                }
                return String(xp);
            } catch (e) {
                return null;
            }
        };

        let keywords = '-';
        try {
            // Info API: metadata.keywords is usually an array
            if (Array.isArray(exif.keywords) && exif.keywords.length) {
                const ks = exif.keywords.filter(k => typeof k === 'string' && k.indexOf('|') === -1).map(k => k.trim()).filter(Boolean);
                if (ks.length) keywords = ks.join(' ; ');
            } else {
                const candidates = [];
                if (exif.XPKeywords) candidates.push(decodeXP(exif.XPKeywords));
                if (exif.Keywords) candidates.push(exif.Keywords);
                if (exif.ImageDescription) candidates.push(exif.ImageDescription);
                if (exif.Subject) candidates.push(exif.Subject);
                const filtered = candidates.filter(Boolean).map(v => String(v).trim()).filter(v => v.length > 0);
                if (filtered.length) keywords = filtered.join(' ; ');
            }
        } catch (e) {
            // ignore
        }
        setText('exif-keywords', keywords);

        // store raw text as well for copy button
        const raw = {
            DateTime: dateText || (exif.DateTime || exif.DateTimeOriginal || exif.CreateDate),
            GPS: gpsText !== '-' ? gpsText : null,
            Keywords: keywords !== '-' ? keywords : null
        };
        const exifTextPEl = document.getElementById('exif-text-p');
        if (exifTextPEl) exifTextPEl.textContent = JSON.stringify(raw, null, 2);

        // show panel if hidden
        if (exifContainer && exifContainer.hasAttribute('hidden')) {
            exifContainer.removeAttribute('hidden');
            if (exifToggleButton) exifToggleButton.setAttribute('aria-pressed', 'true');
        }

    } catch (e) {
        console.warn('displayExif error', e);
    }
}

// EXIF toggle button behavior
if (typeof exifToggleButton !== 'undefined' && exifToggleButton !== null) {
    exifToggleButton.addEventListener('click', () => {
        if (!exifContainer) return;
        const isHidden = exifContainer.hasAttribute('hidden');
        if (isHidden) {
            exifContainer.removeAttribute('hidden');
            exifToggleButton.setAttribute('aria-pressed', 'true');
        } else {
            exifContainer.setAttribute('hidden', '');
            exifToggleButton.setAttribute('aria-pressed', 'false');
        }
    });
}

// Settings button / popup behavior
try {
    if (typeof document !== 'undefined' && settingsBtn) {
        // show popup toggle
        settingsBtn.addEventListener('click', (e) => {
            if (!settingsPopup) return;
            const visible = settingsPopup.style.display === 'block';
            settingsPopup.style.display = visible ? 'none' : 'block';
            settingsBtn.setAttribute('aria-expanded', (!visible).toString());
            // reflect current state
            if (settingsOverlayCheckbox) settingsOverlayCheckbox.checked = !!showInfoOverlayEnabled;
            if (settingsMetadataCheckbox) settingsMetadataCheckbox.checked = !!showInfoMetadataEnabled;
        });
    }
    if (settingsOverlayCheckbox) {
        settingsOverlayCheckbox.addEventListener('change', (e) => {
            showInfoOverlayEnabled = !!e.target.checked;
            if (!showInfoOverlayEnabled) {
                hideInfoNameOverlay();
            } else {
                // apply immediately if info was already fetched
                if (infoUsed && (infoItemName || (Array.isArray(infoKeywords) && infoKeywords.length))) {
                    showInfoNameOverlay(infoItemName, infoKeywords);
                }
            }
        });
    }
    if (settingsMetadataCheckbox) {
        settingsMetadataCheckbox.addEventListener('change', (e) => {
            showInfoMetadataEnabled = !!e.target.checked;
            // if overlay is currently visible, re-render it immediately using
            // the *currently displayed* media info so the metadata change takes effect
            if (document.getElementById('info-name-overlay')) {
                hideInfoNameOverlay();
                if (showInfoOverlayEnabled && (currentInfoName || (Array.isArray(currentInfoKeywords) && currentInfoKeywords.length))) {
                    showInfoNameOverlay(currentInfoName, currentInfoKeywords);
                }
            }
        });
    }
    // close popup when clicking outside of it
    if (typeof document !== 'undefined') {
        document.addEventListener('click', (ev) => {
            try {
                if (!settingsPopup) return;
                if (settingsPopup.style.display !== 'block') return;
                const tgt = ev.target;
                if (tgt && (tgt.closest('#settings-popup') || tgt.closest('#settings-btn') || tgt.closest('#settings-container'))) {
                    return; // click inside popup or on the button - ignore
                }
                // otherwise close popup
                settingsPopup.style.display = 'none';
                if (settingsBtn) settingsBtn.setAttribute('aria-expanded', 'false');
            } catch (e) {
                // ignore
            }
        });
    }
    const settingsClose = (typeof document !== 'undefined') ? document.getElementById('settings-close') : null;
    if (settingsClose) settingsClose.addEventListener('click', () => { if (settingsPopup) settingsPopup.style.display = 'none'; if (settingsBtn) settingsBtn.setAttribute('aria-expanded', 'false'); });
} catch (e) {
    console.warn('Settings wiring failed', e);
}

// wire EXIF panel controls (copy / close)
try {
    if (typeof document !== 'undefined') {
        const copyBtn = document.getElementById('exif-copy');
        const closeBtn = document.getElementById('exif-close');
        if (copyBtn) {
            copyBtn.addEventListener('click', async () => {
                const txtEl = document.getElementById('exif-text-p');
                const payload = txtEl ? txtEl.textContent : null;
                if (!payload) return;
                try {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        await navigator.clipboard.writeText(payload);
                        console.log('EXIF copied to clipboard');
                    } else {
                        const ta = document.createElement('textarea');
                        ta.value = payload;
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                        console.log('EXIF copied via fallback');
                    }
                } catch (e) {
                    console.warn('Failed to copy EXIF', e);
                }
            });
        }
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                if (!exifContainer) return;
                exifContainer.setAttribute('hidden', '');
                if (exifToggleButton) exifToggleButton.setAttribute('aria-pressed', 'false');
            });
        }
    }
} catch (e) {
    console.warn('EXIF control wiring failed', e);
}

const exec = async () => {
    while (true) {
        // eslint-disable-next-line no-await-in-loop
        s = await cycleMedia();
        console.log(`${s} end.`);
    }
};
// Global error handler to avoid silent crashes in the browser
if (typeof window !== 'undefined') {
    window.addEventListener('error', function (e) {
        console.error('Global error caught:', e && e.error ? e.error : e);
        // allow loop to continue; exec has its own try/catch
    });
    window.addEventListener('unhandledrejection', function (e) {
        console.error('Unhandled promise rejection:', e.reason || e);
    });
    // start main loop
    exec();
} else {
    console.log('app.js: not running main loop (non-browser environment)');
}
